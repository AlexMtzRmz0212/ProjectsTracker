import pytest

from backend import auth

PASSWORD = "correct horse battery staple"


@pytest.fixture()
def locked(monkeypatch):
    """Owner login on, with no brute-force delay so wrong-password tests stay fast."""
    monkeypatch.setenv("OWNER_PASSWORD", PASSWORD)
    monkeypatch.setattr(auth, "FAILED_LOGIN_DELAY", 0)


def sign_in(client, password=PASSWORD):
    return client.post("/api/auth/login", json={"password": password})


def test_open_when_no_password_locally(client):
    assert client.get("/api/projects").status_code == 200
    assert client.get("/api/auth/me").json() == {"authenticated": True, "required": False}


def test_data_routes_need_a_session(client, locked):
    for method, path in [
        ("get", "/api/projects"),
        ("post", "/api/projects"),
        ("get", "/api/sessions"),
        ("get", "/api/timer"),
        ("post", "/api/timer/stop"),
    ]:
        assert getattr(client, method)(path).status_code == 401, path
    assert client.get("/api/auth/me").json() == {"authenticated": False, "required": True}


def test_login_logout_cycle(client, locked):
    assert sign_in(client, "nope").status_code == 401
    assert client.get("/api/projects").status_code == 401

    res = sign_in(client)
    assert res.status_code == 204
    cookie = res.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie

    assert client.get("/api/projects").status_code == 200
    assert client.get("/api/auth/me").json() == {"authenticated": True, "required": True}

    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/projects").status_code == 401


def test_forged_and_expired_tokens_are_rejected(client, locked, monkeypatch):
    client.cookies.set(auth.COOKIE, "e30.AAAA")
    assert client.get("/api/projects").status_code == 401

    client.cookies.clear()
    monkeypatch.setattr(auth, "SESSION_SECONDS", -5)  # issued already expired
    assert sign_in(client).status_code == 204
    assert client.get("/api/projects").status_code == 401


def test_changing_the_password_signs_everyone_out(client, locked, monkeypatch):
    assert sign_in(client).status_code == 204
    assert client.get("/api/projects").status_code == 200
    monkeypatch.setenv("OWNER_PASSWORD", "a different password")
    assert client.get("/api/projects").status_code == 401


def test_fails_closed_on_vercel_without_a_password(client, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    assert client.get("/api/projects").status_code == 503
    assert sign_in(client).status_code == 503
    assert client.get("/api/auth/me").json() == {"authenticated": False, "required": True}


def test_public_routes_stay_public(client, locked):
    assert client.get("/api/health").json() == {"ok": True}
    assert client.get("/api/interest").status_code == 200


def test_visitors_can_write_in_but_never_read(client, locked):
    note = {"visitor_id": "a" * 24, "message": "I'd use this for my thesis"}
    assert client.post("/api/interest/message", json=note).status_code == 200

    assert client.get("/api/interest/messages").status_code == 401
    assert client.delete(f"/api/interest/messages/{'a' * 24}").status_code == 401

    assert sign_in(client).status_code == 204
    inbox = client.get("/api/interest/messages").json()
    assert [m["message"] for m in inbox["messages"]] == ["I'd use this for my thesis"]
