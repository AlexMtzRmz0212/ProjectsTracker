"""The Workspace's plan: an ordered "next up" list of projects, to-dos, habits and chores."""


def project(client, name="Thesis"):
    res = client.post("/api/projects", json={"name": name})
    assert res.status_code == 201, res.text
    return res.json()


def todo(client, text="Write", project_id=None, parent_id=None):
    res = client.post("/api/todos", json={"project_id": project_id, "text": text, "parent_id": parent_id})
    assert res.status_code == 201, res.text
    return res.json()


def habit(client, name="Stretch"):
    res = client.post("/api/habits", json={"name": name})
    assert res.status_code == 201, res.text
    return res.json()


def add(client, **body):
    return client.post("/api/plan", json=body)


def test_the_plan_starts_empty_and_keeps_the_order_things_were_added_in(client):
    assert client.get("/api/plan").json() == []
    p = project(client)
    t = todo(client, "Outline", project_id=p["id"])
    h = habit(client)
    first = add(client, kind="project", project_id=p["id"])
    assert first.status_code == 201 and first.json()["project_id"] == p["id"]
    assert add(client, kind="todo", todo_id=t["id"]).status_code == 201
    assert add(client, kind="habit", habit_id=h["id"]).status_code == 201
    assert add(client, kind="chore", label="  Email  ").json()["label"] == "Email"

    plan = client.get("/api/plan").json()
    assert [i["kind"] for i in plan] == ["project", "todo", "habit", "chore"]
    assert [i["position"] for i in plan] == sorted(i["position"] for i in plan)
    assert plan[0]["added_at"].endswith("Z")


def test_a_task_and_a_sub_task_can_be_planned_like_any_to_do(client):
    task = todo(client, "Renew passport")
    sub = todo(client, "Book photos", parent_id=task["id"])
    assert add(client, kind="todo", todo_id=task["id"]).status_code == 201
    assert add(client, kind="todo", todo_id=sub["id"]).status_code == 201
    assert len(client.get("/api/plan").json()) == 2


def test_a_thing_is_on_the_plan_once(client):
    p = project(client)
    first = add(client, kind="project", project_id=p["id"])
    again = add(client, kind="project", project_id=p["id"])
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"]
    assert add(client, kind="chore", label="Email").status_code == 201
    assert add(client, kind="chore", label="Email").status_code == 200
    assert len(client.get("/api/plan").json()) == 2


def test_what_to_add_has_to_be_said_and_open(client):
    p = project(client)
    t = todo(client, "Done already", project_id=p["id"])
    client.patch(f"/api/todos/{t['id']}", json={"done": True})
    assert add(client, kind="project").status_code == 422
    assert add(client, kind="chore", label="   ").status_code == 422
    assert add(client, kind="todo", todo_id=t["id"]).status_code == 422  # ticked off
    assert add(client, kind="todo", todo_id="nope").status_code == 404
    assert add(client, kind="bogus").status_code == 422
    archived = project(client, "Old")
    client.post(f"/api/projects/{archived['id']}/archive")
    assert add(client, kind="project", project_id=archived["id"]).status_code == 422


def test_the_plan_can_be_reordered_and_things_taken_off(client):
    ids = [add(client, kind="chore", label=name).json()["id"] for name in ("a", "b", "c")]
    out = client.put("/api/plan/order", json={"ids": [ids[2], ids[0], ids[1]]})
    assert [i["label"] for i in out.json()] == ["c", "a", "b"]
    assert [i["label"] for i in client.get("/api/plan").json()] == ["c", "a", "b"]

    # Ones left out follow in their order; unknown and repeated ids are ignored
    out = client.put("/api/plan/order", json={"ids": [ids[1], "nope", ids[1]]})
    assert [i["label"] for i in out.json()] == ["b", "c", "a"]

    assert client.delete(f"/api/plan/{ids[1]}").status_code == 204
    assert [i["label"] for i in client.get("/api/plan").json()] == ["c", "a"]
    assert client.delete(f"/api/plan/{ids[1]}").status_code == 404


def test_finished_things_drop_off_the_plan(client):
    p = project(client)
    t = todo(client, "Outline", project_id=p["id"])
    c = todo(client, "Call", project_id=p["id"])
    h = habit(client)
    for body in ({"kind": "project", "project_id": p["id"]}, {"kind": "todo", "todo_id": t["id"]}, {"kind": "todo", "todo_id": c["id"]}, {"kind": "habit", "habit_id": h["id"]}):
        assert add(client, **body).status_code == 201
    add(client, kind="chore", label="Email")
    assert len(client.get("/api/plan").json()) == 5

    client.patch(f"/api/todos/{t['id']}", json={"done": True})  # ticked off
    client.patch(f"/api/todos/{c['id']}", json={"cancelled": True})  # called off
    client.patch(f"/api/habits/{h['id']}", json={"archived": True})
    assert [i["kind"] for i in client.get("/api/plan").json()] == ["project", "chore"]

    client.post(f"/api/projects/{p['id']}/archive")
    assert [i["kind"] for i in client.get("/api/plan").json()] == ["chore"]


def test_deleting_what_is_planned_takes_it_off_the_plan(client):
    p = project(client)
    t = todo(client, "Outline", project_id=p["id"])
    add(client, kind="todo", todo_id=t["id"])
    client.delete(f"/api/todos/{t['id']}")
    assert client.get("/api/plan").json() == []

    add(client, kind="project", project_id=p["id"])
    client.delete(f"/api/projects/{p['id']}")
    assert client.get("/api/plan").json() == []


def test_the_plan_is_private(client, make_user):
    other = make_user("b@example.com")
    mine = project(client)
    item = add(client, kind="project", project_id=mine["id"]).json()
    add(client, kind="chore", label="Mine")

    assert other.get("/api/plan").json() == []
    assert add(other, kind="project", project_id=mine["id"]).status_code == 404  # not theirs to plan
    assert other.delete(f"/api/plan/{item['id']}").status_code == 404
    theirs = add(other, kind="chore", label="Mine")
    assert theirs.status_code == 201 and theirs.json()["id"] != item["id"]  # a chore of the same words is a different item

    # Ordering only touches their own items
    other.put("/api/plan/order", json={"ids": [item["id"]]})
    assert [i["kind"] for i in client.get("/api/plan").json()] == ["project", "chore"]
    assert len(other.get("/api/plan").json()) == 1
