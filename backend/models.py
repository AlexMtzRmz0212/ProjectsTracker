import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    """Naive UTC 'now'. Every timestamp in the database is naive UTC."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(80))
    color: Mapped[str] = mapped_column(String(9), default="#8b5cf6")
    icon: Mapped[str] = mapped_column(String(40), default="folder")
    status: Mapped[str] = mapped_column(String(10), default="active")  # "active" | "done"
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    sessions: Mapped[list["Session"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


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
