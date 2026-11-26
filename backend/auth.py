"""
Accounts and sessions
=====================
Each person has an account (email + password) and gets a signed, HttpOnly session cookie. Every data route depends
on `current_user`, which says whose data a request may touch.

- Signup is by invite only: the admin makes a one-time code, the new person registers with it.
- The token holds the user's id and their `token_version`, so changing a password (which bumps the version)
  signs that account out everywhere.
- The signing key is SESSION_SECRET. Unset on Vercel, every protected route answers 503: a forgotten variable
  must never leave the data open. Locally a fixed development key is used so `uvicorn` just works.
- The first admin is made from ADMIN_EMAIL + OWNER_PASSWORD when the database has no accounts (bootstrap.py).
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from . import schemas
from .bootstrap import seed_user_statuses
from .database import get_db
from .models import Invite, User, utcnow
from .passwords import burn_verification, hash_password, verify_password

COOKIE = "pt_session"
SESSION_SECONDS = 60 * 60 * 24 * 30
FAILED_LOGIN_DELAY = 0.4  # seconds; slows down password guessing a little
DEV_SECRET = "projectstracker-development-only-secret"

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _on_vercel() -> bool:
    return bool(os.getenv("VERCEL"))


def _secret() -> str:
    """The signing key; empty means sign-in is not configured (only ever on Vercel)."""
    return os.getenv("SESSION_SECRET", "") or ("" if _on_vercel() else DEV_SECRET)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: str) -> str:
    key = hashlib.sha256(f"projectstracker-session:{_secret()}".encode()).digest()
    return _b64(hmac.new(key, payload.encode(), hashlib.sha256).digest())


def _make_token(user: User) -> str:
    claims = {"sub": user.id, "ver": user.token_version, "exp": int(time.time()) + SESSION_SECONDS}
    payload = _b64(json.dumps(claims).encode())
    return f"{payload}.{_sign(payload)}"


def _read_token(token: Optional[str]) -> Optional[dict]:
    """The claims in a token that is genuine and not expired; None otherwise."""
    if not token or not _secret():
        return None
    payload, _, signature = token.partition(".")
    if not hmac.compare_digest(signature.encode(), _sign(payload).encode()):
        return None
    try:
        claims = json.loads(_unb64(payload))
        if claims["exp"] > time.time() and isinstance(claims["sub"], str):
            return claims
    except (ValueError, KeyError, TypeError):
        pass
    return None


def _set_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        COOKIE,
        _make_token(user),
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=_on_vercel(),
        samesite="strict",
        path="/",
    )


def _user_from_request(request: Request, db: DbSession) -> Optional[User]:
    claims = _read_token(request.cookies.get(COOKIE))
    if claims is None:
        return None
    user = db.get(User, claims["sub"])
    if user is None or user.token_version != claims.get("ver"):
        return None
    return user


def current_user(request: Request, db: DbSession = Depends(get_db)) -> User:
    """Dependency for every route that touches someone's data: who is asking."""
    if not _secret():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Sign-in is not configured (SESSION_SECRET)")
    user = _user_from_request(request, db)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.strip().encode()).hexdigest()


@router.get("/me", response_model=schemas.SessionInfo)
def me(request: Request, db: DbSession = Depends(get_db)):
    """Cheap session check: who is signed in, if anyone."""
    user = _user_from_request(request, db) if _secret() else None
    return {"authenticated": user is not None, "user": user}


@router.post("/login", response_model=schemas.UserOut)
def login(body: schemas.LoginBody, response: Response, db: DbSession = Depends(get_db)):
    if not _secret():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Sign-in is not configured (SESSION_SECRET)")
    user = db.scalar(select(User).where(User.email == body.email))
    if user is None:
        burn_verification()
    if user is None or not verify_password(body.password, user.password_hash):
        time.sleep(FAILED_LOGIN_DELAY)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    _set_cookie(response, user)
    return user


@router.post("/register", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def register(body: schemas.RegisterBody, response: Response, db: DbSession = Depends(get_db)):
    """Make an account with an invite code. The code is used up in the same transaction, so two people
    can't share one."""
    if not _secret():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Sign-in is not configured (SESSION_SECRET)")
    now = utcnow()
    invite = db.scalar(
        select(Invite).where(Invite.code_hash == _hash_code(body.code), Invite.used_at.is_(None), Invite.expires_at > now)
    )
    if invite is None:
        time.sleep(FAILED_LOGIN_DELAY)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That invite is invalid or has expired")
    user = User(email=body.email, password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "There is already an account with that email")
    claimed = db.execute(
        update(Invite).where(Invite.id == invite.id, Invite.used_at.is_(None)).values(used_at=now, used_by=user.id)
    )
    if claimed.rowcount != 1:  # someone else used it a moment ago
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That invite is invalid or has expired")
    seed_user_statuses(db, user.id)
    db.commit()
    db.refresh(user)
    _set_cookie(response, user)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout():
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(COOKIE, path="/")
    return response


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: schemas.PasswordBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Change your own password. Every other session of the account is signed out; this one stays in."""
    if not verify_password(body.current_password, user.password_hash):
        time.sleep(FAILED_LOGIN_DELAY)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your current password is wrong")
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _set_cookie(response, user)
    return response


# ── Invites (admin) ──────────────────────────────────────────────────────────

admin_router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@admin_router.get("/invites", response_model=list[schemas.InviteOut])
def list_invites(db: DbSession = Depends(get_db)):
    rows = db.execute(
        select(Invite, User.email).outerjoin(User, User.id == Invite.used_by).order_by(Invite.created_at.desc()).limit(100)
    ).all()
    return [
        schemas.InviteOut(
            id=invite.id,
            created_at=invite.created_at,
            expires_at=invite.expires_at,
            used_at=invite.used_at,
            used_by_email=email,
        )
        for invite, email in rows
    ]


@admin_router.post("/invites", response_model=schemas.InviteCreated, status_code=status.HTTP_201_CREATED)
def create_invite(body: schemas.InviteCreate, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    """Make a one-time code. It is returned here and never again."""
    code = secrets.token_urlsafe(16)
    invite = Invite(code_hash=_hash_code(code), created_by=admin.id, expires_at=utcnow() + timedelta(days=body.days))
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return {"id": invite.id, "code": code, "expires_at": invite.expires_at}


@admin_router.delete("/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invite(invite_id: str, db: DbSession = Depends(get_db)):
    invite = db.get(Invite, invite_id)
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")
    db.delete(invite)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
