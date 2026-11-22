"""
Habits from the "My Habits" app (a Loop Habit Tracker fork). Habits made in the tracker itself live in the same
tables (see `Habit.source`) and don't come through here.

My Habits writes a full backup, a SQLite `.db` file, to a Google Drive folder. This module finds the newest one
there, reads it (read-only), lists the habits in it to choose from (`list_drive_habits`) and copies the chosen ones,
and their recent days, into the tracker's own tables (`import_habits`), so the Habits tab can show them. A sync then
keeps those up to date. The tracker never writes back to Drive: the backup is the only copy the other app has.

Access is a service account that the Drive folder is shared with as Viewer, so there is no sign-in step. Two
environment variables set it up, the same two the Habits-Tracking site uses:
  GOOGLE_DRIVE_FOLDER_ID           the id at the end of the folder's URL
  GOOGLE_SERVICE_ACCOUNT_JSON      the key file's JSON, or that JSON base64-encoded
The Google client libraries are only imported when a sync runs, so the rest of the app doesn't need them.

Loop stores everything as integers; what they mean depends on the habit (see `decode`).
"""

import base64
import binascii
import io
import json
import os
import sqlite3
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from .models import Habit, HabitEntry, HabitSync, utcnow

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
# How many days of each habit are kept: enough for the streaks and the strips the tab shows
KEEP_DAYS = 120

# Loop's habit types: 0 yes/no, 1 numerical, and this fork's native times of day (10 time, 11 wake up, 12 bedtime)
BOOLEAN, NUMERICAL = 0, 1
TIME_TYPES = {10, 11, 12}
NUMERIC_SCALE = 1000  # numerical entries are stored x1000
TIME_BASE = 1000  # a time-of-day entry is stored as 1000 + minutes since midnight
_BOOLEAN_STATUS = {2: "yes", 1: "yes", 0: "no", 3: "skip", -1: "unknown"}  # 1 is Loop filling a day in by itself


class HabitsError(Exception):
    """Something the owner can act on; `status` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class BackupFile:
    name: str
    md5: Optional[str]
    modified: Optional[datetime]
    data: bytes


@dataclass(frozen=True)
class LoopHabit:
    local_id: int
    uuid: str
    name: str
    question: str
    unit: str
    value_type: str  # boolean | numerical | time
    target_type: Optional[str]
    target_value: Optional[float]
    freq_num: Optional[int]
    freq_den: Optional[int]
    position: int
    archived: bool


@dataclass(frozen=True)
class LoopEntry:
    habit_uuid: str
    day: date
    status: str  # yes | no | skip | unknown | value
    value: Optional[float]


# ── Reading a backup ─────────────────────────────────────────────────────────

def decode(loop_type: int, raw: Optional[int]) -> tuple[str, Optional[float]]:
    """One stored entry -> (status, value). A yes/no habit's value is 1 for a yes. A numerical habit's is the
    number entered (6000 -> 6.0). A time habit's is minutes since midnight; an entry with no time (a no, a skip)
    has no value, so it is never read as midnight."""
    if loop_type in TIME_TYPES:
        if raw is not None and raw >= TIME_BASE:
            return "value", float(raw - TIME_BASE)
        return _BOOLEAN_STATUS.get(raw, "unknown"), None
    if loop_type == NUMERICAL:
        return ("unknown", None) if raw is None else ("value", raw / NUMERIC_SCALE)
    status = _BOOLEAN_STATUS.get(raw, "unknown")
    return status, 1.0 if status == "yes" else None


def _value_type(loop_type: int) -> str:
    if loop_type in TIME_TYPES:
        return "time"
    return "numerical" if loop_type == NUMERICAL else "boolean"


def read_backup(path: Path | str, keep_days: int = KEEP_DAYS) -> tuple[list[LoopHabit], list[LoopEntry]]:
    """The habits in a Loop backup, and their entries from the last `keep_days` days."""
    conn = sqlite3.connect(f"file:{Path(path).as_posix()}?mode=ro", uri=True)  # read-only: it is someone's backup
    conn.row_factory = sqlite3.Row
    try:
        try:
            rows = conn.execute(
                "SELECT id, uuid, name, description, question, unit, type, target_type, target_value, "
                "freq_num, freq_den, position, archived FROM Habits"
            ).fetchall()
        except sqlite3.DatabaseError as error:
            raise HabitsError("That file is not a Loop Habits backup", 422) from error
        habits, types = [], {}
        for row in rows:
            if not row["uuid"]:  # no stable key to match it by next time
                continue
            loop_type = row["type"]
            is_time = loop_type in TIME_TYPES
            target = row["target_value"]
            habits.append(
                LoopHabit(
                    local_id=row["id"],
                    uuid=row["uuid"],
                    name=row["name"] or "",
                    question=row["question"] or row["description"] or "",
                    unit="HH:MM" if is_time else (row["unit"] or ""),
                    value_type=_value_type(loop_type),
                    target_type={0: "at_least", 1: "at_most"}.get(row["target_type"]),
                    target_value=float(target) if target and target > 0 else None,
                    freq_num=row["freq_num"],
                    freq_den=row["freq_den"],
                    position=row["position"] or 0,
                    archived=bool(row["archived"]),
                )
            )
            types[row["id"]] = (row["uuid"], loop_type)

        # Loop stores midnight of the entry's day in UTC, so reading it back in UTC gives the calendar day
        cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)
        entries = []
        for row in conn.execute(
            "SELECT habit, timestamp, value FROM Repetitions WHERE timestamp >= ? ORDER BY habit, timestamp",
            (int(cutoff.timestamp() * 1000),),
        ):
            found = types.get(row["habit"])
            if found is None:
                continue
            status, value = decode(found[1], row["value"])
            day = datetime.fromtimestamp(row["timestamp"] / 1000, tz=timezone.utc).date()
            entries.append(LoopEntry(found[0], day, status, value))
        return habits, entries
    finally:
        conn.close()


# ── Google Drive ─────────────────────────────────────────────────────────────

def drive_configured() -> bool:
    return bool(os.environ.get("GOOGLE_DRIVE_FOLDER_ID", "").strip() and os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip())


def _service():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw.startswith("{"):
        try:
            raw = base64.b64decode(raw).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as error:
            raise HabitsError("GOOGLE_SERVICE_ACCOUNT_JSON is neither JSON nor base64", 503) from error
    try:
        info = json.loads(raw)
    except json.JSONDecodeError as error:
        raise HabitsError("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON", 503) from error
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError as error:
        raise HabitsError("Drive sync needs google-api-python-client and google-auth (pip install -r requirements.txt)", 503) from error
    credentials = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def fetch_latest_backup() -> Optional[BackupFile]:
    """The newest `.db` in the Drive folder, downloaded; None if the folder has none."""
    if not drive_configured():
        raise HabitsError("Drive sync is not set up: set GOOGLE_DRIVE_FOLDER_ID and GOOGLE_SERVICE_ACCOUNT_JSON", 503)
    folder = os.environ["GOOGLE_DRIVE_FOLDER_ID"].strip()
    try:
        from googleapiclient.http import MediaIoBaseDownload

        service = _service()
        listing = (
            service.files()
            .list(
                q=f"'{folder}' in parents and trashed = false",
                orderBy="modifiedTime desc",
                pageSize=25,
                fields="files(id, name, modifiedTime, md5Checksum)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute()
        )
        item = next((f for f in listing.get("files", []) if f["name"].lower().endswith(".db")), None)
        if item is None:
            return None
        buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(buffer, service.files().get_media(fileId=item["id"], supportsAllDrives=True))
        done = False
        while not done:
            _, done = downloader.next_chunk()
    except HabitsError:
        raise
    except ImportError as error:
        raise HabitsError("Drive sync needs google-api-python-client and google-auth (pip install -r requirements.txt)", 503) from error
    except Exception as error:  # the Drive client raises its own kinds: say what it said
        raise HabitsError(f"Google Drive refused: {error}") from error
    modified = datetime.fromisoformat(item["modifiedTime"].replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
    return BackupFile(item["name"], item.get("md5Checksum"), modified, buffer.getvalue())


# ── Copying it in ────────────────────────────────────────────────────────────

def _read_habits(backup: BackupFile) -> tuple[list[LoopHabit], list[LoopEntry]]:
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "backup.db"
        path.write_bytes(backup.data)
        habits, entries = read_backup(path)
    if not habits:  # a broken export must not retire everything
        raise HabitsError("That backup has no habits in it, so nothing was changed", 422)
    return habits, entries


def _newest_backup() -> BackupFile:
    backup = fetch_latest_backup()
    if backup is None:
        raise HabitsError("No .db backup in the Drive folder. Export one from My Habits (Settings, export full backup)", 404)
    return backup


def _imported(db: DbSession, user_id: str) -> dict[str, Habit]:
    """The user's habits that came from Drive, by their key there."""
    return {
        h.loop_uuid: h
        for h in db.scalars(select(Habit).where(Habit.user_id == user_id, Habit.source == "drive", Habit.loop_uuid.is_not(None)))
    }


def list_drive_habits(db: DbSession, user_id: str) -> dict:
    """What is in the newest backup, to choose from: {file_name, habits: [{uuid, name, value_type, unit, archived,
    imported}]}. `imported` says the user already has it. Nothing is changed."""
    backup = _newest_backup()
    habits, _ = _read_habits(backup)
    have = _imported(db, user_id)
    return {
        "file_name": backup.name,
        "habits": [
            {"uuid": h.uuid, "name": h.name, "value_type": h.value_type, "unit": h.unit, "archived": h.archived, "imported": h.uuid in have}
            for h in sorted(habits, key=lambda h: (h.archived, h.position, h.name.lower()))
        ],
    }


def _copy_in(db: DbSession, user_id: str, backup: BackupFile, wanted: Optional[set[str]]) -> dict:
    """Copy habits from `backup`: the ones the user already imported are brought up to date, and those in `wanted`
    (keys in the backup) are added. Habits are added and updated, never deleted: an imported one missing from the
    backup is marked removed and keeps its days. Returns {changed, file_name, habits}."""
    habits, entries = _read_habits(backup)
    now = utcnow()
    existing = _imported(db, user_id)
    take = set(existing) | (wanted or set())
    in_backup = {h.uuid for h in habits}
    chosen = [loop for loop in habits if loop.uuid in take]
    for loop in chosen:
        habit = existing.get(loop.uuid) or Habit(user_id=user_id, loop_uuid=loop.uuid, source="drive")
        habit.name, habit.question, habit.unit = loop.name[:120], loop.question[:300], loop.unit[:40]
        habit.value_type, habit.target_type, habit.target_value = loop.value_type, loop.target_type, loop.target_value
        habit.freq_num, habit.freq_den, habit.position, habit.archived = loop.freq_num, loop.freq_den, loop.position, loop.archived
        habit.removed_at = None
        if habit.id is None:
            db.add(habit)
        existing[loop.uuid] = habit
    for uuid, habit in existing.items():
        if uuid not in in_backup and habit.removed_at is None:
            habit.removed_at = now
    db.flush()

    # The days in the window are replaced as a whole, so a day cleared in the app is cleared here too (a habit
    # that is no longer in the backup keeps the days it has)
    cutoff = date.today() - timedelta(days=KEEP_DAYS + 2)
    taken = [existing[loop.uuid].id for loop in chosen]
    if taken:
        db.execute(delete(HabitEntry).where(HabitEntry.entry_date >= cutoff, HabitEntry.habit_id.in_(taken)))
    days = {(e.habit_uuid, e.day): e for e in entries if e.habit_uuid in take}  # one entry a day: the last one wins
    for entry in days.values():
        db.add(HabitEntry(habit_id=existing[entry.habit_uuid].id, entry_date=entry.day, status=entry.status, value=entry.value))

    last = db.get(HabitSync, user_id)
    if last is None:
        last = HabitSync(user_id=user_id)
        db.add(last)
    last.file_name, last.md5, last.synced_at = backup.name[:255], backup.md5, now
    db.commit()
    return {"changed": True, "file_name": backup.name, "habits": len(chosen)}


def sync(db: DbSession, user_id: str, force: bool = False) -> dict:
    """Bring the habits the user imported up to date with the newest backup. Nothing is done when that backup is the
    one already synced (unless `force`). Habits that are not imported are left out: they are chosen with `import_habits`."""
    backup = _newest_backup()  # (also says so when Drive isn't set up)
    if not _imported(db, user_id):
        raise HabitsError("No habit has been imported yet: choose which ones to add from Drive first", 409)
    last = db.get(HabitSync, user_id)
    if not force and last is not None and backup.md5 and last.md5 == backup.md5:
        return {"changed": False, "file_name": backup.name, "habits": len(_imported(db, user_id))}
    return _copy_in(db, user_id, backup, None)


def import_habits(db: DbSession, user_id: str, uuids: list[str]) -> dict:
    """Add the habits with these keys (in the newest backup) to the user's own, and refresh the ones they already
    have from the same backup. Keys the backup doesn't hold are an error: the list on screen was out of date."""
    backup = _newest_backup()
    habits, _ = _read_habits(backup)
    wanted = set(uuids)
    missing = wanted - {h.uuid for h in habits}
    if missing:
        raise HabitsError("Some of those habits are no longer in the backup: reload the list and choose again", 409)
    return _copy_in(db, user_id, backup, wanted)
