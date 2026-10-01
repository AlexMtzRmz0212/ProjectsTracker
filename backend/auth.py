"""
Owner-only access
=================
The public site is a demo on sample data; the real tracker is for one person.
That person logs in with OWNER_PASSWORD and gets a signed, HttpOnly session
cookie. Every data route depends on `require_owner`.

- OWNER_PASSWORD unset, running locally: auth is off, so `uvicorn` + the Vite
  dev server work exactly as before.
- OWNER_PASSWORD unset, running on Vercel: every protected route answers 503.
  A forgotten variable must never leave the data open.
- The signing key is derived from the password, so changing the password
  signs every existing session out.
"""

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

COOKIE = "pt_session"
SESSION_SECONDS = 60 * 60 * 24 * 30
FAILED_LOGIN_DELAY = 0.4  # seconds; slows down password guessing a little

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _password() -> str:
    return os.getenv("OWNER_PASSWORD", "")


def _on_vercel() -> bool:
    return bool(os.getenv("VERCEL"))


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: str) -> str:
    key = hashlib.sha256(f"projectstracker-session:{_password()}".encode()).digest()
    return _b64(hmac.new(key, payload.encode(), hashlib.sha256).digest())


def _make_token() -> str:
    payload = _b64(json.dumps({"exp": int(time.time()) + SESSION_SECONDS}).encode())
    return f"{payload}.{_sign(payload)}"


def _valid_token(token: Optional[str]) -> bool:
    if not token or not _password():
        return False
    payload, _, signature = token.partition(".")
    if not hmac.compare_digest(signature, _sign(payload)):
        return False
    try:
        return json.loads(_unb64(payload))["exp"] > time.time()
    except (ValueError, KeyError, TypeError):
        return False


def require_owner(request: Request) -> None:
    """Dependency for every route that touches the owner's data."""
    if not _password():
        if _on_vercel():
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Owner login is not configured")
        return  # local development: open
    if not _valid_token(request.cookies.get(COOKIE)):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required")


class LoginBody(BaseModel):
    password: Annotated[str, Field(max_length=200)]


@router.get("/me")
def me(request: Request):
    """Cheap session check. `required` is false only in password-less local dev."""
    required = bool(_password()) or _on_vercel()
    return {"authenticated": (not required) or _valid_token(request.cookies.get(COOKIE)), "required": required}


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
def login(body: LoginBody):
    if not _password():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Owner login is not configured")
    if not hmac.compare_digest(body.password.encode(), _password().encode()):
        time.sleep(FAILED_LOGIN_DELAY)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong password")
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.set_cookie(
        COOKIE,
        _make_token(),
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=_on_vercel(),
        samesite="strict",
        path="/",
    )
    return response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout():
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(COOKIE, path="/")
    return response
