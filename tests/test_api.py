from datetime import datetime, timedelta, timezone


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def now() -> datetime:
    return datetime.now(timezone.utc)


def make_project(client, name="Website", color="#8b5cf6", icon="code", **fields):
    res = client.post("/api/projects", json={"name": name, "color": color, "icon": icon, **fields})
    assert res.status_code == 201, res.text
    return res.json()


def statuses_by_name(client):
    return {s["name"]: s for s in client.get("/api/statuses").json()}


def start_timer(client, project, ran_for=timedelta(minutes=10)):
    """Start the timer as if it had been started `ran_for` ago (a stop under 2 minutes drops the session)."""
    run = client.post("/api/timer/start", json={"project_id": project["id"]}).json()
    res = client.patch(f"/api/sessions/{run['id']}", json={"start": iso(now() - ran_for)})
    assert res.status_code == 200, res.text
    return res.json()


def make_status(client, name="Paused", **fields):
    res = client.post("/api/statuses", json={"name": name, **fields})
    assert res.status_code == 201, res.text
    return res.json()


# ── Projects ────────────────────────────────────────────────────────────────

def test_project_crud(client):
    a = make_project(client, "Alpha")
    b = make_project(client, "Beta", color="#10b981")
    assert a["status_id"] == statuses_by_name(client)["Active"]["id"]  # new projects start open
    assert a["notes"] == ""
    assert b["sort_order"] > a["sort_order"]

    listed = client.get("/api/projects").json()
    assert [p["name"] for p in listed] == ["Alpha", "Beta"]
    assert listed[0]["total_seconds"] == 0

    res = client.patch(f"/api/projects/{a['id']}", json={"name": "Alpha 2"})
    assert res.status_code == 200
    assert res.json()["name"] == "Alpha 2"

    assert client.delete(f"/api/projects/{a['id']}").status_code == 204
    assert [p["name"] for p in client.get("/api/projects").json()] == ["Beta"]


def test_project_validation(client):
    assert client.post("/api/projects", json={"name": ""}).status_code == 422
    assert client.post("/api/projects", json={"name": "X", "color": "red"}).status_code == 422
    assert client.patch("/api/projects/missing", json={"name": "X"}).status_code == 404


# ── Feed ────────────────────────────────────────────────────────────────────

def test_skip_stamps_the_project(client):
    p = make_project(client)
    assert p["skipped_at"] is None

    before = now()
    skipped = client.post(f"/api/projects/{p['id']}/skip")
    assert skipped.status_code == 200
    stamp = datetime.fromisoformat(skipped.json()["skipped_at"].replace("Z", "+00:00"))
    assert skipped.json()["skipped_at"].endswith("Z") and before - timedelta(seconds=1) <= stamp <= now() + timedelta(seconds=1)
    assert client.get("/api/projects").json()[0]["skipped_at"] == skipped.json()["skipped_at"]

    # Other edits leave it alone, and the project's other fields come back intact
    assert client.patch(f"/api/projects/{p['id']}", json={"name": "Renamed"}).json()["skipped_at"] == skipped.json()["skipped_at"]
    assert skipped.json()["name"] == p["name"] and skipped.json()["status_id"] == p["status_id"]


def test_skip_unknown_project(client):
    assert client.post("/api/projects/missing/skip").status_code == 404


# ── Archive ─────────────────────────────────────────────────────────────────

def test_archive_and_restore(client):
    p = make_project(client)
    assert p["archived_at"] is None

    before = now()
    archived = client.post(f"/api/projects/{p['id']}/archive")
    assert archived.status_code == 200
    body = archived.json()
    stamp = datetime.fromisoformat(body["archived_at"].replace("Z", "+00:00"))
    assert body["archived_at"].endswith("Z") and before - timedelta(seconds=1) <= stamp <= now() + timedelta(seconds=1)
    # Its other fields come back intact, and it stays in the list: the client decides what to show
    assert body["name"] == p["name"] and body["status_id"] == p["status_id"] and body["notes"] == p["notes"]
    assert client.get("/api/projects").json()[0]["archived_at"] == body["archived_at"]

    # Archiving again keeps the first moment, and other edits leave it alone
    assert client.post(f"/api/projects/{p['id']}/archive").json()["archived_at"] == body["archived_at"]
    assert client.patch(f"/api/projects/{p['id']}", json={"name": "Renamed"}).json()["archived_at"] == body["archived_at"]

    restored = client.post(f"/api/projects/{p['id']}/restore")
    assert restored.status_code == 200 and restored.json()["archived_at"] is None
    assert restored.json()["status_id"] == p["status_id"]  # back in the column it left
    assert client.get("/api/projects").json()[0]["archived_at"] is None


def test_archiving_a_project_stops_its_timer(client):
    p = make_project(client)
    other = make_project(client, "Other")
    client.post("/api/timer/start", json={"project_id": p["id"]})

    # Archiving some other project leaves the timer alone
    client.post(f"/api/projects/{other['id']}/archive")
    assert client.get("/api/timer").json() is not None

    client.post(f"/api/projects/{p['id']}/archive")
    assert client.get("/api/timer").json() is None


def test_archive_unknown_project(client):
    assert client.post("/api/projects/missing/archive").status_code == 404
    assert client.post("/api/projects/missing/restore").status_code == 404


def test_archived_projects_keep_their_status_and_can_be_deleted(client):
    paused = make_status(client, "Paused")
    p = make_project(client, status_id=paused["id"])
    client.post(f"/api/projects/{p['id']}/archive")

    # Out of sight, but still using its status
    res = client.delete(f"/api/statuses/{paused['id']}")
    assert res.status_code == 409 and "1 project still use" in res.json()["detail"]

    assert client.delete(f"/api/projects/{p['id']}").status_code == 204
    assert client.delete(f"/api/statuses/{paused['id']}").status_code == 204


def test_patch_cannot_archive(client):
    p = make_project(client)
    res = client.patch(f"/api/projects/{p['id']}", json={"archived_at": iso(now())})
    assert res.status_code == 200 and res.json()["archived_at"] is None


# ── Notes and to-dos ────────────────────────────────────────────────────────

def test_project_notes(client):
    p = make_project(client, notes="first thoughts")
    assert p["notes"] == "first thoughts"
    res = client.patch(f"/api/projects/{p['id']}", json={"notes": "line one\nline two"})
    assert res.json()["notes"] == "line one\nline two"
    assert client.patch(f"/api/projects/{p['id']}", json={"notes": ""}).json()["notes"] == ""  # can be cleared
    assert client.patch(f"/api/projects/{p['id']}", json={"notes": None}).status_code == 422
    assert client.patch(f"/api/projects/{p['id']}", json={"notes": "x" * 20_001}).status_code == 422
    assert client.patch(f"/api/projects/{p['id']}", json={"name": "Renamed"}).json()["notes"] == ""  # untouched by other edits


def make_todo(client, project_id, text="Write the intro"):
    res = client.post("/api/todos", json={"project_id": project_id, "text": text})
    assert res.status_code == 201, res.text
    return res.json()


def test_todo_crud(client):
    p = make_project(client)
    a = make_todo(client, p["id"], "  First  ")
    b = make_todo(client, p["id"], "Second")
    assert a["text"] == "First" and a["done"] is False
    assert b["sort_order"] > a["sort_order"]
    assert [t["text"] for t in client.get("/api/todos").json()] == ["First", "Second"]

    res = client.patch(f"/api/todos/{a['id']}", json={"done": True})
    assert res.json()["done"] is True and res.json()["text"] == "First"
    assert client.patch(f"/api/todos/{a['id']}", json={"done": False, "text": "First, edited"}).json()["done"] is False

    assert client.delete(f"/api/todos/{b['id']}").status_code == 204
    assert [t["text"] for t in client.get("/api/todos").json()] == ["First, edited"]
    assert client.delete(f"/api/todos/{b['id']}").status_code == 404


def test_todo_completed_at_follows_done(client):
    p = make_project(client)
    t = make_todo(client, p["id"])
    assert t["completed_at"] is None

    before = now()
    ticked = client.patch(f"/api/todos/{t['id']}", json={"done": True}).json()
    stamp = datetime.fromisoformat(ticked["completed_at"].replace("Z", "+00:00"))
    assert ticked["completed_at"].endswith("Z") and before - timedelta(seconds=1) <= stamp <= now() + timedelta(seconds=1)

    # Editing the text, or ticking an already done to-do, keeps the original moment
    assert client.patch(f"/api/todos/{t['id']}", json={"text": "Renamed"}).json()["completed_at"] == ticked["completed_at"]
    assert client.patch(f"/api/todos/{t['id']}", json={"done": True}).json()["completed_at"] == ticked["completed_at"]

    unticked = client.patch(f"/api/todos/{t['id']}", json={"done": False}).json()
    assert unticked["completed_at"] is None
    assert client.get("/api/todos").json()[0]["completed_at"] is None


def test_todo_validation(client):
    p = make_project(client)
    assert client.post("/api/todos", json={"project_id": p["id"], "text": "   "}).status_code == 422
    assert client.post("/api/todos", json={"project_id": p["id"], "text": "x" * 201}).status_code == 422
    assert client.post("/api/todos", json={"project_id": "nope", "text": "Hi"}).status_code == 404
    assert client.patch("/api/todos/missing", json={"done": True}).status_code == 404


def test_deleting_a_project_deletes_its_todos(client):
    p = make_project(client)
    keep = make_project(client, "Keep")
    make_todo(client, p["id"])
    kept = make_todo(client, keep["id"], "Stays")
    assert client.delete(f"/api/projects/{p['id']}").status_code == 204
    assert [t["id"] for t in client.get("/api/todos").json()] == [kept["id"]]


def test_running_session_note_can_be_edited(client):
    p = make_project(client)
    run = start_timer(client, p)
    res = client.patch(f"/api/sessions/{run['id']}", json={"note": "drafting the intro"})
    assert res.status_code == 200
    assert res.json()["note"] == "drafting the intro" and res.json()["end"] is None  # still running
    stopped = client.post("/api/timer/stop").json()
    assert stopped["note"] == "drafting the intro"


# ── Statuses ────────────────────────────────────────────────────────────────

def test_default_statuses(client):
    listed = client.get("/api/statuses").json()
    assert [(s["name"], s["is_done"]) for s in listed] == [("Active", False), ("Done", True)]


def test_project_status_changes(client):
    p = make_project(client)
    paused = make_status(client, "Paused")
    done = statuses_by_name(client)["Done"]

    res = client.patch(f"/api/projects/{p['id']}", json={"status_id": paused["id"]})
    assert res.json()["status_id"] == paused["id"]
    assert make_project(client, "Idea", status_id=paused["id"])["status_id"] == paused["id"]

    assert client.patch(f"/api/projects/{p['id']}", json={"status_id": done["id"]}).status_code == 200
    assert client.patch(f"/api/projects/{p['id']}", json={"status_id": None}).status_code == 422
    assert client.patch(f"/api/projects/{p['id']}", json={"status_id": "nope"}).status_code == 404
    assert client.post("/api/projects", json={"name": "X", "status_id": "nope"}).status_code == 404


def test_finishing_a_project_stops_its_timer(client):
    p = make_project(client)
    other = make_project(client, "Other")
    done = statuses_by_name(client)["Done"]
    client.post("/api/timer/start", json={"project_id": p["id"]})

    # Finishing some other project leaves the timer alone
    client.patch(f"/api/projects/{other['id']}", json={"status_id": done["id"]})
    assert client.get("/api/timer").json() is not None

    client.patch(f"/api/projects/{p['id']}", json={"status_id": done["id"]})
    assert client.get("/api/timer").json() is None


def test_marking_a_status_done_stops_timers_in_it(client):
    paused = make_status(client, "Paused")
    p = make_project(client, status_id=paused["id"])
    client.post("/api/timer/start", json={"project_id": p["id"]})
    assert client.patch(f"/api/statuses/{paused['id']}", json={"is_done": True}).json()["is_done"] is True
    assert client.get("/api/timer").json() is None


def test_status_in_use_cannot_be_deleted(client):
    paused = make_status(client, "Paused")
    p = make_project(client, status_id=paused["id"])
    res = client.delete(f"/api/statuses/{paused['id']}")
    assert res.status_code == 409 and "1 project still use" in res.json()["detail"]

    client.patch(f"/api/projects/{p['id']}", json={"status_id": statuses_by_name(client)["Active"]["id"]})
    assert client.delete(f"/api/statuses/{paused['id']}").status_code == 204
    assert client.delete(f"/api/statuses/{paused['id']}").status_code == 404


def test_one_open_status_must_remain(client):
    active = statuses_by_name(client)["Active"]
    assert client.delete(f"/api/statuses/{active['id']}").status_code == 409
    assert client.patch(f"/api/statuses/{active['id']}", json={"is_done": True}).status_code == 409

    # With a second open status, either can go
    idea = make_status(client, "Idea")
    assert client.patch(f"/api/statuses/{active['id']}", json={"is_done": True}).status_code == 200
    assert client.delete(f"/api/statuses/{idea['id']}").status_code == 409  # now the only open one
    # A finished status can always be deleted when unused
    assert client.delete(f"/api/statuses/{statuses_by_name(client)['Done']['id']}").status_code == 204


def test_new_projects_default_to_the_first_open_status(client):
    active = statuses_by_name(client)["Active"]
    idea = make_status(client, "Idea")
    client.patch(f"/api/statuses/{active['id']}", json={"sort_order": 99})  # Idea now sorts first among open ones
    assert make_project(client)["status_id"] == idea["id"]


def test_status_validation(client):
    assert client.post("/api/statuses", json={"name": "done"}).status_code == 409
    assert client.post("/api/statuses", json={"name": ""}).status_code == 422
    assert client.patch("/api/statuses/missing", json={"name": "X"}).status_code == 404


# ── Timer ───────────────────────────────────────────────────────────────────

def test_timer_switches_projects(client):
    a = make_project(client, "A")
    b = make_project(client, "B")
    assert client.get("/api/timer").json() is None

    run_a = start_timer(client, a)
    assert run_a["end"] is None
    assert run_a["start"].endswith("Z")

    # Starting the same project again keeps the same session running
    again = client.post("/api/timer/start", json={"project_id": a["id"]}).json()
    assert again["id"] == run_a["id"]

    # Starting B closes A
    run_b = client.post("/api/timer/start", json={"project_id": b["id"]}).json()
    assert run_b["project_id"] == b["id"]
    sessions = {s["id"]: s for s in client.get("/api/sessions").json()}
    assert sessions[run_a["id"]]["end"] is not None
    assert sessions[run_b["id"]]["end"] is None
    assert client.get("/api/timer").json()["id"] == run_b["id"]

    # B has only just started, so stopping it keeps nothing
    assert client.post("/api/timer/stop").json() is None
    assert client.get("/api/timer").json() is None
    assert [s["id"] for s in client.get("/api/sessions").json()] == [run_a["id"]]
    assert client.post("/api/timer/stop").json() is None


def test_timer_stop_keeps_a_real_session(client):
    p = make_project(client)
    run = start_timer(client, p, ran_for=timedelta(minutes=3))
    stopped = client.post("/api/timer/stop").json()
    assert stopped["id"] == run["id"] and stopped["end"] is not None
    assert client.get("/api/projects").json()[0]["total_seconds"] >= 180


def test_pausing_keeps_even_a_short_session(client):
    """A pause stops with keep=true: the person is coming back, so nothing is dropped."""
    p = make_project(client)
    client.post("/api/timer/start", json={"project_id": p["id"]})
    stopped = client.post("/api/timer/stop?keep=true").json()
    assert stopped["end"] is not None
    assert [s["id"] for s in client.get("/api/sessions").json()] == [stopped["id"]]
    assert client.get("/api/timer").json() is None


def test_sessions_under_two_minutes_are_not_registered(client):
    a = make_project(client, "A")
    b = make_project(client, "B")

    # Stopped right away
    client.post("/api/timer/start", json={"project_id": a["id"]})
    assert client.post("/api/timer/stop").json() is None
    assert client.get("/api/sessions").json() == []

    # Switched away from right away: A leaves nothing, B is running
    client.post("/api/timer/start", json={"project_id": a["id"]})
    run_b = client.post("/api/timer/start", json={"project_id": b["id"]}).json()
    assert [s["id"] for s in client.get("/api/sessions").json()] == [run_b["id"]]

    # Just under the limit is dropped; just over is kept
    start_timer(client, a, ran_for=timedelta(seconds=110))
    run_c = client.post("/api/timer/start", json={"project_id": b["id"]}).json()
    assert [s["id"] for s in client.get("/api/sessions").json()] == [run_c["id"]]
    start_timer(client, a, ran_for=timedelta(seconds=130))
    assert client.post("/api/timer/stop").json()["end"] is not None

    # Finishing a project stops its timer the same way
    done = statuses_by_name(client)["Done"]
    client.post("/api/timer/start", json={"project_id": a["id"]})
    client.patch(f"/api/projects/{a['id']}", json={"status_id": done["id"]})
    assert client.get("/api/timer").json() is None
    assert len(client.get("/api/sessions").json()) == 1  # only the 130 second one

    # Typing a short session in by hand is still allowed
    end = now() - timedelta(hours=1)
    res = client.post(
        "/api/sessions", json={"project_id": b["id"], "start": iso(end - timedelta(seconds=30)), "end": iso(end)}
    )
    assert res.status_code == 201


def test_timer_unknown_project(client):
    assert client.post("/api/timer/start", json={"project_id": "nope"}).status_code == 404


# ── Sessions ────────────────────────────────────────────────────────────────

def test_manual_session_and_totals(client):
    p = make_project(client)
    end = now() - timedelta(hours=1)
    start = end - timedelta(hours=2)
    res = client.post(
        "/api/sessions",
        json={"project_id": p["id"], "start": iso(start), "end": iso(end), "note": "refactor"},
    )
    assert res.status_code == 201, res.text
    assert res.json()["note"] == "refactor"

    total = client.get("/api/projects").json()[0]["total_seconds"]
    assert abs(total - 7200) <= 1


def test_session_validation(client):
    p = make_project(client)
    t = now() - timedelta(hours=3)
    bad_order = {"project_id": p["id"], "start": iso(t), "end": iso(t - timedelta(minutes=5))}
    assert client.post("/api/sessions", json=bad_order).status_code == 422

    same = {"project_id": p["id"], "start": iso(t), "end": iso(t)}
    assert client.post("/api/sessions", json=same).status_code == 422

    future = {"project_id": p["id"], "start": iso(now()), "end": iso(now() + timedelta(hours=1))}
    assert client.post("/api/sessions", json=future).status_code == 422

    missing = {"project_id": "nope", "start": iso(t), "end": iso(t + timedelta(minutes=5))}
    assert client.post("/api/sessions", json=missing).status_code == 404


def test_session_update_and_delete(client):
    p = make_project(client)
    end = now() - timedelta(hours=1)
    s = client.post(
        "/api/sessions",
        json={"project_id": p["id"], "start": iso(end - timedelta(hours=1)), "end": iso(end)},
    ).json()

    # Moving start past end is rejected
    res = client.patch(f"/api/sessions/{s['id']}", json={"start": iso(end + timedelta(minutes=1))})
    assert res.status_code == 422

    res = client.patch(f"/api/sessions/{s['id']}", json={"note": "edited"})
    assert res.status_code == 200 and res.json()["note"] == "edited"

    assert client.delete(f"/api/sessions/{s['id']}").status_code == 204
    assert client.get("/api/sessions").json() == []


def test_timezone_offsets_are_normalised(client):
    p = make_project(client)
    # 10:00-11:00 at UTC-06:00 is 16:00-17:00 UTC
    res = client.post(
        "/api/sessions",
        json={
            "project_id": p["id"],
            "start": "2026-01-15T10:00:00-06:00",
            "end": "2026-01-15T11:00:00-06:00",
        },
    )
    assert res.status_code == 201
    assert res.json()["start"] == "2026-01-15T16:00:00Z"
    assert res.json()["end"] == "2026-01-15T17:00:00Z"


def test_range_query(client):
    p = make_project(client)

    def add(start, end):
        client.post(
            "/api/sessions",
            json={"project_id": p["id"], "start": iso(start), "end": iso(end)},
        )

    base = datetime(2026, 3, 10, 12, tzinfo=timezone.utc)
    add(base - timedelta(days=5), base - timedelta(days=5, hours=-1))  # before the range
    add(base, base + timedelta(hours=1))                               # inside
    add(base - timedelta(days=1, hours=1), base - timedelta(days=1) + timedelta(hours=1))  # straddles start

    lo = base - timedelta(days=1)
    hi = base + timedelta(days=1)
    got = client.get("/api/sessions", params={"start": iso(lo), "end": iso(hi)}).json()
    assert len(got) == 2

    # A running session overlaps any range that ends after it started
    client.post("/api/timer/start", json={"project_id": p["id"]})
    got = client.get("/api/sessions", params={"start": iso(now() - timedelta(days=1))}).json()
    assert any(s["end"] is None for s in got)


def test_delete_project_cascades_sessions(client):
    p = make_project(client)
    keep = make_project(client, "Keep")
    end = now() - timedelta(hours=1)
    for proj in (p, keep):
        client.post(
            "/api/sessions",
            json={"project_id": proj["id"], "start": iso(end - timedelta(hours=1)), "end": iso(end)},
        )
    client.post("/api/timer/start", json={"project_id": p["id"]})

    assert client.delete(f"/api/projects/{p['id']}").status_code == 204
    remaining = client.get("/api/sessions").json()
    assert [s["project_id"] for s in remaining] == [keep["id"]]
    assert client.get("/api/timer").json() is None


# ── Pomodoros ───────────────────────────────────────────────────────────────

def make_pomodoro(client, ended_ago=timedelta(hours=1), length=timedelta(minutes=25), **fields):
    end = now() - ended_ago
    res = client.post("/api/pomodoros", json={"start": iso(end - length), "end": iso(end), **fields})
    assert res.status_code == 201, res.text
    return res.json()


def test_pomodoro_is_saved_and_listed(client):
    assert client.get("/api/pomodoros").json() == []
    made = make_pomodoro(client)
    assert client.get("/api/pomodoros").json() == [made]


def test_a_cut_short_pomodoro_is_kept_and_marked(client):
    assert make_pomodoro(client)["completed"] is True  # a focus that ran out is the default
    short = make_pomodoro(client, length=timedelta(minutes=7), completed=False)
    assert short["completed"] is False
    assert [p["completed"] for p in client.get("/api/pomodoros").json()] == [True, False]


def test_pomodoros_are_listed_by_overlap(client):
    old = make_pomodoro(client, ended_ago=timedelta(days=3))
    recent = make_pomodoro(client, ended_ago=timedelta(hours=1))
    since = iso(now() - timedelta(days=1))
    assert [p["id"] for p in client.get("/api/pomodoros", params={"start": since}).json()] == [recent["id"]]
    until = iso(now() - timedelta(days=2))
    assert [p["id"] for p in client.get("/api/pomodoros", params={"end": until}).json()] == [old["id"]]


def test_pomodoro_validation(client):
    t = now() - timedelta(hours=1)
    backwards = {"start": iso(t), "end": iso(t - timedelta(minutes=5))}
    assert client.post("/api/pomodoros", json=backwards).status_code == 422
    future = {"start": iso(now()), "end": iso(now() + timedelta(hours=1))}
    assert client.post("/api/pomodoros", json=future).status_code == 422
    assert client.post("/api/pomodoros", json={"start": iso(t)}).status_code == 422


# ── Interest counter (public) ───────────────────────────────────────────────

def vote(client, visitor_id):
    return client.post("/api/interest", json={"visitor_id": visitor_id})


def test_interest_counts_each_visitor_once(client):
    assert client.get("/api/interest").json() == {"count": 0}

    assert vote(client, "a" * 24).json() == {"count": 1}
    assert vote(client, "a" * 24).json() == {"count": 1}  # same visitor, no change
    assert vote(client, "b" * 24).json() == {"count": 2}
    assert client.get("/api/interest").json() == {"count": 2}


def test_interest_rejects_malformed_ids(client):
    assert vote(client, "short").status_code == 422
    assert vote(client, "has spaces and punctuation!!").status_code == 422
    assert client.get("/api/interest").json() == {"count": 0}


def test_interest_is_rate_limited(client, monkeypatch):
    from backend import main

    monkeypatch.setattr(main, "INTEREST_MAX_PER_WINDOW", 2)
    assert vote(client, "a" * 24).status_code == 200
    assert vote(client, "b" * 24).status_code == 200
    assert vote(client, "c" * 24).status_code == 429
    assert vote(client, "a" * 24).json() == {"count": 2}  # existing voters are unaffected


# ── Interest notes (public write, owner read) ───────────────────────────────

def write_note(client, visitor_id="a" * 24, **fields):
    return client.post("/api/interest/message", json={"visitor_id": visitor_id, **fields})


def test_note_is_saved_and_counts_as_interest(client):
    res = write_note(client, email="  sam@example.com ", message="  Would track my thesis hours.  ")
    assert res.status_code == 200
    assert res.json() == {"count": 1}  # writing in registers the vote too

    inbox = client.get("/api/interest/messages").json()
    assert inbox["count"] == 1
    assert len(inbox["messages"]) == 1
    note = inbox["messages"][0]
    assert note["email"] == "sam@example.com"  # whitespace trimmed
    assert note["message"] == "Would track my thesis hours."
    assert note["created_at"].endswith("Z")


def test_note_alone_or_email_alone_is_enough(client):
    assert write_note(client, "a" * 24, message="Just a note").status_code == 200
    assert write_note(client, "b" * 24, email="lee@example.com").status_code == 200
    assert len(client.get("/api/interest/messages").json()["messages"]) == 2


def test_note_needs_something_and_a_sane_email(client):
    assert write_note(client).status_code == 422
    assert write_note(client, email="   ", message="  ").status_code == 422
    assert write_note(client, email="not-an-email").status_code == 422
    assert write_note(client, message="x" * 1001).status_code == 422
    assert client.get("/api/interest/messages").json() == {"count": 0, "messages": []}


def test_sending_again_replaces_the_note(client):
    write_note(client, message="first")
    write_note(client, message="second")
    inbox = client.get("/api/interest/messages").json()
    assert inbox["count"] == 1
    assert [m["message"] for m in inbox["messages"]] == ["second"]


def test_notes_are_rate_limited_but_replacements_are_not(client, monkeypatch):
    from backend import main

    monkeypatch.setattr(main, "INTEREST_MESSAGES_MAX_PER_WINDOW", 1)
    assert write_note(client, "a" * 24, message="one").status_code == 200
    assert write_note(client, "b" * 24, message="two").status_code == 429
    assert write_note(client, "a" * 24, message="one, edited").status_code == 200


def test_owner_can_delete_a_note_but_the_vote_stays(client):
    write_note(client, message="please remove me")
    assert client.delete(f"/api/interest/messages/{'a' * 24}").status_code == 204
    assert client.get("/api/interest/messages").json() == {"count": 1, "messages": []}
    assert client.delete(f"/api/interest/messages/{'a' * 24}").status_code == 404
