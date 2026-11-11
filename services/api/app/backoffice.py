"""Backoffice POC routes backed by the Horekia PostgreSQL namespace."""

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .config import Settings, get_settings
from .db import POC_TENANT_ID, db_session

router = APIRouter(prefix="/api/v1/backoffice", tags=["backoffice"])


class SettingsPatch(BaseModel):
    currency: str = Field(min_length=3, max_length=3)
    tax_rate: Decimal = Field(ge=0, le=100)
    quote_validity_days: int = Field(gt=0, le=3650)
    review_required: bool
    public_chat_enabled: bool


class JobTypeCreate(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)


class KnowledgeRow(BaseModel):
    kind: str = Field(default="product", pattern=r"^(product|category|sales_pattern|policy|faq|document|other)$")
    title: str = Field(min_length=1, max_length=240)
    content: str = Field(default="", max_length=10000)
    code: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, max_length=160)
    unit: str = Field(default="unit", max_length=40)
    base_price: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    metadata: dict[str, Any] = Field(default_factory=dict)


class KnowledgeImport(BaseModel):
    source_name: str = Field(min_length=1, max_length=240)
    rows: list[KnowledgeRow] = Field(min_length=1, max_length=1000)


def database_error(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Base de datos no disponible para el backoffice",
    )


@router.get("/summary")
def summary(settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            tenant = conn.execute(
                "select id, name, slug, default_locale from public.horekia_tenants where id = %s",
                (POC_TENANT_ID,),
            ).fetchone()
            tenant_settings = conn.execute(
                """
                select currency, tax_rate, quote_validity_days, review_required,
                       public_chat_enabled, configuration_version
                from public.horekia_tenant_settings where tenant_id = %s
                """,
                (POC_TENANT_ID,),
            ).fetchone()
            counts = {
                "job_types": conn.execute(
                    "select count(*) from public.horekia_job_types where tenant_id = %s",
                    (POC_TENANT_ID,),
                ).fetchone()["count"],
                "items": conn.execute(
                    "select count(*) from public.horekia_items where tenant_id = %s",
                    (POC_TENANT_ID,),
                ).fetchone()["count"],
                "requests": conn.execute(
                    "select count(*) from public.horekia_requests where tenant_id = %s",
                    (POC_TENANT_ID,),
                ).fetchone()["count"],
                "quotes": conn.execute(
                    "select count(*) from public.horekia_quotes where tenant_id = %s",
                    (POC_TENANT_ID,),
                ).fetchone()["count"],
            }
            return {"tenant": tenant, "settings": tenant_settings, "counts": counts}
    except Exception as exc:
        raise database_error(exc) from exc


@router.patch("/settings")
def update_settings(payload: SettingsPatch, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            row = conn.execute(
                """
                update public.horekia_tenant_settings
                set currency = %s, tax_rate = %s, quote_validity_days = %s,
                    review_required = %s, public_chat_enabled = %s,
                    configuration_version = configuration_version + 1,
                    updated_at = now()
                where tenant_id = %s
                returning currency, tax_rate, quote_validity_days, review_required,
                          public_chat_enabled, configuration_version
                """,
                (
                    payload.currency.upper(),
                    payload.tax_rate,
                    payload.quote_validity_days,
                    payload.review_required,
                    payload.public_chat_enabled,
                    POC_TENANT_ID,
                ),
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Configuración de empresa no encontrada")
            return row
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc


@router.get("/job-types")
def list_job_types(settings: Settings = Depends(get_settings)) -> list[dict[str, Any]]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            return conn.execute(
                """
                select id, slug, name, description, status, created_at, updated_at
                from public.horekia_job_types where tenant_id = %s order by name
                """,
                (POC_TENANT_ID,),
            ).fetchall()
    except Exception as exc:
        raise database_error(exc) from exc


@router.post("/job-types", status_code=status.HTTP_201_CREATED)
def create_job_type(payload: JobTypeCreate, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            row = conn.execute(
                """
                insert into public.horekia_job_types (tenant_id, slug, name, description)
                values (%s, %s, %s, %s)
                returning id, slug, name, description, status, created_at, updated_at
                """,
                (POC_TENANT_ID, payload.slug, payload.name, payload.description),
            ).fetchone()
            return row
    except Exception as exc:
        if "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Ya existe un servicio con ese slug") from exc
        raise database_error(exc) from exc


@router.get("/knowledge/summary")
def knowledge_summary(settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            rows = conn.execute(
                """
                select kind, count(*)::int as count
                from public.horekia_knowledge_entries
                where tenant_id = %s and status = 'active'
                group by kind order by kind
                """,
                (POC_TENANT_ID,),
            ).fetchall()
            return {"total": sum(row["count"] for row in rows), "by_kind": rows}
    except Exception as exc:
        raise database_error(exc) from exc


@router.get("/knowledge/entries")
def knowledge_entries(settings: Settings = Depends(get_settings)) -> list[dict[str, Any]]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            return conn.execute(
                """
                select id, kind, title, content, metadata, source_type, source_name, created_at
                from public.horekia_knowledge_entries
                where tenant_id = %s and status = 'active'
                order by created_at desc limit 100
                """,
                (POC_TENANT_ID,),
            ).fetchall()
    except Exception as exc:
        raise database_error(exc) from exc


@router.post("/knowledge/import", status_code=status.HTTP_201_CREATED)
def import_knowledge(payload: KnowledgeImport, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    """Import fictitious tenant knowledge from rows parsed from a CSV in the client."""

    try:
        with db_session(settings) as conn:
            import_row = conn.execute(
                """
                insert into public.horekia_imports (tenant_id, source_name, source_type, status, report, created_by)
                values (%s, %s, 'csv', 'confirmed', %s, %s)
                returning id
                """,
                (POC_TENANT_ID, payload.source_name, Jsonb({"received_rows": len(payload.rows)}), None),
            ).fetchone()
            import_id = import_row["id"]
            created_entries = 0
            created_items = 0
            for row in payload.rows:
                metadata = dict(row.metadata)
                if row.category:
                    metadata["category"] = row.category
                if row.code:
                    metadata["code"] = row.code
                content = row.content or row.title
                entry = conn.execute(
                    """
                    insert into public.horekia_knowledge_entries
                      (tenant_id, kind, title, content, metadata, source_type, source_name, source_import_id)
                    values (%s, %s, %s, %s, %s, 'csv', %s, %s)
                    returning id
                    """,
                    (POC_TENANT_ID, row.kind, row.title, content, Jsonb(metadata), payload.source_name, import_id),
                ).fetchone()
                created_entries += 1
                if row.kind == "product":
                    conn.execute(
                        """
                        insert into public.horekia_items
                          (tenant_id, sku, name, description, unit, base_price, currency, metadata)
                        values (%s, %s, %s, %s, %s, %s, %s, %s)
                        on conflict (tenant_id, sku) do update set
                          name = excluded.name, description = excluded.description,
                          unit = excluded.unit, base_price = excluded.base_price,
                          currency = excluded.currency, metadata = excluded.metadata,
                          updated_at = now()
                        """,
                        (
                            POC_TENANT_ID,
                            row.code,
                            row.title,
                            row.content or None,
                            row.unit,
                            row.base_price,
                            row.currency.upper(),
                            Jsonb({**metadata, "knowledge_entry_id": str(entry["id"])}),
                        ),
                    )
                    created_items += 1
            conn.execute(
                """
                update public.horekia_imports
                set report = %s
                where tenant_id = %s and id = %s
                """,
                (Jsonb({"received_rows": len(payload.rows), "created_entries": created_entries, "created_items": created_items}), POC_TENANT_ID, import_id),
            )
            return {"import_id": import_id, "created_entries": created_entries, "created_items": created_items}
    except Exception as exc:
        if "horekia_knowledge_entries" in str(exc):
            raise HTTPException(status_code=503, detail="Falta aplicar la migración de conocimiento") from exc
        raise database_error(exc) from exc
