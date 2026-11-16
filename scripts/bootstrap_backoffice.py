#!/usr/bin/env python3
"""Create or rotate the private master account for the Horekia backoffice."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from uuid import UUID

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.auth import _hash_password  # noqa: E402
POC_TENANT_ID = UUID("00000000-0000-0000-0000-000000000001")


def main() -> int:
    load_dotenv(ROOT / ".env")
    database_url = os.getenv("DATABASE_URL", "").strip()
    email = os.getenv("BACKOFFICE_MASTER_EMAIL", "").strip().lower()
    password = os.getenv("BACKOFFICE_MASTER_PASSWORD", "")
    if not database_url or "[YOUR-PASSWORD]" in database_url:
        raise SystemExit("DATABASE_URL está vacío o conserva el placeholder de contraseña")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise SystemExit("BACKOFFICE_MASTER_EMAIL no contiene un email válido")
    if len(password) < 12:
        raise SystemExit("BACKOFFICE_MASTER_PASSWORD debe tener al menos 12 caracteres")

    with psycopg.connect(database_url, connect_timeout=15, sslmode="require") as conn:
        with conn.transaction():
            conn.execute(
                """
                insert into public.horekia_backoffice_users (tenant_id, email, password_hash, role, status)
                values (%s, %s, %s, 'owner', 'active')
                on conflict (tenant_id, email) do update
                  set password_hash = excluded.password_hash,
                      role = 'owner',
                      status = 'active'
                """,
                (POC_TENANT_ID, email, _hash_password(password)),
            )
    print(f"Cuenta maestra lista para {email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
