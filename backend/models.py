import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, false, func, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    """Naive UTC 'now'. Every timestamp in the database is naive UTC."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Status(Base):
    """Where a project stands (Idea, Active, On hold, Done, ...). Every project has one.
    `is_done` marks the statuses that mean "finished": no timer, tucked away at the bottom.
    `is_pinned` marks the one status whose column stays on the board when the others are hidden
    (at most one; the update route clears it from the rest)."""

    __tablename__ = "statuses"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(40))
    color: Mapped[str] = mapped_column(String(9), default="#56606b")
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Project(Base):
    """`skipped_at` is when it was last sent to the back of the Feed's queue (NULL if never);
    the server sets it, in the skip route. `archived_at` is when it was put away (NULL while it
    is on the board); the archive and restore routes set it, and its status is left as it was.
    `cancelled_at` is when it was called off: a cancelled project is archived too (so it leaves the
    board and the Feed), and restoring it clears both."""

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(80))
    color: Mapped[str] = mapped_column(String(9), default="#8b5cf6")
    icon: Mapped[str] = mapped_column(String(40), default="folder")
    # A status in use can't be deleted, so there is no cascade to worry about here
    status_id: Mapped[str] = mapped_column(ForeignKey("statuses.id"), index=True)
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # When it was last edited: its details, status or notes, or its to-dos. Skipping it in the Feed or
    # working on it doesn't count. The routes set it (see _touch_project); the Projects board sorts by it.
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, server_default=func.now())
    skipped_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    sessions: Mapped[list["Session"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    todos: Mapped[list["Todo"]] = relationship(cascade="all, delete-orphan")
    open_items: Mapped[list["OpenItem"]] = relationship(cascade="all, delete-orphan")


class Todo(Base):
    """One line on a project's to-do list, or, with no project (`project_id` NULL), a task of its
    own: something to do and time that isn't part of any project. `completed_at` is when it was
    ticked off (NULL while open, and for to-dos finished before the column existed); the server
    sets it, which is how a session can list what got done during it. `parent_id` makes it a
    sub-to-do of another to-do on the same project (NULL for a top-level one); only one level deep,
    and the delete route removes a to-do's sub-to-dos with it. `working_since` is when it was
    marked as being worked on (NULL when it isn't); any number can be, and ticking one off clears it.
    `cancelled_at` is when it was called off: it is closed (`done` is set, so it is out of every open
    list) but never completed (`completed_at` stays NULL, so it isn't counted as work done)."""

    __tablename__ = "todos"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    project_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    parent_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("todos.id", ondelete="CASCADE"), nullable=True, index=True
    )
    text: Mapped[str] = mapped_column(String(200))
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    working_since: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Session(Base):
    """One block of time worked on a project, or on a task (a to-do with no project: `project_id`
    NULL, `todo_id` set). A project's session may name one of its to-dos too. `end` is NULL while
    the timer runs."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    project_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    todo_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("todos.id", ondelete="SET NULL"), nullable=True, index=True
    )
    start: Mapped[datetime] = mapped_column(DateTime, index=True)
    end: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    note: Mapped[str] = mapped_column(String(280), default="")

    project: Mapped[Project] = relationship(back_populates="sessions")


class OpenItem(Base):
    """Something started and left open to be closed later: a long piece of work on a project or a
    task that runs alongside the timer (and may run for days). It isn't a session until it is
    closed; closing it makes one from `start` to the moment it was closed."""

    __tablename__ = "open_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    project_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    todo_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("todos.id", ondelete="CASCADE"), nullable=True, index=True
    )
    start: Mapped[datetime] = mapped_column(DateTime)
    note: Mapped[str] = mapped_column(String(280), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Pomodoro(Base):
    """One focus. Which projects it covered is whatever sessions overlap [start, end], so the timers
    clicked during it are logged as usual. It can also say what it was for: a project (`project_id`),
    a task or a project's to-do (`todo_id`), or a plain `label` for a chore or activity with no home
    of its own. The links are plain ids, not foreign keys: a pomodoro outlives what it was for, and
    then the label (copied from its name when it was saved) is what's left.
    `completed` is False for a focus that was stopped or cut short before its countdown ran out."""

    __tablename__ = "pomodoros"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    start: Mapped[datetime] = mapped_column(DateTime, index=True)
    end: Mapped[datetime] = mapped_column(DateTime, index=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    project_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    todo_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    label: Mapped[str] = mapped_column(String(120), default="", server_default="")


class InterestVote(Base):
    """One anonymous "I'd use this" from the public landing page. `visitor_id` is a
    random id the browser makes up, so clicking twice doesn't count twice."""

    __tablename__ = "interest_votes"

    visitor_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class InterestMessage(Base):
    """What a visitor chose to send after pressing "I'd use this": an email to reply
    to, a note, or both. One per visitor_id; sending again replaces it."""

    __tablename__ = "interest_messages"

    visitor_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), default="")
    message: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Habit(Base):
    """A habit from the My Habits app (a Loop Habit Tracker fork), copied in from its Drive backup (see habits.py).
    `loop_uuid` is the habit's key in that app: a sync updates the row it matches and adds the rest. `value_type`
    is boolean (yes/no), numerical, or time (minutes since midnight). `removed_at` is when a sync found it missing
    from the newest backup; its days are kept. Read-only here: habits are edited in the other app."""

    __tablename__ = "habits"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    loop_uuid: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    question: Mapped[str] = mapped_column(String(300), default="", server_default="")
    unit: Mapped[str] = mapped_column(String(40), default="", server_default="")
    value_type: Mapped[str] = mapped_column(String(12), default="boolean")
    target_type: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    target_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    freq_num: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    freq_den: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    removed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    entries: Mapped[list["HabitEntry"]] = relationship(cascade="all, delete-orphan")


class HabitEntry(Base):
    """One habit on one day. `status` is yes, no, skip or unknown for a yes/no habit, and `value` (with `value`
    holding the number, or the minutes since midnight of a time) for the others."""

    __tablename__ = "habit_entries"

    habit_id: Mapped[str] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"), primary_key=True)
    entry_date: Mapped[date] = mapped_column(Date, primary_key=True)
    status: Mapped[str] = mapped_column(String(10), default="unknown")
    value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class HabitSync(Base):
    """The one row saying which backup the habits were last copied from, and when."""

    __tablename__ = "habit_sync"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    file_name: Mapped[str] = mapped_column(String(255), default="")
    md5: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

