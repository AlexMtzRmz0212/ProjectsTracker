from datetime import date, datetime, timezone
from typing import Annotated, Literal, Optional

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


# ── Accounts ────────────────────────────────────────────────────────────────

# Deliberately loose: the point is a login name that can receive mail, and an invite already vouches for the person
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_lower=True, min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$"),
]
NewPassword = Annotated[str, Field(min_length=8, max_length=200)]


Language = Literal["en", "es"]


class LoginBody(BaseModel):
    email: Email
    password: Annotated[str, Field(max_length=200)]


class LanguageBody(BaseModel):
    language: Language


class RegisterBody(BaseModel):
    code: Annotated[str, Field(min_length=1, max_length=100)]
    email: Email
    password: NewPassword
    language: Language = "en"  # what the person was reading when they signed up: names their starting statuses


class PasswordBody(BaseModel):
    current_password: Annotated[str, Field(max_length=200)]
    new_password: NewPassword


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    is_admin: bool = False
    language: str = "en"


class SessionInfo(BaseModel):
    authenticated: bool
    user: Optional[UserOut] = None


class InviteCreate(BaseModel):
    days: Annotated[int, Field(ge=1, le=30)] = 7  # how long the code works


class InviteCreated(BaseModel):
    id: str
    code: str  # shown once: only its hash is stored
    expires_at: UTCDateTime


class InviteOut(BaseModel):
    id: str
    created_at: UTCDateTime
    expires_at: UTCDateTime
    used_at: Optional[UTCDateTime] = None
    used_by_email: Optional[str] = None


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
    cadence_days: Annotated[int, Field(ge=0, le=365)] = 0  # how often it is done, in days; 0: no cadence


class ProjectUpdate(BaseModel):
    name: Optional[Annotated[str, Field(min_length=1, max_length=80)]] = None
    color: Optional[HexColor] = None
    icon: Optional[Annotated[str, Field(min_length=1, max_length=40)]] = None
    status_id: Optional[str] = None
    notes: Optional[Annotated[str, Field(max_length=NOTES_MAX)]] = None
    cadence_days: Optional[Annotated[int, Field(ge=0, le=365)]] = None
    sort_order: Optional[int] = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    color: str
    icon: str
    status_id: str
    notes: str
    cadence_days: int = 0  # how often it is done, in days; 0: no cadence
    sort_order: int
    created_at: UTCDateTime
    updated_at: UTCDateTime  # last edited (details, status, notes or to-dos)
    skipped_at: Optional[UTCDateTime] = None  # last sent to the back of the Feed's queue
    archived_at: Optional[UTCDateTime] = None  # when it was put away; None while it is on the board
    cancelled_at: Optional[UTCDateTime] = None  # when it was called off (it is archived too); None otherwise
    total_seconds: int = 0  # closed sessions only; the client adds a running timer live


# ── To-dos ──────────────────────────────────────────────────────────────────

TodoText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=250)]


class TodoCreate(BaseModel):
    project_id: Optional[str] = None  # none: a task of its own
    text: TodoText
    parent_id: Optional[str] = None
    position: Literal["top", "bottom"] = "bottom"  # where it goes in the list: the front, or the back


class TodoUpdate(BaseModel):
    text: Optional[TodoText] = None
    done: Optional[bool] = None
    sort_order: Optional[int] = None
    working: Optional[bool] = None  # being worked on (sets working_since), or not
    cancelled: Optional[bool] = None  # called off (closed, but not done), or taken back
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
    cancelled_at: Optional[UTCDateTime] = None  # called off: `done` is set too, `completed_at` is not
    total_seconds: int = 0  # closed-session time logged on a task (one with no project)


# ── Sessions ────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    # A project, a task (a to-do with no project), a project and one of its to-dos, or a chore:
    # just a free-text label with no project or task
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] = ""
    start: UTCDateTime
    end: UTCDateTime
    note: Annotated[str, Field(max_length=280)] = ""


class SessionUpdate(BaseModel):
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    label: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]] = None
    start: Optional[UTCDateTime] = None
    end: Optional[UTCDateTime] = None
    note: Optional[Annotated[str, Field(max_length=280)]] = None


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    label: str = ""
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
    # What it was for, all optional: a project, a task or to-do, or a free-text label
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] = ""


class PomodoroOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    start: UTCDateTime
    end: UTCDateTime
    completed: bool
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    label: str = ""


class PomodoroLabelsMerge(BaseModel):
    """Rename tags: every pomodoro tagged with one of `labels` (any capitals) becomes tagged `into`."""

    labels: Annotated[list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]], Field(min_length=1, max_length=100)]
    into: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class PomodoroLabelsMerged(BaseModel):
    updated: int


# ── Habits (from the My Habits backup on Drive) ─────────────────────────────

class HabitEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    entry_date: date
    status: str
    value: Optional[float] = None


class HabitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source: str = "drive"  # drive: picked from the My Habits backup (read-only here); app: made here (editable)
    name: str
    question: str = ""
    unit: str = ""
    value_type: str
    target_type: Optional[str] = None
    target_value: Optional[float] = None
    freq_num: Optional[int] = None
    freq_den: Optional[int] = None
    position: int = 0
    archived: bool = False
    removed_at: Optional[UTCDateTime] = None
    entries: list[HabitEntryOut] = []


class HabitsOut(BaseModel):
    habits: list[HabitOut]
    configured: bool  # whether Drive sync is set up on the server
    synced_at: Optional[UTCDateTime] = None
    source_file: str = ""


class HabitSyncOut(BaseModel):
    changed: bool
    file_name: str
    habits: int


class DriveHabitOut(BaseModel):
    """A habit in the newest Drive backup, to choose from."""

    uuid: str
    name: str
    value_type: str
    unit: str = ""
    archived: bool = False
    imported: bool = False  # the user already has it


class DriveHabitsOut(BaseModel):
    file_name: str
    habits: list[DriveHabitOut]


class HabitImportBody(BaseModel):
    uuids: Annotated[list[Annotated[str, Field(min_length=1, max_length=64)]], Field(min_length=1, max_length=200)]


class HabitCreate(BaseModel):
    """A habit made here (a continuous task). Yes/no, or a number to reach (or stay under) a day."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    question: Annotated[str, Field(max_length=300)] = ""
    value_type: Literal["boolean", "numerical"] = "boolean"
    unit: Annotated[str, Field(max_length=40)] = ""
    target_type: Optional[Literal["at_least", "at_most"]] = None
    target_value: Optional[Annotated[float, Field(gt=0)]] = None
    freq_num: Annotated[int, Field(ge=1, le=31)] = 1  # freq_num times every freq_den days
    freq_den: Annotated[int, Field(ge=1, le=31)] = 1


class HabitUpdate(BaseModel):
    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]] = None
    question: Optional[Annotated[str, Field(max_length=300)]] = None
    unit: Optional[Annotated[str, Field(max_length=40)]] = None
    target_type: Optional[Literal["at_least", "at_most"]] = None
    target_value: Optional[Annotated[float, Field(gt=0)]] = None
    freq_num: Optional[Annotated[int, Field(ge=1, le=31)]] = None
    freq_den: Optional[Annotated[int, Field(ge=1, le=31)]] = None
    archived: Optional[bool] = None


class HabitEntryIn(BaseModel):
    """One day of an in-app habit. `unknown` clears the day. A numerical habit takes `value` (the number)."""

    status: Literal["yes", "no", "skip", "value", "unknown"]
    value: Optional[Annotated[float, Field(ge=0, le=1_000_000)]] = None


# ── The Workspace's plan ("next up") ────────────────────────────────────────

class PlanItemCreate(BaseModel):
    """Add something to the plan: a project (`project_id`), a to-do or task (`todo_id`), a habit (`habit_id`) or a
    chore (`label`), according to `kind`."""

    kind: Literal["project", "todo", "habit", "chore"]
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    habit_id: Optional[str] = None
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] = ""
    # Why it is being added (an AI's reason), shown under it on the plan
    why: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""


class PlanItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    project_id: Optional[str] = None
    todo_id: Optional[str] = None
    habit_id: Optional[str] = None
    label: str = ""
    why: str = ""
    position: int
    added_at: UTCDateTime


class PlanOrderBody(BaseModel):
    """Every item of the plan, in the new order. Ones left out keep their place after these."""

    ids: Annotated[list[str], Field(max_length=500)]


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
