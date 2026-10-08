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
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from . import auth, schemas
from .bootstrap import init_db
from .database import engine, get_db
from .models import InterestMessage, InterestVote, OpenItem, Pomodoro, Project, Session, Status, Todo, utcnow

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
        select(Session.project_id, Session.start, Session.end).where(
            Session.end.is_not(None), Session.project_id.is_not(None)
        )
    )
    for project_id, start, end in rows:
        totals[project_id] += (end - start).total_seconds()
    return {pid: int(seconds) for pid, seconds in totals.items()}


def _task_totals(db: DbSession) -> dict[str, int]:
    """Closed-session seconds per task (a to-do with no project)."""
    totals: dict[str, float] = defaultdict(float)
    rows = db.execute(
        select(Session.todo_id, Session.start, Session.end).where(
            Session.end.is_not(None), Session.project_id.is_(None), Session.todo_id.is_not(None)
        )
    )
    for todo_id, start, end in rows:
        totals[todo_id] += (end - start).total_seconds()
    return {tid: int(seconds) for tid, seconds in totals.items()}


def _subject(db: DbSession, project_id: Optional[str], todo_id: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """What time is logged on: a project, a task (a to-do with no project), or a project and one of
    its to-dos (the project is filled in from the to-do when left out). Returns (project_id, todo_id)."""
    if todo_id is not None:
        todo = _get_todo(db, todo_id)
        if todo.project_id is None:
            if project_id is not None:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A task isn't part of a project")
        elif project_id not in (None, todo.project_id):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That to-do belongs to another project")
        else:
            project_id = todo.project_id
    elif project_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick a project or a task")
    else:
        _get_project(db, project_id)
    return project_id, todo_id


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
    if changes.get("is_pinned"):  # only one column is the one that stays
        db.execute(update(Status).where(Status.id != current.id).values(is_pinned=False))
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


def _todo_out(todo: Todo, totals: dict[str, int]) -> schemas.TodoOut:
    out = schemas.TodoOut.model_validate(todo)
    out.total_seconds = totals.get(todo.id, 0) if todo.project_id is None else 0
    return out


@api.get("/todos", response_model=list[schemas.TodoOut])
def list_todos(db: DbSession = Depends(get_db)):
    """Every project's to-dos, and the tasks of their own, at once; there are few, and the app
    shows counts on the list. A task carries the time logged on it."""
    totals = _task_totals(db)
    return [_todo_out(t, totals) for t in db.scalars(select(Todo).order_by(Todo.sort_order, Todo.created_at)).all()]


@api.post("/todos", response_model=schemas.TodoOut, status_code=status.HTTP_201_CREATED)
def create_todo(body: schemas.TodoCreate, db: DbSession = Depends(get_db)):
    if body.project_id is not None:
        _get_project(db, body.project_id)
    if body.parent_id is not None:
        parent = _get_todo(db, body.parent_id)
        if parent.project_id != body.project_id or parent.parent_id is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A sub-to-do goes under a top-level to-do of the same project")
    todo = Todo(**body.model_dump(), sort_order=_next_order(db, Todo))
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


def _reparent_todo(db: DbSession, todo: Todo, parent_id: Optional[str]) -> None:
    """Move a to-do under another one (`parent_id`), or back to the top level (None). Sub-to-dos go one level
    deep: the parent is a top-level to-do of the same project, and one that has sub-to-dos of its own can't
    become a sub. It goes to the end of its new list. A task that becomes a sub-to-do of another task is no
    longer a task of its own, so the time and open items on it move to the task it is under."""
    if parent_id is not None:
        parent = _get_todo(db, parent_id)
        has_subs = db.scalar(select(Todo.id).where(Todo.parent_id == todo.id).limit(1)) is not None
        if parent.id == todo.id or parent.project_id != todo.project_id or parent.parent_id is not None or has_subs:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "A to-do goes under a top-level to-do of the same project, and one with sub-to-dos can't go under another",
            )
        if todo.project_id is None:
            db.execute(update(Session).where(Session.todo_id == todo.id).values(todo_id=parent.id))
            db.execute(update(OpenItem).where(OpenItem.todo_id == todo.id).values(todo_id=parent.id))
    todo.parent_id = parent_id
    todo.sort_order = _next_order(db, Todo)


@api.patch("/todos/{todo_id}", response_model=schemas.TodoOut)
def update_todo(todo_id: str, body: schemas.TodoUpdate, db: DbSession = Depends(get_db)):
    todo = _get_todo(db, todo_id)
    was_done = todo.done
    changes = body.model_dump(exclude_unset=True)
    working = changes.pop("working", None)
    moves = "parent_id" in changes
    new_parent = changes.pop("parent_id", None)
    if moves and new_parent != todo.parent_id:
        _reparent_todo(db, todo, new_parent)
    for field, value in changes.items():
        if value is not None:
            setattr(todo, field, value)
    if working is not None:  # marking it again keeps when it was first marked
        todo.working_since = (todo.working_since or utcnow()) if working else None
    if todo.done != was_done:  # ticking again keeps the first time; unticking forgets it
        todo.completed_at = utcnow() if todo.done else None
    if todo.done:
        todo.working_since = None
        # A task ticked off is finished: its timer stops, as a finished project's does
        current = _running(db)
        if todo.project_id is None and current is not None and current.todo_id == todo.id:
            _end_timer(db, current, utcnow())
    db.commit()
    db.refresh(todo)
    return _todo_out(todo, _task_totals(db))


@api.delete("/todos/{todo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_todo(todo_id: str, db: DbSession = Depends(get_db)):
    todo = _get_todo(db, todo_id)
    subs = db.scalars(select(Todo).where(Todo.parent_id == todo.id)).all()
    ids = [todo.id, *(sub.id for sub in subs)]
    if todo.project_id is None:
        # A task's time and open items have nothing else to belong to: they go with it
        db.execute(Session.__table__.delete().where(Session.todo_id.in_(ids)))
        db.execute(OpenItem.__table__.delete().where(OpenItem.todo_id.in_(ids)))
    else:
        # A project's to-do: its time stays the project's
        db.execute(update(Session).where(Session.todo_id.in_(ids)).values(todo_id=None))
        db.execute(update(OpenItem).where(OpenItem.todo_id.in_(ids)).values(todo_id=None))
    for sub in subs:
        db.delete(sub)
    db.delete(todo)
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
    project_id, todo_id = _subject(db, body.project_id, body.todo_id)
    _validate_span(body.start, body.end)
    session = Session(**{**body.model_dump(), "project_id": project_id, "todo_id": todo_id})
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@api.patch("/sessions/{session_id}", response_model=schemas.SessionOut)
def update_session(session_id: str, body: schemas.SessionUpdate, db: DbSession = Depends(get_db)):
    session = _get_session(db, session_id)
    changes = body.model_dump(exclude_unset=True)
    if "project_id" in changes or "todo_id" in changes:
        changes["project_id"], changes["todo_id"] = _subject(
            db, changes.get("project_id", session.project_id), changes.get("todo_id", session.todo_id)
        )
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
    """Only one timer runs at a time: starting a project (or a task) stops whatever was running."""
    project_id, todo_id = _subject(db, body.project_id, body.todo_id)
    now = utcnow()
    current = _running(db)
    if current is not None:
        if current.project_id == project_id and current.todo_id == todo_id:
            return current
        _end_timer(db, current, now)
    session = Session(project_id=project_id, todo_id=todo_id, start=now, end=None)
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
#region Open items

def _get_open_item(db: DbSession, item_id: str) -> OpenItem:
    item = db.get(OpenItem, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Open item not found")
    return item


def _validate_open_start(start: datetime) -> None:
    if start > utcnow() + FUTURE_TOLERANCE:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Start can't be in the future")


@api.get("/open-items", response_model=list[schemas.OpenItemOut])
def list_open_items(db: DbSession = Depends(get_db)):
    return db.scalars(select(OpenItem).order_by(OpenItem.start)).all()


@api.post("/open-items", response_model=schemas.OpenItemOut, status_code=status.HTTP_201_CREATED)
def create_open_item(body: schemas.OpenItemCreate, db: DbSession = Depends(get_db)):
    """Start something to close later. Any number can be open, alongside the timer."""
    project_id, todo_id = _subject(db, body.project_id, body.todo_id)
    start = body.start or utcnow()
    _validate_open_start(start)
    item = OpenItem(project_id=project_id, todo_id=todo_id, start=start, note=body.note)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@api.patch("/open-items/{item_id}", response_model=schemas.OpenItemOut)
def update_open_item(item_id: str, body: schemas.OpenItemUpdate, db: DbSession = Depends(get_db)):
    item = _get_open_item(db, item_id)
    changes = body.model_dump(exclude_unset=True)
    if "project_id" in changes or "todo_id" in changes:
        changes["project_id"], changes["todo_id"] = _subject(
            db, changes.get("project_id", item.project_id), changes.get("todo_id", item.todo_id)
        )
    if changes.get("start") is not None:
        _validate_open_start(changes["start"])
    for field, value in changes.items():
        if value is not None or field in ("project_id", "todo_id"):
            setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@api.post("/open-items/{item_id}/close", response_model=schemas.SessionOut)
def close_open_item(item_id: str, body: schemas.OpenItemClose, db: DbSession = Depends(get_db)):
    """Close it: it becomes a session from its start to `end` (now if not given)."""
    item = _get_open_item(db, item_id)
    end = body.end or utcnow()
    _validate_span(item.start, end)
    session = Session(project_id=item.project_id, todo_id=item.todo_id, start=item.start, end=end, note=item.note)
    db.add(session)
    db.delete(item)
    db.commit()
    db.refresh(session)
    return session


@api.delete("/open-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_open_item(item_id: str, db: DbSession = Depends(get_db)):
    """Throw it away: nothing is logged."""
    db.delete(_get_open_item(db, item_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

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
