"""
Habits, from the "My Habits" app (a Loop Habit Tracker fork).

My Habits writes a full backup, a SQLite `.db` file, to a Google Drive folder. This module finds the newest one
there, reads it (read-only) and copies the habits and their recent days into the tracker's own tables, so the
Habits tab can show them. The tracker never writes back to Drive: the backup is the only copy the other app has.

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

def sync(db: DbSession, force: bool = False) -> dict:
    """Bring the habits up to date with the newest backup. Nothing is done when that backup is the one already
    synced (unless `force`). Habits are added and updated, never deleted: one missing from the newest backup is
    marked removed and keeps its days. Returns {changed, file_name, habits}."""
    backup = fetch_latest_backup()
    if backup is None:
        raise HabitsError("No .db backup in the Drive folder. Export one from My Habits (Settings, export full backup)", 404)
    last = db.get(HabitSync, 1)
    if not force and last is not None and backup.md5 and last.md5 == backup.md5:
        return {"changed": False, "file_name": backup.name, "habits": db.query(Habit).count()}

    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "backup.db"
        path.write_bytes(backup.data)
        habits, entries = read_backup(path)
    if not habits:  # a broken export must not retire everything
        raise HabitsError("That backup has no habits in it, so nothing was changed", 422)

    now = utcnow()
    existing = {h.loop_uuid: h for h in db.scalars(select(Habit))}
    seen = set()
    for loop in habits:
        habit = existing.get(loop.uuid) or Habit(loop_uuid=loop.uuid)
        habit.name, habit.question, habit.unit = loop.name[:120], loop.question[:300], loop.unit[:40]
        habit.value_type, habit.target_type, habit.target_value = loop.value_type, loop.target_type, loop.target_value
        habit.freq_num, habit.freq_den, habit.position, habit.archived = loop.freq_num, loop.freq_den, loop.position, loop.archived
        habit.removed_at = None
        if habit.id is None:
            db.add(habit)
        existing[loop.uuid] = habit
        seen.add(loop.uuid)
    for uuid, habit in existing.items():
        if uuid not in seen and habit.removed_at is None:
            habit.removed_at = now
    db.flush()

    # The days in the window are replaced as a whole, so a day cleared in the app is cleared here too (a habit
    # that is no longer in the backup keeps the days it has)
    cutoff = date.today() - timedelta(days=KEEP_DAYS + 2)
    db.execute(delete(HabitEntry).where(HabitEntry.entry_date >= cutoff, HabitEntry.habit_id.in_([existing[u].id for u in seen])))
    days = {(e.habit_uuid, e.day): e for e in entries}  # one entry a day: the last one wins
    for entry in days.values():
        db.add(HabitEntry(habit_id=existing[entry.habit_uuid].id, entry_date=entry.day, status=entry.status, value=entry.value))

    if last is None:
        last = HabitSync(id=1)
        db.add(last)
    last.file_name, last.md5, last.synced_at = backup.name[:255], backup.md5, now
    db.commit()
    return {"changed": True, "file_name": backup.name, "habits": len(habits)}
