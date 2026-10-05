import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    """Naive UTC 'now'. Every timestamp in the database is naive UTC."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Status(Base):
    """Where a project stands (Idea, Active, On hold, Done, ...). Every project has one.
    `is_done` marks the statuses that mean "finished": no timer, tucked away at the bottom."""

    __tablename__ = "statuses"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(40))
    color: Mapped[str] = mapped_column(String(9), default="#56606b")
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Project(Base):
    """`skipped_at` is when it was last sent to the back of the Feed's queue (NULL if never);
    the server sets it, in the skip route. `archived_at` is when it was put away (NULL while it
    is on the board); the archive and restore routes set it, and its status is left as it was."""

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
    skipped_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    sessions: Mapped[list["Session"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    todos: Mapped[list["Todo"]] = relationship(cascade="all, delete-orphan")


class Todo(Base):
    """One line on a project's to-do list. `completed_at` is when it was ticked off (NULL
    while open, and for to-dos finished before the column existed); the server sets it,
    which is how a session can list what got done during it."""

    __tablename__ = "todos"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(String(200))
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Session(Base):
    """One block of time worked on a project. `end` is NULL while the timer runs."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    start: Mapped[datetime] = mapped_column(DateTime, index=True)
    end: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    note: Mapped[str] = mapped_column(String(280), default="")

    project: Mapped[Project] = relationship(back_populates="sessions")


class Pomodoro(Base):
    """One focus. It has no project: which ones it covered is whatever sessions overlap
    [start, end], so the timers clicked during it are logged as usual. `completed` is False
    for a focus that was stopped or cut short before its countdown ran out."""

    __tablename__ = "pomodoros"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    start: Mapped[datetime] = mapped_column(DateTime, index=True)
    end: Mapped[datetime] = mapped_column(DateTime, index=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())


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
