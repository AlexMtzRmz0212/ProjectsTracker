from datetime import timedelta

from fastapi.testclient import TestClient

from backend import auth
from backend.database import SessionLocal
from backend.main import app
from backend.models import Invite, User, utcnow

ADMIN = {"email": "admin@example.com", "password": "admin password 123"}  # made from the env vars set in conftest.py


def sign_in(client, email=ADMIN["email"], password=ADMIN["password"]):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def make_invite(admin_client, days=7):
    res = admin_client.post("/api/admin/invites", json={"days": days})
    assert res.status_code == 201, res.text
    return res.json()


def register(client, code, email="new@example.com", password="a perfectly fine password"):
    return client.post("/api/auth/register", json={"code": code, "email": email, "password": password})


# ── Sessions ────────────────────────────────────────────────────────────────

def test_data_routes_need_a_session(anonymous):
    for method, path in [
        ("get", "/api/projects"),
        ("post", "/api/projects"),
        ("get", "/api/sessions"),
        ("get", "/api/timer"),
        ("post", "/api/timer/stop"),
        ("get", "/api/habits"),
        ("get", "/api/admin/invites"),
    ]:
        assert getattr(anonymous, method)(path).status_code == 401, path
    assert anonymous.get("/api/auth/me").json() == {"authenticated": False, "user": None}


def test_login_logout_cycle(anonymous):
    assert sign_in(anonymous, password="nope").status_code == 401
    assert anonymous.get("/api/projects").status_code == 401

    res = sign_in(anonymous)
    assert res.status_code == 200
    assert res.json()["email"] == ADMIN["email"] and res.json()["is_admin"] is True
    cookie = res.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie

    assert anonymous.get("/api/projects").status_code == 200
    me = anonymous.get("/api/auth/me").json()
    assert me["authenticated"] is True and me["user"]["email"] == ADMIN["email"]

    assert anonymous.post("/api/auth/logout").status_code == 204
    assert anonymous.get("/api/projects").status_code == 401


def test_unknown_email_and_wrong_password_look_the_same(anonymous):
    unknown = sign_in(anonymous, email="nobody@example.com")
    wrong = sign_in(anonymous, password="wrong password")
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


def test_email_is_case_insensitive(anonymous):
    assert sign_in(anonymous, email="  ADMIN@Example.com ").status_code == 200


def test_forged_and_expired_tokens_are_rejected(anonymous, monkeypatch):
    anonymous.cookies.set(auth.COOKIE, "e30.AAAA")
    assert anonymous.get("/api/projects").status_code == 401

    anonymous.cookies.clear()
    monkeypatch.setattr(auth, "SESSION_SECONDS", -5)  # issued already expired
    assert sign_in(anonymous).status_code == 200
    assert anonymous.get("/api/projects").status_code == 401


def test_a_token_signed_with_another_key_is_rejected(client, monkeypatch):
    assert client.get("/api/projects").status_code == 200
    monkeypatch.setenv("SESSION_SECRET", "a different secret")
    assert client.get("/api/projects").status_code == 401


def test_a_deleted_user_is_signed_out(client):
    with SessionLocal() as db:
        db.delete(db.query(User).filter_by(email=ADMIN["email"]).one())
        db.commit()
    assert client.get("/api/projects").status_code == 401


def test_fails_closed_on_vercel_without_a_secret(anonymous, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("SESSION_SECRET")
    assert anonymous.get("/api/projects").status_code == 503
    assert sign_in(anonymous).status_code == 503
    assert anonymous.get("/api/auth/me").json() == {"authenticated": False, "user": None}


def test_public_routes_stay_public(anonymous):
    assert anonymous.get("/api/health").json() == {"ok": True}
    assert anonymous.get("/api/interest").status_code == 200


def test_visitors_can_write_in_but_only_the_admin_reads(anonymous, make_user):
    note = {"visitor_id": "a" * 24, "message": "I'd use this for my thesis"}
    assert anonymous.post("/api/interest/message", json=note).status_code == 200

    assert anonymous.get("/api/interest/messages").status_code == 401
    assert anonymous.delete(f"/api/interest/messages/{'a' * 24}").status_code == 401

    ordinary = make_user("ordinary@example.com")
    assert ordinary.get("/api/interest/messages").status_code == 403
    assert ordinary.delete(f"/api/interest/messages/{'a' * 24}").status_code == 403

    assert sign_in(anonymous).status_code == 200
    inbox = anonymous.get("/api/interest/messages").json()
    assert [m["message"] for m in inbox["messages"]] == ["I'd use this for my thesis"]


# ── Passwords ───────────────────────────────────────────────────────────────

def test_changing_the_password_signs_out_other_sessions_but_not_this_one(client):
    elsewhere = TestClient(app)
    assert sign_in(elsewhere).status_code == 200
    assert elsewhere.get("/api/projects").status_code == 200

    new = "a brand new password"
    assert client.post("/api/auth/password", json={"current_password": "wrong", "new_password": new}).status_code == 403
    assert client.post("/api/auth/password", json={"current_password": ADMIN["password"], "new_password": "short"}).status_code == 422
    assert client.post("/api/auth/password", json={"current_password": ADMIN["password"], "new_password": new}).status_code == 204

    assert client.get("/api/projects").status_code == 200  # this session carries on
    assert elsewhere.get("/api/projects").status_code == 401  # the other one is out
    assert sign_in(elsewhere).status_code == 401  # the old password no longer works
    assert sign_in(elsewhere, password=new).status_code == 200
    elsewhere.close()


# ── Invites and registration ────────────────────────────────────────────────

def test_only_the_admin_can_make_or_see_invites(make_user):
    ordinary = make_user("ordinary@example.com")
    assert ordinary.post("/api/admin/invites", json={}).status_code == 403
    assert ordinary.get("/api/admin/invites").status_code == 403
    assert ordinary.delete("/api/admin/invites/anything").status_code == 403


def test_an_invite_lets_one_person_register_once(client):
    invite = make_invite(client)
    newcomer = TestClient(app)

    res = register(newcomer, invite["code"])
    assert res.status_code == 201
    assert res.json()["email"] == "new@example.com" and res.json()["is_admin"] is False
    assert newcomer.get("/api/auth/me").json()["authenticated"] is True  # registering signs in

    # They start with their own default statuses, not the admin's, and nothing else
    assert [s["name"] for s in newcomer.get("/api/statuses").json()] == ["Active", "Done"]
    assert newcomer.get("/api/projects").json() == []

    # The code is used up
    assert register(TestClient(app), invite["code"], email="second@example.com").status_code == 400

    listed = client.get("/api/admin/invites").json()
    assert [(i["used_by_email"], i["used_at"] is not None) for i in listed] == [("new@example.com", True)]
    assert "code" not in listed[0]  # never shown again
    newcomer.close()


def test_bad_expired_and_revoked_invites_are_refused(client):
    visitor = TestClient(app)  # not signed in
    assert register(visitor, "not-a-real-code").status_code == 400

    expired = make_invite(client)
    with SessionLocal() as db:
        db.query(Invite).filter_by(id=expired["id"]).update({"expires_at": utcnow() - timedelta(minutes=1)})
        db.commit()
    assert register(visitor, expired["code"]).status_code == 400

    revoked = make_invite(client)
    assert client.delete(f"/api/admin/invites/{revoked['id']}").status_code == 204
    assert register(visitor, revoked["code"]).status_code == 400
    assert client.delete(f"/api/admin/invites/{revoked['id']}").status_code == 404
    visitor.close()


def test_registration_checks_the_email_and_password(client):
    visitor = TestClient(app)
    invite = make_invite(client)
    assert register(visitor, invite["code"], email="not-an-email").status_code == 422
    assert register(visitor, invite["code"], password="short").status_code == 422
    # A taken email is refused and doesn't burn the invite
    assert register(visitor, invite["code"], email=ADMIN["email"].upper()).status_code == 409
    assert register(visitor, invite["code"]).status_code == 201
    visitor.close()


def test_invite_length_is_bounded(client):
    assert client.post("/api/admin/invites", json={"days": 0}).status_code == 422
    assert client.post("/api/admin/invites", json={"days": 31}).status_code == 422
