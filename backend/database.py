import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

# Locally the SQLite file lives next to the backend package. On Vercel the project
# filesystem is read-only (only /tmp is writable), and for real persistence there
# DATABASE_URL should point at a hosted Postgres (e.g. Neon) instead.
_on_vercel = bool(os.getenv("VERCEL"))
_default_db = (
    "sqlite:////tmp/tracker.db"
    if _on_vercel
    else f"sqlite:///{Path(__file__).parent / 'tracker.db'}"
)

DATABASE_URL = os.getenv("DATABASE_URL") or _default_db

# SQLAlchemy 1.4+ requires "postgresql://", but some hosts hand out "postgres://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLite needs check_same_thread=False because FastAPI serves requests from a
# thread pool; PostgreSQL doesn't take that argument.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

# A hosted database closes idle connections (and Neon suspends itself); a pooled connection that was closed
# behind our back would fail the next request, so each one is checked as it is taken out of the pool and
# retired before the server is likely to have dropped it.
pool_options = {} if DATABASE_URL.startswith("sqlite") else {"pool_pre_ping": True, "pool_recycle": 300}

engine = create_engine(DATABASE_URL, connect_args=connect_args, **pool_options)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
