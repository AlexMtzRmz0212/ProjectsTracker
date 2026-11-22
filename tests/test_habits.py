"""Habits picked from a My Habits (Loop) backup, and habits made in the app. Drive itself is never called: the
download is replaced by a backup built here."""

import sqlite3
from datetime import date, datetime, timedelta, timezone

import pytest

from backend import habits


def ms(day: date) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)


def make_backup(path, habit_rows, repetitions):
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE Habits (id INTEGER PRIMARY KEY, uuid TEXT, name TEXT, description TEXT, question TEXT, unit TEXT, "
        "type INTEGER, target_type INTEGER, target_value REAL, freq_num INTEGER, freq_den INTEGER, position INTEGER, archived INTEGER)"
    )
    conn.execute("CREATE TABLE Repetitions (habit INTEGER, timestamp INTEGER, value INTEGER, notes TEXT)")
    conn.executemany("INSERT INTO Habits VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", habit_rows)
    conn.executemany("INSERT INTO Repetitions VALUES (?,?,?,?)", repetitions)
    conn.commit()
    conn.close()


@pytest.fixture()
def drive(tmp_path, monkeypatch):
    """A fake Drive folder: `drive.set(...)` chooses the backup that is "newest" in it."""
    today = date.today()
    state = {"file": None, "calls": 0}
    monkeypatch.setenv("GOOGLE_DRIVE_FOLDER_ID", "folder")
    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "{}")

    def fetch():
        state["calls"] += 1
        return state["file"]

    monkeypatch.setattr(habits, "fetch_latest_backup", fetch)

    class Drive:
        def set(self, habit_rows, repetitions, md5="a"):
            path = tmp_path / f"{md5}.db"
            make_backup(path, habit_rows, repetitions)
            state["file"] = habits.BackupFile(f"{md5}.db", md5, datetime(2026, 1, 1), path.read_bytes())

    drive = Drive()
    drive.today = today
    return drive


def standard(today):
    rows = [
        (1, "u-run", "Run", "", "Did you run?", "", 0, 0, 0, 1, 1, 0, 0),
        (2, "u-water", "Water", "", "", "glasses", 1, 0, 8, 1, 1, 1, 0),
        (3, "u-bed", "Bedtime", "", "", "", 12, 1, 1410, 1, 1, 2, 0),
    ]
    reps = [
        (1, ms(today), 2, None),
        (1, ms(today - timedelta(days=1)), 0, None),
        (1, ms(today - timedelta(days=2)), 3, None),
        (2, ms(today), 6000, None),
        (3, ms(today), 1000 + 23 * 60 + 15, None),
        (1, ms(today - timedelta(days=400)), 2, None),  # too old to keep
    ]
    return rows, reps


def test_decode_follows_each_habit_type():
    assert habits.decode(0, 2) == ("yes", 1.0)
    assert habits.decode(0, 1) == ("yes", 1.0)
    assert habits.decode(0, 0) == ("no", None)
    assert habits.decode(0, 3) == ("skip", None)
    assert habits.decode(0, None) == ("unknown", None)
    assert habits.decode(1, 6000) == ("value", 6.0)
    assert habits.decode(12, 1000 + 23 * 60 + 15) == ("value", 1395.0)
    # A time habit with no time (a skipped day) is not read as midnight
    assert habits.decode(12, 3) == ("skip", None)


def test_listing_with_nothing_synced_says_whether_drive_is_set_up(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_DRIVE_FOLDER_ID", raising=False)
    listing = client.get("/api/habits").json()
    assert listing == {"habits": [], "configured": False, "synced_at": None, "source_file": ""}
    # And asking to sync says what is missing, rather than failing obscurely
    answer = client.post("/api/habits/sync")
    assert answer.status_code == 503 and "GOOGLE_DRIVE_FOLDER_ID" in answer.json()["detail"]


ALL = ["u-run", "u-water", "u-bed"]


def import_habits(client, uuids=ALL):
    res = client.post("/api/habits/import", json={"uuids": uuids})
    assert res.status_code == 200, res.text
    return res.json()


def test_sync_copies_habits_and_recent_days(client, drive):
    rows, reps = standard(drive.today)
    drive.set(rows, reps)
    result = import_habits(client)
    assert result == {"changed": True, "file_name": "a.db", "habits": 3}

    listing = client.get("/api/habits").json()
    assert listing["configured"] is True and listing["source_file"] == "a.db" and listing["synced_at"].endswith("Z")
    by_name = {h["name"]: h for h in listing["habits"]}
    assert [h["name"] for h in listing["habits"]] == ["Run", "Water", "Bedtime"]  # in the app's order
    assert by_name["Run"]["value_type"] == "boolean" and by_name["Run"]["question"] == "Did you run?"
    assert {h["source"] for h in listing["habits"]} == {"drive"}
    assert {e["entry_date"]: e["status"] for e in by_name["Run"]["entries"]} == {
        drive.today.isoformat(): "yes",
        (drive.today - timedelta(days=1)).isoformat(): "no",
        (drive.today - timedelta(days=2)).isoformat(): "skip",
    }  # the entry 400 days back was not kept
    assert by_name["Water"]["entries"][0]["value"] == 6.0 and by_name["Water"]["target_value"] == 8
    assert by_name["Bedtime"]["value_type"] == "time" and by_name["Bedtime"]["unit"] == "HH:MM"
    assert by_name["Bedtime"]["target_type"] == "at_most"
    assert by_name["Bedtime"]["entries"][0]["value"] == 1395.0


def test_the_same_backup_is_not_copied_twice_unless_forced(client, drive):
    rows, reps = standard(drive.today)
    drive.set(rows, reps)
    import_habits(client)
    assert client.post("/api/habits/sync").json()["changed"] is False  # the backup the import came from
    assert client.post("/api/habits/sync?force=true").json()["changed"] is True


def test_a_newer_backup_updates_days_and_retires_missing_habits(client, drive):
    rows, reps = standard(drive.today)
    drive.set(rows, reps, md5="a")
    import_habits(client)

    # Water is gone from the app, Run's today became a no, and a new habit appeared
    rows2 = [rows[0], rows[2], (4, "u-read", "Read", "", "", "", 0, 0, 0, 1, 1, 3, 0)]
    reps2 = [(1, ms(drive.today), 0, None), (4, ms(drive.today), 2, None)]
    drive.set(rows2, reps2, md5="b")
    assert client.post("/api/habits/sync").json()["changed"] is True

    # A sync only keeps what was added up to date: the new habit waits to be chosen
    by_name = {h["name"]: h for h in client.get("/api/habits").json()["habits"]}
    assert set(by_name) == {"Run", "Bedtime", "Water"}
    assert by_name["Water"]["removed_at"] is not None and by_name["Water"]["entries"]  # kept, marked
    assert by_name["Run"]["removed_at"] is None
    today_entry = next(e for e in by_name["Run"]["entries"] if e["entry_date"] == drive.today.isoformat())
    assert today_entry["status"] == "no"


def test_an_empty_or_missing_backup_changes_nothing(client, drive, monkeypatch):
    rows, reps = standard(drive.today)
    drive.set(rows, reps)
    import_habits(client)

    drive.set([], [], md5="empty")
    answer = client.post("/api/habits/sync")
    assert answer.status_code == 422
    assert len(client.get("/api/habits").json()["habits"]) == 3

    # Nothing in the folder at all
    monkeypatch.setattr(habits, "fetch_latest_backup", lambda: None)
    assert client.post("/api/habits/sync").status_code == 404


def test_drive_habits_can_be_chosen_one_by_one(client, drive):
    rows, reps = standard(drive.today)
    drive.set(rows, reps)

    shown = client.get("/api/habits/drive").json()
    assert shown["file_name"] == "a.db"
    assert [(h["uuid"], h["imported"]) for h in shown["habits"]] == [("u-run", False), ("u-water", False), ("u-bed", False)]
    assert client.get("/api/habits").json()["habits"] == []  # looking changes nothing

    import_habits(client, ["u-run"])
    assert [h["name"] for h in client.get("/api/habits").json()["habits"]] == ["Run"]
    assert [h["imported"] for h in client.get("/api/habits/drive").json()["habits"]] == [True, False, False]

    # Adding another keeps the first, and a sync only ever refreshes what was added
    import_habits(client, ["u-bed"])
    assert [h["name"] for h in client.get("/api/habits").json()["habits"]] == ["Run", "Bedtime"]
    assert client.post("/api/habits/sync?force=true").json()["habits"] == 2

    # A habit the backup doesn't hold is refused, and nothing is added
    assert client.post("/api/habits/import", json={"uuids": ["u-nope"]}).status_code == 409
    assert client.post("/api/habits/import", json={"uuids": []}).status_code == 422
    assert len(client.get("/api/habits").json()["habits"]) == 2


def test_syncing_with_nothing_added_says_so(client, drive):
    rows, reps = standard(drive.today)
    drive.set(rows, reps)
    answer = client.post("/api/habits/sync")
    assert answer.status_code == 409 and "imported" in answer.json()["detail"]


def test_an_added_drive_habit_can_be_removed_and_added_again(client, drive):
    rows, reps = standard(drive.today)
    drive.set(rows, reps)
    import_habits(client, ["u-run"])
    habit = client.get("/api/habits").json()["habits"][0]
    assert client.delete(f"/api/habits/{habit['id']}").status_code == 204
    assert client.get("/api/habits").json()["habits"] == []
    assert client.delete(f"/api/habits/{habit['id']}").status_code == 404
    import_habits(client, ["u-run"])
    assert len(client.get("/api/habits").json()["habits"][0]["entries"]) == 3


def test_a_habit_made_here_is_edited_and_logged_here(client, drive):
    made = client.post("/api/habits", json={"name": "  Stretch ", "question": "Did you stretch?"})
    assert made.status_code == 201, made.text
    habit = made.json()
    assert habit["source"] == "app" and habit["name"] == "Stretch" and habit["value_type"] == "boolean" and habit["entries"] == []

    today = drive.today.isoformat()

    def day(d, **body):
        return client.put(f"/api/habits/{habit['id']}/entries/{d}", json=body)

    assert day(today, status="yes").json()["entries"] == [{"entry_date": today, "status": "yes", "value": 1.0}]
    assert day(today, status="no").json()["entries"][0]["status"] == "no"  # a day is replaced, not added
    yesterday = (drive.today - timedelta(days=1)).isoformat()
    assert len(day(yesterday, status="skip").json()["entries"]) == 2
    assert day(today, status="unknown").json()["entries"] == [{"entry_date": yesterday, "status": "skip", "value": None}]  # cleared
    assert day(today, status="value", value=3).status_code == 422  # a yes/no habit has no number
    assert day((drive.today + timedelta(days=10)).isoformat(), status="yes").status_code == 422  # not yet

    changed = client.patch(f"/api/habits/{habit['id']}", json={"name": "Stretch daily", "archived": True}).json()
    assert changed["name"] == "Stretch daily" and changed["archived"] is True
    assert client.patch(f"/api/habits/{habit['id']}", json={"name": None}).status_code == 422

    assert [h["name"] for h in client.get("/api/habits").json()["habits"]] == ["Stretch daily"]
    assert client.delete(f"/api/habits/{habit['id']}").status_code == 204
    assert client.get("/api/habits").json()["habits"] == []


def test_a_numerical_habit_made_here_takes_a_number(client, drive):
    habit = client.post("/api/habits", json={"name": "Water", "value_type": "numerical", "unit": "glasses", "target_value": 8}).json()
    assert habit["unit"] == "glasses" and habit["target_value"] == 8 and habit["target_type"] == "at_least"
    today = drive.today.isoformat()

    def put(**body):
        return client.put(f"/api/habits/{habit['id']}/entries/{today}", json=body)

    assert put(status="value", value=6.5).json()["entries"][0]["value"] == 6.5
    assert put(status="yes").status_code == 422  # not a yes/no habit
    assert put(status="value").status_code == 422  # how much?

    # A yes/no habit drops a unit and target it was given
    plain = client.post("/api/habits", json={"name": "Read", "unit": "pages", "target_value": 5}).json()
    assert plain["unit"] == "" and plain["target_value"] is None


def test_a_drive_habit_cannot_be_changed_or_logged_here(client, drive):
    rows, reps = standard(drive.today)
    drive.set(rows, reps)
    import_habits(client, ["u-run"])
    habit = client.get("/api/habits").json()["habits"][0]
    assert client.patch(f"/api/habits/{habit['id']}", json={"name": "Jog"}).status_code == 409
    assert client.put(f"/api/habits/{habit['id']}/entries/{drive.today.isoformat()}", json={"status": "no"}).status_code == 409


def test_a_sync_leaves_habits_made_here_alone(client, drive):
    rows, reps = standard(drive.today)
    drive.set(rows, reps)
    mine = client.post("/api/habits", json={"name": "Stretch"}).json()
    import_habits(client, ["u-run"])
    drive.set([rows[1]], [], md5="b")  # Run is gone from the backup
    client.post("/api/habits/sync")
    by_name = {h["name"]: h for h in client.get("/api/habits").json()["habits"]}
    assert by_name["Stretch"]["removed_at"] is None and by_name["Stretch"]["id"] == mine["id"]
    assert by_name["Run"]["removed_at"] is not None
