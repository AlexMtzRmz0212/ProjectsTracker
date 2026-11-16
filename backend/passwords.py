"""
Password hashing with scrypt from the standard library (no extra dependency).

A stored hash looks like `scrypt$N$r$p$salt$digest` (salt and digest base64url), so the cost can be raised
later and old hashes still verify with the settings they were made with.
"""

import base64
import hashlib
import hmac
import secrets
from functools import lru_cache

_N, _R, _P = 2**14, 8, 1  # ~16 MB and a few dozen ms: fine for a serverless request
_MAXMEM = 64 * 1024 * 1024


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32, maxmem=_MAXMEM)
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = _unb64(digest)
        actual = hashlib.scrypt(
            password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected), maxmem=_MAXMEM
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    return hash_password("not-a-real-password")


def burn_verification() -> None:
    """Spend the same time as a real check, so an unknown email can't be told from a wrong password by timing."""
    verify_password("x", _dummy_hash())
