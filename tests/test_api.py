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
    run = client.post("/api/timer/start", json={"project_id": p["id"]}).json()
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

    run_a = client.post("/api/timer/start", json={"project_id": a["id"]}).json()
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

    stopped = client.post("/api/timer/stop").json()
    assert stopped["id"] == run_b["id"] and stopped["end"] is not None
    assert client.get("/api/timer").json() is None
    assert client.post("/api/timer/stop").json() is None


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
