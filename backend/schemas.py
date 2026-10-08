from datetime import datetime, timezone
from typing import Annotated, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, PlainSerializer, StringConstraints


def _to_naive_utc(value: datetime) -> datetime:
    """Accept any ISO datetime; store it as naive UTC. Naive input is taken as UTC."""
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _to_iso_z(value: datetime) -> str:
    return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


# Incoming datetimes are normalised to naive UTC; outgoing ones get an explicit "Z"
# so the browser parses them as UTC and does all day-grouping in local time.
UTCDateTime = Annotated[
    datetime,
    AfterValidator(_to_naive_utc),
    PlainSerializer(_to_iso_z, return_type=str, when_used="json"),
]

HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
NOTES_MAX = 20_000
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


# ── Statuses ────────────────────────────────────────────────────────────────

class StatusCreate(BaseModel):
    name: Label
    color: HexColor = "#56606b"
    is_done: bool = False


class StatusUpdate(BaseModel):
    name: Optional[Label] = None
    color: Optional[HexColor] = None
    is_done: Optional[bool] = None
    is_pinned: Optional[bool] = None
    sort_order: Optional[int] = None


class StatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    color: str
    is_done: bool
    is_pinned: bool = False
    sort_order: int


# ── Projects ────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    color: HexColor = "#8b5cf6"
    icon: Annotated[str, Field(min_length=1, max_length=40)] = "folder"
    status_id: Optional[str] = None  # omitted: the first open status
    notes: Annotated[str, Field(max_length=NOTES_MAX)] = ""


class ProjectUpdate(BaseModel):
    name: Optional[Annotated[str, Field(min_length=1, max_length=80)]] = None
    color: Optional[HexColor] = None
    icon: Optional[Annotated[str, Field(min_length=1, max_length=40)]] = None
    status_id: Optional[str] = None
    notes: Optional[Annotated[str, Field(max_length=NOTES_MAX)]] = None
    sort_order: Optional[int] = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    color: str
    icon: str
    status_id: str
    notes: str
    sort_order: int
    created_at: UTCDateTime
    skipped_at: Optional[UTCDateTime] = None  # last sent to the back of the Feed's queue
    archived_at: Optional[UTCDateTime] = None  # when it was put away; None while it is on the board
    total_seconds: int = 0  # closed sessions only; the client adds a running timer live


# ── To-dos ──────────────────────────────────────────────────────────────────

TodoText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class TodoCreate(BaseModel):
    project_id: Optional[str] = None  # none: a task of its own
    text: TodoText
    parent_id: Optional[str] = None


class TodoUpdate(BaseModel):
    text: Optional[TodoText] = None
    done: Optional[bool] = None
    sort_order: Optional[int] = None
    working: Optional[bool] = None  # being worked on (sets working_since), or not
    parent_id: Optional[str] = None  # under another to-do of the same project; sent as null, back to the top level


class TodoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: Optional[str] = None
    parent_id: Optional[str] = None
    text: str
    done: bool
    sort_order: int
    created_at: UTCDateTime
    completed_at: Optional[UTCDateTime] = None
    working_since: Optional[UTCDateTime] = None
    total_seconds: int = 0  # closed-session time logged on a task (one with no project)


# ── Sessions ────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    # A project, a task (a to-do with no project), or a project and one of its to-dos
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    start: UTCDateTime
    end: UTCDateTime
    note: Annotated[str, Field(max_length=280)] = ""


class SessionUpdate(BaseModel):
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    start: Optional[UTCDateTime] = None
    end: Optional[UTCDateTime] = None
    note: Optional[Annotated[str, Field(max_length=280)]] = None


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    start: UTCDateTime
    end: Optional[UTCDateTime]
    note: str


class TimerStart(BaseModel):
    project_id: Optional[str] = None
    todo_id: Optional[str] = None


# ── Open items ──────────────────────────────────────────────────────────────

class OpenItemCreate(BaseModel):
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    start: Optional[UTCDateTime] = None  # none: now
    note: Annotated[str, Field(max_length=280)] = ""


class OpenItemUpdate(BaseModel):
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    start: Optional[UTCDateTime] = None
    note: Optional[Annotated[str, Field(max_length=280)]] = None


class OpenItemClose(BaseModel):
    end: Optional[UTCDateTime] = None  # none: now


class OpenItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    start: UTCDateTime
    note: str


# ── Pomodoros ───────────────────────────────────────────────────────────────

class PomodoroCreate(BaseModel):
    start: UTCDateTime
    end: UTCDateTime
    completed: bool = True


class PomodoroOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    start: UTCDateTime
    end: UTCDateTime
    completed: bool


# ── Interest counter (public) ───────────────────────────────────────────────

VisitorId = Annotated[str, Field(pattern=r"^[A-Za-z0-9-]{16,64}$")]
# Deliberately loose: the point is a reply address, and the owner is the only reader.
# Empty is allowed because an email or a note alone is enough.
OptionalEmail = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=254, pattern=r"^$|^[^\s@]+@[^\s@]+\.[^\s@]+$")
]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]


class InterestIn(BaseModel):
    visitor_id: VisitorId


class InterestOut(BaseModel):
    count: int


class InterestMessageIn(BaseModel):
    visitor_id: VisitorId
    email: OptionalEmail = ""
    message: Note = ""


class InterestMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    visitor_id: str
    email: str
    message: str
    created_at: UTCDateTime


class InterestInboxOut(BaseModel):
    count: int
    messages: list[InterestMessageOut]
