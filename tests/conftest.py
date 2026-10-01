import os
import tempfile
from pathlib import Path

import pytest

# Point the app at a throwaway SQLite file *before* backend.database is imported,
# so tests never touch the real backend/tracker.db.
_tmp_dir = tempfile.mkdtemp(prefix="projects-tracker-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_tmp_dir) / 'test.db'}"

from fastapi.testclient import TestClient  # noqa: E402

from backend.database import Base, engine  # noqa: E402
from backend.main import app  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c
