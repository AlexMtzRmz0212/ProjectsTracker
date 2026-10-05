"""
Database setup that runs when the app starts: create missing tables, bring a
database made by an older version up to date, and make sure there are statuses.

There is no migration tool here. `create_all` only creates tables that don't exist,
so changes to an existing table (projects, todos) are applied by hand below, and every step
checks whether it is already done. Running this twice is harmless.
"""

from sqlalchemy import Engine, inspect, select, text
from sqlalchemy.orm import Session as DbSession

from . import models
from .models import Status

# What a fresh database starts with. The owner can rename, recolor or add to these.
DEFAULT_STATUSES = [
    ("Active", "#3a744b", False),
    ("Done", "#56606b", True),
]


def init_db(engine: Engine) -> None:
    models.Base.metadata.create_all(bind=engine)
    _add_project_columns(engine)
    _add_todo_columns(engine)
    _add_status_columns(engine)
    _add_pomodoro_columns(engine)
    with DbSession(engine) as db:
        _seed_statuses(db)
        _backfill_status_ids(db)
        db.commit()
    _drop_legacy_status_column(engine)


def _project_columns(engine: Engine) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns("projects")}


def _add_project_columns(engine: Engine) -> None:
    """v1 projects had a `status` string and no notes. status_id is added nullable
    because existing rows have no value yet; _backfill_status_ids fills it in.

    An interim version also added a category_id column (and a categories table) that was
    later merged into statuses. It is left alone: it is nullable so nothing trips on it,
    and SQLite can't drop a column that has a foreign key.

    skipped_at (the Feed's skip) is NULL for projects made before it existed: never skipped.
    archived_at is NULL for those too: they are on the board, not in the archive."""
    columns = _project_columns(engine)
    with engine.begin() as conn:
        if "status_id" not in columns:
            conn.execute(text("ALTER TABLE projects ADD COLUMN status_id VARCHAR REFERENCES statuses(id)"))
        if "notes" not in columns:
            conn.execute(text("ALTER TABLE projects ADD COLUMN notes TEXT NOT NULL DEFAULT ''"))
        if "skipped_at" not in columns:
            column_type = models.Project.__table__.c.skipped_at.type.compile(dialect=engine.dialect)
            conn.execute(text(f"ALTER TABLE projects ADD COLUMN skipped_at {column_type}"))
        if "archived_at" not in columns:
            column_type = models.Project.__table__.c.archived_at.type.compile(dialect=engine.dialect)
            conn.execute(text(f"ALTER TABLE projects ADD COLUMN archived_at {column_type}"))


def _add_todo_columns(engine: Engine) -> None:
    """to-dos made before completed_at existed get NULL: when they were ticked off isn't known.
    parent_id is NULL for to-dos made before sub-to-dos existed: they are all top-level."""
    columns = {c["name"] for c in inspect(engine).get_columns("todos")}
    with engine.begin() as conn:
        if "completed_at" not in columns:
            column_type = models.Todo.__table__.c.completed_at.type.compile(dialect=engine.dialect)
            conn.execute(text(f"ALTER TABLE todos ADD COLUMN completed_at {column_type}"))
        if "parent_id" not in columns:
            conn.execute(text("ALTER TABLE todos ADD COLUMN parent_id VARCHAR REFERENCES todos(id) ON DELETE CASCADE"))


def _add_status_columns(engine: Engine) -> None:
    """Statuses made before is_pinned existed are not pinned."""
    if "is_pinned" not in {c["name"] for c in inspect(engine).get_columns("statuses")}:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE statuses ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE"))


def _add_pomodoro_columns(engine: Engine) -> None:
    """Pomodoros saved before `completed` existed were all finished ones: they get TRUE."""
    if "completed" not in {c["name"] for c in inspect(engine).get_columns("pomodoros")}:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE pomodoros ADD COLUMN completed BOOLEAN NOT NULL DEFAULT TRUE"))


def _seed_statuses(db: DbSession) -> None:
    if db.scalar(select(Status.id).limit(1)) is not None:
        return
    for order, (name, color, is_done) in enumerate(DEFAULT_STATUSES, start=1):
        db.add(Status(name=name, color=color, is_done=is_done, sort_order=order))
    db.flush()


def _backfill_status_ids(db: DbSession) -> None:
    """Point every project that has no status_id at a status: v1 'done' projects at the
    first finished status, everything else at the first open one."""
    first_open = db.scalar(select(Status).where(Status.is_done.is_(False)).order_by(Status.sort_order))
    first_done = db.scalar(select(Status).where(Status.is_done.is_(True)).order_by(Status.sort_order))
    legacy = "status" in _project_columns(db.get_bind())
    if legacy and first_done is not None:
        db.execute(
            text("UPDATE projects SET status_id = :id WHERE status_id IS NULL AND status = 'done'"),
            {"id": first_done.id},
        )
    db.execute(text("UPDATE projects SET status_id = :id WHERE status_id IS NULL"), {"id": first_open.id})


def _drop_legacy_status_column(engine: Engine) -> None:
    # The old column is NOT NULL with no default, so left in place it would reject every new project.
    if "status" in _project_columns(engine):
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE projects DROP COLUMN status"))
