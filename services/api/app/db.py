"""Small database boundary for the single-company POC."""

from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID

import psycopg
from psycopg.rows import dict_row

from .config import Settings

POC_TENANT_ID = UUID("00000000-0000-0000-0000-000000000001")
POC_USER_ID = UUID("10000000-0000-0000-0000-000000000001")


@contextmanager
def db_session(settings: Settings) -> Iterator[psycopg.Connection]:
    """Open a transaction under the POC application identity.

    There is no Supabase Auth in this POC. The database sees the same JWT
    subject that the RLS smoke test uses; Fase 3 will replace this fixed
    identity with the authenticated backend subject.
    """

    if not settings.database_url:
        raise RuntimeError("DATABASE_URL no está configurado")
    with (
        psycopg.connect(settings.database_url, connect_timeout=15, sslmode="require", row_factory=dict_row, prepare_threshold=None) as conn,
        conn.transaction(),
    ):
        conn.execute("set local role authenticated")
        conn.execute("select set_config('request.jwt.claim.role', 'authenticated', true)")
        conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(POC_USER_ID),))
        yield conn
