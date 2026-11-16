"""Lightweight backoffice authentication for the single-installation POC.

This is deliberately independent from Supabase Auth. Passwords are stored as
PBKDF2 hashes and sessions are opaque, revocable tokens stored only as hashes.
The production installation must provide the master credentials privately.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from .config import Settings, get_settings
from .db import POC_TENANT_ID, db_session

SESSION_HEADER = "X-Backoffice-Session"
SESSION_TTL = timedelta(hours=12)
PBKDF2_ITERATIONS = 310_000


class BackofficeLogin(BaseModel):
    email: str = Field(min_length=3, max_length=240)
    password: str = Field(min_length=8, max_length=200)

    def normalized_email(self) -> str:
        return self.email.strip().lower()


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _session_user(token: str | None, settings: Settings) -> dict[str, Any] | None:
    if not token:
        return None
    with db_session(settings) as conn:
        row = conn.execute(
            """
            select u.id, u.tenant_id, u.email, u.role, t.name as tenant_name
            from public.horekia_backoffice_sessions s
            join public.horekia_backoffice_users u on u.id = s.user_id
            join public.horekia_tenants t on t.id = u.tenant_id
            where s.token_hash = %s
              and s.revoked_at is null
              and s.expires_at > now()
              and u.status = 'active'
            """,
            (_token_hash(token),),
        ).fetchone()
    return dict(row) if row else None


def require_backoffice_session(
    token: str | None = Header(default=None, alias=SESSION_HEADER),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:  # noqa: B008
    user = _session_user(token, settings)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión de backoffice no válida o caducada",
            headers={"WWW-Authenticate": "Session"},
        )
    return user


router = APIRouter(prefix="/api/v1/backoffice/auth", tags=["backoffice-auth"])


@router.post("/login")
def login(payload: BackofficeLogin, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    email = payload.normalized_email()
    with db_session(settings) as conn:
        user = conn.execute(
            """
            select id, tenant_id, email, role, password_hash
            from public.horekia_backoffice_users
            where tenant_id = %s and lower(email) = %s and status = 'active'
            """,
            (POC_TENANT_ID, email),
        ).fetchone()
        if not user or not _verify_password(payload.password, user["password_hash"]):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email o contraseña incorrectos")
        token = secrets.token_urlsafe(48)
        conn.execute(
            """
            insert into public.horekia_backoffice_sessions (token_hash, user_id, tenant_id, expires_at)
            values (%s, %s, %s, %s)
            """,
            (_token_hash(token), user["id"], user["tenant_id"], datetime.now(timezone.utc) + SESSION_TTL),
        )
        conn.execute(
            "update public.horekia_backoffice_users set last_login_at = now() where id = %s",
            (user["id"],),
        )
    return {"session": token, "user": {"email": email, "role": user["role"]}}


@router.get("/me")
def me(user: dict[str, Any] = Depends(require_backoffice_session)) -> dict[str, Any]:  # noqa: B008
    return {"email": user["email"], "role": user["role"], "tenant_name": user["tenant_name"]}


@router.post("/logout")
def logout(
    token: str | None = Header(default=None, alias=SESSION_HEADER),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:  # noqa: B008
    if token:
        with db_session(settings) as conn:
            conn.execute(
                "update public.horekia_backoffice_sessions set revoked_at = now() where token_hash = %s",
                (_token_hash(token),),
            )
    return {"status": "signed_out"}


__all__ = ["BackofficeLogin", "SESSION_HEADER", "_hash_password", "_verify_password", "require_backoffice_session", "router"]
