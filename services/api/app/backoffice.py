"""Backoffice POC routes backed by the Horekia PostgreSQL namespace."""

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
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
