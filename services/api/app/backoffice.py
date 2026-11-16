"""Backoffice POC routes backed by the Horekia PostgreSQL namespace."""

import io
import json
import logging
from pathlib import Path
import ssl
import urllib.error
import urllib.request
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
import certifi
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .config import Settings, get_settings
from .auth import require_backoffice_session
from .calculator import CalculationError, calculate_quote
from .db import POC_TENANT_ID, db_session
from .documentation import BACKOFFICE_HELP_CONTEXT
from .geo import COVERAGE_FIELD_KEY

router = APIRouter(prefix="/api/v1/backoffice", tags=["backoffice"], dependencies=[Depends(require_backoffice_session)])
logger = logging.getLogger(__name__)


class SettingsPatch(BaseModel):
    currency: str = Field(min_length=3, max_length=3)
    tax_rate: Decimal = Field(ge=0, le=100)
    quote_validity_days: int = Field(gt=0, le=3650)
    review_required: bool
    public_chat_enabled: bool


class ProfilePatch(BaseModel):
    legal_name: str | None = Field(default=None, max_length=240)
    display_name: str | None = Field(default=None, max_length=240)
    service_type_id: UUID | None = None
    service_radius_km: Decimal = Field(default=Decimal("100"), gt=0, le=1000)
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
    sector_pack_id: UUID | None = None


class JobTypePatch(BaseModel):
    sector_pack_id: UUID | None = None


class SectorPackCreate(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)


class BlueprintField(BaseModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    label: str = Field(min_length=1, max_length=160)
    type: str = Field(pattern=r"^(text|number|boolean|choice|color|date|file)$")
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=100)
    unit: str | None = Field(default=None, max_length=40)
    min: Decimal | None = None
    max: Decimal | None = None
    help_text: str | None = Field(default=None, max_length=500)
    example: str | None = Field(default=None, max_length=500)
    depends_on: dict[str, Any] | None = None
    visible_when: dict[str, Any] | None = None
    product_options: dict[str, list[str]] | None = None
    color_config: dict[str, Any] | None = None


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


class KnowledgeEntryPatch(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    content: str = Field(max_length=10000)


class ProductCreate(BaseModel):
    sku: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{1,119}$")
    name: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=2000)
    category_path: list[str] = Field(min_length=1, max_length=10)
    brand: str | None = Field(default=None, max_length=160)
    model: str | None = Field(default=None, max_length=160)
    material: str | None = Field(default=None, max_length=240)
    grammage_g: Decimal | None = Field(default=None, ge=0, le=100000)
    colors: list[str] = Field(default_factory=list, max_length=50)
    sizes: list[str] = Field(default_factory=list, max_length=50)
    image_url: str | None = Field(default=None, max_length=2000)
    unit: str = Field(default="unidad", max_length=40)
    base_price: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProductPatch(ProductCreate):
    pass


class DocumentationChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class DocumentationChatRequest(BaseModel):
    messages: list[DocumentationChatMessage] = Field(min_length=1, max_length=12)


class StatusPatch(BaseModel):
    status: str = Field(min_length=1, max_length=32)


def database_error(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Base de datos no disponible para el backoffice",
    )


def _documentation_chat_mock(messages: list[DocumentationChatMessage]) -> str:
    question = messages[-1].content.lower()
    if "csv" in question or "import" in question:
        return "Para datos generales usa Base de conocimiento → Importar conocimiento. Para preguntas, conceptos, reglas o medidas usa Importar patrón de servicio, con filas service, field, item, rule o measure."
    if "servicio" in question or "patrón" in question:
        return "Crea el servicio desde el Wizard, paso Oferta y servicios. Después pulsa Diseñar para configurar Preguntas, Catálogo, Reglas y Medidas."
    return "Consulta el menú Documentación. Esta ayuda responde sobre la configuración del backoffice."


def _ask_gemini_documentation(messages: list[DocumentationChatMessage], settings: Settings) -> str:
    if settings.ai_mock:
        return _documentation_chat_mock(messages)
    model = settings.gemini_model.removeprefix("models/")
    contents = [{"role": "user" if message.role == "user" else "model", "parts": [{"text": message.content}]} for message in messages]
    payload = {
        "systemInstruction": {"parts": [{"text": BACKOFFICE_HELP_CONTEXT}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 700},
    }
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": settings.gemini_api_key},
        method="POST",
    )
    try:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        with urllib.request.urlopen(request, timeout=45, context=ssl_context) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail="El servicio de ayuda de Gemini no está disponible") from exc
    parts = result.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    answer = "\n".join(part.get("text", "") for part in parts if part.get("text"))
    if not answer:
        raise HTTPException(status_code=502, detail="Gemini no devolvió una respuesta de ayuda")
    return answer.strip()


@router.get("/summary")
def summary(settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            tenant = conn.execute(
                """
                select t.id,
                       coalesce(nullif(trim(p.display_name), ''),
                                nullif(trim(p.legal_name), ''),
                                t.name) as name,
                       t.slug,
                       t.default_locale
                from public.horekia_tenants t
                left join public.horekia_tenant_profiles p on p.tenant_id = t.id
                where t.id = %s
                """,
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
                select legal_name, display_name, service_type_id, service_radius_km, tax_id, contact_name, contact_role,
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
                set legal_name = %s, display_name = %s, service_type_id = %s, service_radius_km = %s, tax_id = %s,
                    contact_name = %s, contact_role = %s, contact_email = %s,
                    contact_phone = %s, billing_email = %s, quotes_email = %s,
                    address_line1 = %s, address_line2 = %s, postal_code = %s,
                    city = %s, region = %s, country = %s,
                    quote_document_type = %s, disclaimers = %s, warranty_terms = %s,
                    updated_at = now()
                where tenant_id = %s
                returning legal_name, display_name, service_type_id, service_radius_km, tax_id, contact_name, contact_role,
                          contact_email, contact_phone, billing_email, quotes_email,
                          address_line1, address_line2, postal_code, city, region, country,
                          quote_document_type, quote_template_document_id is not null as quote_template_available,
                          disclaimers, warranty_terms, metadata
                """,
                (
                    payload.legal_name, payload.display_name, payload.service_type_id, payload.service_radius_km, payload.tax_id,
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
                select j.id, j.slug, j.name, j.description, j.image_url, j.status, j.created_at, j.updated_at,
                       st.id as sector_pack_id, st.slug as sector_pack_slug,
                       st.name as sector_pack_name, st.description as sector_pack_description
                from public.horekia_job_types j
                left join public.horekia_service_types st on st.tenant_id = j.tenant_id and st.id = j.service_type_id
                where j.tenant_id = %s
                order by coalesce(st.name, 'Sin clasificar'), j.name
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
                insert into public.horekia_job_types (tenant_id, slug, name, description, service_type_id)
                values (%s, %s, %s, %s, %s)
                returning id
                """,
                (POC_TENANT_ID, payload.slug, payload.name, payload.description, payload.sector_pack_id),
            ).fetchone()
            return conn.execute(
                """
                select j.id, j.slug, j.name, j.description, j.image_url, j.status, j.created_at, j.updated_at,
                       st.id as sector_pack_id, st.slug as sector_pack_slug,
                       st.name as sector_pack_name, st.description as sector_pack_description
                from public.horekia_job_types j
                left join public.horekia_service_types st on st.tenant_id = j.tenant_id and st.id = j.service_type_id
                where j.tenant_id = %s and j.id = %s
                """,
                (POC_TENANT_ID, row["id"]),
            ).fetchone()
    except Exception as exc:
        if "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Ya existe un servicio con ese slug") from exc
        raise database_error(exc) from exc


@router.patch("/job-types/{job_type_id}")
def update_job_type(job_type_id: UUID, payload: JobTypePatch, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            row = conn.execute(
                """
                update public.horekia_job_types
                set service_type_id = %s, updated_at = now()
                where tenant_id = %s and id = %s
                returning id
                """,
                (payload.sector_pack_id, POC_TENANT_ID, job_type_id),
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Servicio no encontrado")
            return conn.execute(
                """
                select j.id, j.slug, j.name, j.description, j.image_url, j.status, j.created_at, j.updated_at,
                       st.id as sector_pack_id, st.slug as sector_pack_slug,
                       st.name as sector_pack_name, st.description as sector_pack_description
                from public.horekia_job_types j
                left join public.horekia_service_types st on st.tenant_id = j.tenant_id and st.id = j.service_type_id
                where j.tenant_id = %s and j.id = %s
                """,
                (POC_TENANT_ID, job_type_id),
            ).fetchone()
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc


@router.get("/service-types")
def list_sector_packs(settings: Settings = Depends(get_settings)) -> list[dict[str, Any]]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            return conn.execute(
                "select id, slug, name, description from public.horekia_service_types where tenant_id = %s order by name",
                (POC_TENANT_ID,),
            ).fetchall()
    except Exception as exc:
        raise database_error(exc) from exc


@router.post("/service-types", status_code=status.HTTP_201_CREATED)
def create_sector_pack(payload: SectorPackCreate, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            return conn.execute(
                """
                insert into public.horekia_service_types (tenant_id, slug, name, description)
                values (%s, %s, %s, %s)
                returning id, slug, name, description
                """,
                (POC_TENANT_ID, payload.slug, payload.name, payload.description),
            ).fetchone()
    except Exception as exc:
        if "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Ya existe un tipo de servicio con ese slug") from exc
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

            # Reordering saves the whole blueprint. Serialize concurrent saves for
            # the same tenant/service so they cannot allocate the same version.
            conn.execute(
                "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (f"horekia-blueprint:{POC_TENANT_ID}:{job_type_id}",),
            )
            duplicate_groups = {
                "preguntas": [field.key for field in payload.fields],
                "conceptos": [item.sku for item in payload.items],
                "reglas": [rule.code for rule in payload.rules],
                "medidas": [measure.code for measure in payload.measures],
            }
            for group, codes in duplicate_groups.items():
                duplicates = sorted({code for code in codes if codes.count(code) > 1})
                if duplicates:
                    raise HTTPException(status_code=409, detail=f"Hay códigos repetidos en {group}: {', '.join(duplicates)}")
            for field_index, field in enumerate(payload.fields):
                visibility = field.visible_when
                if not visibility:
                    continue
                controller_code = visibility.get("field")
                expected_value = visibility.get("equals")
                controller_index = next((index for index, candidate in enumerate(payload.fields) if candidate.key == controller_code), -1)
                if not isinstance(controller_code, str) or not isinstance(expected_value, str) or not expected_value.strip():
                    raise HTTPException(status_code=422, detail=f"La condición de «{field.label}» debe indicar field y equals.")
                if controller_index < 0 or payload.fields[controller_index].type not in {"choice", "boolean"}:
                    raise HTTPException(status_code=422, detail=f"La condición de «{field.label}» debe depender de una pregunta de opción o Sí/No existente.")
                if controller_index >= field_index:
                    raise HTTPException(status_code=422, detail=f"La condición de «{field.label}» debe depender de una pregunta anterior.")
                controller = payload.fields[controller_index]
                valid_values = controller.options if controller.type == "choice" else ["true", "false"]
                if expected_value.casefold() not in {str(value).casefold() for value in valid_values}:
                    raise HTTPException(status_code=422, detail=f"La condición de «{field.label}» usa una opción inexistente: {expected_value}")

            product_rows = conn.execute(
                """
                select sku
                from public.horekia_items
                where tenant_id = %s and status = 'active'
                  and metadata ? 'catalog_product'
                """,
                (POC_TENANT_ID,),
            ).fetchall()
            catalog_skus = {row["sku"] for row in product_rows if row["sku"]}
            # Keep service concepts available to deterministic rules. Product
            # associations, however, are resolved from the tenant catalog.
            for field in payload.fields:
                if not field.product_options:
                    continue
                for option, product_skus in field.product_options.items():
                    if option not in field.options:
                        raise HTTPException(status_code=422, detail=f"La asociación de productos de «{field.label}» usa una opción inexistente: {option}")
                    unknown_skus = sorted(set(product_skus) - catalog_skus)
                    if unknown_skus:
                        raise HTTPException(status_code=422, detail=f"La asociación de productos de «{field.label}» referencia SKU inexistentes: {', '.join(unknown_skus)}")

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
            service_fields = [field for field in payload.fields if field.key != COVERAGE_FIELD_KEY]
            conn.execute(
                """
                insert into public.horekia_intake_schemas (tenant_id, job_type_id, version, fields)
                values (%s, %s, %s, %s)
                """,
                (POC_TENANT_ID, job_type_id, next_version, Jsonb([field.model_dump(mode="json", exclude_none=True) for field in service_fields])),
            )

            item_skus = [item.sku for item in payload.items]
            rule_codes = [rule.code for rule in payload.rules]
            measure_codes = [measure.code for measure in payload.measures]
            if item_skus:
                item_placeholders = ", ".join("%s" for _ in item_skus)
                conn.execute(
                    f"delete from public.horekia_items where tenant_id = %s and job_type_id = %s and (sku is null or sku not in ({item_placeholders}))",
                    (POC_TENANT_ID, job_type_id, *item_skus),
                )
            else:
                conn.execute(
                    "delete from public.horekia_items where tenant_id = %s and job_type_id = %s",
                    (POC_TENANT_ID, job_type_id),
                )
            if rule_codes:
                rule_placeholders = ", ".join("%s" for _ in rule_codes)
                conn.execute(
                    f"delete from public.horekia_price_rules where tenant_id = %s and job_type_id = %s and code not in ({rule_placeholders})",
                    (POC_TENANT_ID, job_type_id, *rule_codes),
                )
            else:
                conn.execute(
                    "delete from public.horekia_price_rules where tenant_id = %s and job_type_id = %s",
                    (POC_TENANT_ID, job_type_id),
                )
            if measure_codes:
                measure_placeholders = ", ".join("%s" for _ in measure_codes)
                conn.execute(
                    f"delete from public.horekia_computed_measures where tenant_id = %s and job_type_id = %s and code not in ({measure_placeholders})",
                    (POC_TENANT_ID, job_type_id, *measure_codes),
                )
            else:
                conn.execute(
                    "delete from public.horekia_computed_measures where tenant_id = %s and job_type_id = %s",
                    (POC_TENANT_ID, job_type_id),
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
            return {"job_type_id": job_type_id, "version": next_version, "fields": len(service_fields), "items": len(payload.items), "rules": len(payload.rules), "measures": len(payload.measures)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("No se pudo guardar el patrón del servicio %s", job_type_id)
        if "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Hay códigos repetidos en el patrón del servicio") from exc
        raise database_error(exc) from exc


def _product_metadata(payload: ProductCreate) -> dict[str, Any]:
    metadata = dict(payload.metadata)
    catalog_product = dict(metadata.get("catalog_product") or {})
    catalog_product.update(
        {
            "category_path": [part.strip() for part in payload.category_path if part.strip()],
            "brand": payload.brand,
            "model": payload.model,
            "material": payload.material,
            "grammage_g": float(payload.grammage_g) if payload.grammage_g is not None else None,
            "colors": [color.strip() for color in payload.colors if color.strip()],
            "sizes": [size.strip() for size in payload.sizes if size.strip()],
            "image_url": payload.image_url,
        }
    )
    metadata["catalog_product"] = {key: value for key, value in catalog_product.items() if value not in (None, "", [], {})}
    return metadata


def _product_view(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    catalog = metadata.get("catalog_product") if isinstance(metadata.get("catalog_product"), dict) else {}
    return {
        "id": str(row["id"]),
        "sku": row["sku"],
        "name": row["name"],
        "description": row.get("description"),
        "category_path": catalog.get("category_path") or [],
        "brand": catalog.get("brand"),
        "model": catalog.get("model"),
        "material": catalog.get("material"),
        "grammage_g": catalog.get("grammage_g"),
        "colors": catalog.get("colors") or [],
        "sizes": catalog.get("sizes") or [],
        "image_url": catalog.get("image_url"),
        "unit": row["unit"],
        "base_price": row["base_price"],
        "currency": row["currency"],
        "metadata": metadata,
    }


@router.get("/products")
def list_products(settings: Settings = Depends(get_settings)) -> list[dict[str, Any]]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            rows = conn.execute(
                """
                select id, sku, name, description, unit, base_price, currency, metadata
                from public.horekia_items
                where tenant_id = %s and status = 'active'
                  and metadata ? 'catalog_product'
                order by name, sku
                """,
                (POC_TENANT_ID,),
            ).fetchall()
            return [_product_view(row) for row in rows]
    except Exception as exc:
        raise database_error(exc) from exc


@router.post("/products", status_code=status.HTTP_201_CREATED)
def create_product(payload: ProductCreate, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        metadata = _product_metadata(payload)
        with db_session(settings) as conn:
            row = conn.execute(
                """
                insert into public.horekia_items
                  (tenant_id, job_type_id, sku, name, description, unit, base_price, currency, metadata)
                values (%s, null, %s, %s, %s, %s, %s, %s, %s)
                returning id, sku, name, description, unit, base_price, currency, metadata
                """,
                (POC_TENANT_ID, payload.sku, payload.name.strip(), payload.description, payload.unit, payload.base_price, payload.currency.upper(), Jsonb(metadata)),
            ).fetchone()
            return _product_view(row)
    except Exception as exc:
        if "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=409, detail=f"Ya existe un producto con el SKU «{payload.sku}».") from exc
        raise database_error(exc) from exc


@router.patch("/products/{product_id}")
def update_product(product_id: UUID, payload: ProductPatch, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        metadata = _product_metadata(payload)
        with db_session(settings) as conn:
            row = conn.execute(
                """
                update public.horekia_items
                set sku = %s, name = %s, description = %s, unit = %s,
                    base_price = %s, currency = %s, metadata = %s, updated_at = now()
                where tenant_id = %s and id = %s and status = 'active'
                  and metadata ? 'catalog_product'
                returning id, sku, name, description, unit, base_price, currency, metadata
                """,
                (payload.sku, payload.name.strip(), payload.description, payload.unit, payload.base_price, payload.currency.upper(), Jsonb(metadata), POC_TENANT_ID, product_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Producto no encontrado")
            return _product_view(row)
    except HTTPException:
        raise
    except Exception as exc:
        if "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=409, detail=f"Ya existe un producto con el SKU «{payload.sku}».") from exc
        raise database_error(exc) from exc


@router.delete("/products/{product_id}")
def delete_product(product_id: UUID, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            row = conn.execute(
                """
                select id, sku
                from public.horekia_items
                where tenant_id = %s and id = %s and status = 'active'
                  and metadata ? 'catalog_product'
                """,
                (POC_TENANT_ID, product_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Producto no encontrado")
            schemas = conn.execute(
                """
                select fields
                from public.horekia_intake_schemas
                where tenant_id = %s and status = 'active'
                """,
                (POC_TENANT_ID,),
            ).fetchall()
            for schema in schemas:
                for field in schema.get("fields") or []:
                    mappings = field.get("product_options") if isinstance(field, dict) else None
                    if isinstance(mappings, dict) and any(row["sku"] in values for values in mappings.values() if isinstance(values, list)):
                        raise HTTPException(status_code=409, detail="No se puede eliminar este producto porque está asociado a un patrón activo. Desasócialo primero.")
            archived = conn.execute(
                """
                update public.horekia_items
                set status = 'archived', updated_at = now()
                where tenant_id = %s and id = %s
                returning id, sku, status
                """,
                (POC_TENANT_ID, product_id),
            ).fetchone()
            return {"id": str(archived["id"]), "sku": archived["sku"], "status": archived["status"]}
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc


def _product_image_path(settings: Settings, product_id: UUID, extension: str) -> Path:
    tenant_dir = Path(settings.product_upload_dir) / str(POC_TENANT_ID)
    return tenant_dir / f"{product_id}{extension}"


def _product_image_url(settings: Settings, product_id: UUID, extension: str) -> str:
    return f"{settings.media_public_base_url.rstrip('/')}/products/{POC_TENANT_ID}/{product_id}{extension}"


def _job_type_image_path(settings: Settings, job_type_id: UUID, extension: str) -> Path:
    tenant_dir = Path(settings.product_upload_dir).parent / "services" / str(POC_TENANT_ID)
    return tenant_dir / f"{job_type_id}{extension}"


def _job_type_image_url(settings: Settings, job_type_id: UUID, extension: str) -> str:
    return f"{settings.media_public_base_url.rstrip('/')}/services/{POC_TENANT_ID}/{job_type_id}{extension}"


@router.post("/job-types/{job_type_id}/image")
def upload_job_type_image(job_type_id: UUID, file: UploadFile = File(...), settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    """Store an optional public service icon in the POC server directory."""

    filename = (file.filename or "").lower()
    extensions = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
    }
    extension = extensions.get(file.content_type or "")
    if extension is None:
        extension = (
            ".jpg" if filename.endswith((".jpg", ".jpeg")) else
            ".png" if filename.endswith(".png") else
            ".webp" if filename.endswith(".webp") else
            ".svg" if filename.endswith(".svg") else None
        )
    if extension is None:
        raise HTTPException(status_code=415, detail="La imagen debe ser PNG, JPG, WEBP o SVG")
    content = file.file.read(5 * 1024 * 1024 + 1)
    if not content:
        raise HTTPException(status_code=400, detail="La imagen está vacía")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="La imagen no puede superar 5 MB")
    try:
        with db_session(settings) as conn:
            row = conn.execute(
                """
                select id
                from public.horekia_job_types
                where tenant_id = %s and id = %s and status = 'active'
                """,
                (POC_TENANT_ID, job_type_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Servicio no encontrado")
            for old_extension in (".png", ".jpg", ".webp", ".svg"):
                _job_type_image_path(settings, job_type_id, old_extension).unlink(missing_ok=True)
            target = _job_type_image_path(settings, job_type_id, extension)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            image_url = _job_type_image_url(settings, job_type_id, extension)
            updated = conn.execute(
                """
                update public.horekia_job_types
                set image_url = %s, updated_at = now()
                where tenant_id = %s and id = %s
                returning id, slug, name, description, image_url, status, created_at, updated_at
                """,
                (image_url, POC_TENANT_ID, job_type_id),
            ).fetchone()
            return updated
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc


@router.post("/products/{product_id}/image")
def upload_product_image(product_id: UUID, file: UploadFile = File(...), settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    """Store a product image in the POC server directory and link it to the catalog row."""

    filename = (file.filename or "").lower()
    extensions = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
    extension = extensions.get(file.content_type or "")
    if extension is None:
        extension = ".jpg" if filename.endswith((".jpg", ".jpeg")) else ".png" if filename.endswith(".png") else ".webp" if filename.endswith(".webp") else None
    if extension is None:
        raise HTTPException(status_code=415, detail="La imagen debe ser PNG, JPG o WEBP")
    content = file.file.read(5 * 1024 * 1024 + 1)
    if not content:
        raise HTTPException(status_code=400, detail="La imagen está vacía")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="La imagen no puede superar 5 MB")
    try:
        with db_session(settings) as conn:
            row = conn.execute(
                """
                select id, metadata
                from public.horekia_items
                where tenant_id = %s and id = %s and status = 'active'
                  and metadata ? 'catalog_product'
                """,
                (POC_TENANT_ID, product_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Producto no encontrado")
            metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            catalog = dict(metadata.get("catalog_product") or {})
            old_image_url = catalog.get("image_url")
            if isinstance(old_image_url, str):
                for old_extension in (".png", ".jpg", ".webp"):
                    if old_image_url.endswith(f"{product_id}{old_extension}"):
                        _product_image_path(settings, product_id, old_extension).unlink(missing_ok=True)
            target = _product_image_path(settings, product_id, extension)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            catalog["image_url"] = _product_image_url(settings, product_id, extension)
            metadata["catalog_product"] = catalog
            updated = conn.execute(
                """
                update public.horekia_items
                set metadata = %s, updated_at = now()
                where tenant_id = %s and id = %s
                returning id, sku, name, description, unit, base_price, currency, metadata
                """,
                (Jsonb(metadata), POC_TENANT_ID, product_id),
            ).fetchone()
            return _product_view(updated)
    except HTTPException:
        raise
    except Exception as exc:
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


@router.post("/documentation/chat")
def documentation_chat(payload: DocumentationChatRequest, settings: Settings = Depends(get_settings)) -> dict[str, str]:  # noqa: B008
    """Answer backoffice questions from controlled documentation context only."""

    try:
        return {"reply": _ask_gemini_documentation(payload.messages, settings)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="No se ha podido obtener la ayuda del backoffice") from exc


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


@router.patch("/knowledge/entries/{entry_id}")
def update_knowledge_entry(entry_id: UUID, payload: KnowledgeEntryPatch, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            entry = conn.execute(
                """
                update public.horekia_knowledge_entries
                set title = %s, content = %s, updated_at = now()
                where tenant_id = %s and id = %s and status = 'active'
                returning id, kind, title, content, metadata, source_type, source_name, created_at
                """,
                (payload.title.strip(), payload.content.strip(), POC_TENANT_ID, entry_id),
            ).fetchone()
            if not entry:
                raise HTTPException(status_code=404, detail="Entrada de conocimiento no encontrada")
            if entry["kind"] == "product":
                conn.execute(
                    """
                    update public.horekia_items
                    set name = %s, description = %s, updated_at = now()
                    where tenant_id = %s and metadata->>'knowledge_entry_id' = %s and status = 'active'
                    """,
                    (payload.title.strip(), payload.content.strip() or None, POC_TENANT_ID, str(entry_id)),
                )
            return entry
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc


@router.delete("/knowledge/entries/{entry_id}")
def delete_knowledge_entry(entry_id: UUID, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            entry = conn.execute(
                """
                update public.horekia_knowledge_entries
                set status = 'archived', updated_at = now()
                where tenant_id = %s and id = %s and status = 'active'
                returning id, kind
                """,
                (POC_TENANT_ID, entry_id),
            ).fetchone()
            if not entry:
                raise HTTPException(status_code=404, detail="Entrada de conocimiento no encontrada")
            if entry["kind"] == "product":
                conn.execute(
                    """
                    update public.horekia_items
                    set status = 'archived', updated_at = now()
                    where tenant_id = %s and metadata->>'knowledge_entry_id' = %s and status = 'active'
                    """,
                    (POC_TENANT_ID, str(entry_id)),
                )
            return {"id": entry["id"], "kind": entry["kind"], "status": "archived"}
    except HTTPException:
        raise
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


def _operations_blueprint(conn: Any, job_type_id: UUID) -> dict[str, Any]:
    schema = conn.execute(
        """
        select fields from public.horekia_intake_schemas
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
    products = conn.execute(
        """
        select sku, name, description, unit, base_price, currency, metadata
        from public.horekia_items
        where tenant_id = %s and status = 'active'
                  and metadata ? 'catalog_product'
        order by name
        """,
        (POC_TENANT_ID,),
    ).fetchall()
    known_skus = {str(item.get("sku")) for item in items if item.get("sku")}
    items = [*items, *[product for product in products if str(product.get("sku")) not in known_skus]]
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
        select code, expression from public.horekia_computed_measures
        where tenant_id = %s and job_type_id = %s order by code
        """,
        (POC_TENANT_ID, job_type_id),
    ).fetchall()
    return {"fields": schema["fields"] if schema else [], "items": items, "rules": rules, "measures": measures}


def _create_operations_quote(conn: Any, request: dict[str, Any], blueprint: dict[str, Any], tenant_settings: dict[str, Any]) -> dict[str, Any]:
    calculation = calculate_quote(
        fields=blueprint["fields"],
        items=blueprint["items"],
        rules=blueprint["rules"],
        measures=blueprint["measures"],
        intake=dict(request["intake_data"] or {}),
        tax_rate=tenant_settings["tax_rate"],
        currency=tenant_settings["currency"],
    )
    existing = conn.execute(
        """
        select id, status, currency, subtotal, tax_amount, total
        from public.horekia_quotes
        where tenant_id = %s and request_id = %s and status not in ('rejected', 'expired')
        order by created_at desc limit 1
        """,
        (POC_TENANT_ID, request["id"]),
    ).fetchone()
    if existing:
        return {**existing, "calculation": calculation}

    quote = conn.execute(
        """
        insert into public.horekia_quotes
          (tenant_id, request_id, status, currency, subtotal, tax_amount, total,
           configuration_version, configuration_snapshot, calculation_snapshot)
        values (%s, %s, 'needs_review', %s, %s, %s, %s, %s, %s, %s)
        returning id, status, currency, subtotal, tax_amount, total
        """,
        (
            POC_TENANT_ID,
            request["id"],
            tenant_settings["currency"],
            calculation["subtotal"],
            calculation["tax_amount"],
            calculation["total"],
            tenant_settings["configuration_version"],
            Jsonb(blueprint),
            Jsonb(calculation),
        ),
    ).fetchone()
    for line in calculation["lines"]:
        item_id = None
        if line.get("sku"):
            item = conn.execute(
                "select id from public.horekia_items where tenant_id = %s and sku = %s",
                (POC_TENANT_ID, line["sku"]),
            ).fetchone()
            item_id = item["id"] if item else None
        conn.execute(
            """
            insert into public.horekia_quote_lines
              (tenant_id, quote_id, item_id, description, quantity, unit_price, amount, calculation_trace)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                POC_TENANT_ID,
                quote["id"],
                item_id,
                line["description"],
                line["quantity"],
                line["unit_price"],
                line["amount"],
                Jsonb(line["trace"]),
            ),
        )
    conn.execute(
        "insert into public.horekia_quote_events (tenant_id, quote_id, event_type, payload) values (%s, %s, 'created', %s)",
        (POC_TENANT_ID, quote["id"], Jsonb({"source": "backoffice"})),
    )
    return {**quote, "calculation": calculation}


@router.get("/requests")
def list_requests(settings: Settings = Depends(get_settings)) -> list[dict[str, Any]]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            return conn.execute(
                """
                select r.id, r.status, r.source, r.intake_data, r.missing_fields,
                       r.created_at, r.updated_at, j.slug as job_type_slug, j.name as job_type_name,
                       c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
                       q.id as quote_id, q.status as quote_status, q.total as quote_total, q.currency as quote_currency
                from public.horekia_requests r
                left join public.horekia_job_types j on j.tenant_id = r.tenant_id and j.id = r.job_type_id
                left join public.horekia_customers c on c.tenant_id = r.tenant_id and c.id = r.customer_id
                left join lateral (
                  select id, status, total, currency from public.horekia_quotes
                  where tenant_id = r.tenant_id and request_id = r.id
                  order by created_at desc limit 1
                ) q on true
                where r.tenant_id = %s order by r.created_at desc limit 200
                """,
                (POC_TENANT_ID,),
            ).fetchall()
    except Exception as exc:
        raise database_error(exc) from exc


@router.get("/requests/{request_id}")
def get_request(request_id: UUID, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            request = conn.execute(
                """
                select r.*, j.slug as job_type_slug, j.name as job_type_name,
                       c.name as customer_name, c.email as customer_email, c.phone as customer_phone
                from public.horekia_requests r
                left join public.horekia_job_types j on j.tenant_id = r.tenant_id and j.id = r.job_type_id
                left join public.horekia_customers c on c.tenant_id = r.tenant_id and c.id = r.customer_id
                where r.tenant_id = %s and r.id = %s
                """,
                (POC_TENANT_ID, request_id),
            ).fetchone()
            if not request:
                raise HTTPException(status_code=404, detail="Petición no encontrada")
            messages = conn.execute(
                "select id, sender, body, structured_data, provenance, created_at from public.horekia_messages where tenant_id = %s and request_id = %s order by created_at",
                (POC_TENANT_ID, request_id),
            ).fetchall()
            quote = conn.execute(
                "select id, status, currency, subtotal, tax_amount, total, valid_until, created_at, updated_at from public.horekia_quotes where tenant_id = %s and request_id = %s order by created_at desc limit 1",
                (POC_TENANT_ID, request_id),
            ).fetchone()
            return {"request": request, "messages": messages, "quote": quote}
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc


@router.patch("/requests/{request_id}/status")
def update_request_status(request_id: UUID, payload: StatusPatch, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    allowed = {"new", "in_progress", "needs_review", "quoted", "closed"}
    if payload.status not in allowed:
        raise HTTPException(status_code=422, detail="Estado de petición no válido")
    try:
        with db_session(settings) as conn:
            row = conn.execute(
                "update public.horekia_requests set status = %s, updated_at = now() where tenant_id = %s and id = %s returning id, status, updated_at",
                (payload.status, POC_TENANT_ID, request_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Petición no encontrada")
            return row
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc


@router.post("/requests/{request_id}/calculate")
def calculate_request_quote(request_id: UUID, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            request = conn.execute(
                "select id, job_type_id, intake_data from public.horekia_requests where tenant_id = %s and id = %s",
                (POC_TENANT_ID, request_id),
            ).fetchone()
            if not request:
                raise HTTPException(status_code=404, detail="Petición no encontrada")
            if not request["job_type_id"]:
                raise HTTPException(status_code=422, detail="La petición no tiene servicio asociado")
            blueprint = _operations_blueprint(conn, request["job_type_id"])
            tenant_settings = conn.execute(
                "select currency, tax_rate, configuration_version from public.horekia_tenant_settings where tenant_id = %s",
                (POC_TENANT_ID,),
            ).fetchone()
            try:
                quote = _create_operations_quote(conn, request, blueprint, tenant_settings)
            except CalculationError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            conn.execute("update public.horekia_requests set status = 'quoted', updated_at = now() where tenant_id = %s and id = %s", (POC_TENANT_ID, request_id))
            return quote
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc


@router.get("/quotes")
def list_quotes(settings: Settings = Depends(get_settings)) -> list[dict[str, Any]]:  # noqa: B008
    try:
        with db_session(settings) as conn:
            return conn.execute(
                """
                select q.id, q.request_id, q.status, q.currency, q.subtotal, q.tax_amount, q.total,
                       q.valid_until, q.created_at, q.updated_at, j.name as job_type_name,
                       c.name as customer_name
                from public.horekia_quotes q
                left join public.horekia_requests r on r.tenant_id = q.tenant_id and r.id = q.request_id
                left join public.horekia_job_types j on j.tenant_id = r.tenant_id and j.id = r.job_type_id
                left join public.horekia_customers c on c.tenant_id = r.tenant_id and c.id = r.customer_id
                where q.tenant_id = %s order by q.created_at desc limit 200
                """,
                (POC_TENANT_ID,),
            ).fetchall()
    except Exception as exc:
        raise database_error(exc) from exc


@router.patch("/quotes/{quote_id}/status")
def update_quote_status(quote_id: UUID, payload: StatusPatch, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    allowed = {"draft", "needs_review", "approved", "sent", "accepted", "rejected", "expired"}
    if payload.status not in allowed:
        raise HTTPException(status_code=422, detail="Estado de presupuesto no válido")
    try:
        with db_session(settings) as conn:
            row = conn.execute(
                "update public.horekia_quotes set status = %s, updated_at = now() where tenant_id = %s and id = %s returning id, status, updated_at",
                (payload.status, POC_TENANT_ID, quote_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Presupuesto no encontrado")
            conn.execute(
                "insert into public.horekia_quote_events (tenant_id, quote_id, event_type, payload) values (%s, %s, %s, %s)",
                (POC_TENANT_ID, quote_id, "approved" if payload.status == "approved" else "updated", Jsonb({"status": payload.status, "source": "backoffice"})),
            )
            return row
    except HTTPException:
        raise
    except Exception as exc:
        raise database_error(exc) from exc
