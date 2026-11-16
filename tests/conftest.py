import os
import tempfile
from pathlib import Path

import pytest

# Point the app at a throwaway SQLite file *before* backend.database is imported,
# so tests never touch the real backend/tracker.db. The same goes for the accounts
# settings: a developer's .env must not leak into the tests.
_tmp_dir = tempfile.mkdtemp(prefix="projects-tracker-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_tmp_dir) / 'test.db'}"
os.environ["SESSION_SECRET"] = "test-session-secret"
os.environ["ADMIN_EMAIL"] = "admin@example.com"
os.environ["OWNER_PASSWORD"] = "admin password 123"
os.environ.pop("VERCEL", None)

from fastapi.testclient import TestClient  # noqa: E402

from backend import auth  # noqa: E402
from backend.bootstrap import init_db, seed_user_statuses  # noqa: E402
from backend.database import Base, SessionLocal, engine  # noqa: E402
from backend.main import app  # noqa: E402
from backend.models import User  # noqa: E402
from backend import passwords  # noqa: E402
from backend.passwords import hash_password  # noqa: E402

passwords._N = 2**10  # a cheap scrypt cost: hashes carry their own, so this only speeds the tests up

ADMIN = {"email": "admin@example.com", "password": "admin password 123"}


@pytest.fixture(autouse=True)
def _no_login_delay(monkeypatch):
    """Wrong-password tests shouldn't sleep."""
    monkeypatch.setattr(auth, "FAILED_LOGIN_DELAY", 0)


@pytest.fixture()
def fresh_db():
    """An empty database with only the admin account (made from ADMIN_EMAIL + OWNER_PASSWORD)."""
    Base.metadata.drop_all(bind=engine)
    init_db(engine)


@pytest.fixture()
def anonymous(fresh_db):
    """A client with no session."""
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def client(anonymous):
    """A client signed in as the admin, who owns the data: the one most tests use."""
    assert anonymous.post("/api/auth/login", json=ADMIN).status_code == 200
    return anonymous


@pytest.fixture()
def make_user(fresh_db):
    """Make an account and return a client signed in as it: `make_user("b@example.com")`."""
    opened = []

    def make(email, password="a perfectly fine password", admin=False):
        with SessionLocal() as db:
            user = User(email=email, password_hash=hash_password(password), is_admin=admin)
            db.add(user)
            db.flush()
            seed_user_statuses(db, user.id)
            db.commit()
        c = TestClient(app)
        opened.append(c)
        assert c.post("/api/auth/login", json={"email": email, "password": password}).status_code == 200
        return c

    yield make
    for c in opened:
        c.close()


@pytest.fixture()
def other(make_user):
    """A second, ordinary user, signed in."""
    return make_user("other@example.com")
