"""
ProjectsTracker — FastAPI backend
=================================
Run:  uvicorn backend.main:app --reload --port 8001
Every route lives under /api so the Vite dev proxy and the Vercel deploy share
the same paths. Only /api/health, /api/auth/*, /api/interest and
/api/interest/message are public; everything else, including reading what
visitors wrote (/api/interest/messages), needs the owner's session (see auth.py).
"""

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from . import auth, schemas
from .bootstrap import init_db
from .database import engine, get_db
from .models import InterestMessage, InterestVote, Pomodoro, Project, Session, Status, Todo, utcnow

init_db(engine)

app = FastAPI(title="ProjectsTracker", version="1.0.0")
public = APIRouter(prefix="/api")
api = APIRouter(prefix="/api", dependencies=[Depends(auth.require_owner)])

# Manual entries may not end in the future; a little slack absorbs clock skew
# between the browser and the server.
FUTURE_TOLERANCE = timedelta(minutes=1)

# A timer stopped sooner than this leaves no session behind. Manual entries aren't held to it.
MIN_TIMER_SESSION = timedelta(minutes=2)

# The public interest counter can't tell people apart, so it caps how fast new
# votes are accepted overall: a script can't pump thousands in a few minutes.
INTEREST_WINDOW = timedelta(minutes=10)
INTEREST_MAX_PER_WINDOW = 60
INTEREST_MESSAGES_MAX_PER_WINDOW = 20


# ─────────────────────────────────────────────────────────────────────────────
#region Helpers

def _get_project(db: DbSession, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return project


def _get_session(db: DbSession, session_id: str) -> Session:
    session = db.get(Session, session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return session


def _get_status(db: DbSession, status_id: str) -> Status:
    found = db.get(Status, status_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Status not found")
    return found


def _first_open_status(db: DbSession) -> Status:
    found = db.scalars(select(Status).where(Status.is_done.is_(False)).order_by(Status.sort_order)).first()
    if found is None:  # the status routes never allow this
        raise HTTPException(status.HTTP_409_CONFLICT, "Add a status that isn't marked done first")
    return found


def _next_order(db: DbSession, model) -> int:
    return (db.scalar(select(func.max(model.sort_order))) or 0) + 1


def _ensure_unique_name(db: DbSession, model, name: str, label: str, except_id: Optional[str] = None) -> None:
    """Two statuses with the same name can't be told apart in the UI."""
    query = select(model.id).where(func.lower(model.name) == name.lower())
    if except_id is not None:
        query = query.where(model.id != except_id)
    if db.scalar(query) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"There is already a {label} called “{name}”")


def _end_timer(db: DbSession, current: Session, now: datetime, keep: bool = False) -> Optional[Session]:
    """Close a running session. One shorter than MIN_TIMER_SESSION was an accidental
    click, so it is dropped instead of kept (returns None then). `keep` is for a pause:
    the person means to carry on, so even a few seconds stay in the log."""
    if not keep and now - current.start < MIN_TIMER_SESSION:
        db.delete(current)
        return None
    current.end = now
    return current


def _stop_timers(db: DbSession, condition) -> None:
    """A finished project has no timer: stop the running one if it belongs to a project matching `condition`."""
    current = _running(db)
    if current is not None and db.scalar(
        select(Project.id).where(Project.id == current.project_id).where(condition)
    ) is not None:
        _end_timer(db, current, utcnow())


def _running(db: DbSession) -> Optional[Session]:
    return db.scalars(select(Session).where(Session.end.is_(None))).first()


def _validate_span(start: datetime, end: Optional[datetime]) -> None:
    if end is None:
        return
    if end <= start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "End must be after start")
    if end > utcnow() + FUTURE_TOLERANCE:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "End can't be in the future")


def _totals(db: DbSession) -> dict[str, int]:
    """Closed-session seconds per project. Summed in Python to stay portable
    between SQLite and Postgres date arithmetic."""
    totals: dict[str, float] = defaultdict(float)
    rows = db.execute(
        select(Session.project_id, Session.start, Session.end).where(Session.end.is_not(None))
    )
    for project_id, start, end in rows:
        totals[project_id] += (end - start).total_seconds()
    return {pid: int(seconds) for pid, seconds in totals.items()}


def _project_out(project: Project, total_seconds: int = 0) -> schemas.ProjectOut:
    out = schemas.ProjectOut.model_validate(project)
    out.total_seconds = total_seconds
    return out

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region Projects

@public.get("/health")
def health():
    return {"ok": True}


@api.get("/projects", response_model=list[schemas.ProjectOut])
def list_projects(db: DbSession = Depends(get_db)):
    projects = db.scalars(select(Project).order_by(Project.sort_order, Project.created_at)).all()
    totals = _totals(db)
    return [_project_out(p, totals.get(p.id, 0)) for p in projects]


@api.post("/projects", response_model=schemas.ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(body: schemas.ProjectCreate, db: DbSession = Depends(get_db)):
    data = body.model_dump()
    data["status_id"] = _get_status(db, data["status_id"]).id if data["status_id"] else _first_open_status(db).id
    project = Project(**data, sort_order=_next_order(db, Project))
    db.add(project)
    db.commit()
    db.refresh(project)
    return _project_out(project)


@api.patch("/projects/{project_id}", response_model=schemas.ProjectOut)
def update_project(project_id: str, body: schemas.ProjectUpdate, db: DbSession = Depends(get_db)):
    project = _get_project(db, project_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("notes", "") is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Notes can't be null")
    if "status_id" in changes:
        if changes["status_id"] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A project always has a status")
        if _get_status(db, changes["status_id"]).is_done:
            _stop_timers(db, Project.id == project.id)
    for field, value in changes.items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return _project_out(project, _totals(db).get(project.id, 0))


@api.post("/projects/{project_id}/skip", response_model=schemas.ProjectOut)
def skip_project(project_id: str, db: DbSession = Depends(get_db)):
    """Send a project to the back of the Feed's queue. The client ranks projects by the later of
    their last session and this stamp, so it stays back until the others have had their turn."""
    project = _get_project(db, project_id)
    project.skipped_at = utcnow()
    db.commit()
    db.refresh(project)
    return _project_out(project, _totals(db).get(project.id, 0))


@api.post("/projects/{project_id}/archive", response_model=schemas.ProjectOut)
def archive_project(project_id: str, db: DbSession = Depends(get_db)):
    """Put a project away: off the board, out of the Feed and the open stats, its history kept.
    Its status is left alone, so restoring puts it back in the same column. An archived project
    has no timer, so a running one is stopped."""
    project = _get_project(db, project_id)
    _stop_timers(db, Project.id == project.id)
    project.archived_at = project.archived_at or utcnow()  # archiving twice keeps the first moment
    db.commit()
    db.refresh(project)
    return _project_out(project, _totals(db).get(project.id, 0))


@api.post("/projects/{project_id}/restore", response_model=schemas.ProjectOut)
def restore_project(project_id: str, db: DbSession = Depends(get_db)):
    """Bring an archived project back to the board, in the status it left."""
    project = _get_project(db, project_id)
    project.archived_at = None
    db.commit()
    db.refresh(project)
    return _project_out(project, _totals(db).get(project.id, 0))


@api.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, db: DbSession = Depends(get_db)):
    db.delete(_get_project(db, project_id))  # sessions go with it (ORM cascade)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region Statuses

def _open_statuses_left(db: DbSession, without_id: str) -> int:
    return db.scalar(
        select(func.count()).select_from(Status).where(Status.is_done.is_(False), Status.id != without_id)
    ) or 0


@api.get("/statuses", response_model=list[schemas.StatusOut])
def list_statuses(db: DbSession = Depends(get_db)):
    return db.scalars(select(Status).order_by(Status.sort_order, Status.name)).all()


@api.post("/statuses", response_model=schemas.StatusOut, status_code=status.HTTP_201_CREATED)
def create_status(body: schemas.StatusCreate, db: DbSession = Depends(get_db)):
    _ensure_unique_name(db, Status, body.name, "status")
    created = Status(**body.model_dump(), sort_order=_next_order(db, Status))
    db.add(created)
    db.commit()
    db.refresh(created)
    return created


@api.patch("/statuses/{status_id}", response_model=schemas.StatusOut)
def update_status(status_id: str, body: schemas.StatusUpdate, db: DbSession = Depends(get_db)):
    current = _get_status(db, status_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("name") is not None:
        _ensure_unique_name(db, Status, changes["name"], "status", except_id=current.id)
    if changes.get("is_done") and not current.is_done:
        # New projects need somewhere to start, so one open status must always remain
        if _open_statuses_left(db, current.id) == 0:
            raise HTTPException(status.HTTP_409_CONFLICT, "Keep at least one status that isn't marked done")
        _stop_timers(db, Project.status_id == current.id)
    for field, value in changes.items():
        if value is not None:
            setattr(current, field, value)
    db.commit()
    db.refresh(current)
    return current


@api.delete("/statuses/{status_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_status(status_id: str, db: DbSession = Depends(get_db)):
    current = _get_status(db, status_id)
    in_use = db.scalar(select(func.count()).select_from(Project).where(Project.status_id == current.id)) or 0
    if in_use:
        noun, pronoun = ("projects", "them") if in_use != 1 else ("project", "it")
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{in_use} {noun} still use this status. Move {pronoun} to another status first.",
        )
    if not current.is_done and _open_statuses_left(db, current.id) == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Keep at least one status that isn't marked done")
    db.delete(current)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region To-dos

def _get_todo(db: DbSession, todo_id: str) -> Todo:
    todo = db.get(Todo, todo_id)
    if todo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "To-do not found")
    return todo


@api.get("/todos", response_model=list[schemas.TodoOut])
def list_todos(db: DbSession = Depends(get_db)):
    """Every project's to-dos at once; there are few, and the app shows counts on the list."""
    return db.scalars(select(Todo).order_by(Todo.sort_order, Todo.created_at)).all()


@api.post("/todos", response_model=schemas.TodoOut, status_code=status.HTTP_201_CREATED)
def create_todo(body: schemas.TodoCreate, db: DbSession = Depends(get_db)):
    _get_project(db, body.project_id)
    todo = Todo(**body.model_dump(), sort_order=_next_order(db, Todo))
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


@api.patch("/todos/{todo_id}", response_model=schemas.TodoOut)
def update_todo(todo_id: str, body: schemas.TodoUpdate, db: DbSession = Depends(get_db)):
    todo = _get_todo(db, todo_id)
    was_done = todo.done
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(todo, field, value)
    if todo.done != was_done:  # ticking again keeps the first time; unticking forgets it
        todo.completed_at = utcnow() if todo.done else None
    db.commit()
    db.refresh(todo)
    return todo


@api.delete("/todos/{todo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_todo(todo_id: str, db: DbSession = Depends(get_db)):
    db.delete(_get_todo(db, todo_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region Sessions

@api.get("/sessions", response_model=list[schemas.SessionOut])
def list_sessions(
    start: Optional[schemas.UTCDateTime] = None,
    end: Optional[schemas.UTCDateTime] = None,
    db: DbSession = Depends(get_db),
):
    """Sessions overlapping [start, end). A running session counts as ongoing."""
    query = select(Session).order_by(Session.start)
    if end is not None:
        query = query.where(Session.start < end)
    if start is not None:
        query = query.where((Session.end.is_(None)) | (Session.end > start))
    return db.scalars(query).all()


@api.post("/sessions", response_model=schemas.SessionOut, status_code=status.HTTP_201_CREATED)
def create_session(body: schemas.SessionCreate, db: DbSession = Depends(get_db)):
    _get_project(db, body.project_id)
    _validate_span(body.start, body.end)
    session = Session(**body.model_dump())
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@api.patch("/sessions/{session_id}", response_model=schemas.SessionOut)
def update_session(session_id: str, body: schemas.SessionUpdate, db: DbSession = Depends(get_db)):
    session = _get_session(db, session_id)
    changes = body.model_dump(exclude_unset=True)
    if "project_id" in changes:
        _get_project(db, changes["project_id"])
    _validate_span(changes.get("start", session.start), changes.get("end", session.end))
    for field, value in changes.items():
        setattr(session, field, value)
    db.commit()
    db.refresh(session)
    return session


@api.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str, db: DbSession = Depends(get_db)):
    db.delete(_get_session(db, session_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region Timer

@api.get("/timer", response_model=Optional[schemas.SessionOut])
def get_timer(db: DbSession = Depends(get_db)):
    return _running(db)


@api.post("/timer/start", response_model=schemas.SessionOut)
def start_timer(body: schemas.TimerStart, db: DbSession = Depends(get_db)):
    """Only one timer runs at a time: starting a project stops whatever was running."""
    _get_project(db, body.project_id)
    now = utcnow()
    current = _running(db)
    if current is not None:
        if current.project_id == body.project_id:
            return current
        _end_timer(db, current, now)
    session = Session(project_id=body.project_id, start=now, end=None)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@api.post("/timer/stop", response_model=Optional[schemas.SessionOut])
def stop_timer(keep: bool = False, db: DbSession = Depends(get_db)):
    current = _running(db)
    if current is None:
        return None
    stopped = _end_timer(db, current, utcnow(), keep=keep)
    db.commit()
    if stopped is None:
        return None
    db.refresh(stopped)
    return stopped

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region Pomodoros

@api.get("/pomodoros", response_model=list[schemas.PomodoroOut])
def list_pomodoros(
    start: Optional[schemas.UTCDateTime] = None,
    end: Optional[schemas.UTCDateTime] = None,
    db: DbSession = Depends(get_db),
):
    """Pomodoros overlapping [start, end), cut-short ones included."""
    query = select(Pomodoro).order_by(Pomodoro.start)
    if end is not None:
        query = query.where(Pomodoro.start < end)
    if start is not None:
        query = query.where(Pomodoro.end > start)
    return db.scalars(query).all()


@api.post("/pomodoros", response_model=schemas.PomodoroOut, status_code=status.HTTP_201_CREATED)
def create_pomodoro(body: schemas.PomodoroCreate, db: DbSession = Depends(get_db)):
    """Saved by the client when a focus ends: `completed` if its countdown ran out, otherwise it was cut short."""
    _validate_span(body.start, body.end)
    pomodoro = Pomodoro(**body.model_dump())
    db.add(pomodoro)
    db.commit()
    db.refresh(pomodoro)
    return pomodoro

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region Interest counter (public)

def _interest_count(db: DbSession) -> int:
    return db.scalar(select(func.count()).select_from(InterestVote)) or 0


@public.get("/interest", response_model=schemas.InterestOut)
def get_interest(db: DbSession = Depends(get_db)):
    return {"count": _interest_count(db)}


def _recent(db: DbSession, model) -> int:
    """Rows of `model` created inside the rate-limit window."""
    return db.scalar(
        select(func.count()).select_from(model).where(model.created_at > utcnow() - INTEREST_WINDOW)
    ) or 0


def _register_vote(db: DbSession, visitor_id: str) -> None:
    """Count this visitor once. Repeating a visitor_id changes nothing."""
    if db.get(InterestVote, visitor_id) is not None:
        return
    if _recent(db, InterestVote) >= INTEREST_MAX_PER_WINDOW:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Lots of votes right now. Try again in a few minutes.")
    db.add(InterestVote(visitor_id=visitor_id))
    try:
        db.commit()
    except IntegrityError:  # the same visitor raced themselves; they're counted either way
        db.rollback()


@public.post("/interest", response_model=schemas.InterestOut)
def add_interest(body: schemas.InterestIn, db: DbSession = Depends(get_db)):
    """Register one "I'd use this"."""
    _register_vote(db, body.visitor_id)
    return {"count": _interest_count(db)}


@public.post("/interest/message", response_model=schemas.InterestOut)
def send_interest_message(body: schemas.InterestMessageIn, db: DbSession = Depends(get_db)):
    """Leave the owner a way to reply and/or a note. Writing in counts as interest
    too, so this works even if the plain vote never reached the server."""
    if not body.email and not body.message:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Add an email or a note")
    _register_vote(db, body.visitor_id)

    existing = db.get(InterestMessage, body.visitor_id)
    if existing is not None:  # sending again replaces the earlier note
        existing.email, existing.message, existing.created_at = body.email, body.message, utcnow()
    else:
        if _recent(db, InterestMessage) >= INTEREST_MESSAGES_MAX_PER_WINDOW:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Lots of notes right now. Try again in a few minutes.")
        db.add(InterestMessage(visitor_id=body.visitor_id, email=body.email, message=body.message))
    try:
        db.commit()
    except IntegrityError:  # a double submit from the same visitor: the first one stands
        db.rollback()
    return {"count": _interest_count(db)}


@api.get("/interest/messages", response_model=schemas.InterestInboxOut)
def list_interest_messages(db: DbSession = Depends(get_db)):
    """Owner only: the vote count and everything visitors have written, newest first."""
    rows = db.scalars(select(InterestMessage).order_by(InterestMessage.created_at.desc())).all()
    return {"count": _interest_count(db), "messages": rows}


@api.delete("/interest/messages/{visitor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interest_message(visitor_id: str, db: DbSession = Depends(get_db)):
    """Owner only: erase one visitor's note and email. Their vote still counts."""
    row = db.get(InterestMessage, visitor_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

#endregion

app.include_router(public)
app.include_router(auth.router)
app.include_router(api)
