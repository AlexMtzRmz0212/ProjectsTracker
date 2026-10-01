from datetime import datetime, timedelta, timezone


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def now() -> datetime:
    return datetime.now(timezone.utc)


def make_project(client, name="Website", color="#8b5cf6", icon="code"):
    res = client.post("/api/projects", json={"name": name, "color": color, "icon": icon})
    assert res.status_code == 201, res.text
    return res.json()


# ── Projects ────────────────────────────────────────────────────────────────

def test_project_crud(client):
    a = make_project(client, "Alpha")
    b = make_project(client, "Beta", color="#10b981")
    assert a["status"] == "active"
    assert b["sort_order"] > a["sort_order"]

    listed = client.get("/api/projects").json()
    assert [p["name"] for p in listed] == ["Alpha", "Beta"]
    assert listed[0]["total_seconds"] == 0

    res = client.patch(f"/api/projects/{a['id']}", json={"name": "Alpha 2", "status": "done"})
    assert res.status_code == 200
    assert res.json()["name"] == "Alpha 2"
    assert res.json()["status"] == "done"

    assert client.delete(f"/api/projects/{a['id']}").status_code == 204
    assert [p["name"] for p in client.get("/api/projects").json()] == ["Beta"]


def test_project_validation(client):
    assert client.post("/api/projects", json={"name": ""}).status_code == 422
    assert client.post("/api/projects", json={"name": "X", "color": "red"}).status_code == 422
    assert client.patch("/api/projects/missing", json={"name": "X"}).status_code == 404


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
