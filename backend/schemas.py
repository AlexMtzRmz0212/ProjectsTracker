from datetime import datetime, timezone
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
Status = Literal["active", "done"]


# ── Projects ────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    color: HexColor = "#8b5cf6"
    icon: Annotated[str, Field(min_length=1, max_length=40)] = "folder"


class ProjectUpdate(BaseModel):
    name: Optional[Annotated[str, Field(min_length=1, max_length=80)]] = None
    color: Optional[HexColor] = None
    icon: Optional[Annotated[str, Field(min_length=1, max_length=40)]] = None
    status: Optional[Status] = None
    sort_order: Optional[int] = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    color: str
    icon: str
    status: Status
    sort_order: int
    created_at: UTCDateTime
    total_seconds: int = 0  # closed sessions only; the client adds a running timer live


# ── Sessions ────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    project_id: str
    start: UTCDateTime
    end: UTCDateTime
    note: Annotated[str, Field(max_length=280)] = ""


class SessionUpdate(BaseModel):
    project_id: Optional[str] = None
    start: Optional[UTCDateTime] = None
    end: Optional[UTCDateTime] = None
    note: Optional[Annotated[str, Field(max_length=280)]] = None


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    start: UTCDateTime
    end: Optional[UTCDateTime]
    note: str


class TimerStart(BaseModel):
    project_id: str


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
