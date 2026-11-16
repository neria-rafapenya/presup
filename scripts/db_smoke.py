#!/usr/bin/env python3
"""Validate and optionally apply Horekia migrations on an authorized POC database."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
SEED = ROOT / "supabase" / "seed.sql"
TENANT_ONE = "00000000-0000-0000-0000-000000000001"
TENANT_TWO = "00000000-0000-0000-0000-000000000002"
USER_ONE = "10000000-0000-0000-0000-000000000001"
USER_TWO = "10000000-0000-0000-0000-000000000002"


def database_url() -> str:
    """Read the last non-empty DATABASE_URL without printing it."""

    value = os.getenv("DATABASE_URL", "").strip()
    env_path = ROOT / ".env"
    if env_path.exists():
        for raw in env_path.read_text().splitlines():
            line = raw.strip()
            if line.startswith("DATABASE_URL") and "=" in line:
                candidate = line.split("=", 1)[1].strip()
                if candidate:
                    value = candidate
    if not value or "[YOUR-PASSWORD]" in value:
        raise SystemExit("DATABASE_URL está vacío o conserva el placeholder de contraseña")
    return value


def horekia_tables(conn: psycopg.Connection) -> list[str]:
    rows = conn.execute(
        """
        select tablename
        from pg_catalog.pg_tables
        where schemaname = 'public' and tablename like 'horekia_%'
        order by tablename
        """
    ).fetchall()
    return [row[0] for row in rows]


def apply_schema(conn: psycopg.Connection) -> None:
    existing = horekia_tables(conn)
    if existing:
        raise SystemExit(
            "La base ya contiene tablas horekia_*; no se aplica automáticamente: "
            + ", ".join(existing)
        )
    with conn.transaction():
        for migration in MIGRATIONS:
            conn.execute(migration.read_text())
        conn.execute(SEED.read_text())


def apply_upgrades(conn: psycopg.Connection) -> None:
    """Apply idempotent upgrades added after the original POC bootstrap.

    The first RLS migrations intentionally create policies without ``if not
    exists``. An existing installation must not replay them. New incremental
    migrations are kept idempotent and start at 0017.
    """

    upgrades = [migration for migration in MIGRATIONS if migration.name >= "0017_"]
    with conn.transaction():
        for migration in upgrades:
            conn.execute(migration.read_text())


def assert_rls(conn: psycopg.Connection) -> None:
    with conn.transaction():
        conn.execute(
            """
            insert into public.horekia_tenant_users (tenant_id, user_id, role)
            values (%s::uuid, %s::uuid, 'owner'), (%s::uuid, %s::uuid, 'owner')
            on conflict (tenant_id, user_id) do nothing
            """,
            (TENANT_ONE, USER_ONE, TENANT_TWO, USER_TWO),
        )
        conn.execute("set local role authenticated")
        conn.execute("select set_config('request.jwt.claim.role', 'authenticated', true)")

        conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (USER_ONE,))
        own = conn.execute(
            "select count(*) from public.horekia_job_types where tenant_id = %s::uuid",
            (TENANT_ONE,),
        ).fetchone()[0]
        foreign = conn.execute(
            "select count(*) from public.horekia_job_types where tenant_id = %s::uuid",
            (TENANT_TWO,),
        ).fetchone()[0]
        if own < 1 or foreign != 0:
            raise AssertionError(f"aislamiento de lectura inválido: own={own}, foreign={foreign}")

        try:
            with conn.transaction():
                conn.execute(
                    """
                    insert into public.horekia_job_types (tenant_id, slug, name)
                    values (%s::uuid, 'cross-tenant', 'No permitido')
                    """,
                    (TENANT_TWO,),
                )
        except psycopg.errors.InsufficientPrivilege:
            pass
        else:
            raise AssertionError("RLS permitió una escritura cruzada")

        conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (USER_TWO,))
        own_two = conn.execute(
            "select count(*) from public.horekia_job_types where tenant_id = %s::uuid",
            (TENANT_TWO,),
        ).fetchone()[0]
        foreign_two = conn.execute(
            "select count(*) from public.horekia_job_types where tenant_id = %s::uuid",
            (TENANT_ONE,),
        ).fetchone()[0]
        if own_two < 1 or foreign_two != 0:
            raise AssertionError(f"aislamiento de lectura inválido: own={own_two}, foreign={foreign_two}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="aplica migraciones y seed si no hay tablas horekia_*")
    parser.add_argument("--upgrade", action="store_true", help="aplica migraciones incrementales idempotentes")
    args = parser.parse_args()

    with psycopg.connect(database_url(), connect_timeout=15, sslmode="require") as conn:
        print("Conexión PostgreSQL: ok")
        print(f"Tablas horekia_* antes: {len(horekia_tables(conn))}")
        if args.apply:
            apply_schema(conn)
            print("Migraciones y seed Horekia: aplicados")
        if args.upgrade:
            apply_upgrades(conn)
            print("Migraciones incrementales Horekia: aplicadas")
        assert_rls(conn)
        print("RLS: lecturas propias, lecturas cruzadas denegadas y escritura cruzada denegada")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
