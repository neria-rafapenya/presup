"""Backoffice POC routes backed by the Horekia PostgreSQL namespace."""

import io
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
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


class ProfilePatch(BaseModel):
    legal_name: str | None = Field(default=None, max_length=240)
    display_name: str | None = Field(default=None, max_length=240)
    tax_id: str | None = Field(default=None, max_length=80)
    contact_name: str | None = Field(default=None, max_length=160)
    contact_role: str | None = Field(default=None, max_length=160)
    contact_email: str | None = Field(default=None, max_length=240)
    contact_phone: str | None = Field(default=None, max_length=80)
    billing_email: str | None = Field(default=None, max_length=240)
    quotes_email: str | None = Field(default=None, max_length=240)
    address_line1: str | None = Field(default=None, max_length=240)
    address_line2: str | None = Field(default=None, max_length=240)
    postal_code: str | None = Field(default=None, max_length=30)
    city: str | None = Field(default=None, max_length=120)
    region: str | None = Field(default=None, max_length=120)
    country: str = Field(default="España", max_length=120)
    quote_document_type: str = Field(default="quote", pattern=r"^(quote|proforma)$")
    disclaimers: str | None = Field(default=None, max_length=10000)
    warranty_terms: str | None = Field(default=None, max_length=10000)


class JobTypeCreate(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)


class BlueprintField(BaseModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    label: str = Field(min_length=1, max_length=160)
    type: str = Field(pattern=r"^(text|number|boolean|choice|date|file)$")
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=100)
    unit: str | None = Field(default=None, max_length=40)
    min: Decimal | None = None
    max: Decimal | None = None
    help_text: str | None = Field(default=None, max_length=500)
    example: str | None = Field(default=None, max_length=500)


class BlueprintItem(BaseModel):
    sku: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=2000)
    unit: str = Field(default="unit", max_length=40)
    base_price: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    metadata: dict[str, Any] = Field(default_factory=dict)


class BlueprintRule(BaseModel):
    code: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    kind: str = Field(pattern=r"^(unit_price|factor|surcharge|minimum|formula)$")
    priority: int = Field(default=100, ge=0)
    definition: dict[str, Any] = Field(default_factory=dict)


class BlueprintMeasure(BaseModel):
    code: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    expression: dict[str, Any] = Field(default_factory=dict)


class ServiceBlueprint(BaseModel):
    fields: list[BlueprintField] = Field(default_factory=list, max_length=100)
    items: list[BlueprintItem] = Field(default_factory=list, max_length=500)
    rules: list[BlueprintRule] = Field(default_factory=list, max_length=200)
    measures: list[BlueprintMeasure] = Field(default_factory=list, max_length=100)


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


@router.get("/profile")
def profile(settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            conn.execute(
                """
                insert into public.horekia_tenant_profiles (tenant_id, legal_name, display_name)
                select id, name, name from public.horekia_tenants where id = %s
                on conflict (tenant_id) do nothing
                """,
                (POC_TENANT_ID,),
            )
            row = conn.execute(
                """
                select legal_name, display_name, tax_id, contact_name, contact_role,
                       contact_email, contact_phone, billing_email, quotes_email,
                       address_line1, address_line2, postal_code, city, region, country,
                       quote_document_type, quote_template_document_id is not null as quote_template_available,
                       coalesce((select filename from public.horekia_tenant_documents d
                                 where d.tenant_id = p.tenant_id and d.id = p.quote_template_document_id), '')
                         as quote_template_filename,
                       disclaimers, warranty_terms, metadata
                from public.horekia_tenant_profiles p where tenant_id = %s
                """,
                (POC_TENANT_ID,),
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Ficha de empresa no encontrada")
            return row
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc


@router.patch("/profile")
def update_profile(payload: ProfilePatch, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            row = conn.execute(
                """
                update public.horekia_tenant_profiles
                set legal_name = %s, display_name = %s, tax_id = %s,
                    contact_name = %s, contact_role = %s, contact_email = %s,
                    contact_phone = %s, billing_email = %s, quotes_email = %s,
                    address_line1 = %s, address_line2 = %s, postal_code = %s,
                    city = %s, region = %s, country = %s,
                    quote_document_type = %s, disclaimers = %s, warranty_terms = %s,
                    updated_at = now()
                where tenant_id = %s
                returning legal_name, display_name, tax_id, contact_name, contact_role,
                          contact_email, contact_phone, billing_email, quotes_email,
                          address_line1, address_line2, postal_code, city, region, country,
                          quote_document_type, quote_template_document_id is not null as quote_template_available,
                          disclaimers, warranty_terms, metadata
                """,
                (
                    payload.legal_name, payload.display_name, payload.tax_id,
                    payload.contact_name, payload.contact_role, payload.contact_email,
                    payload.contact_phone, payload.billing_email, payload.quotes_email,
                    payload.address_line1, payload.address_line2, payload.postal_code,
                    payload.city, payload.region, payload.country,
                    payload.quote_document_type, payload.disclaimers, payload.warranty_terms,
                    POC_TENANT_ID,
                ),
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Ficha de empresa no encontrada")
            return row
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc


@router.post("/profile/quote-template", status_code=status.HTTP_201_CREATED)
def upload_quote_template(file: UploadFile = File(...), settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    filename = file.filename or "plantilla.pdf"
    if file.content_type != "application/pdf" and not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="La plantilla debe ser un PDF")
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="La plantilla PDF está vacía")
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="La plantilla PDF no puede superar 10 MB")
    try:
        with db_session(settings) as conn:
            document_type = conn.execute(
                "select quote_document_type from public.horekia_tenant_profiles where tenant_id = %s",
                (POC_TENANT_ID,),
            ).fetchone()["quote_document_type"]
            kind = "proforma_template" if document_type == "proforma" else "quote_template"
            row = conn.execute(
                """
                insert into public.horekia_tenant_documents
                  (tenant_id, kind, filename, mime_type, size_bytes, content)
                values (%s, %s, %s, 'application/pdf', %s, %s)
                returning id, filename, size_bytes
                """,
                (POC_TENANT_ID, kind, filename, len(content), content),
            ).fetchone()
            conn.execute(
                """
                update public.horekia_tenant_profiles
                set quote_template_document_id = %s, updated_at = now()
                where tenant_id = %s
                """,
                (row["id"], POC_TENANT_ID),
            )
            return {"id": row["id"], "filename": row["filename"], "size_bytes": row["size_bytes"]}
    except Exception as exc:
        raise database_error(exc) from exc


@router.get("/profile/quote-template")
def download_quote_template(settings: Settings = Depends(get_settings)) -> StreamingResponse:  # noqa: B008
    try:
        with db_session(settings) as conn:
            row = conn.execute(
                """
                select d.filename, d.mime_type, d.content
                from public.horekia_tenant_profiles p
                join public.horekia_tenant_documents d
                  on d.tenant_id = p.tenant_id and d.id = p.quote_template_document_id
                where p.tenant_id = %s
                """,
                (POC_TENANT_ID,),
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="No hay plantilla PDF cargada")
            return StreamingResponse(
                io.BytesIO(row["content"]),
                media_type=row["mime_type"],
                headers={"Content-Disposition": f'attachment; filename="{row["filename"]}"'},
            )
    except HTTPException:
        raise
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


@router.delete("/job-types/{job_type_id}")
def delete_job_type(job_type_id: UUID, settings: Settings = Depends(get_settings)) -> dict[str, str]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            service = conn.execute(
                "select id from public.horekia_job_types where tenant_id = %s and id = %s",
                (POC_TENANT_ID, job_type_id),
            ).fetchone()
            if service is None:
                raise HTTPException(status_code=404, detail="Servicio no encontrado")

            conn.execute("delete from public.horekia_intake_schemas where tenant_id = %s and job_type_id = %s", (POC_TENANT_ID, job_type_id))
            conn.execute("delete from public.horekia_price_rules where tenant_id = %s and job_type_id = %s", (POC_TENANT_ID, job_type_id))
            conn.execute("delete from public.horekia_computed_measures where tenant_id = %s and job_type_id = %s", (POC_TENANT_ID, job_type_id))
            conn.execute("delete from public.horekia_items where tenant_id = %s and job_type_id = %s", (POC_TENANT_ID, job_type_id))
            conn.execute("delete from public.horekia_job_types where tenant_id = %s and id = %s", (POC_TENANT_ID, job_type_id))
            return {"id": str(job_type_id)}
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc


@router.get("/job-types/{job_type_id}/blueprint")
def get_service_blueprint(job_type_id: UUID, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            service = conn.execute(
                "select id, slug, name, description from public.horekia_job_types where tenant_id = %s and id = %s",
                (POC_TENANT_ID, job_type_id),
            ).fetchone()
            if service is None:
                raise HTTPException(status_code=404, detail="Servicio no encontrado")
            schema = conn.execute(
                """
                select version, fields from public.horekia_intake_schemas
                where tenant_id = %s and job_type_id = %s and status = 'active'
                order by version desc limit 1
                """,
                (POC_TENANT_ID, job_type_id),
            ).fetchone()
            items = conn.execute(
                """
                select sku, name, description, unit, base_price, currency, metadata
                from public.horekia_items
                where tenant_id = %s and job_type_id = %s and status = 'active'
                order by name
                """,
                (POC_TENANT_ID, job_type_id),
            ).fetchall()
            rules = conn.execute(
                """
                select code, kind, priority, definition
                from public.horekia_price_rules
                where tenant_id = %s and job_type_id = %s and status = 'active'
                order by priority, code
                """,
                (POC_TENANT_ID, job_type_id),
            ).fetchall()
            measures = conn.execute(
                """
                select code, expression
                from public.horekia_computed_measures
                where tenant_id = %s and job_type_id = %s
                order by code
                """,
                (POC_TENANT_ID, job_type_id),
            ).fetchall()
            return {
                "service": service,
                "version": schema["version"] if schema else 0,
                "fields": schema["fields"] if schema else [],
                "items": items,
                "rules": rules,
                "measures": measures,
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc


@router.put("/job-types/{job_type_id}/blueprint")
def save_service_blueprint(job_type_id: UUID, payload: ServiceBlueprint, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            service = conn.execute(
                "select id from public.horekia_job_types where tenant_id = %s and id = %s",
                (POC_TENANT_ID, job_type_id),
            ).fetchone()
            if service is None:
                raise HTTPException(status_code=404, detail="Servicio no encontrado")

            active_schema = conn.execute(
                """
                select id, version from public.horekia_intake_schemas
                where tenant_id = %s and job_type_id = %s and status = 'active'
                order by version desc limit 1
                """,
                (POC_TENANT_ID, job_type_id),
            ).fetchone()
            next_version = (active_schema["version"] + 1) if active_schema else 1
            if active_schema:
                conn.execute(
                    "update public.horekia_intake_schemas set status = 'archived' where tenant_id = %s and id = %s",
                    (POC_TENANT_ID, active_schema["id"]),
                )
            conn.execute(
                """
                insert into public.horekia_intake_schemas (tenant_id, job_type_id, version, fields)
                values (%s, %s, %s, %s)
                """,
                (POC_TENANT_ID, job_type_id, next_version, Jsonb([field.model_dump(mode="json", exclude_none=True) for field in payload.fields])),
            )

            for item in payload.items:
                metadata = dict(item.metadata)
                metadata["service_blueprint"] = True
                conn.execute(
                    """
                    insert into public.horekia_items
                      (tenant_id, job_type_id, sku, name, description, unit, base_price, currency, metadata)
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    on conflict (tenant_id, sku) do update set
                      job_type_id = excluded.job_type_id, name = excluded.name,
                      description = excluded.description, unit = excluded.unit,
                      base_price = excluded.base_price, currency = excluded.currency,
                      metadata = excluded.metadata, updated_at = now()
                    """,
                    (POC_TENANT_ID, job_type_id, item.sku, item.name, item.description, item.unit, item.base_price, item.currency.upper(), Jsonb(metadata)),
                )

            for rule in payload.rules:
                conn.execute(
                    """
                    insert into public.horekia_price_rules
                      (tenant_id, job_type_id, code, kind, priority, definition, version)
                    values (%s, %s, %s, %s, %s, %s, 1)
                    on conflict (tenant_id, code, version) do update set
                      job_type_id = excluded.job_type_id, kind = excluded.kind,
                      priority = excluded.priority, definition = excluded.definition,
                      status = 'active'
                    """,
                    (POC_TENANT_ID, job_type_id, rule.code, rule.kind, rule.priority, Jsonb(rule.definition)),
                )

            for measure in payload.measures:
                conn.execute(
                    """
                    insert into public.horekia_computed_measures
                      (tenant_id, job_type_id, code, expression, version)
                    values (%s, %s, %s, %s, 1)
                    on conflict (tenant_id, code, version) do update set
                      job_type_id = excluded.job_type_id, expression = excluded.expression
                    """,
                    (POC_TENANT_ID, job_type_id, measure.code, Jsonb(measure.expression)),
                )
            conn.execute(
                """
                update public.horekia_tenant_settings
                set configuration_version = configuration_version + 1, updated_at = now()
                where tenant_id = %s
                """,
                (POC_TENANT_ID,),
            )
            return {"job_type_id": job_type_id, "version": next_version, "fields": len(payload.fields), "items": len(payload.items), "rules": len(payload.rules), "measures": len(payload.measures)}
    except HTTPException:
        raise
    except Exception as exc:
        if "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Hay códigos repetidos en el patrón del servicio") from exc
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
