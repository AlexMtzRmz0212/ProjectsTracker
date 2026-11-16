"""Two accounts in one database: neither can see, change or reference the other's data."""

import pytest
from sqlalchemy.exc import IntegrityError

from backend.database import SessionLocal
from backend.models import Habit, HabitEntry, Session, User
from datetime import date, datetime, timedelta


def mine(client, name="Mine"):
    res = client.post("/api/projects", json={"name": name})
    assert res.status_code == 201, res.text
    return res.json()


def task(client, text="A task"):
    res = client.post("/api/todos", json={"text": text})
    assert res.status_code == 201, res.text
    return res.json()


def past_span():
    end = datetime.utcnow() - timedelta(hours=1)
    return {"start": (end - timedelta(minutes=30)).isoformat() + "Z", "end": end.isoformat() + "Z"}


# ── Lists ───────────────────────────────────────────────────────────────────

def test_lists_only_hold_your_own_rows(client, other):
    project = mine(client)
    todo = task(client)
    client.post("/api/sessions", json={"project_id": project["id"], **past_span()})
    client.post("/api/open-items", json={"project_id": project["id"]})
    client.post("/api/pomodoros", json={"project_id": project["id"], **past_span()})

    for path in ("/api/projects", "/api/todos", "/api/sessions", "/api/open-items", "/api/pomodoros"):
        assert client.get(path).json(), path
        assert other.get(path).json() == [], path
    assert todo["id"] not in [t["id"] for t in other.get("/api/todos").json()]


def test_each_account_starts_with_its_own_statuses_and_order(client, other):
    mine_statuses = client.get("/api/statuses").json()
    theirs = other.get("/api/statuses").json()
    assert [s["name"] for s in theirs] == ["Active", "Done"]
    assert {s["id"] for s in mine_statuses}.isdisjoint({s["id"] for s in theirs})
    # sort_order counts per account, not across the database
    mine(client, "a"), mine(client, "b")
    assert mine(other, "first")["sort_order"] == 1


# ── Projects ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "method,suffix",
    [("patch", ""), ("delete", ""), ("post", "/skip"), ("post", "/archive"), ("post", "/restore"), ("post", "/cancel")],
)
def test_someone_elses_project_is_not_found(client, other, method, suffix):
    project = mine(client)
    kwargs = {"json": {"name": "stolen"}} if method == "patch" else {}
    assert getattr(other, method)(f"/api/projects/{project['id']}{suffix}", **kwargs).status_code == 404
    assert client.get("/api/projects").json()[0]["name"] == "Mine"  # untouched


def test_cannot_use_someone_elses_status(client, other):
    theirs = other.get("/api/statuses").json()[0]
    assert client.post("/api/projects", json={"name": "x", "status_id": theirs["id"]}).status_code == 404
    project = mine(client)
    assert client.patch(f"/api/projects/{project['id']}", json={"status_id": theirs["id"]}).status_code == 404


# ── Statuses ────────────────────────────────────────────────────────────────

def test_someone_elses_status_is_not_found(client, other):
    status = client.get("/api/statuses").json()[0]
    assert other.patch(f"/api/statuses/{status['id']}", json={"name": "Hijacked"}).status_code == 404
    assert other.delete(f"/api/statuses/{status['id']}").status_code == 404


def test_status_names_only_clash_within_an_account(client, other):
    assert client.post("/api/statuses", json={"name": "Backlog"}).status_code == 201
    assert other.post("/api/statuses", json={"name": "Backlog"}).status_code == 201
    assert client.post("/api/statuses", json={"name": "backlog"}).status_code == 409
    # Both already have "Active": renaming one to the other's name is fine too
    assert other.patch(f"/api/statuses/{other.get('/api/statuses').json()[0]['id']}", json={"name": "Backlog"}).status_code == 409


def test_pinning_a_status_leaves_the_other_accounts_pin_alone(client, other):
    theirs = other.get("/api/statuses").json()[0]
    assert other.patch(f"/api/statuses/{theirs['id']}", json={"is_pinned": True}).status_code == 200
    mine_status = client.get("/api/statuses").json()[0]
    assert client.patch(f"/api/statuses/{mine_status['id']}", json={"is_pinned": True}).status_code == 200
    assert [s["is_pinned"] for s in other.get("/api/statuses").json()].count(True) == 1


def test_the_last_open_status_rule_is_per_account(client, other):
    """Another account's open statuses don't count towards keeping one open."""
    open_ones = [s for s in client.get("/api/statuses").json() if not s["is_done"]]
    assert len(open_ones) == 1
    assert client.delete(f"/api/statuses/{open_ones[0]['id']}").status_code == 409
    assert client.patch(f"/api/statuses/{open_ones[0]['id']}", json={"is_done": True}).status_code == 409


# ── To-dos, tasks ───────────────────────────────────────────────────────────

def test_someone_elses_todo_is_not_found(client, other):
    todo = task(client)
    assert other.patch(f"/api/todos/{todo['id']}", json={"done": True}).status_code == 404
    assert other.delete(f"/api/todos/{todo['id']}").status_code == 404
    assert other.post(f"/api/todos/{todo['id']}/to-project").status_code == 404
    assert client.get("/api/todos").json()[0]["done"] is False


def test_cannot_hang_a_todo_on_someone_elses_project_or_todo(client, other):
    project = mine(client)
    parent = client.post("/api/todos", json={"text": "p", "project_id": project["id"]}).json()
    assert other.post("/api/todos", json={"text": "x", "project_id": project["id"]}).status_code == 404
    assert other.post("/api/todos", json={"text": "x", "parent_id": parent["id"]}).status_code == 404
    own = task(other)
    assert other.patch(f"/api/todos/{own['id']}", json={"parent_id": parent["id"]}).status_code == 404


# ── Sessions, open items ────────────────────────────────────────────────────

def test_cannot_log_time_on_or_touch_someone_elses_things(client, other):
    project = mine(client)
    todo = task(client)
    logged = client.post("/api/sessions", json={"project_id": project["id"], **past_span()}).json()
    item = client.post("/api/open-items", json={"project_id": project["id"]}).json()

    assert other.post("/api/sessions", json={"project_id": project["id"], **past_span()}).status_code == 404
    assert other.post("/api/sessions", json={"todo_id": todo["id"], **past_span()}).status_code == 404
    assert other.patch(f"/api/sessions/{logged['id']}", json={"note": "x"}).status_code == 404
    assert other.delete(f"/api/sessions/{logged['id']}").status_code == 404

    own = mine(other, "theirs")
    own_session = other.post("/api/sessions", json={"project_id": own["id"], **past_span()}).json()
    assert other.patch(f"/api/sessions/{own_session['id']}", json={"project_id": project["id"]}).status_code == 404

    assert other.post("/api/open-items", json={"project_id": project["id"]}).status_code == 404
    assert other.patch(f"/api/open-items/{item['id']}", json={"note": "x"}).status_code == 404
    assert other.post(f"/api/open-items/{item['id']}/close", json={}).status_code == 404
    assert other.delete(f"/api/open-items/{item['id']}").status_code == 404

    assert len(client.get("/api/sessions").json()) == 1 and len(client.get("/api/open-items").json()) == 1


def test_project_totals_only_count_your_sessions(client, other):
    project = mine(client)
    client.post("/api/sessions", json={"project_id": project["id"], **past_span()})
    assert client.get("/api/projects").json()[0]["total_seconds"] == 30 * 60
    assert other.get("/api/projects").json() == []


# ── Timer ───────────────────────────────────────────────────────────────────

def test_everyone_has_their_own_running_timer(client, other):
    mine_project = mine(client, "mine")
    theirs = mine(other, "theirs")

    a = client.post("/api/timer/start", json={"project_id": mine_project["id"]}).json()
    b = other.post("/api/timer/start", json={"project_id": theirs["id"]}).json()
    assert a["id"] != b["id"]

    assert client.get("/api/timer").json()["id"] == a["id"]  # B starting didn't stop A's
    assert other.get("/api/timer").json()["id"] == b["id"]

    assert client.post("/api/timer/stop", params={"keep": True}).json()["id"] == a["id"]
    assert client.get("/api/timer").json() is None
    assert other.get("/api/timer").json()["id"] == b["id"]  # and A stopping didn't stop B's


def test_cannot_time_someone_elses_project(client, other):
    project = mine(client)
    assert other.post("/api/timer/start", json={"project_id": project["id"]}).status_code == 404


def test_the_database_refuses_a_second_running_timer_for_one_account(client):
    project = mine(client)
    client.post("/api/timer/start", json={"project_id": project["id"]})
    with SessionLocal() as db:
        user = db.query(User).filter_by(email="admin@example.com").one()
        db.add(Session(user_id=user.id, project_id=project["id"], start=datetime.utcnow(), end=None))
        with pytest.raises(IntegrityError):
            db.commit()


def test_restarting_the_timer_right_away_works_with_that_safety_net(client):
    """A session under the 2-minute minimum is deleted when stopped; the new one must go in after the delete."""
    a, b = mine(client, "a"), mine(client, "b")
    client.post("/api/timer/start", json={"project_id": a["id"]})
    second = client.post("/api/timer/start", json={"project_id": b["id"]})
    assert second.status_code == 200 and second.json()["project_id"] == b["id"]
    assert client.get("/api/timer").json()["project_id"] == b["id"]


# ── Pomodoros ───────────────────────────────────────────────────────────────

def test_a_pomodoro_cannot_link_to_someone_elses_project_or_todo(client, other):
    project = mine(client, "Secret project")
    todo = task(client, "Secret task")
    res = other.post("/api/pomodoros", json={"project_id": project["id"], **past_span()})
    assert res.status_code == 201
    assert res.json()["project_id"] is None and res.json()["label"] == ""  # nothing of theirs leaks in
    res = other.post("/api/pomodoros", json={"todo_id": todo["id"], **past_span()})
    assert res.json()["todo_id"] is None and res.json()["label"] == ""


# ── Habits and the admin-only routes ────────────────────────────────────────

def test_habits_are_private_and_only_the_admin_syncs(client, other):
    with SessionLocal() as db:
        admin = db.query(User).filter_by(email="admin@example.com").one()
        habit = Habit(user_id=admin.id, loop_uuid="same-uuid", name="Read")
        db.add(habit)
        db.flush()
        db.add(HabitEntry(habit_id=habit.id, entry_date=date.today(), status="yes", value=1.0))
        db.commit()

    assert [h["name"] for h in client.get("/api/habits").json()["habits"]] == ["Read"]
    theirs = other.get("/api/habits").json()
    assert theirs["habits"] == [] and theirs["configured"] is False
    assert other.post("/api/habits/sync").status_code == 403


def test_the_same_habit_uuid_can_exist_in_two_accounts(client, other):
    with SessionLocal() as db:
        for user in db.query(User).all():
            db.add(Habit(user_id=user.id, loop_uuid="shared-uuid", name="Run"))
        db.commit()  # no unique violation
    assert len(client.get("/api/habits").json()["habits"]) == 1
    assert len(other.get("/api/habits").json()["habits"]) == 1
