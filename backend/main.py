"""
ProjectsTracker — FastAPI backend
=================================
Run:  uvicorn backend.main:app --reload --port 8001
Every route lives under /api so the Vite dev proxy and a future Vercel deploy
can share the same paths.
"""

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from . import models, schemas
from .database import engine, get_db
from .models import Project, Session, utcnow

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="ProjectsTracker", version="1.0.0")
api = APIRouter(prefix="/api")

# Manual entries may not end in the future; a little slack absorbs clock skew
# between the browser and the server.
FUTURE_TOLERANCE = timedelta(minutes=1)


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

@api.get("/health")
def health():
    return {"ok": True}


@api.get("/projects", response_model=list[schemas.ProjectOut])
def list_projects(db: DbSession = Depends(get_db)):
    projects = db.scalars(select(Project).order_by(Project.sort_order, Project.created_at)).all()
    totals = _totals(db)
    return [_project_out(p, totals.get(p.id, 0)) for p in projects]


@api.post("/projects", response_model=schemas.ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(body: schemas.ProjectCreate, db: DbSession = Depends(get_db)):
    next_order = (db.scalar(select(func.max(Project.sort_order))) or 0) + 1
    project = Project(**body.model_dump(), sort_order=next_order)
    db.add(project)
    db.commit()
    db.refresh(project)
    return _project_out(project)


@api.patch("/projects/{project_id}", response_model=schemas.ProjectOut)
def update_project(project_id: str, body: schemas.ProjectUpdate, db: DbSession = Depends(get_db)):
    project = _get_project(db, project_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
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
        current.end = now
    session = Session(project_id=body.project_id, start=now, end=None)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@api.post("/timer/stop", response_model=Optional[schemas.SessionOut])
def stop_timer(db: DbSession = Depends(get_db)):
    current = _running(db)
    if current is None:
        return None
    current.end = utcnow()
    db.commit()
    db.refresh(current)
    return current

#endregion

app.include_router(api)
