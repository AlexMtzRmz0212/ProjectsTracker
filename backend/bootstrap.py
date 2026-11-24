"""
Database setup that runs when the app starts: create missing tables, bring a
database made by an older version up to date, and make sure there are statuses.

There is no migration tool here. `create_all` only creates tables that don't exist,
so changes to an existing table (projects, todos) are applied by hand below, and every step
checks whether it is already done. Running this twice is harmless.
"""

import logging
import os
import re

from sqlalchemy import Engine, Table, inspect, select, text, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.schema import CreateTable
from sqlalchemy.orm import Session as DbSession

from . import models
from .models import Status, User
from .passwords import hash_password

log = logging.getLogger(__name__)

# What a fresh database starts with. Every account gets its own copy to rename, recolor or add to.
DEFAULT_STATUSES = [
    ("Active", "#3a744b", False),
    ("Done", "#56606b", True),
]

# The names above in the languages the app speaks. They are only the starting point: the person renames them freely.
STATUS_NAMES = {"es": {"Active": "Activo", "Done": "Hecho"}}

# The tables whose rows belong to one account. Rows made before accounts existed have no user_id until the
# admin adopts them (_adopt_orphans).
OWNED_MODELS = [
    models.Status, models.Project, models.Todo, models.Session,
    models.OpenItem, models.Pomodoro, models.Habit,
]


def init_db(engine: Engine) -> None:
    models.Base.metadata.create_all(bind=engine)
    _add_project_columns(engine)
    _add_todo_columns(engine)
    _add_status_columns(engine)
    _add_pomodoro_columns(engine)
    _add_session_columns(engine)
    _add_user_columns(engine)
    _add_language_column(engine)
    _add_plan_columns(engine)
    # Tasks of their own are to-dos with no project, and their time is sessions with no project
    _make_nullable(engine, models.Todo.__table__, "project_id")
    _make_nullable(engine, models.Session.__table__, "project_id")
    # Habits made here have no Drive key (loop_uuid), and say where they came from (source)
    _add_habit_columns(engine)
    _make_nullable(engine, models.Habit.__table__, "loop_uuid")
    with DbSession(engine) as db:
        _seed_statuses(db)
        _backfill_status_ids(db)
        _ensure_admin(db)
        _adopt_orphans(db)
        db.commit()
    _migrate_habit_sync(engine)
    _drop_legacy_status_column(engine)
    _ensure_one_running_timer(engine)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def seed_user_statuses(db: DbSession, user_id: str, language: str = "en") -> None:
    """Give a new account the default statuses, named in its language (nothing if it already has some)."""
    if db.scalar(select(Status.id).where(Status.user_id == user_id).limit(1)) is not None:
        return
    names = STATUS_NAMES.get(language, {})
    for order, (name, color, is_done) in enumerate(DEFAULT_STATUSES, start=1):
        db.add(Status(user_id=user_id, name=names.get(name, name), color=color, is_done=is_done, sort_order=order))
    db.flush()


def _first_admin_id(db: DbSession) -> str | None:
    return db.scalar(select(User.id).where(User.is_admin.is_(True)).order_by(User.created_at).limit(1))


def _ensure_admin(db: DbSession) -> None:
    """With no accounts yet, make the first one, the admin, from ADMIN_EMAIL and OWNER_PASSWORD. That is how the
    person who ran the single-owner version keeps their data: they sign in with the password they already had.
    After that the variables are ignored (the password is changed in the app)."""
    if db.scalar(select(User.id).limit(1)) is not None:
        return
    email, password = normalize_email(os.getenv("ADMIN_EMAIL", "")), os.getenv("OWNER_PASSWORD", "")
    if not email or not password:
        log.warning("No accounts yet: set ADMIN_EMAIL and OWNER_PASSWORD to create the admin")
        return
    db.add(User(email=email, password_hash=hash_password(password), is_admin=True))
    db.flush()


def _adopt_orphans(db: DbSession) -> None:
    """Everything made before accounts existed (no user_id) becomes the admin's, and the admin has statuses."""
    admin_id = _first_admin_id(db)
    if admin_id is None:
        return
    for model in OWNED_MODELS:
        db.execute(update(model).where(model.user_id.is_(None)).values(user_id=admin_id))
    seed_user_statuses(db, admin_id)


def _add_user_columns(engine: Engine) -> None:
    """Add `user_id` to a table made before accounts existed (nullable; the admin adopts the rows). A habit's
    uuid used to be unique on its own: it is now unique per account."""
    existing = set(inspect(engine).get_table_names())
    with engine.begin() as conn:
        for model in OWNED_MODELS:
            table = model.__tablename__
            if table not in existing:
                continue
            if "user_id" not in {c["name"] for c in inspect(conn).get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE"))
            conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_user_id ON {table} (user_id)"))
        legacy = [i for i in inspect(conn).get_indexes("habits") if i["name"] == "ix_habits_loop_uuid" and i["unique"]]
        if legacy:
            conn.execute(text("DROP INDEX ix_habits_loop_uuid"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_habits_loop_uuid ON habits (loop_uuid)"))
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_habits_user_loop ON habits (user_id, loop_uuid)"))


def _add_habit_columns(engine: Engine) -> None:
    """Habits made before `source` existed all came from Drive."""
    if "source" not in {c["name"] for c in inspect(engine).get_columns("habits")}:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE habits ADD COLUMN source VARCHAR(8) NOT NULL DEFAULT 'drive'"))


def _add_language_column(engine: Engine) -> None:
    """Accounts made before the app had a second language speak English."""
    if "language" not in {c["name"] for c in inspect(engine).get_columns("users")}:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN language VARCHAR(5) NOT NULL DEFAULT 'en'"))


def _add_plan_columns(engine: Engine) -> None:
    """Plan items made before `why` existed have no reason."""
    if "why" not in {c["name"] for c in inspect(engine).get_columns("plan_items")}:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE plan_items ADD COLUMN why VARCHAR(200) NOT NULL DEFAULT ''"))


def _migrate_habit_sync(engine: Engine) -> None:
    """habit_sync used to be one row (id = 1); it is now one row per account. It only remembers which backup was
    copied last, so the table is made again and the old row goes to the admin."""
    if "user_id" in {c["name"] for c in inspect(engine).get_columns("habit_sync")}:
        return
    with engine.begin() as conn:
        old = conn.execute(text("SELECT file_name, md5, synced_at FROM habit_sync LIMIT 1")).first()
        conn.execute(text("DROP TABLE habit_sync"))
    models.HabitSync.__table__.create(bind=engine)
    with DbSession(engine) as db:
        admin_id = _first_admin_id(db)
        if old is not None and admin_id is not None:
            # Raw SQL: the value is handed back exactly as the old table held it (SQLite returns text here)
            db.execute(
                text("INSERT INTO habit_sync (user_id, file_name, md5, synced_at) VALUES (:u, :f, :m, :s)"),
                {"u": admin_id, "f": old.file_name, "m": old.md5, "s": old.synced_at},
            )
            db.commit()


def _ensure_one_running_timer(engine: Engine) -> None:
    """A safety net under the timer routes: the database itself refuses a second running session for one account.
    If old data already breaks that, the index is skipped (and logged) rather than stopping the app."""
    try:
        with engine.begin() as conn:
            conn.execute(text('CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_one_running ON sessions (user_id) WHERE "end" IS NULL'))
    except SQLAlchemyError:
        log.warning("Could not enforce one running timer per account: some account has several running sessions")


def _project_columns(engine: Engine) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns("projects")}


def _add_project_columns(engine: Engine) -> None:
    """v1 projects had a `status` string and no notes. status_id is added nullable
    because existing rows have no value yet; _backfill_status_ids fills it in.

    An interim version also added a category_id column (and a categories table) that was
    later merged into statuses. It is left alone: it is nullable so nothing trips on it,
    and SQLite can't drop a column that has a foreign key.

    skipped_at (the Feed's skip) is NULL for projects made before it existed: never skipped.
    archived_at is NULL for those too: they are on the board, not in the archive.
    cadence_days is 0 for those too: no cadence."""
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
        if "cancelled_at" not in columns:
            column_type = models.Project.__table__.c.cancelled_at.type.compile(dialect=engine.dialect)
            conn.execute(text(f"ALTER TABLE projects ADD COLUMN cancelled_at {column_type}"))
        if "updated_at" not in columns:
            # Projects made before it existed were last edited when they were made
            column_type = models.Project.__table__.c.updated_at.type.compile(dialect=engine.dialect)
            conn.execute(text(f"ALTER TABLE projects ADD COLUMN updated_at {column_type}"))
            conn.execute(text("UPDATE projects SET updated_at = created_at WHERE updated_at IS NULL"))
        if "cadence_days" not in columns:
            # Projects made before it existed have no cadence
            conn.execute(text("ALTER TABLE projects ADD COLUMN cadence_days INTEGER NOT NULL DEFAULT 0"))


def _add_todo_columns(engine: Engine) -> None:
    """to-dos made before completed_at existed get NULL: when they were ticked off isn't known.
    parent_id is NULL for to-dos made before sub-to-dos existed: they are all top-level.
    working_since is NULL for to-dos made before it existed: none is being worked on."""
    columns = {c["name"] for c in inspect(engine).get_columns("todos")}
    with engine.begin() as conn:
        if engine.dialect.name != "sqlite":
            # A to-do's text was 200 characters long and is 250 now (SQLite doesn't hold to a length, so only others change)
            conn.execute(text("ALTER TABLE todos ALTER COLUMN text TYPE VARCHAR(250)"))
        if "completed_at" not in columns:
            column_type = models.Todo.__table__.c.completed_at.type.compile(dialect=engine.dialect)
            conn.execute(text(f"ALTER TABLE todos ADD COLUMN completed_at {column_type}"))
        if "parent_id" not in columns:
            conn.execute(text("ALTER TABLE todos ADD COLUMN parent_id VARCHAR REFERENCES todos(id) ON DELETE CASCADE"))
        if "working_since" not in columns:
            column_type = models.Todo.__table__.c.working_since.type.compile(dialect=engine.dialect)
            conn.execute(text(f"ALTER TABLE todos ADD COLUMN working_since {column_type}"))
        if "cancelled_at" not in columns:
            column_type = models.Todo.__table__.c.cancelled_at.type.compile(dialect=engine.dialect)
            conn.execute(text(f"ALTER TABLE todos ADD COLUMN cancelled_at {column_type}"))


def _add_session_columns(engine: Engine) -> None:
    """Sessions made before todo_id existed are a project's, with no to-do named. Ones made before
    chores existed have no label."""
    columns = {c["name"] for c in inspect(engine).get_columns("sessions")}
    with engine.begin() as conn:
        if "todo_id" not in columns:
            conn.execute(text("ALTER TABLE sessions ADD COLUMN todo_id VARCHAR REFERENCES todos(id) ON DELETE SET NULL"))
        if "label" not in columns:
            conn.execute(text("ALTER TABLE sessions ADD COLUMN label VARCHAR(120) NOT NULL DEFAULT ''"))


def _make_nullable(engine: Engine, table: Table, column: str) -> None:
    """Let a NOT NULL column take NULL. Postgres can say so directly; SQLite can't change a column,
    so the table is made again from the model and the rows copied across (the usual SQLite recipe).
    Foreign keys aren't enforced on these connections, so the brief rename is safe."""
    current = {c["name"]: c for c in inspect(engine).get_columns(table.name)}
    if column not in current or current[column]["nullable"]:
        return
    if engine.dialect.name != "sqlite":
        with engine.begin() as conn:
            conn.execute(text(f'ALTER TABLE {table.name} ALTER COLUMN "{column}" DROP NOT NULL'))
        return
    new_name = f"{table.name}__new"
    ddl = str(CreateTable(table).compile(dialect=engine.dialect))
    ddl = re.sub(rf"CREATE TABLE {table.name}\b", f"CREATE TABLE {new_name}", ddl, count=1)
    shared = ", ".join(f'"{c.name}"' for c in table.columns if c.name in current)
    with engine.begin() as conn:
        conn.execute(text(ddl))
        conn.execute(text(f"INSERT INTO {new_name} ({shared}) SELECT {shared} FROM {table.name}"))
        conn.execute(text(f"DROP TABLE {table.name}"))
        conn.execute(text(f"ALTER TABLE {new_name} RENAME TO {table.name}"))
    for index in table.indexes:
        index.create(bind=engine, checkfirst=True)


def _add_status_columns(engine: Engine) -> None:
    """Statuses made before is_pinned existed are not pinned."""
    if "is_pinned" not in {c["name"] for c in inspect(engine).get_columns("statuses")}:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE statuses ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE"))


def _add_pomodoro_columns(engine: Engine) -> None:
    """Pomodoros saved before `completed` existed were all finished ones: they get TRUE. Ones saved
    before they could say what they were for have no project, task or label."""
    columns = {c["name"] for c in inspect(engine).get_columns("pomodoros")}
    with engine.begin() as conn:
        if "completed" not in columns:
            conn.execute(text("ALTER TABLE pomodoros ADD COLUMN completed BOOLEAN NOT NULL DEFAULT TRUE"))
        if "project_id" not in columns:
            conn.execute(text("ALTER TABLE pomodoros ADD COLUMN project_id VARCHAR"))
        if "todo_id" not in columns:
            conn.execute(text("ALTER TABLE pomodoros ADD COLUMN todo_id VARCHAR"))
        if "label" not in columns:
            conn.execute(text("ALTER TABLE pomodoros ADD COLUMN label VARCHAR(120) NOT NULL DEFAULT ''"))


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
