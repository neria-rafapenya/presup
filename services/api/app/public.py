"""Public tenant chat API, deliberately separate from the backoffice help chat."""

import base64
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import hmac
import json
import re
import secrets
import ssl
from typing import Any
import unicodedata
import urllib.error
import urllib.request
from uuid import UUID

import certifi
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator, model_validator

from .calculator import CalculationError, calculate_quote
from .config import Settings, get_settings
from .db import POC_TENANT_ID, db_session
from .email import EmailDeliveryError, send_contact_email, send_quote_email
from .geo import CITY_COORDINATES, COVERAGE_FIELD, COVERAGE_FIELD_KEY, check_service_coverage
from .pdf import build_quote_pdf
from .recaptcha import RecaptchaVerificationError, assess_token

router = APIRouter(prefix="/api/v1/public", tags=["public-chat"])


class ConversationStart(BaseModel):
    job_type_slug: str = Field(min_length=1, max_length=120)
    customer_name: str | None = Field(default=None, min_length=2, max_length=160)
    customer_email: str | None = Field(default=None, min_length=5, max_length=240)
    customer_phone: str | None = Field(default=None, max_length=80)
    session_token: str | None = Field(default=None, min_length=20, max_length=240)
    recaptcha_token: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def require_contact_or_session(self) -> "ConversationStart":
        if not self.session_token and (not self.customer_name or not self.customer_email):
            raise ValueError("Indica tu nombre y email, o inicia sesión para continuar")
        return self

    @field_validator("customer_name", "customer_email")
    @classmethod
    def normalize_contact(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Este dato es obligatorio")
        return normalized

    @field_validator("customer_email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
            raise ValueError("Escribe un email válido")
        return normalized


class CustomerAccountComplete(BaseModel):
    password: str = Field(min_length=8, max_length=128)
    password_confirmation: str = Field(min_length=8, max_length=128)
    recaptcha_token: str | None = Field(default=None, max_length=10000)


class CustomerLogin(BaseModel):
    email: str = Field(min_length=5, max_length=240)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
            raise ValueError("Escribe un email válido")
        return normalized


class ContactRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    email: str = Field(min_length=5, max_length=240)
    company: str = Field(min_length=2, max_length=160)
    phone: str | None = Field(default=None, max_length=80)
    sector: str | None = Field(default=None, max_length=120)
    message: str = Field(min_length=10, max_length=4000)
    privacy_acknowledged: bool = Field(default=False, alias="privacyAcknowledged")
    website: str | None = Field(default=None, max_length=240)

    @field_validator("name", "company", "message")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Este dato es obligatorio")
        return normalized

    @field_validator("email")
    @classmethod
    def validate_contact_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
            raise ValueError("Escribe un email válido")
        return normalized

    @model_validator(mode="after")
    def require_privacy(self) -> "ContactRequest":
        if not self.privacy_acknowledged:
            raise ValueError("Debes aceptar el tratamiento de la solicitud")
        return self


class ChatMessage(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    field_key: str | None = Field(default=None, max_length=64)
    session_token: str | None = Field(default=None, min_length=20, max_length=240)
    product_sku: str | None = Field(default=None, max_length=120)


def _blueprint(conn: Any, tenant_id: UUID, job_type_id: UUID) -> dict[str, Any]:
    schema = conn.execute(
        """
        select fields from public.horekia_intake_schemas
        where tenant_id = %s and job_type_id = %s and status = 'active'
        order by version desc limit 1
        """,
        (tenant_id, job_type_id),
    ).fetchone()
    items = conn.execute(
        """
        select sku, name, description, unit, base_price, currency, metadata
        from public.horekia_items
        where tenant_id = %s and job_type_id = %s and status = 'active'
        order by name
        """,
        (tenant_id, job_type_id),
    ).fetchall()
    products = conn.execute(
        """
        select sku, name, description, unit, base_price, currency, metadata
        from public.horekia_items
        where tenant_id = %s and status = 'active'
          and metadata ? 'catalog_product'
        order by name
        """,
        (tenant_id,),
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
        (tenant_id, job_type_id),
    ).fetchall()
    measures = conn.execute(
        """
        select code, expression from public.horekia_computed_measures
        where tenant_id = %s and job_type_id = %s order by code
        """,
        (tenant_id, job_type_id),
    ).fetchall()
    fields = [field for field in (schema["fields"] if schema else []) if field.get("key") != COVERAGE_FIELD_KEY]
    return {"fields": fields, "items": items, "rules": rules, "measures": measures}


def _chat_fields(blueprint: dict[str, Any]) -> list[dict[str, Any]]:
    """Return tenant-wide coverage first, followed by this service's fields."""

    return [dict(COVERAGE_FIELD), *blueprint["fields"]]


def _tenant_and_service(conn: Any, tenant_slug: str, job_type_slug: str) -> tuple[dict[str, Any], dict[str, Any]]:
    tenant = conn.execute(
        "select id, name, slug from public.horekia_tenants where slug = %s and status = 'active'",
        (tenant_slug,),
    ).fetchone()
    if not tenant:
        raise HTTPException(status_code=404, detail="Empresa no encontrada")
    service = conn.execute(
        """
        select id, slug, name, description from public.horekia_job_types
        where tenant_id = %s and slug = %s and status = 'active'
        """,
        (tenant["id"], job_type_slug),
    ).fetchone()
    if not service:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")
    return tenant, service


def _dependent_options(field: dict[str, Any], intake: dict[str, Any] | None = None) -> list[str]:
    options = list(field.get("options") or [])
    dependency = field.get("depends_on") or {}
    if not isinstance(dependency, dict):
        return options
    controller_key = dependency.get("field")
    options_by_value = dependency.get("options_by_value")
    if not isinstance(controller_key, str) or not isinstance(options_by_value, dict):
        return options
    current_value = (intake or {}).get(controller_key)
    if current_value in (None, ""):
        return options
    for expected, dependent_options in options_by_value.items():
        if str(expected).casefold() == str(current_value).casefold() and isinstance(dependent_options, list):
            return [str(option) for option in dependent_options if str(option).strip()]
    return []


def _effective_field(field: dict[str, Any], intake: dict[str, Any] | None = None) -> dict[str, Any]:
    effective = dict(field)
    effective["options"] = _dependent_options(field, intake)
    return effective


def _selected_product_sizes(intake: dict[str, Any] | None, items: list[dict[str, Any]] | None) -> list[str]:
    if not intake or not items:
        return []
    selected_skus = [str(value) for key, value in intake.items() if key.endswith("_product_sku") and value]
    products_by_sku = {str(item.get("sku")): item for item in items if item.get("sku")}
    for sku in reversed(selected_skus):
        product = products_by_sku.get(sku)
        metadata = product.get("metadata") if isinstance(product, dict) else None
        catalog = metadata.get("catalog_product") if isinstance(metadata, dict) else None
        sizes = catalog.get("sizes") if isinstance(catalog, dict) else None
        if isinstance(sizes, list):
            return [str(size).strip() for size in sizes if str(size).strip()]
    return []


def _field_with_product_context(field: dict[str, Any], intake: dict[str, Any] | None = None, items: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    effective = _effective_field(field, intake)
    sizes = _selected_product_sizes(intake, items)
    if sizes and "talla" in str(effective.get("label", "")).casefold():
        size_text = ", ".join(sizes[:-1]) + f" o {sizes[-1]}" if len(sizes) > 1 else sizes[0]
        effective["help_text"] = f"El producto seleccionado está disponible en estas tallas: {size_text}."
        effective["example"] = f"12 de {sizes[0]} y 13 de {sizes[1] if len(sizes) > 1 else sizes[0]}"
    return effective


def _field_is_visible(field: dict[str, Any], intake: dict[str, Any] | None = None) -> bool:
    condition = field.get("visible_when")
    if not condition:
        return True
    if not isinstance(condition, dict):
        return True
    controller_key = condition.get("field")
    expected_value = condition.get("equals")
    if not isinstance(controller_key, str) or not isinstance(expected_value, str) or not expected_value.strip():
        return False
    actual_value = (intake or {}).get(controller_key)
    if actual_value in (None, ""):
        return False
    return str(actual_value).casefold() == expected_value.casefold()


def _field_question(field: dict[str, Any], prompt_index: int = 0, intake: dict[str, Any] | None = None, items: list[dict[str, Any]] | None = None) -> str:
    field = _field_with_product_context(field, intake, items)
    label = field["label"].lower()
    sizes = _selected_product_sizes(intake, items)
    if sizes and "talla" in label:
        size_text = ", ".join(f"**{size}**" for size in sizes[:-1]) + f" o **{sizes[-1]}**" if len(sizes) > 1 else f"**{sizes[0]}**"
        question = field["label"].rstrip(".")
        return f"{question} Para este producto están disponibles {size_text}. Por ejemplo: {field['example']}."
    if field.get("key") == COVERAGE_FIELD_KEY:
        return f"**{field['label'].rstrip()}**"
    if field["label"].rstrip().endswith("?"):
        question = field["label"].rstrip()
        options = field.get("options") or []
        if field.get("type") == "choice" and options and not all(option.casefold() in question.casefold() for option in options):
            choices = ", ".join(f"**{option}**" for option in options[:-1]) + f" o **{options[-1]}**"
            return f"{question} Puedes elegir entre {choices}."
        return question
    if field.get("type") == "choice" and field.get("options"):
        subject = label.removeprefix("tipo de ")
        options = field["options"]
        if len(options) == 2:
            return f"¿Tu {subject} será **{options[0]}** o **{options[1]}**?"
        choices = ", ".join(f"**{option}**" for option in options[:-1]) + f" o **{options[-1]}**"
        return f"¿Qué {subject} prefieres? {choices}."
    if field.get("type") == "number":
        prefixes = ("Bien", "Vale", "Ok", "Recibido")
        prefix = prefixes[prompt_index % len(prefixes)]
        if label.startswith("superficie de "):
            subject = f"la superficie de las {label.removeprefix('superficie de ')}"
        elif label.startswith("superficie "):
            subject = f"la {label}"
        else:
            subject = label
        unit_words = {
            "m²": "metros cuadrados",
            "m2": "metros cuadrados",
            "m": "metros",
            "cm": "centímetros",
            "mm": "milímetros",
            "ud": "unidades",
            "unidad": "unidades",
            "hora": "horas",
            "día": "días",
            "kg": "kilos",
        }
        unit = unit_words.get(str(field.get("unit", "")).lower())
        if unit:
            if label in {"unidades", "cantidad"}:
                return f"{prefix}, ¿cuántas {unit} necesitas?"
            if subject == label and label.startswith(("altura", "anchura", "longitud", "distancia")):
                subject = f"la {label}"
            return f"{prefix}, ¿cuántos {unit} tiene {subject}?"
        return f"{prefix}, ¿qué cantidad de {label} necesitas?"
    if field.get("type") == "boolean":
        return field["label"].rstrip(".")
    question = field["label"].rstrip(".")
    if question.endswith("?"):
        return question
    if field.get("unit"):
        question += f" [{field['unit']}]"
    if field.get("example") and field.get("type") != "choice":
        question += f" Ejemplo: {field['example']}"
    return question + "."


def _opening_message(service: dict[str, Any], customer_name: str | None = None) -> str:
    service_name = service["name"].strip()
    normalized_name = (customer_name or "").strip()
    safe_first_name = re.sub(r"[*_`]", "", normalized_name.split()[0]) if normalized_name else ""
    greeting = f"Hola, **{safe_first_name}**.\n\n" if safe_first_name else "Hola.\n\n"
    return f"{greeting}Parece que quieres preparar un presupuesto para **{service_name}**.\n\nAntes de entrar en detalles, **¿en qué ciudad o código postal deberíamos realizar el servicio?** Así compruebo primero si está dentro de nuestra zona de actuación."


def _normalized_words(value: str) -> set[str]:
    normalized = unicodedata.normalize("NFD", value.lower())
    normalized = "".join(character for character in normalized if unicodedata.category(character) != "Mn")
    return set(normalized.replace(",", " ").replace(".", " ").replace(";", " ").replace(":", " ").split())


def _friendly_retry(field: dict[str, Any], intake: dict[str, Any] | None = None) -> str:
    field = _effective_field(field, intake)
    label = field["label"].lower()
    if field.get("type") == "choice" and field.get("options"):
        options = field["options"]
        if len(options) == 2:
            choices = f"{options[0]} o {options[1]}"
        else:
            choices = ", ".join(options[:-1]) + f" o {options[-1]}"
        return f"Vale. ¿Qué {label} quieres? Puedes elegir {choices}."
    if field.get("type") == "number":
        return f"Entendido. Necesito que me indiques la cantidad de {field['label'].lower()}."
    if field.get("type") == "boolean":
        return f"Gracias. Para continuar, ¿{label}? Responde sí o no."
    return f"Gracias. Para continuar necesito que me indiques {label}."


def _catalog_product_view(item: dict[str, Any]) -> dict[str, Any]:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    return {
        "sku": item.get("sku"),
        "name": item.get("name"),
        "description": item.get("description"),
        "unit": item.get("unit"),
        "base_price": str(item.get("base_price")) if item.get("base_price") is not None else None,
        "currency": item.get("currency"),
        "metadata": metadata,
    }


def _public_field(field: dict[str, Any] | None, intake: dict[str, Any] | None = None, items: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    if not field:
        return None
    if not _field_is_visible(field, intake):
        return None
    field = _effective_field(field, intake)
    public_field = {
        "key": field.get("key"),
        "label": field.get("label"),
        "type": field.get("type"),
        "unit": field.get("unit"),
        "options": field.get("options", []),
    }
    if isinstance(field.get("color_config"), dict):
        public_field["color_config"] = field["color_config"]
    product_options = field.get("product_options")
    if isinstance(product_options, dict) and items:
        products_by_sku = {str(item.get("sku")): item for item in items if item.get("sku")}
        public_field["products_by_option"] = {
            str(option): [_catalog_product_view(products_by_sku[sku]) for sku in skus if str(sku) in products_by_sku]
            for option, skus in product_options.items()
            if isinstance(skus, list)
        }
    return public_field


def _normalize_location_with_gemini(user_location: str, settings: Settings) -> str | None:
    """Normalize a location spelling; Gemini never supplies coordinates or distance."""

    if settings.ai_mock or not settings.gemini_api_key:
        return None
    model = settings.gemini_model.removeprefix("models/")
    system = (
        "Eres un normalizador de ubicaciones para una aplicación de presupuestos en España. "
        "Corrige errores ortográficos y elimina contexto innecesario como 'capital', provincia o país. "
        "No calcules distancias, no inventes coordenadas y no decidas si una ubicación está dentro de un radio. "
        "Devuelve únicamente un JSON válido con la propiedad location. Si no puedes identificar una ciudad "
        "o un código postal de cinco cifras presente en el mensaje, usa null."
    )
    prompt = json.dumps(
        {
            "ubicacion_escrita_por_cliente": user_location,
            "ciudades_conocidas_por_la_aplicacion": sorted(CITY_COORDINATES),
        },
        ensure_ascii=False,
    )
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 80, "responseMimeType": "application/json"},
    }
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": settings.gemini_api_key},
        method="POST",
    )
    try:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        with urllib.request.urlopen(request, timeout=8, context=ssl_context) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    parts = result.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    raw = "\n".join(part.get("text", "") for part in parts if part.get("text")).strip()
    if not raw:
        return None
    try:
        normalized = json.loads(raw).get("location")
    except json.JSONDecodeError:
        return None
    if not isinstance(normalized, str) or not normalized.strip():
        return None
    return normalized.strip()


def _ask_gemini_public(
    *,
    service_name: str,
    field: dict[str, Any],
    user_message: str,
    settings: Settings,
) -> str | None:
    """Answer a public clarification without giving Gemini pricing authority."""

    if settings.ai_mock or not settings.gemini_api_key:
        return None
    model = settings.gemini_model.removeprefix("models/")
    field_context = {
        "label": field.get("label"),
        "type": field.get("type"),
        "unit": field.get("unit"),
        "options": field.get("options", []),
        "help_text": field.get("help_text"),
    }
    system = (
        "Eres el asistente conversacional de una empresa que prepara presupuestos. "
        "Estás ayudando a un cliente que no ha respondido de forma inequívoca a una pregunta. "
        "Responde en español, con tono cercano, breve y claro. No empieces con Hola ni con otro saludo: "
        "la conversación ya está en curso. Explica qué significa la pregunta "
        "si el cliente pide aclaración y vuelve a pedir el dato. No inventes precios, no calcules "
        "importes y no cambies de servicio. Si el mensaje no es una aclaración, formula la pregunta "
        "de forma natural. Devuelve únicamente el texto que verá el cliente, sin encabezados técnicos."
    )
    prompt = json.dumps(
        {
            "servicio": service_name,
            "pregunta_actual": field_context,
            "mensaje_cliente": user_message,
        },
        ensure_ascii=False,
    )
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 240},
    }
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": settings.gemini_api_key},
        method="POST",
    )
    try:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        with urllib.request.urlopen(request, timeout=20, context=ssl_context) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return None
    parts = result.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    answer = "\n".join(part.get("text", "") for part in parts if part.get("text"))
    return answer.strip() or None


def _public_knowledge_context(conn: Any, tenant_id: UUID, service: dict[str, Any]) -> list[dict[str, str]]:
    """Return a small, service-relevant slice of tenant knowledge for the public chat."""

    rows = conn.execute(
        """
        select kind, title, content
        from public.horekia_knowledge_entries
        where tenant_id = %s and status = 'active'
        order by updated_at desc
        limit 160
        """,
        (tenant_id,),
    ).fetchall()
    service_terms = _normalized_words(f"{service.get('name', '')} {service.get('description') or ''}")
    scored: list[tuple[int, dict[str, str]]] = []
    for row in rows:
        title = str(row.get("title") or "")
        content = str(row.get("content") or "")
        terms = _normalized_words(f"{title} {content}")
        score = len(service_terms & terms)
        if row.get("kind") in {"policy", "faq"}:
            score += 1
        if score:
            scored.append((score, {"kind": str(row.get("kind") or "other"), "title": title[:240], "content": content[:1400]}))
    if not scored:
        scored = [(0, {"kind": str(row.get("kind") or "other"), "title": str(row.get("title") or "")[:240], "content": str(row.get("content") or "")[:1400]}) for row in rows[:20]]
    scored.sort(key=lambda item: item[0], reverse=True)
    context: list[dict[str, str]] = []
    total_chars = 0
    for _, entry in scored:
        entry_size = len(entry["title"]) + len(entry["content"])
        if total_chars + entry_size > 12000:
            break
        context.append(entry)
        total_chars += entry_size
    return context


def _public_gemini_context(service: dict[str, Any], blueprint: dict[str, Any], knowledge: list[dict[str, str]]) -> dict[str, Any]:
    fields = []
    for field in blueprint["fields"]:
        fields.append({
            "key": field.get("key"),
            "label": field.get("label"),
            "type": field.get("type"),
            "required": bool(field.get("required")),
            "options": field.get("options") or [],
            "unit": field.get("unit"),
            "help_text": field.get("help_text"),
            "example": field.get("example"),
            "depends_on": field.get("depends_on"),
            "visible_when": field.get("visible_when"),
        })
    catalog = []
    for item in blueprint["items"]:
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        catalog_product = metadata.get("catalog_product") if isinstance(metadata.get("catalog_product"), dict) else None
        if catalog_product is not None:
            catalog.append({
                "sku": item.get("sku"),
                "name": item.get("name"),
                "description": item.get("description"),
                "category_path": catalog_product.get("category_path") or [],
                "brand": catalog_product.get("brand"),
                "model": catalog_product.get("model"),
                "material": catalog_product.get("material"),
                "colors": catalog_product.get("colors") or [],
                "sizes": catalog_product.get("sizes") or [],
            })
        else:
            catalog.append({"sku": item.get("sku"), "name": item.get("name"), "description": item.get("description")})
    return {
        "service": {"name": service.get("name"), "description": service.get("description")},
        "questions_available": fields,
        "catalog_and_billable_concepts": catalog,
        "knowledge_base": knowledge,
    }


def _parse_gemini_json(raw: str) -> dict[str, Any] | None:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE | re.DOTALL).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _ask_gemini_conversation(
    *,
    service: dict[str, Any],
    blueprint: dict[str, Any],
    knowledge: list[dict[str, str]],
    history: list[dict[str, Any]],
    intake: dict[str, Any],
    user_message: str,
    settings: Settings,
) -> dict[str, Any] | None:
    """Let Gemini conduct the conversation while the server validates every extracted value."""

    if settings.ai_mock or not settings.gemini_api_key:
        return None
    model = settings.gemini_model.removeprefix("models/")
    context = _public_gemini_context(service, blueprint, knowledge)
    system = (
        "Eres el asistente conversacional de una empresa que prepara presupuestos. "
        "Conduces una conversación natural sobre el servicio seleccionado, no un formulario rígido. "
        "El cliente puede explicar su necesidad en cualquier orden, pedir consejo o describir un problema. "
        "Comprende primero su intención y responde de forma cercana antes de pedir el siguiente dato. "
        "Usa exclusivamente el contexto del negocio, el catálogo y la base de conocimiento proporcionados. "
        "Puedes recomendar opciones que aparezcan en ese contexto, pero no inventes productos, materiales, "
        "medidas, políticas ni disponibilidad. Nunca inventes precios ni calcules importes: el servidor lo hará. "
        "Extrae únicamente datos que el cliente haya dicho o que sean una equivalencia inequívoca. "
        "Para una opción, devuelve exactamente una de las opciones permitidas. Si el dato no está claro, no lo extraigas. "
        "Comprueba que la opción o producto elegido sea coherente con la necesidad que el cliente acaba de describir. "
        "Si, por ejemplo, el cliente dice que quiere pintar una cerca pero selecciona pintura para suelos, no avances ni "
        "aceptes silenciosamente la combinación: devuelve needs_confirmation=true y pide confirmación de forma amable, "
        "ofreciendo continuar con la opción elegida o volver a la opción adecuada. "
        "Para una pregunta de tipo color, conserva la selección estructurada con nombre, sistema y código si el cliente los proporciona; no inventes códigos. "
        "Haz una sola pregunta cada vez. No saludes de nuevo durante la conversación. "
        "La ubicación debe solicitarse antes de cerrar o calcular el presupuesto, pero puedes entender primero la necesidad. "
        "Si datos_ya_extraidos ya contiene ubicacion_servicio, no vuelvas a pedir la ciudad, localidad, dirección ni código postal. "
        "Devuelve únicamente JSON válido con esta forma: "
        '{"reply":"texto para el cliente","updates":[{"field":"clave","value":"valor"}],"next_field":"clave o null","needs_confirmation":false,"ready_for_quote":false}. '
        "updates debe ser una lista; next_field debe ser una clave de questions_available o null; "
        "needs_confirmation solo puede ser true cuando detectes una contradicción entre la necesidad expresada y la opción o producto elegido; en ese caso no avances la conversación. "
        "Cuando el cliente indique horas estimadas, confirma que son una referencia y recuerda que se revisarán técnicamente; el presupuesto es orientativo y puede variar tras el estudio de viabilidad y el contrato. "
        "ready_for_quote solo puede ser true si ya están claros todos los datos obligatorios y la ubicación."
    )
    context_text = json.dumps({"contexto": context, "datos_ya_extraidos": intake}, ensure_ascii=False)
    contents = [{
        "role": "user" if message.get("sender") == "customer" else "model",
        "parts": [{"text": str(message.get("body") or "")}],
    } for message in history[-14:]]
    if not contents or contents[-1].get("role") != "user":
        contents.append({"role": "user", "parts": [{"text": user_message}]})
    else:
        contents[-1] = {"role": "user", "parts": [{"text": user_message}]}
    contents.insert(0, {"role": "user", "parts": [{"text": context_text}]})
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.45, "maxOutputTokens": 420, "responseMimeType": "application/json"},
    }
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": settings.gemini_api_key},
        method="POST",
    )
    try:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        with urllib.request.urlopen(request, timeout=25, context=ssl_context) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    parts = result.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    raw = "\n".join(part.get("text", "") for part in parts if part.get("text")).strip()
    parsed = _parse_gemini_json(raw) if raw else None
    if not parsed or not isinstance(parsed.get("reply"), str) or not parsed["reply"].strip():
        return None
    return parsed


def _coverage_value_supported(fields: list[dict[str, Any]], value: str, user_message: str) -> bool:
    normalized_value = " ".join(sorted(_normalized_words(value)))
    if not normalized_value:
        return False
    for field in fields:
        if field.get("type") != "choice":
            continue
        if any(" ".join(sorted(_normalized_words(str(option)))) == normalized_value for option in field.get("options") or []):
            return False
    normalized_message = " ".join(sorted(_normalized_words(user_message)))
    if re.search(r"\b\d{5}\b", value) and re.search(r"\b\d{5}\b", user_message):
        return True
    known_locations = [" ".join(sorted(_normalized_words(city))) for city in CITY_COORDINATES]
    if any(location and location in normalized_value and location in normalized_message for location in known_locations):
        return True
    location_markers = {"ciudad", "municipio", "postal", "codigo", "cp", "direccion", "ubicacion", "provincia"}
    return bool(location_markers & set(_normalized_words(user_message))) and bool(set(_normalized_words(value)) & set(_normalized_words(user_message)))


def _apply_gemini_updates(fields: list[dict[str, Any]], intake: dict[str, Any], analysis: dict[str, Any], user_message: str = "") -> tuple[dict[str, Any], set[str]]:
    updated = dict(intake)
    accepted: set[str] = set()
    raw_updates = analysis.get("updates")
    if not isinstance(raw_updates, list):
        return updated, accepted
    for update in raw_updates:
        if not isinstance(update, dict):
            continue
        key = update.get("field")
        if not isinstance(key, str):
            continue
        field = next((candidate for candidate in fields if candidate.get("key") == key), None)
        if not field or not _field_is_visible(field, updated):
            continue
        raw_value = update.get("value")
        if raw_value is None:
            continue
        if key == COVERAGE_FIELD_KEY and not _coverage_value_supported(fields, str(raw_value), user_message):
            continue
        value = _coerce_field(field, raw_value if field.get("type") == "color" else str(raw_value), updated)
        if value is not None:
            updated[key] = value
            accepted.add(key)
    return updated, accepted


def _resolve_coverage(conn: Any, tenant_id: UUID, value: Any, settings: Settings) -> tuple[dict[str, Any], dict[str, Any]]:
    profile = conn.execute(
        "select city, service_radius_km, display_name from public.horekia_tenant_profiles where tenant_id = %s",
        (tenant_id,),
    ).fetchone() or {}
    requested_location = str(value)
    coverage = check_service_coverage(profile.get("city"), requested_location, profile.get("service_radius_km"))
    if coverage.get("reason") == "location_not_found":
        normalized_location = _normalize_location_with_gemini(requested_location, settings)
        if normalized_location:
            normalized_coverage = check_service_coverage(profile.get("city"), normalized_location, profile.get("service_radius_km"))
            if normalized_coverage["status"] != "unavailable":
                normalized_coverage["destination_input"] = requested_location
                normalized_coverage["destination_normalized"] = normalized_location
                normalized_coverage["resolved_by"] = "gemini"
                coverage = normalized_coverage
    return coverage, profile


def _coverage_unavailable_reply(coverage: dict[str, Any]) -> str:
    if coverage.get("reason") == "origin_not_configured":
        return "Todavía no puedo validar el radio de actuación porque la ciudad de la empresa no está configurada en sus datos."
    return "No he podido localizar esa ubicación. Indícame una ciudad o un código postal de cinco cifras para comprobar si está dentro de nuestro radio de actuación."


def _outside_coverage_reply(coverage: dict[str, Any], profile: dict[str, Any]) -> str:
    distance = f"{coverage['distance_km']:.1f}".replace(".", ",")
    radius = f"{float(coverage['radius_km']):.1f}".rstrip("0").rstrip(".").replace(".", ",")
    business_name = profile.get("display_name") or "la empresa"
    contact_name = f"**{business_name}**" if business_name != "la empresa" else business_name
    return (
        f"Lo siento, en esta ocasión no podemos preparar el presupuesto porque la ubicación está a **{distance} km** "
        f"de nuestra ciudad y nuestro radio de acción es de **{radius} km**.\n\n"
        f"Si necesitas realizar el servicio en esa dirección, puedes contactar directamente con {contact_name} "
        "para consultar si es posible valorar una excepción."
    )


def _reply_requests_coverage(reply: str) -> bool:
    """Detect when Gemini asks again for a location already validated by the server."""

    normalized = reply.casefold()
    coverage_terms = (
        "ubicación", "ubicacion", "ciudad", "municipio", "localidad", "dirección", "direccion",
        "código postal", "codigo postal", "prestar el servicio", "realizar el servicio",
    )
    request_terms = (
        "dime", "indica", "indicarme", "señala", "dónde", "donde", "en qué", "en que",
        "qué ciudad", "que ciudad", "deberíamos", "podrías",
    )
    return any(term in normalized for term in coverage_terms) and any(term in normalized for term in request_terms)


def _quote_completion_reply(service_name: str, *, authenticated_customer: bool, email_sent: bool) -> str:
    if authenticated_customer and email_sent:
        return (
            "Perfecto, ya lo tenemos todo.\n\n"
            "He hecho un cálculo aproximado y te he enviado por correo electrónico el presupuesto. "
            "También puedes verlo en tu perfil de usuario, en **Mis presupuestos**.\n\n"
            "Espero haberte ayudado. ¡Un abrazo!"
        )
    if authenticated_customer:
        return (
            f"Perfecto, ya lo tenemos todo. He preparado el presupuesto de {service_name}, "
            "pero la empresa todavía debe revisar la configuración del correo antes de poder enviártelo."
        )
    return (
        "Perfecto, ya lo tenemos todo. He hecho un cálculo aproximado y tu presupuesto está preparado. "
        "Para recibirlo por correo electrónico y verlo en **Mis presupuestos**, solo falta crear tu contraseña."
    )


def _hours_review_note(fields: list[dict[str, Any]], intake: dict[str, Any], accepted_keys: set[str]) -> str | None:
    """Set expectations when the customer supplies an estimated labour duration."""

    for field in fields:
        key = str(field.get("key") or "")
        if key not in accepted_keys or key not in intake:
            continue
        searchable = f"{key} {field.get('label') or ''} {field.get('unit') or ''}".casefold()
        if "hora" not in searchable:
            continue
        try:
            amount = Decimal(str(intake[key]))
            display = format(amount.normalize(), "f")
        except (ArithmeticError, ValueError, TypeError):
            display = str(intake[key])
        unit = "hora" if display == "1" else "horas"
        return (
            f"Perfecto, tomo como referencia **{display} {unit}**. Estas horas se revisarán con el estudio técnico "
            "y con las características reales del trabajo antes de confirmar el presupuesto.\n\n"
            "Recuerda que este presupuesto es orientativo: el alcance, las horas y el importe final "
            "podrán variar después del estudio de viabilidad y de las condiciones del contrato."
        )
    return None


def _append_hours_review_note(reply: str, note: str | None) -> str:
    if not note or "orientativo" in reply.casefold():
        return reply
    return f"{reply}\n\n{note}"


def _conversational_turn(
    conn: Any,
    *,
    tenant_id: UUID,
    request_id: UUID,
    request: dict[str, Any],
    service: dict[str, Any],
    blueprint: dict[str, Any],
    fields: list[dict[str, Any]],
    intake: dict[str, Any],
    payload: ChatMessage,
    analysis: dict[str, Any],
    authenticated_customer: bool,
    settings: Settings,
) -> dict[str, Any]:
    hinted_field = next((field for field in fields if field.get("key") == payload.field_key), None) if payload.field_key else None
    if analysis.get("needs_confirmation") is True:
        reply = str(analysis.get("reply") or "Creo que hay una pequeña incongruencia entre lo que necesitas y la opción seleccionada. ¿Quieres continuar con esta opción o prefieres revisar la selección?").strip()
        current_field = hinted_field or _next_missing(fields, intake)
        conn.execute(
            "insert into public.horekia_messages (tenant_id, request_id, sender, body, provenance) values (%s, %s, 'assistant', %s, %s)",
            (tenant_id, request_id, reply, Jsonb({"source": "gemini_conversation", "needs_confirmation": True})),
        )
        return {
            "request_id": str(request_id),
            "status": "in_progress",
            "reply": reply,
            "field": _public_field(current_field, intake, blueprint["items"]),
            "intake_data": intake,
        }
    updated_intake, accepted_keys = _apply_gemini_updates(fields, intake, analysis, payload.content)
    if hinted_field and hinted_field.get("key") not in accepted_keys and _field_is_visible(hinted_field, updated_intake):
        direct_value = _coerce_field(hinted_field, payload.content, updated_intake)
        if direct_value is not None:
            updated_intake[hinted_field["key"]] = direct_value
            accepted_keys.add(hinted_field["key"])

    pending_product_field = None
    for field in fields:
        if field.get("key") not in accepted_keys:
            continue
        product_options = field.get("product_options") if isinstance(field.get("product_options"), dict) else {}
        option = updated_intake.get(field.get("key"))
        allowed_products = product_options.get(str(option), []) if option is not None else []
        if not isinstance(allowed_products, list) or not allowed_products:
            continue
        if payload.product_sku:
            if payload.product_sku not in [str(value) for value in allowed_products]:
                reply = "Ese modelo no está disponible para la opción que has elegido. Selecciona uno de los modelos mostrados."
                conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, provenance) values (%s, %s, 'assistant', %s, %s)", (tenant_id, request_id, reply, Jsonb({"source": "product_catalog"})))
                return {"request_id": str(request_id), "status": "in_progress", "reply": reply, "field": _public_field(field, updated_intake, blueprint["items"]), "intake_data": updated_intake}
            updated_intake[f"{field['key']}_product_sku"] = payload.product_sku
        else:
            pending_product_field = field

    coverage = None
    profile: dict[str, Any] = {}
    coverage_field = next((field for field in fields if field.get("key") == COVERAGE_FIELD_KEY), None)
    # Reuse the already validated location on every turn. Previously coverage
    # was only resolved when the location was accepted in the current message,
    # so the LLM could ask for it again later in the same conversation.
    if COVERAGE_FIELD_KEY in updated_intake:
        coverage, profile = _resolve_coverage(conn, tenant_id, updated_intake[COVERAGE_FIELD_KEY], settings)
    if COVERAGE_FIELD_KEY in accepted_keys and coverage:
        if coverage["status"] == "unavailable":
            reply = _coverage_unavailable_reply(coverage)
            conn.execute("update public.horekia_requests set intake_data = %s, updated_at = now() where tenant_id = %s and id = %s", (Jsonb(updated_intake), tenant_id, request_id))
            conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb(coverage), Jsonb({"source": "coverage_check"})))
            return {"request_id": str(request_id), "status": "in_progress", "reply": reply, "field": _public_field(coverage_field, updated_intake, blueprint["items"]), "intake_data": updated_intake, "coverage": coverage}
        if coverage["status"] == "outside_radius":
            reply = _outside_coverage_reply(coverage, profile)
            conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'closed', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(updated_intake), Jsonb([]), tenant_id, request_id))
            conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb(coverage), Jsonb({"source": "coverage_check"})))
            return {"request_id": str(request_id), "status": "closed", "reply": reply, "field": None, "intake_data": updated_intake, "coverage": coverage, "eligible": False}

    if coverage and coverage.get("status") == "within_radius" and accepted_keys == {COVERAGE_FIELD_KEY}:
        reply = "Perfecto, podemos prestar el servicio en esa ubicación. Ahora cuéntame qué te gustaría hacer o qué problema quieres resolver."
        missing = [field for field in fields if field.get("required") and field.get("key") not in updated_intake and _field_is_visible(field, updated_intake)]
        conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'in_progress', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(updated_intake), Jsonb([field["key"] for field in missing]), tenant_id, request_id))
        conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb({"coverage": coverage, "source": "gemini_conversation"}), Jsonb({"source": "coverage_check"})))
        return {"request_id": str(request_id), "status": "in_progress", "reply": reply, "field": None, "intake_data": updated_intake, "coverage": coverage, "eligible": True}

    hours_note = _hours_review_note(fields, updated_intake, accepted_keys)
    missing = [field for field in fields if field.get("required") and field.get("key") not in updated_intake and _field_is_visible(field, updated_intake)]
    next_field = pending_product_field
    if not next_field and missing:
        if coverage_field and coverage_field.get("key") not in updated_intake:
            next_field = coverage_field
        else:
            requested_next = analysis.get("next_field")
            next_field = next((field for field in missing if field.get("key") == requested_next), None)
            next_field = next_field or missing[0]
    if next_field:
        reply = str(analysis.get("reply") or _field_question(next_field, 0, updated_intake, blueprint["items"]))
        if COVERAGE_FIELD_KEY in updated_intake and next_field.get("key") != COVERAGE_FIELD_KEY and _reply_requests_coverage(reply):
            reply = _field_question(next_field, 0, updated_intake, blueprint["items"])
        if next_field.get("key") == COVERAGE_FIELD_KEY:
            reply_lower = reply.casefold()
            if not any(token in reply_lower for token in ("ubicación", "ubicacion", "ciudad", "municipio", "código postal", "codigo postal", "dónde", "donde")):
                reply = "Perfecto, lo tengo en cuenta. Para comprobar que podemos prestar el servicio, ¿en qué ciudad o código postal deberíamos realizarlo?"
        reply = _append_hours_review_note(reply, hours_note)
        conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'in_progress', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(updated_intake), Jsonb([field["key"] for field in missing]), tenant_id, request_id))
        structured_data = {"field": next_field["key"], "extracted_fields": sorted(accepted_keys), "source": "gemini_conversation"}
        if coverage:
            structured_data["coverage"] = coverage
        conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb(structured_data), Jsonb({"source": "gemini_conversation"})))
        response = {"request_id": str(request_id), "status": "in_progress", "reply": reply, "field": _public_field(next_field, updated_intake, blueprint["items"]), "intake_data": updated_intake}
        if coverage:
            response["coverage"] = coverage
            response["eligible"] = True
        return response

    try:
        tenant_settings = conn.execute("select currency, tax_rate, configuration_version from public.horekia_tenant_settings where tenant_id = %s", (tenant_id,)).fetchone()
        quote, calculation = _create_quote(conn, tenant_id, request_id, service["id"], blueprint, updated_intake, tenant_settings)
    except CalculationError as exc:
        reply = f"Necesito revisar un dato antes de calcular: {exc}"
        conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'needs_review', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(updated_intake), Jsonb([]), tenant_id, request_id))
        conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, provenance) values (%s, %s, 'assistant', %s, %s)", (tenant_id, request_id, reply, Jsonb({"source": "calculator", "error": str(exc)})))
        return {"request_id": str(request_id), "status": "needs_review", "reply": reply, "field": None, "intake_data": updated_intake}
    email_sent = False
    email_error = None
    if authenticated_customer:
        email_sent, email_error = _deliver_quote_email(conn, settings=settings, tenant_id=tenant_id, request_id=request_id, quote=quote, calculation=calculation, service=service)
        reply = _quote_completion_reply(service["name"], authenticated_customer=True, email_sent=email_sent)
    else:
        reply = _quote_completion_reply(service["name"], authenticated_customer=False, email_sent=False)
    reply = _append_hours_review_note(reply, hours_note)
    conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'quoted', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(updated_intake), Jsonb([]), tenant_id, request_id))
    conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb({"quote_id": str(quote["id"]), "calculation": calculation, "source": "gemini_conversation"}), Jsonb({"source": "calculator"})))
    response = {"request_id": str(request_id), "status": "quoted", "reply": reply, "field": None, "intake_data": updated_intake}
    if authenticated_customer:
        response["email_sent"] = email_sent
    else:
        response["quote_available"] = True
        response["quote_id"] = str(quote["id"])
    return response


def _next_missing(fields: list[dict[str, Any]], intake: dict[str, Any]) -> dict[str, Any] | None:
    return next((field for field in fields if field.get("required") and field["key"] not in intake and _field_is_visible(field, intake)), None)


def _coerce_field(field: dict[str, Any], content: Any, intake: dict[str, Any] | None = None) -> Any | None:
    field = _effective_field(field, intake)
    value = content.strip() if isinstance(content, str) else content
    field_type = field.get("type")
    if field_type == "number":
        try:
            numeric_match = re.search(r"(?<!\d)\d+(?:[.,]\d+)?(?!\d)", value)
            if not numeric_match:
                return None
            number = Decimal(numeric_match.group(0).replace(",", "."))
            return int(number) if number == number.to_integral() else float(number)
        except Exception:
            return None
    if field_type == "boolean":
        if not isinstance(value, str):
            return None
        if value.lower() in {"sí", "si", "s", "yes", "true", "1"}:
            return True
        if value.lower() in {"no", "n", "false", "0"}:
            return False
        return None
    if field_type == "choice":
        if not isinstance(value, str):
            return None
        options = field.get("options") or []
        normalized = " ".join(sorted(_normalized_words(value)))
        exact = next((option for option in options if " ".join(sorted(_normalized_words(option))) == normalized), None)
        if exact:
            return exact
        input_words = _normalized_words(value)
        matches = [option for option in options if _normalized_words(option) & input_words]
        return matches[0] if len(matches) == 1 else None
    if field_type == "color":
        if isinstance(value, dict):
            allowed_keys = {"name", "system", "code", "hex", "rgb", "cmyk"}
            clean = {key: value[key] for key in allowed_keys if key in value and value[key] not in (None, "", [])}
            return clean or None
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict):
                return _coerce_field(field, parsed, intake)
            return {"name": value} if value else None
        return None
    return value or None


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    return value


def _hash_customer_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    iterations = 310_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "pbkdf2_sha256${}${}${}".format(
        iterations,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def _verify_customer_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    try:
        algorithm, iterations_text, salt_text, digest_text = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_text)
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, UnicodeDecodeError):
        return False


def _issue_customer_session(conn: Any, tenant_id: UUID, customer_id: UUID) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    conn.execute(
        """
        insert into public.horekia_customer_sessions
          (tenant_id, customer_id, token_hash, expires_at)
        values (%s, %s, %s, %s)
        """,
        (tenant_id, customer_id, token_hash, datetime.now(timezone.utc) + timedelta(days=30)),
    )
    return token


def _customer_for_session(conn: Any, tenant_id: UUID, token: str | None) -> Any | None:
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return conn.execute(
        """
        select c.id, c.name, c.email
        from public.horekia_customer_sessions s
        join public.horekia_customers c on c.tenant_id = s.tenant_id and c.id = s.customer_id
        where s.tenant_id = %s and s.token_hash = %s and s.expires_at > now()
        """,
        (tenant_id, token_hash),
    ).fetchone()


def _tenant_by_slug(conn: Any, tenant_slug: str) -> dict[str, Any]:
    tenant = conn.execute(
        "select id, name, slug from public.horekia_tenants where slug = %s and status = 'active'",
        (tenant_slug,),
    ).fetchone()
    if not tenant:
        raise HTTPException(status_code=404, detail="Empresa no encontrada")
    return tenant


def _require_customer_session(conn: Any, tenant_id: UUID, token: str | None) -> Any:
    customer = _customer_for_session(conn, tenant_id, token)
    if not customer:
        raise HTTPException(status_code=401, detail="La sesión ha caducado. Vuelve a iniciar sesión")
    return customer


def _quote_response(quote: dict[str, Any], calculation: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(quote["id"]), "status": quote["status"], "currency": quote["currency"], "subtotal": str(quote["subtotal"]), "tax_amount": str(quote["tax_amount"]), "total": str(quote["total"]), "patterns": calculation.get("patterns", []), "lines": calculation["lines"]}


def _deliver_quote_email(
    conn: Any,
    *,
    settings: Settings,
    tenant_id: UUID,
    request_id: UUID,
    quote: dict[str, Any],
    calculation: dict[str, Any],
    service: dict[str, Any],
) -> tuple[bool, str | None]:
    customer = conn.execute(
        "select c.id, c.name, c.email from public.horekia_customers c join public.horekia_requests r on r.tenant_id = c.tenant_id and r.customer_id = c.id where r.tenant_id = %s and r.id = %s",
        (tenant_id, request_id),
    ).fetchone()
    if not customer or not customer["email"]:
        return False, "La solicitud no tiene un email de destino"
    existing = conn.execute(
        "select status, provider_message_id from public.horekia_quote_deliveries where tenant_id = %s and quote_id = %s and recipient_email = %s",
        (tenant_id, quote["id"], customer["email"]),
    ).fetchone()
    if existing and existing["status"] == "sent":
        return True, existing["provider_message_id"]
    delivery = conn.execute(
        """
        insert into public.horekia_quote_deliveries
          (tenant_id, quote_id, request_id, recipient_email, status, attempts, error_message)
        values (%s, %s, %s, %s, 'pending', 1, null)
        on conflict (tenant_id, quote_id, recipient_email) do update
          set status = 'pending', attempts = public.horekia_quote_deliveries.attempts + 1,
              error_message = null, updated_at = now()
        returning id
        """,
        (tenant_id, quote["id"], request_id, customer["email"]),
    ).fetchone()
    profile = conn.execute(
        "select display_name, legal_name, quotes_email, address_line1, postal_code, city, disclaimers, warranty_terms, quote_template_document_id from public.horekia_tenant_profiles where tenant_id = %s",
        (tenant_id,),
    ).fetchone() or {}
    template = None
    if profile.get("quote_template_document_id"):
        document = conn.execute(
            "select content from public.horekia_tenant_documents where tenant_id = %s and id = %s",
            (tenant_id, profile["quote_template_document_id"]),
        ).fetchone()
        template = document["content"] if document else None
    tenant_name = profile.get("display_name") or profile.get("legal_name") or "HorekIA"
    try:
        pdf_content = build_quote_pdf(
            tenant=profile,
            customer=customer,
            service=service,
            quote=quote,
            calculation=calculation,
            template_content=template,
        )
        message_id = send_quote_email(
            settings=settings,
            recipient=customer["email"],
            recipient_name=customer.get("name"),
            subject=f"{tenant_name} · Presupuesto de {service['name']}",
            tenant_name=tenant_name,
            service_name=service["name"],
            total=f"{Decimal(str(quote['total'])):.2f}".replace(".", ","),
            currency=quote["currency"],
            pdf_content=pdf_content,
            pdf_filename=f"presupuesto-{service['slug']}-{str(quote['id'])[:8]}.pdf",
            reply_to=profile.get("quotes_email"),
        )
    except (EmailDeliveryError, ValueError, ImportError) as exc:
        conn.execute(
            "update public.horekia_quote_deliveries set status = 'failed', error_message = %s, updated_at = now() where tenant_id = %s and id = %s",
            (str(exc)[:1000], tenant_id, delivery["id"]),
        )
        return False, str(exc)
    conn.execute(
        "update public.horekia_quote_deliveries set status = 'sent', provider_message_id = %s, sent_at = now(), updated_at = now() where tenant_id = %s and id = %s",
        (message_id, tenant_id, delivery["id"]),
    )
    return True, message_id


def _create_quote(conn: Any, tenant_id: UUID, request_id: UUID, job_type_id: UUID, blueprint: dict[str, Any], intake: dict[str, Any], settings: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    calculation = calculate_quote(fields=blueprint["fields"], items=blueprint["items"], rules=blueprint["rules"], measures=blueprint["measures"], intake=intake, tax_rate=settings["tax_rate"], currency=settings["currency"])
    snapshot = _jsonable(blueprint)
    quote = conn.execute(
        """
        insert into public.horekia_quotes
          (tenant_id, request_id, status, currency, subtotal, tax_amount, total, configuration_version, configuration_snapshot, calculation_snapshot)
        values (%s, %s, 'needs_review', %s, %s, %s, %s, %s, %s, %s)
        returning id, status, currency, subtotal, tax_amount, total
        """,
        (tenant_id, request_id, settings["currency"], calculation["subtotal"], calculation["tax_amount"], calculation["total"], settings["configuration_version"], Jsonb(snapshot), Jsonb(calculation)),
    ).fetchone()
    for line in calculation["lines"]:
        item_id = None
        if line.get("sku"):
            item = conn.execute("select id from public.horekia_items where tenant_id = %s and job_type_id = %s and sku = %s", (tenant_id, job_type_id, line["sku"])).fetchone()
            item_id = item["id"] if item else None
        conn.execute(
            """
            insert into public.horekia_quote_lines
              (tenant_id, quote_id, item_id, description, quantity, unit_price, amount, calculation_trace)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (tenant_id, quote["id"], item_id, line["description"], line["quantity"], line["unit_price"], line["amount"], Jsonb(line["trace"])),
        )
    return quote, calculation


@router.get("/tenants/{tenant_slug}/services")
def public_services(tenant_slug: str, settings: Settings = Depends(get_settings)) -> list[dict[str, Any]]:  # noqa: B008
    with db_session(settings) as conn:
        tenant = _tenant_by_slug(conn, tenant_slug)
        return conn.execute(
            """
            select j.slug, j.name, j.description, j.image_url, j.created_at,
                   st.name as sector_pack_name
            from public.horekia_job_types j
            left join public.horekia_service_types st on st.tenant_id = j.tenant_id and st.id = j.service_type_id
            left join public.horekia_tenant_profiles tp on tp.tenant_id = j.tenant_id
            where j.tenant_id = %s and j.status = 'active'
              and (tp.service_type_id is null or j.service_type_id = tp.service_type_id)
            order by j.created_at desc, j.name
            """,
            (tenant["id"],),
        ).fetchall()


@router.post("/contact", status_code=status.HTTP_202_ACCEPTED)
def commercial_contact(payload: ContactRequest, settings: Settings = Depends(get_settings)) -> dict[str, bool]:  # noqa: B008
    """Forward the commercial contact form to the configured Horekia recipient."""

    # Silent success for the honeypot avoids teaching automated senders which field was detected.
    if payload.website:
        return {"ok": True}
    try:
        with db_session(settings) as conn:
            profile = conn.execute(
                """
                select display_name, legal_name, contact_email, quotes_email
                from public.horekia_tenant_profiles
                where tenant_id = %s
                """,
                (POC_TENANT_ID,),
            ).fetchone() or {}
        recipient = profile.get("contact_email") or profile.get("quotes_email") or settings.resend_from_email
        if not recipient:
            raise EmailDeliveryError("No hay un destinatario comercial configurado")
        send_contact_email(
            settings=settings,
            recipient=recipient,
            sender_name=payload.name,
            sender_email=payload.email,
            company=payload.company,
            phone=payload.phone,
            sector=payload.sector,
            message=payload.message,
        )
        return {"ok": True}
    except EmailDeliveryError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="No se ha podido enviar la solicitud de contacto") from exc


@router.post("/tenants/{tenant_slug}/auth/login")
def customer_login(tenant_slug: str, payload: CustomerLogin, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    with db_session(settings) as conn:
        tenant = _tenant_by_slug(conn, tenant_slug)
        customer = conn.execute(
            """
            select id, name, email, account_password_hash
            from public.horekia_customers
            where tenant_id = %s and lower(email) = %s and account_password_hash is not null
            order by account_created_at desc nulls last, created_at desc
            limit 1
            """,
            (tenant["id"], payload.email),
        ).fetchone()
        if not customer or not _verify_customer_password(payload.password, customer["account_password_hash"]):
            raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")
        conn.execute(
            "update public.horekia_customers set last_login_at = now() where tenant_id = %s and id = %s",
            (tenant["id"], customer["id"]),
        )
        token = _issue_customer_session(conn, tenant["id"], customer["id"])
        return {
            "status": "authenticated",
            "session_token": token,
            "customer": {"id": str(customer["id"]), "name": customer["name"], "email": customer["email"]},
        }


@router.post("/tenants/{tenant_slug}/auth/logout")
def customer_logout(tenant_slug: str, customer_session: str | None = Header(default=None, alias="X-Customer-Session"), settings: Settings = Depends(get_settings)) -> dict[str, str]:  # noqa: B008
    with db_session(settings) as conn:
        tenant = _tenant_by_slug(conn, tenant_slug)
        if customer_session:
            token_hash = hashlib.sha256(customer_session.encode("utf-8")).hexdigest()
            conn.execute(
                "delete from public.horekia_customer_sessions where tenant_id = %s and token_hash = %s",
                (tenant["id"], token_hash),
            )
        return {"status": "signed_out"}


@router.get("/tenants/{tenant_slug}/account")
def customer_account(tenant_slug: str, customer_session: str | None = Header(default=None, alias="X-Customer-Session"), settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    with db_session(settings) as conn:
        tenant = _tenant_by_slug(conn, tenant_slug)
        customer = _require_customer_session(conn, tenant["id"], customer_session)
        profile = conn.execute(
            "select id, name, email, phone, account_created_at, last_login_at from public.horekia_customers where tenant_id = %s and id = %s",
            (tenant["id"], customer["id"]),
        ).fetchone()
        quote_rows = conn.execute(
            """
            select q.id, q.status, q.currency, q.subtotal, q.tax_amount, q.total, q.valid_until,
                   q.created_at, q.updated_at, q.calculation_snapshot,
                   r.id as request_id, r.status as request_status, r.created_at as request_created_at,
                   j.id as job_type_id, j.slug as service_slug, j.name as service_name
            from public.horekia_quotes q
            join public.horekia_requests r on r.tenant_id = q.tenant_id and r.id = q.request_id
            left join public.horekia_job_types j on j.tenant_id = r.tenant_id and j.id = r.job_type_id
            where q.tenant_id = %s and r.customer_id = %s and q.customer_deleted_at is null
            order by q.created_at desc
            """,
            (tenant["id"], customer["id"]),
        ).fetchall()
        quotes: list[dict[str, Any]] = []
        for quote in quote_rows:
            snapshot = quote.get("calculation_snapshot") or {}
            result = dict(quote)
            result.pop("calculation_snapshot", None)
            result["lines"] = snapshot.get("lines", []) if isinstance(snapshot, dict) else []
            quotes.append(result)
        return {"tenant": tenant, "customer": profile, "quotes": quotes}


@router.post("/tenants/{tenant_slug}/quotes/{quote_id}/request-execution")
def request_quote_execution(tenant_slug: str, quote_id: UUID, customer_session: str | None = Header(default=None, alias="X-Customer-Session"), settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    with db_session(settings) as conn:
        tenant = _tenant_by_slug(conn, tenant_slug)
        customer = _require_customer_session(conn, tenant["id"], customer_session)
        quote = conn.execute(
            """
            select q.id, q.status, q.request_id, r.customer_id
            from public.horekia_quotes q
            join public.horekia_requests r on r.tenant_id = q.tenant_id and r.id = q.request_id
            where q.tenant_id = %s and q.id = %s and r.customer_id = %s
            """,
            (tenant["id"], quote_id, customer["id"]),
        ).fetchone()
        if not quote:
            raise HTTPException(status_code=404, detail="Presupuesto no encontrado")
        if quote["status"] in {"rejected", "expired"}:
            raise HTTPException(status_code=409, detail="Este presupuesto ya no está disponible para solicitarlo")
        if quote["status"] != "accepted":
            conn.execute(
                "update public.horekia_quotes set status = 'accepted', updated_at = now() where tenant_id = %s and id = %s",
                (tenant["id"], quote_id),
            )
            conn.execute(
                "insert into public.horekia_quote_events (tenant_id, quote_id, event_type, payload) values (%s, %s, 'accepted', %s)",
                (tenant["id"], quote_id, Jsonb({"source": "public_customer", "action": "request_execution", "customer_id": str(customer["id"])})),
            )
            conn.execute(
                "insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'system', %s, %s, %s)",
                (tenant["id"], quote["request_id"], "El cliente ha solicitado llevar a cabo este presupuesto.", Jsonb({"quote_id": str(quote_id), "action": "request_execution"}), Jsonb({"source": "customer_account"})),
            )
        return {"status": "accepted", "quote_id": str(quote_id), "message": "Hemos enviado tu solicitud a la empresa."}


@router.delete("/tenants/{tenant_slug}/quotes/{quote_id}")
def delete_customer_quote(tenant_slug: str, quote_id: UUID, customer_session: str | None = Header(default=None, alias="X-Customer-Session"), settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    """Hide a customer's quote from their account while preserving tenant history."""

    with db_session(settings) as conn:
        tenant = _tenant_by_slug(conn, tenant_slug)
        customer = _require_customer_session(conn, tenant["id"], customer_session)
        quote = conn.execute(
            """
            select q.id, q.status, q.request_id
            from public.horekia_quotes q
            join public.horekia_requests r on r.tenant_id = q.tenant_id and r.id = q.request_id
            where q.tenant_id = %s and q.id = %s and r.customer_id = %s
              and q.customer_deleted_at is null
            """,
            (tenant["id"], quote_id, customer["id"]),
        ).fetchone()
        if not quote:
            raise HTTPException(status_code=404, detail="Presupuesto no encontrado")
        conn.execute(
            "update public.horekia_quotes set customer_deleted_at = now(), updated_at = now() where tenant_id = %s and id = %s",
            (tenant["id"], quote_id),
        )
        conn.execute(
            "insert into public.horekia_quote_events (tenant_id, quote_id, event_type, payload) values (%s, %s, 'updated', %s)",
            (tenant["id"], quote_id, Jsonb({"source": "public_customer", "action": "hide_quote", "customer_id": str(customer["id"]), "previous_status": quote["status"]})),
        )
        return {"status": "deleted", "quote_id": str(quote_id), "message": "El presupuesto se ha eliminado de tu cuenta."}


@router.post("/tenants/{tenant_slug}/conversations", status_code=status.HTTP_201_CREATED)
def start_conversation(tenant_slug: str, payload: ConversationStart, http_request: Request, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    if not payload.session_token:
        try:
            assess_token(
                settings,
                token=payload.recaptcha_token or "",
                expected_action="start_quote",
                user_agent=http_request.headers.get("user-agent"),
                user_ip=http_request.client.host if http_request.client else None,
            )
        except RecaptchaVerificationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    with db_session(settings) as conn:
        tenant, service = _tenant_and_service(conn, tenant_slug, payload.job_type_slug)
        customer = _customer_for_session(conn, tenant["id"], payload.session_token)
        if payload.session_token and not customer:
            raise HTTPException(status_code=401, detail="La sesión ha caducado. Vuelve a identificarte para continuar")
        if not customer:
            customer = conn.execute(
                "insert into public.horekia_customers (tenant_id, name, email, phone) values (%s, %s, %s, %s) returning id",
                (tenant["id"], payload.customer_name, payload.customer_email, payload.customer_phone),
            ).fetchone()
        customer_id = customer["id"]
        blueprint = _blueprint(conn, tenant["id"], service["id"])
        fields = _chat_fields(blueprint)
        opening = _opening_message(service, customer.get("name") or payload.customer_name)
        request = conn.execute(
            "insert into public.horekia_requests (tenant_id, customer_id, job_type_id, status, intake_data, missing_fields, source) values (%s, %s, %s, 'new', %s, %s, 'chat') returning id, status, intake_data, missing_fields, created_at",
            (tenant["id"], customer_id, service["id"], Jsonb({}), Jsonb([field["key"] for field in fields if field.get("required")])),
        ).fetchone()
        conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant["id"], request["id"], opening, Jsonb({"service": service["slug"]}), Jsonb({"source": "service_blueprint"})))
        return {"request_id": str(request["id"]), "tenant": tenant, "service": service, "message": {"sender": "assistant", "body": opening}, "field": _public_field(COVERAGE_FIELD, {}, blueprint["items"]), "intake_data": {}, "status": request["status"]}


@router.post("/conversations/{request_id}/account")
def complete_customer_account(request_id: UUID, payload: CustomerAccountComplete, http_request: Request, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    """Finish the customer account after the deterministic quote is prepared."""

    if payload.password != payload.password_confirmation:
        raise HTTPException(status_code=422, detail="Las contraseñas no coinciden")
    try:
        assess_token(
            settings,
            token=payload.recaptcha_token or "",
            expected_action="complete_account",
            user_agent=http_request.headers.get("user-agent"),
            user_ip=http_request.client.host if http_request.client else None,
        )
    except RecaptchaVerificationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    with db_session(settings) as conn:
        request = conn.execute(
            "select id, customer_id, job_type_id, status from public.horekia_requests where tenant_id = %s and id = %s",
            (POC_TENANT_ID, request_id),
        ).fetchone()
        if not request:
            raise HTTPException(status_code=404, detail="Solicitud no encontrada")
        if request["status"] != "quoted":
            raise HTTPException(status_code=409, detail="La solicitud todavía no tiene un presupuesto preparado")
        customer = conn.execute(
            "select id, name, email, account_password_hash from public.horekia_customers where tenant_id = %s and id = %s",
            (POC_TENANT_ID, request["customer_id"]),
        ).fetchone()
        if not customer:
            raise HTTPException(status_code=409, detail="La solicitud no tiene datos de contacto")
        if customer["account_password_hash"]:
            raise HTTPException(status_code=409, detail="Esta cuenta ya está activada. Inicia sesión para continuar")
        conn.execute(
            "update public.horekia_customers set account_password_hash = %s, account_created_at = now(), last_login_at = now() where tenant_id = %s and id = %s",
            (_hash_customer_password(payload.password), POC_TENANT_ID, customer["id"]),
        )
        token = _issue_customer_session(conn, POC_TENANT_ID, customer["id"])
        quote = conn.execute(
            "select id, status, currency, subtotal, tax_amount, total, calculation_snapshot from public.horekia_quotes where tenant_id = %s and request_id = %s order by created_at desc limit 1",
            (POC_TENANT_ID, request_id),
        ).fetchone()
        if not quote:
            raise HTTPException(status_code=409, detail="No se ha encontrado el presupuesto preparado")
        service = conn.execute(
            "select id, name, slug from public.horekia_job_types where tenant_id = %s and id = %s",
            (POC_TENANT_ID, request["job_type_id"]),
        ).fetchone()
        email_sent, email_error = _deliver_quote_email(
            conn,
            settings=settings,
            tenant_id=POC_TENANT_ID,
            request_id=request_id,
            quote=quote,
            calculation=quote["calculation_snapshot"] or {"lines": []},
            service=service or {"name": "tu servicio", "slug": "presupuesto"},
        )
        if not email_sent:
            raise HTTPException(status_code=503, detail=f"La cuenta no se ha podido activar porque el presupuesto no se ha enviado: {email_error}")
        return {
            "status": "authenticated",
            "session_token": token,
            "customer": {"id": str(customer["id"]), "name": customer["name"], "email": customer["email"]},
            "email_sent": True,
        }


@router.get("/conversations/{request_id}")
def get_conversation(request_id: UUID, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    with db_session(settings) as conn:
        request = conn.execute("select id, job_type_id, status, intake_data, missing_fields, created_at from public.horekia_requests where tenant_id = %s and id = %s", (POC_TENANT_ID, request_id)).fetchone()
        if not request:
            raise HTTPException(status_code=404, detail="Conversación no encontrada")
        messages = conn.execute("select id, sender, body, structured_data, created_at from public.horekia_messages where tenant_id = %s and request_id = %s order by created_at", (POC_TENANT_ID, request_id)).fetchall()
        return {"request": request, "messages": messages}


@router.post("/conversations/{request_id}/messages")
def send_message(request_id: UUID, payload: ChatMessage, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    with db_session(settings) as conn:
        tenant_id = POC_TENANT_ID
        request = conn.execute("select id, customer_id, job_type_id, status, intake_data from public.horekia_requests where tenant_id = %s and id = %s", (tenant_id, request_id)).fetchone()
        if not request:
            raise HTTPException(status_code=404, detail="Conversación no encontrada")
        session_customer = _customer_for_session(conn, tenant_id, payload.session_token)
        if payload.session_token and not session_customer:
            raise HTTPException(status_code=401, detail="La sesión ha caducado. Vuelve a identificarte para continuar")
        authenticated_customer = bool(session_customer and session_customer["id"] == request["customer_id"])
        if request["status"] == "closed":
            return {"request_id": str(request_id), "status": "closed", "reply": "Esta solicitud se ha cerrado porque la ubicación indicada está fuera de nuestro radio de actuación.", "field": None, "intake_data": request["intake_data"]}
        service = conn.execute("select id, name, slug from public.horekia_job_types where tenant_id = %s and id = %s", (tenant_id, request["job_type_id"])).fetchone()
        blueprint = _blueprint(conn, tenant_id, request["job_type_id"])
        fields = _chat_fields(blueprint)
        intake = dict(request["intake_data"] or {})
        # A location stored in intake_data has already passed the deterministic
        # coverage check. Do not validate it again against the literal text of
        # the next customer message, which could make a valid location vanish.
        conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body) values (%s, %s, 'customer', %s)", (tenant_id, request_id, payload.content))
        if not settings.ai_mock and settings.gemini_api_key:
            history = conn.execute(
                "select sender, body from public.horekia_messages where tenant_id = %s and request_id = %s order by created_at desc limit 14",
                (tenant_id, request_id),
            ).fetchall()
            analysis = _ask_gemini_conversation(
                service=service,
                blueprint=blueprint,
                knowledge=_public_knowledge_context(conn, tenant_id, service),
                history=list(reversed(history)),
                intake=intake,
                user_message=payload.content,
                settings=settings,
            )
            if analysis:
                return _conversational_turn(
                    conn,
                    tenant_id=tenant_id,
                    request_id=request_id,
                    request=request,
                    service=service,
                    blueprint=blueprint,
                    fields=fields,
                    intake=intake,
                    payload=payload,
                    analysis=analysis,
                    authenticated_customer=authenticated_customer,
                    settings=settings,
                )
        field = next((item for item in fields if item.get("key") == payload.field_key), None) if payload.field_key else _next_missing(fields, intake)
        if field and not _field_is_visible(field, intake):
            field = _next_missing(fields, intake)
        coverage = None
        if field:
            value = _coerce_field(field, payload.content, intake)
            product_options = field.get("product_options") if isinstance(field.get("product_options"), dict) else {}
            if value is not None and product_options:
                allowed_products = [str(item) for item in product_options.get(str(value), [])] if isinstance(product_options.get(str(value)), list) else []
                if not payload.product_sku or payload.product_sku not in allowed_products:
                    effective_field = _effective_field(field, intake)
                    reply = "Elige uno de los modelos disponibles para esa prenda para continuar."
                    conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, provenance) values (%s, %s, 'assistant', %s, %s)", (tenant_id, request_id, reply, Jsonb({"source": "product_catalog"})))
                    return {"request_id": str(request_id), "status": "in_progress", "reply": reply, "field": _public_field(effective_field, intake, blueprint["items"]), "intake_data": intake}
            if value is None:
                effective_field = _effective_field(field, intake)
                contextual_field = _field_with_product_context(field, intake, blueprint["items"])
                reply = _ask_gemini_public(
                    service_name=service["name"],
                    field=contextual_field,
                    user_message=payload.content,
                    settings=settings,
                ) or _field_question(contextual_field, 0, intake, blueprint["items"])
                conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, provenance) values (%s, %s, 'assistant', %s, %s)", (tenant_id, request_id, reply, Jsonb({"source": "service_blueprint"})))
                return {"request_id": str(request_id), "status": "in_progress", "reply": reply, "field": _public_field(field, intake, blueprint["items"]), "intake_data": intake}
            if field.get("key") == COVERAGE_FIELD_KEY:
                profile = conn.execute("select city, service_radius_km, display_name from public.horekia_tenant_profiles where tenant_id = %s", (tenant_id,)).fetchone()
                requested_location = str(value)
                radius_km = profile["service_radius_km"] if profile else None
                coverage = check_service_coverage(profile["city"] if profile else None, requested_location, radius_km)
                if coverage.get("reason") == "location_not_found":
                    normalized_location = _normalize_location_with_gemini(requested_location, settings)
                    if normalized_location:
                        normalized_coverage = check_service_coverage(profile["city"] if profile else None, normalized_location, radius_km)
                        if normalized_coverage["status"] != "unavailable":
                            normalized_coverage["destination_input"] = requested_location
                            normalized_coverage["destination_normalized"] = normalized_location
                            normalized_coverage["resolved_by"] = "gemini"
                            coverage = normalized_coverage
                if coverage["status"] == "unavailable":
                    if coverage["reason"] == "origin_not_configured":
                        reply = "Todavía no puedo validar el radio de actuación porque la ciudad de la empresa no está configurada en sus datos."
                    else:
                        reply = "No he podido localizar esa ubicación. Indícame una ciudad o un código postal de cinco cifras para comprobar si está dentro de nuestro radio de actuación."
                    conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb(coverage), Jsonb({"source": "coverage_check"})))
                    return {"request_id": str(request_id), "status": "in_progress", "reply": reply, "field": _public_field(field, intake, blueprint["items"]), "intake_data": intake, "coverage": coverage}
                if coverage["status"] == "outside_radius":
                    intake[field["key"]] = value
                    distance = f"{coverage['distance_km']:.1f}".replace(".", ",")
                    radius = f"{float(coverage['radius_km']):.1f}".rstrip("0").rstrip(".").replace(".", ",")
                    business_name = (profile["display_name"] if profile else None) or "la empresa"
                    contact_name = f"**{business_name}**" if business_name != "la empresa" else business_name
                    reply = (
                        f"Lo siento, en esta ocasión no podemos preparar el presupuesto porque la ubicación está a **{distance} km** "
                        f"de nuestra ciudad y nuestro radio de acción es de **{radius} km**.\n\n"
                        f"Si necesitas realizar la reforma en esa dirección, puedes contactar directamente con {contact_name} "
                        "para consultar si es posible valorar una excepción."
                    )
                    conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'closed', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(intake), Jsonb([]), tenant_id, request_id))
                    conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb(coverage), Jsonb({"source": "coverage_check"})))
                    return {"request_id": str(request_id), "status": "closed", "reply": reply, "field": None, "intake_data": intake, "coverage": coverage, "eligible": False}
            intake[field["key"]] = value
            if payload.product_sku and product_options:
                intake[f"{field['key']}_product_sku"] = payload.product_sku
            hours_note = _hours_review_note(fields, intake, {field["key"]})
        else:
            hours_note = None
        next_field = _next_missing(fields, intake)
        missing = [item["key"] for item in fields if item.get("required") and item["key"] not in intake and _field_is_visible(item, intake)]
        if next_field:
            numeric_prompt_index = sum(
                1 for item in blueprint["fields"] if item.get("type") == "number" and item.get("key") in intake
            )
            reply = _field_question(next_field, numeric_prompt_index, intake, blueprint["items"])
            reply = _append_hours_review_note(reply, hours_note)
            conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'in_progress', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(intake), Jsonb(missing), tenant_id, request_id))
            structured_data = {"field": next_field["key"]}
            if coverage:
                structured_data["coverage"] = coverage
            conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb(structured_data), Jsonb({"source": "service_blueprint"})))
            response = {"request_id": str(request_id), "status": "in_progress", "reply": reply, "field": _public_field(next_field, intake, blueprint["items"]), "intake_data": intake}
            if coverage:
                response["coverage"] = coverage
                response["eligible"] = True
            return response
        try:
            tenant_settings = conn.execute("select currency, tax_rate, configuration_version from public.horekia_tenant_settings where tenant_id = %s", (tenant_id,)).fetchone()
            quote, calculation = _create_quote(conn, tenant_id, request_id, service["id"], blueprint, intake, tenant_settings)
        except CalculationError as exc:
            reply = f"Necesito revisar un dato antes de calcular: {exc}"
            conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'needs_review', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(intake), Jsonb([]), tenant_id, request_id))
            conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, provenance) values (%s, %s, 'assistant', %s, %s)", (tenant_id, request_id, reply, Jsonb({"source": "calculator", "error": str(exc)})))
            return {"request_id": str(request_id), "status": "needs_review", "reply": reply, "field": None, "intake_data": intake}
        email_sent = False
        email_error = None
        if authenticated_customer:
            email_sent, email_error = _deliver_quote_email(
                conn,
                settings=settings,
                tenant_id=tenant_id,
                request_id=request_id,
                quote=quote,
                calculation=calculation,
                service=service,
            )
            if email_sent:
                reply = _quote_completion_reply(service["name"], authenticated_customer=True, email_sent=True)
            else:
                reply = _quote_completion_reply(service["name"], authenticated_customer=True, email_sent=False)
        else:
            reply = _quote_completion_reply(service["name"], authenticated_customer=False, email_sent=False)
        reply = _append_hours_review_note(reply, hours_note)
        conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'quoted', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(intake), Jsonb([]), tenant_id, request_id))
        conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb({"quote_id": str(quote["id"]), "calculation": calculation}), Jsonb({"source": "calculator"})))
        response = {"request_id": str(request_id), "status": "quoted", "reply": reply, "field": None, "intake_data": intake}
        if authenticated_customer:
            response["email_sent"] = email_sent
        else:
            response["quote_available"] = True
            response["quote_id"] = str(quote["id"])
        return response
