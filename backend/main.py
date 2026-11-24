"""
ProjectsTracker — FastAPI backend
=================================
Run:  uvicorn backend.main:app --reload --port 8001
Every route lives under /api so the Vite dev proxy and the Vercel deploy share
the same paths. Only /api/health, /api/auth/*, /api/interest and
/api/interest/message are public; everything else needs a signed-in user (see auth.py), and every
query is scoped to that user: nobody can read or change anyone else's rows. Reading what visitors
wrote (/api/interest/messages), the habits sync and /api/admin/* are for the admin only.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession, selectinload

from . import auth, habits as habits_sync, schemas
from .bootstrap import init_db
from .database import engine, get_db
from .models import (
    Habit, HabitEntry, HabitSync, InterestMessage, InterestVote, OpenItem, PlanItem, Pomodoro, Project, Session, Status, Todo, User, utcnow,
)

init_db(engine)

app = FastAPI(title="ProjectsTracker", version="1.0.0")
public = APIRouter(prefix="/api")
api = APIRouter(prefix="/api", dependencies=[Depends(auth.current_user)])

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

def _get_owned(db: DbSession, model, item_id: str, user: User, label: str):
    """A row by id, if it is the user's. Someone else's row answers 404, the same as one that doesn't
    exist, so ids can't be probed."""
    found = db.get(model, item_id)
    if found is None or found.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{label} not found")
    return found


def _get_project(db: DbSession, user: User, project_id: str) -> Project:
    return _get_owned(db, Project, project_id, user, "Project")


def _get_session(db: DbSession, user: User, session_id: str) -> Session:
    return _get_owned(db, Session, session_id, user, "Session")


def _get_status(db: DbSession, user: User, status_id: str) -> Status:
    return _get_owned(db, Status, status_id, user, "Status")


def _first_open_status(db: DbSession, user: User) -> Status:
    found = db.scalars(
        select(Status).where(Status.user_id == user.id, Status.is_done.is_(False)).order_by(Status.sort_order)
    ).first()
    if found is None:  # the status routes never allow this
        raise HTTPException(status.HTTP_409_CONFLICT, "Add a status that isn't marked done first")
    return found


def _next_order(db: DbSession, model, user: User) -> int:
    return (db.scalar(select(func.max(model.sort_order)).where(model.user_id == user.id)) or 0) + 1


def _prev_order(db: DbSession, model, user: User) -> int:
    """A sort_order before every other of the user's: the front of whatever list it goes in."""
    return min(0, db.scalar(select(func.min(model.sort_order)).where(model.user_id == user.id)) or 0) - 1


def _touch_project(db: DbSession, project_id: Optional[str]) -> None:
    """Stamp a project as just edited. Not committed here: it goes in with the caller's change."""
    if project_id is not None:
        db.execute(update(Project).where(Project.id == project_id).values(updated_at=utcnow()))


def _ensure_unique_name(db: DbSession, user: User, model, name: str, label: str, except_id: Optional[str] = None) -> None:
    """Two of a user's statuses with the same name can't be told apart in the UI."""
    query = select(model.id).where(model.user_id == user.id, func.lower(model.name) == name.lower())
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


def _stop_timers(db: DbSession, user: User, condition) -> None:
    """A finished project has no timer: stop the user's running one if it belongs to a project matching `condition`."""
    current = _running(db, user)
    if current is not None and db.scalar(
        select(Project.id).where(Project.id == current.project_id).where(condition)
    ) is not None:
        _end_timer(db, current, utcnow())


def _running(db: DbSession, user: User) -> Optional[Session]:
    """The user's running timer: each person has their own."""
    return db.scalars(select(Session).where(Session.user_id == user.id, Session.end.is_(None))).first()


def _validate_span(start: datetime, end: Optional[datetime]) -> None:
    if end is None:
        return
    if end <= start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "End must be after start")
    if end > utcnow() + FUTURE_TOLERANCE:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "End can't be in the future")


def _totals(db: DbSession, user: User) -> dict[str, int]:
    """Closed-session seconds per project. Summed in Python to stay portable
    between SQLite and Postgres date arithmetic."""
    totals: dict[str, float] = defaultdict(float)
    rows = db.execute(
        select(Session.project_id, Session.start, Session.end).where(
            Session.user_id == user.id, Session.end.is_not(None), Session.project_id.is_not(None)
        )
    )
    for project_id, start, end in rows:
        totals[project_id] += (end - start).total_seconds()
    return {pid: int(seconds) for pid, seconds in totals.items()}


def _task_totals(db: DbSession, user: User) -> dict[str, int]:
    """Closed-session seconds per task (a to-do with no project)."""
    totals: dict[str, float] = defaultdict(float)
    rows = db.execute(
        select(Session.todo_id, Session.start, Session.end).where(
            Session.user_id == user.id,
            Session.end.is_not(None),
            Session.project_id.is_(None),
            Session.todo_id.is_not(None),
        )
    )
    for todo_id, start, end in rows:
        totals[todo_id] += (end - start).total_seconds()
    return {tid: int(seconds) for tid, seconds in totals.items()}


def _subject(
    db: DbSession, user: User, project_id: Optional[str], todo_id: Optional[str]
) -> tuple[Optional[str], Optional[str]]:
    """What time is logged on: a project, a task (a to-do with no project), or a project and one of
    its to-dos (the project is filled in from the to-do when left out). Both must be the user's.
    Returns (project_id, todo_id)."""
    if todo_id is not None:
        todo = _get_todo(db, user, todo_id)
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
        _get_project(db, user, project_id)
    return project_id, todo_id


def _session_subject(
    db: DbSession, user: User, project_id: Optional[str], todo_id: Optional[str], label: str = ""
) -> tuple[Optional[str], Optional[str], str]:
    """Like _subject, and a session can also be a chore: no project or task, only a label. A session
    on a project or task keeps no label. Returns (project_id, todo_id, label)."""
    label = (label or "").strip()[:120]
    if project_id is None and todo_id is None and label:
        return None, None, label
    project_id, todo_id = _subject(db, user, project_id, todo_id)
    return project_id, todo_id, ""


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
def list_projects(user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    projects = db.scalars(
        select(Project).where(Project.user_id == user.id).order_by(Project.sort_order, Project.created_at)
    ).all()
    totals = _totals(db, user)
    return [_project_out(p, totals.get(p.id, 0)) for p in projects]


@api.post("/projects", response_model=schemas.ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(body: schemas.ProjectCreate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    data = body.model_dump()
    data["status_id"] = _get_status(db, user, data["status_id"]).id if data["status_id"] else _first_open_status(db, user).id
    project = Project(**data, user_id=user.id, sort_order=_next_order(db, Project, user))
    db.add(project)
    db.commit()
    db.refresh(project)
    return _project_out(project)


@api.patch("/projects/{project_id}", response_model=schemas.ProjectOut)
def update_project(
    project_id: str, body: schemas.ProjectUpdate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)
):
    project = _get_project(db, user, project_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("notes", "") is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Notes can't be null")
    if changes.get("cadence_days", 0) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The cadence can't be null (0 is none)")
    if "status_id" in changes:
        if changes["status_id"] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A project always has a status")
        if _get_status(db, user, changes["status_id"]).is_done:
            _stop_timers(db, user, Project.id == project.id)
    for field, value in changes.items():
        setattr(project, field, value)
    project.updated_at = utcnow()
    db.commit()
    db.refresh(project)
    return _project_out(project, _totals(db, user).get(project.id, 0))


@api.post("/projects/{project_id}/skip", response_model=schemas.ProjectOut)
def skip_project(project_id: str, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Send a project to the back of the Feed's queue. The client ranks projects by the later of
    their last session and this stamp, so it stays back until the others have had their turn."""
    project = _get_project(db, user, project_id)
    project.skipped_at = utcnow()
    db.commit()
    db.refresh(project)
    return _project_out(project, _totals(db, user).get(project.id, 0))


@api.post("/projects/{project_id}/archive", response_model=schemas.ProjectOut)
def archive_project(project_id: str, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Put a project away: off the board, out of the Feed and the open stats, its history kept.
    Its status is left alone, so restoring puts it back in the same column. An archived project
    has no timer, so a running one is stopped."""
    project = _get_project(db, user, project_id)
    _stop_timers(db, user, Project.id == project.id)
    project.archived_at = project.archived_at or utcnow()  # archiving twice keeps the first moment
    db.commit()
    db.refresh(project)
    return _project_out(project, _totals(db, user).get(project.id, 0))


@api.post("/projects/{project_id}/restore", response_model=schemas.ProjectOut)
def restore_project(project_id: str, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Bring an archived project back to the board, in the status it left."""
    project = _get_project(db, user, project_id)
    project.archived_at = None
    project.cancelled_at = None
    db.commit()
    db.refresh(project)
    return _project_out(project, _totals(db, user).get(project.id, 0))


@api.post("/projects/{project_id}/cancel", response_model=schemas.ProjectOut)
def cancel_project(project_id: str, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Call a project off. It is archived too, so it leaves the board, the Feed and the open
    stats with its history kept, and restoring it brings it back. Its timer is stopped."""
    project = _get_project(db, user, project_id)
    _stop_timers(db, user, Project.id == project.id)
    now = utcnow()
    project.archived_at = project.archived_at or now
    project.cancelled_at = project.cancelled_at or now
    db.commit()
    db.refresh(project)
    return _project_out(project, _totals(db, user).get(project.id, 0))


@api.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    db.delete(_get_project(db, user, project_id))  # sessions go with it (ORM cascade)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region Statuses

def _open_statuses_left(db: DbSession, user: User, without_id: str) -> int:
    return db.scalar(
        select(func.count()).select_from(Status).where(
            Status.user_id == user.id, Status.is_done.is_(False), Status.id != without_id
        )
    ) or 0


@api.get("/statuses", response_model=list[schemas.StatusOut])
def list_statuses(user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    return db.scalars(select(Status).where(Status.user_id == user.id).order_by(Status.sort_order, Status.name)).all()


@api.post("/statuses", response_model=schemas.StatusOut, status_code=status.HTTP_201_CREATED)
def create_status(body: schemas.StatusCreate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    _ensure_unique_name(db, user, Status, body.name, "status")
    created = Status(**body.model_dump(), user_id=user.id, sort_order=_next_order(db, Status, user))
    db.add(created)
    db.commit()
    db.refresh(created)
    return created


@api.patch("/statuses/{status_id}", response_model=schemas.StatusOut)
def update_status(
    status_id: str, body: schemas.StatusUpdate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)
):
    current = _get_status(db, user, status_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("name") is not None:
        _ensure_unique_name(db, user, Status, changes["name"], "status", except_id=current.id)
    if changes.get("is_done") and not current.is_done:
        # New projects need somewhere to start, so one open status must always remain
        if _open_statuses_left(db, user, current.id) == 0:
            raise HTTPException(status.HTTP_409_CONFLICT, "Keep at least one status that isn't marked done")
        _stop_timers(db, user, Project.status_id == current.id)
    if changes.get("is_pinned"):  # only one column is the one that stays
        db.execute(update(Status).where(Status.user_id == user.id, Status.id != current.id).values(is_pinned=False))
    for field, value in changes.items():
        if value is not None:
            setattr(current, field, value)
    db.commit()
    db.refresh(current)
    return current


@api.delete("/statuses/{status_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_status(status_id: str, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    current = _get_status(db, user, status_id)
    in_use = db.scalar(select(func.count()).select_from(Project).where(Project.status_id == current.id)) or 0
    if in_use:
        noun, pronoun = ("projects", "them") if in_use != 1 else ("project", "it")
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{in_use} {noun} still use this status. Move {pronoun} to another status first.",
        )
    if not current.is_done and _open_statuses_left(db, user, current.id) == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Keep at least one status that isn't marked done")
    db.delete(current)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region To-dos

def _get_todo(db: DbSession, user: User, todo_id: str) -> Todo:
    return _get_owned(db, Todo, todo_id, user, "To-do")


def _todo_out(todo: Todo, totals: dict[str, int]) -> schemas.TodoOut:
    out = schemas.TodoOut.model_validate(todo)
    out.total_seconds = totals.get(todo.id, 0) if todo.project_id is None else 0
    return out


@api.get("/todos", response_model=list[schemas.TodoOut])
def list_todos(user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Every project's to-dos, and the tasks of their own, at once; there are few, and the app
    shows counts on the list. A task carries the time logged on it."""
    totals = _task_totals(db, user)
    todos = db.scalars(select(Todo).where(Todo.user_id == user.id).order_by(Todo.sort_order, Todo.created_at)).all()
    return [_todo_out(t, totals) for t in todos]


@api.post("/todos", response_model=schemas.TodoOut, status_code=status.HTTP_201_CREATED)
def create_todo(body: schemas.TodoCreate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    if body.project_id is not None:
        _get_project(db, user, body.project_id)
    if body.parent_id is not None:
        parent = _get_todo(db, user, body.parent_id)
        if parent.project_id != body.project_id or parent.parent_id is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A sub-to-do goes under a top-level to-do of the same project")
    fields = body.model_dump(exclude={"position"})
    # A new to-do goes to the back, unless it is asked for the front (a sub-to-do always goes to the back of its parent)
    front = body.position == "top" and body.parent_id is None
    order = _prev_order(db, Todo, user) if front else _next_order(db, Todo, user)
    todo = Todo(**fields, user_id=user.id, sort_order=order)
    db.add(todo)
    _touch_project(db, todo.project_id)
    db.commit()
    db.refresh(todo)
    return todo


def _reparent_todo(db: DbSession, user: User, todo: Todo, parent_id: Optional[str]) -> None:
    """Move a to-do under another one (`parent_id`), or back to the top level (None). Sub-to-dos go one level
    deep: the parent is a top-level to-do of the same project, and one that has sub-to-dos of its own can't
    become a sub. It goes to the end of its new list. A task that becomes a sub-to-do of another task is no
    longer a task of its own, so the time and open items on it move to the task it is under."""
    if parent_id is not None:
        parent = _get_todo(db, user, parent_id)
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
    todo.sort_order = _next_order(db, Todo, user)


@api.patch("/todos/{todo_id}", response_model=schemas.TodoOut)
def update_todo(
    todo_id: str, body: schemas.TodoUpdate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)
):
    todo = _get_todo(db, user, todo_id)
    was_done = todo.done
    changes = body.model_dump(exclude_unset=True)
    working = changes.pop("working", None)
    cancelled = changes.pop("cancelled", None)
    moves = "parent_id" in changes
    new_parent = changes.pop("parent_id", None)
    if moves and new_parent != todo.parent_id:
        _reparent_todo(db, user, todo, new_parent)
    for field, value in changes.items():
        if value is not None:
            setattr(todo, field, value)
    if working is not None:  # marking it again keeps when it was first marked
        todo.working_since = (todo.working_since or utcnow()) if working else None
    if cancelled is not None:  # called off: closed like a done one, but never completed
        todo.done = cancelled
        todo.cancelled_at = (todo.cancelled_at or utcnow()) if cancelled else None
        todo.completed_at = None
    else:
        if todo.done != was_done:  # ticking again keeps the first time; unticking forgets it
            todo.completed_at = utcnow() if todo.done else None
        if not todo.done:  # a cancelled to-do that is reopened is no longer cancelled
            todo.cancelled_at = None
    if todo.done:
        todo.working_since = None
        if not was_done:
            # Closing a to-do closes its open sub-to-dos, the same way (done, or cancelled)
            now = utcnow()
            for sub in db.scalars(select(Todo).where(Todo.parent_id == todo.id, Todo.done.is_(False))):
                sub.working_since = None
                sub.done = True
                sub.cancelled_at = (sub.cancelled_at or now) if todo.cancelled_at else None
                sub.completed_at = None if todo.cancelled_at else now
        # A task ticked off is finished: its timer stops, as a finished project's does
        current = _running(db, user)
        if todo.project_id is None and current is not None and current.todo_id == todo.id:
            _end_timer(db, current, utcnow())
    _touch_project(db, todo.project_id)
    db.commit()
    db.refresh(todo)
    return _todo_out(todo, _task_totals(db, user))


@api.post("/todos/{todo_id}/to-project", response_model=schemas.ProjectOut, status_code=status.HTTP_201_CREATED)
def task_to_project(todo_id: str, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Turn a task into a project of its own. The project is named after the task and starts in the first
    open status; the task's sub-tasks become its to-dos, and the time and open items on the task (a
    running timer too) become the project's. The task itself goes, as it is now the project."""
    task = _get_todo(db, user, todo_id)
    if task.project_id is not None or task.parent_id is not None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only a task can be turned into a project")
    project = Project(
        user_id=user.id,
        name=task.text[:80],
        status_id=_first_open_status(db, user).id,
        sort_order=_next_order(db, Project, user),
    )
    db.add(project)
    db.flush()
    subs = db.scalars(select(Todo).where(Todo.parent_id == task.id)).all()
    for sub in subs:  # they keep their order, as to-dos at the top level of the new project
        sub.project_id = project.id
        sub.parent_id = None
    # Time on the task itself is the project's as a whole; time on a sub-task stays on that to-do
    db.execute(update(Session).where(Session.todo_id == task.id).values(project_id=project.id, todo_id=None))
    db.execute(update(OpenItem).where(OpenItem.todo_id == task.id).values(project_id=project.id, todo_id=None))
    if subs:
        sub_ids = [sub.id for sub in subs]
        db.execute(update(Session).where(Session.todo_id.in_(sub_ids)).values(project_id=project.id))
        db.execute(update(OpenItem).where(OpenItem.todo_id.in_(sub_ids)).values(project_id=project.id))
    db.flush()
    db.delete(task)
    db.commit()
    db.refresh(project)
    return _project_out(project, _totals(db, user).get(project.id, 0))


@api.delete("/todos/{todo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_todo(todo_id: str, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    todo = _get_todo(db, user, todo_id)
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
    _touch_project(db, todo.project_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region Sessions

@api.get("/sessions", response_model=list[schemas.SessionOut])
def list_sessions(
    start: Optional[schemas.UTCDateTime] = None,
    end: Optional[schemas.UTCDateTime] = None,
    user: User = Depends(auth.current_user),
    db: DbSession = Depends(get_db),
):
    """Sessions overlapping [start, end). A running session counts as ongoing."""
    query = select(Session).where(Session.user_id == user.id).order_by(Session.start)
    if end is not None:
        query = query.where(Session.start < end)
    if start is not None:
        query = query.where((Session.end.is_(None)) | (Session.end > start))
    return db.scalars(query).all()


@api.post("/sessions", response_model=schemas.SessionOut, status_code=status.HTTP_201_CREATED)
def create_session(body: schemas.SessionCreate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    project_id, todo_id, label = _session_subject(db, user, body.project_id, body.todo_id, body.label)
    _validate_span(body.start, body.end)
    session = Session(**{**body.model_dump(), "user_id": user.id, "project_id": project_id, "todo_id": todo_id, "label": label})
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@api.patch("/sessions/{session_id}", response_model=schemas.SessionOut)
def update_session(
    session_id: str, body: schemas.SessionUpdate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)
):
    session = _get_session(db, user, session_id)
    changes = body.model_dump(exclude_unset=True)
    if "project_id" in changes or "todo_id" in changes or "label" in changes:
        changes["project_id"], changes["todo_id"], changes["label"] = _session_subject(
            db,
            user,
            changes.get("project_id", session.project_id),
            changes.get("todo_id", session.todo_id),
            changes.get("label", session.label),
        )
    _validate_span(changes.get("start", session.start), changes.get("end", session.end))
    for field, value in changes.items():
        setattr(session, field, value)
    try:
        db.commit()
    except IntegrityError:  # reopening it would make a second running timer
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A timer is already running")
    db.refresh(session)
    return session


@api.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    db.delete(_get_session(db, user, session_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region Timer

@api.get("/timer", response_model=Optional[schemas.SessionOut])
def get_timer(user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    return _running(db, user)


@api.post("/timer/start", response_model=schemas.SessionOut)
def start_timer(body: schemas.TimerStart, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Only one timer runs at a time per person: starting a project (or a task) stops whatever was running."""
    project_id, todo_id = _subject(db, user, body.project_id, body.todo_id)
    now = utcnow()
    current = _running(db, user)
    if current is not None:
        if current.project_id == project_id and current.todo_id == todo_id:
            return current
        _end_timer(db, current, now)
        db.flush()  # the old one is closed or gone before the new one goes in (the database allows one running)
    session = Session(user_id=user.id, project_id=project_id, todo_id=todo_id, start=now, end=None)
    db.add(session)
    try:
        db.commit()
    except IntegrityError:  # two starts raced: the other one won, and its timer is the answer
        db.rollback()
        return _running(db, user)
    db.refresh(session)
    return session


@api.post("/timer/stop", response_model=Optional[schemas.SessionOut])
def stop_timer(keep: bool = False, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    current = _running(db, user)
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

def _get_open_item(db: DbSession, user: User, item_id: str) -> OpenItem:
    return _get_owned(db, OpenItem, item_id, user, "Open item")


def _validate_open_start(start: datetime) -> None:
    if start > utcnow() + FUTURE_TOLERANCE:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Start can't be in the future")


@api.get("/open-items", response_model=list[schemas.OpenItemOut])
def list_open_items(user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    return db.scalars(select(OpenItem).where(OpenItem.user_id == user.id).order_by(OpenItem.start)).all()


@api.post("/open-items", response_model=schemas.OpenItemOut, status_code=status.HTTP_201_CREATED)
def create_open_item(body: schemas.OpenItemCreate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Start something to close later. Any number can be open, alongside the timer."""
    project_id, todo_id = _subject(db, user, body.project_id, body.todo_id)
    start = body.start or utcnow()
    _validate_open_start(start)
    item = OpenItem(user_id=user.id, project_id=project_id, todo_id=todo_id, start=start, note=body.note)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@api.patch("/open-items/{item_id}", response_model=schemas.OpenItemOut)
def update_open_item(
    item_id: str, body: schemas.OpenItemUpdate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)
):
    item = _get_open_item(db, user, item_id)
    changes = body.model_dump(exclude_unset=True)
    if "project_id" in changes or "todo_id" in changes:
        changes["project_id"], changes["todo_id"] = _subject(
            db, user, changes.get("project_id", item.project_id), changes.get("todo_id", item.todo_id)
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
def close_open_item(
    item_id: str, body: schemas.OpenItemClose, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)
):
    """Close it: it becomes a session from its start to `end` (now if not given)."""
    item = _get_open_item(db, user, item_id)
    end = body.end or utcnow()
    _validate_span(item.start, end)
    session = Session(
        user_id=user.id, project_id=item.project_id, todo_id=item.todo_id, start=item.start, end=end, note=item.note
    )
    db.add(session)
    db.delete(item)
    db.commit()
    db.refresh(session)
    return session


@api.delete("/open-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_open_item(item_id: str, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Throw it away: nothing is logged."""
    db.delete(_get_open_item(db, user, item_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region Pomodoros

@api.get("/pomodoros", response_model=list[schemas.PomodoroOut])
def list_pomodoros(
    start: Optional[schemas.UTCDateTime] = None,
    end: Optional[schemas.UTCDateTime] = None,
    user: User = Depends(auth.current_user),
    db: DbSession = Depends(get_db),
):
    """Pomodoros overlapping [start, end), cut-short ones included."""
    query = select(Pomodoro).where(Pomodoro.user_id == user.id).order_by(Pomodoro.start)
    if end is not None:
        query = query.where(Pomodoro.start < end)
    if start is not None:
        query = query.where(Pomodoro.end > start)
    return db.scalars(query).all()


@api.post("/pomodoros", response_model=schemas.PomodoroOut, status_code=status.HTTP_201_CREATED)
def create_pomodoro(body: schemas.PomodoroCreate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Saved by the client when a focus ends: `completed` if its countdown ran out, otherwise it was cut short."""
    _validate_span(body.start, body.end)
    data = body.model_dump()
    # The link and the label are kept apart: if what it was for is deleted later, the label remains.
    # An id that isn't the user's is treated like one that no longer exists: the link is dropped.
    if data["todo_id"] is not None:
        todo = db.get(Todo, data["todo_id"])
        if todo is None or todo.user_id != user.id:
            data["todo_id"] = None
        else:
            data["project_id"] = todo.project_id
            data["label"] = data["label"] or todo.text[:120]
    if data["project_id"] is not None:
        project = db.get(Project, data["project_id"])
        if project is None or project.user_id != user.id:
            data["project_id"] = None
        else:
            data["label"] = data["label"] or project.name
    pomodoro = Pomodoro(**data, user_id=user.id)
    db.add(pomodoro)
    db.commit()
    db.refresh(pomodoro)
    return pomodoro


@api.post("/pomodoros/merge-labels", response_model=schemas.PomodoroLabelsMerged)
def merge_pomodoro_labels(body: schemas.PomodoroLabelsMerge, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Merge tags: the user's pomodoros tagged with any of `labels` (capitals ignored) get the label `into`. Only the
    tags that are just words are touched: a pomodoro for a project or a to-do keeps the name it was saved with."""
    names = {label.strip().lower() for label in body.labels}
    rows = db.scalars(
        select(Pomodoro).where(Pomodoro.user_id == user.id, Pomodoro.project_id.is_(None), Pomodoro.todo_id.is_(None), Pomodoro.label != "")
    ).all()
    # Matched here, not in SQL: SQLite only lowercases plain letters, and the tags are counted the way JavaScript does
    changed = [p for p in rows if p.label.strip().lower() in names and p.label != body.into]
    for p in changed:
        p.label = body.into
    db.commit()
    return {"updated": len(changed)}

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region Habits

def _get_habit(db: DbSession, user: User, habit_id: str) -> Habit:
    return _get_owned(db, Habit, habit_id, user, "Habit")


def _habit_out(db: DbSession, habit: Habit) -> Habit:
    db.refresh(habit)  # its days, as they are now
    return habit


@api.get("/habits", response_model=schemas.HabitsOut)
def list_habits(user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """The user's habits: the ones picked from the My Habits backup (see habits.py) and the ones made here, with
    their last days. Only the admin can sync, so `configured` (which shows the Drive buttons) is false for everyone else."""
    found = db.scalars(
        select(Habit).where(Habit.user_id == user.id).options(selectinload(Habit.entries)).order_by(Habit.position, Habit.name)
    ).all()
    synced = db.get(HabitSync, user.id)
    return {
        "habits": found,
        "configured": user.is_admin and habits_sync.drive_configured(),
        "synced_at": synced.synced_at if synced else None,
        "source_file": synced.file_name if synced else "",
    }


@api.get("/habits/drive", response_model=schemas.DriveHabitsOut)
def list_drive_habits(user: User = Depends(auth.require_admin), db: DbSession = Depends(get_db)):
    """Admin only. The habits in the newest Drive backup, to choose which to add (nothing is changed)."""
    try:
        return habits_sync.list_drive_habits(db, user.id)
    except habits_sync.HabitsError as error:
        raise HTTPException(error.status, str(error))


@api.post("/habits/import", response_model=schemas.HabitSyncOut)
def import_habits(body: schemas.HabitImportBody, user: User = Depends(auth.require_admin), db: DbSession = Depends(get_db)):
    """Admin only. Add the chosen habits from the newest Drive backup, and refresh the ones already added."""
    try:
        return habits_sync.import_habits(db, user.id, body.uuids)
    except habits_sync.HabitsError as error:
        raise HTTPException(error.status, str(error))


@api.post("/habits/sync", response_model=schemas.HabitSyncOut)
def sync_habits(force: bool = False, user: User = Depends(auth.require_admin), db: DbSession = Depends(get_db)):
    """Admin only (the Drive folder is the admin's). Bring the habits already added from Drive up to date with the
    newest backup, unless it is the one already copied (`force` copies it anyway)."""
    try:
        return habits_sync.sync(db, user.id, force=force)
    except habits_sync.HabitsError as error:
        raise HTTPException(error.status, str(error))


@api.post("/habits", response_model=schemas.HabitOut, status_code=status.HTTP_201_CREATED)
def create_habit(body: schemas.HabitCreate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """A habit made here (a continuous task), at the end of the list. It has no Drive key."""
    if body.value_type == "boolean":  # a yes/no habit has no unit or target to reach
        data = body.model_dump(exclude={"unit", "target_type", "target_value"})
    else:
        data = body.model_dump()
        if data["target_value"] is not None and data["target_type"] is None:
            data["target_type"] = "at_least"
    position = (db.scalar(select(func.max(Habit.position)).where(Habit.user_id == user.id)) or 0) + 1
    habit = Habit(**data, user_id=user.id, source="app", loop_uuid=None, position=position)
    db.add(habit)
    db.commit()
    db.refresh(habit)
    return habit


def _own_habit(db: DbSession, user: User, habit_id: str) -> Habit:
    """A habit that can be changed here: one made here. A Drive habit is edited in My Habits, and the next sync would undo it."""
    habit = _get_habit(db, user, habit_id)
    if habit.source != "app":
        raise HTTPException(status.HTTP_409_CONFLICT, "That habit comes from My Habits: change it there")
    return habit


@api.patch("/habits/{habit_id}", response_model=schemas.HabitOut)
def update_habit(habit_id: str, body: schemas.HabitUpdate, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    habit = _own_habit(db, user, habit_id)
    changes = body.model_dump(exclude_unset=True)
    for field in ("name", "question", "unit", "freq_num", "freq_den", "archived"):
        if field in changes and changes[field] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{field} can't be null")
    if habit.value_type == "boolean":
        changes.pop("unit", None)
        changes.pop("target_type", None)
        changes.pop("target_value", None)
    for field, value in changes.items():
        setattr(habit, field, value)
    db.commit()
    return _habit_out(db, habit)


@api.delete("/habits/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(habit_id: str, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Remove a habit and its days: one made here, or one added from Drive (it can be added again; Drive itself is never touched)."""
    db.delete(_get_habit(db, user, habit_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@api.put("/habits/{habit_id}/entries/{day}", response_model=schemas.HabitOut)
def set_habit_day(
    habit_id: str, day: date, body: schemas.HabitEntryIn, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)
):
    """Log one day of a habit made here. `unknown` clears the day. A yes/no habit takes yes, no or skip; a numerical
    one takes a value (or skip)."""
    habit = _own_habit(db, user, habit_id)
    if day > date.today() + timedelta(days=1):  # a day or so of slack for the person's own time zone
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That day hasn't happened yet")
    entry = db.get(HabitEntry, (habit.id, day))
    if body.status == "unknown":
        if entry is not None:
            db.delete(entry)
    else:
        numerical = habit.value_type == "numerical"
        if numerical and body.status in ("yes", "no"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A numerical habit takes a number or skip")
        if not numerical and body.status == "value":
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A yes/no habit takes yes, no or skip")
        if body.status == "value" and body.value is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Say how much")
        value = body.value if body.status == "value" else 1.0 if body.status == "yes" else None
        if entry is None:
            db.add(HabitEntry(habit_id=habit.id, entry_date=day, status=body.status, value=value))
        else:
            entry.status, entry.value = body.status, value
    db.commit()
    return _habit_out(db, habit)

#endregion
# ─────────────────────────────────────────────────────────────────────────────
#region Plan (the Workspace's "next up" list)

def _plan_items(db: DbSession, user: User) -> list[PlanItem]:
    """The user's plan, in order. Items whose target has been finished or is gone (a ticked or cancelled to-do, an
    archived or finished project, an archived or removed habit) are dropped from it here, so the list never holds
    anything that can't be worked on."""
    items = db.scalars(select(PlanItem).where(PlanItem.user_id == user.id).order_by(PlanItem.position, PlanItem.added_at)).all()
    if not items:
        return []
    projects = {
        p.id: p
        for p in db.scalars(select(Project).where(Project.user_id == user.id, Project.id.in_([i.project_id for i in items if i.project_id])))
    }
    done_statuses = set(db.scalars(select(Status.id).where(Status.user_id == user.id, Status.is_done.is_(True))))
    todos = {t.id: t for t in db.scalars(select(Todo).where(Todo.user_id == user.id, Todo.id.in_([i.todo_id for i in items if i.todo_id])))}
    habits = {h.id: h for h in db.scalars(select(Habit).where(Habit.user_id == user.id, Habit.id.in_([i.habit_id for i in items if i.habit_id])))}

    def alive(item: PlanItem) -> bool:
        if item.kind == "project":
            p = projects.get(item.project_id)
            return p is not None and p.archived_at is None and p.status_id not in done_statuses
        if item.kind == "todo":
            t = todos.get(item.todo_id)
            return t is not None and not t.done and t.cancelled_at is None
        if item.kind == "habit":
            h = habits.get(item.habit_id)
            return h is not None and not h.archived and h.removed_at is None
        return bool(item.label)

    kept = [i for i in items if alive(i)]
    if len(kept) != len(items):
        for item in items:
            if item not in kept:
                db.delete(item)
        db.commit()
    return kept


@api.get("/plan", response_model=list[schemas.PlanItemOut])
def list_plan(user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    return _plan_items(db, user)


@api.post("/plan", response_model=schemas.PlanItemOut, status_code=status.HTTP_201_CREATED)
def add_to_plan(
    body: schemas.PlanItemCreate, response: Response, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)
):
    """Put something at the end of the plan. Already on it: that item is answered (200) and nothing changes."""
    refs = {"project": body.project_id, "todo": body.todo_id, "habit": body.habit_id, "chore": body.label or None}
    ref = refs[body.kind]
    if not ref:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Say what to add")
    if body.kind == "project":
        project = _get_project(db, user, ref)
        if project.archived_at is not None or _get_status(db, user, project.status_id).is_done:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That project is finished")
    elif body.kind == "todo":
        todo = _get_todo(db, user, ref)
        if todo.done or todo.cancelled_at is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That is already finished")
    elif body.kind == "habit":
        habit = _get_habit(db, user, ref)
        if habit.archived or habit.removed_at is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That habit isn't active")
    column = {"project": PlanItem.project_id, "todo": PlanItem.todo_id, "habit": PlanItem.habit_id, "chore": PlanItem.label}[body.kind]
    existing = db.scalar(select(PlanItem).where(PlanItem.user_id == user.id, PlanItem.kind == body.kind, column == ref))
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        # An AI's reason for something already on the plan is kept; nothing else changes
        if body.why and existing.why != body.why:
            existing.why = body.why
            db.commit()
            db.refresh(existing)
        return existing
    position = (db.scalar(select(func.max(PlanItem.position)).where(PlanItem.user_id == user.id)) or 0) + 1
    item = PlanItem(user_id=user.id, kind=body.kind, position=position, why=body.why)
    if body.kind == "chore":
        item.label = ref
    else:
        setattr(item, f"{body.kind}_id", ref)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@api.put("/plan/order", response_model=list[schemas.PlanItemOut])
def order_plan(body: schemas.PlanOrderBody, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    """Set the order of the plan: the ids given come first, in that order; any the list left out follow, as they were."""
    items = _plan_items(db, user)
    by_id = {i.id: i for i in items}
    first = [by_id[i] for i in dict.fromkeys(body.ids) if i in by_id]
    rest = [i for i in items if i not in first]
    for position, item in enumerate(first + rest, start=1):
        item.position = position
    db.commit()
    return first + rest


@api.delete("/plan/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_from_plan(item_id: str, user: User = Depends(auth.current_user), db: DbSession = Depends(get_db)):
    db.delete(_get_owned(db, PlanItem, item_id, user, "Plan item"))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

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


@api.get("/interest/messages", response_model=schemas.InterestInboxOut, dependencies=[Depends(auth.require_admin)])
def list_interest_messages(db: DbSession = Depends(get_db)):
    """Admin only: the vote count and everything visitors have written, newest first."""
    rows = db.scalars(select(InterestMessage).order_by(InterestMessage.created_at.desc())).all()
    return {"count": _interest_count(db), "messages": rows}


@api.delete(
    "/interest/messages/{visitor_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(auth.require_admin)]
)
def delete_interest_message(visitor_id: str, db: DbSession = Depends(get_db)):
    """Admin only: erase one visitor's note and email. Their vote still counts."""
    row = db.get(InterestMessage, visitor_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

#endregion

app.include_router(public)
app.include_router(auth.router)
app.include_router(auth.admin_router)
app.include_router(api)
