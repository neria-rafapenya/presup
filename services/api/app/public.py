"""Public tenant chat API, deliberately separate from the backoffice help chat."""

import base64
from decimal import Decimal
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
import secrets
import ssl
from typing import Any
import unicodedata
import urllib.error
import urllib.request
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
import certifi
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator, model_validator

from .calculator import CalculationError, calculate_quote
from .config import Settings, get_settings
from .db import POC_TENANT_ID, db_session
from .geo import CITY_COORDINATES, COVERAGE_FIELD, COVERAGE_FIELD_KEY, check_service_coverage

router = APIRouter(prefix="/api/v1/public", tags=["public-chat"])


class ConversationStart(BaseModel):
    job_type_slug: str = Field(min_length=1, max_length=120)
    customer_name: str | None = Field(default=None, min_length=2, max_length=160)
    customer_email: str | None = Field(default=None, min_length=5, max_length=240)
    customer_phone: str | None = Field(default=None, max_length=80)
    session_token: str | None = Field(default=None, min_length=20, max_length=240)

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


class ChatMessage(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    field_key: str | None = Field(default=None, max_length=64)
    session_token: str | None = Field(default=None, min_length=20, max_length=240)


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


def _field_question(field: dict[str, Any], prompt_index: int = 0) -> str:
    label = field["label"].lower()
    if field["label"].rstrip().endswith("?"):
        return field["label"].rstrip()
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


def _opening_message(service: dict[str, Any]) -> str:
    service_name = service["name"].strip().lower()
    if service_name.startswith("reforma de "):
        need = f"Quieres reformar tu {service_name.removeprefix('reforma de ')}."
    else:
        need = f"Quieres pedir un presupuesto de {service_name}."
    return f"{need}\n\nNecesito que me respondas a algunas preguntas para poder ofrecerte el presupuesto más adecuado a tus preferencias."


def _normalized_words(value: str) -> set[str]:
    normalized = unicodedata.normalize("NFD", value.lower())
    normalized = "".join(character for character in normalized if unicodedata.category(character) != "Mn")
    return set(normalized.replace(",", " ").replace(".", " ").replace(";", " ").replace(":", " ").split())


def _friendly_retry(field: dict[str, Any]) -> str:
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


def _public_field(field: dict[str, Any] | None) -> dict[str, Any] | None:
    if not field:
        return None
    return {
        "key": field.get("key"),
        "label": field.get("label"),
        "type": field.get("type"),
        "unit": field.get("unit"),
        "options": field.get("options", []),
    }


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


def _next_missing(fields: list[dict[str, Any]], intake: dict[str, Any]) -> dict[str, Any] | None:
    return next((field for field in fields if field.get("required") and field["key"] not in intake), None)


def _coerce_field(field: dict[str, Any], content: str) -> Any | None:
    value = content.strip()
    field_type = field.get("type")
    if field_type == "number":
        try:
            number = Decimal(value.replace(",", "."))
            return int(number) if number == number.to_integral() else float(number)
        except Exception:
            return None
    if field_type == "boolean":
        if value.lower() in {"sí", "si", "s", "yes", "true", "1"}:
            return True
        if value.lower() in {"no", "n", "false", "0"}:
            return False
        return None
    if field_type == "choice":
        options = field.get("options") or []
        normalized = " ".join(sorted(_normalized_words(value)))
        exact = next((option for option in options if " ".join(sorted(_normalized_words(option))) == normalized), None)
        if exact:
            return exact
        input_words = _normalized_words(value)
        matches = [option for option in options if _normalized_words(option) & input_words]
        return matches[0] if len(matches) == 1 else None
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


def _quote_response(quote: dict[str, Any], calculation: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(quote["id"]), "status": quote["status"], "currency": quote["currency"], "subtotal": str(quote["subtotal"]), "tax_amount": str(quote["tax_amount"]), "total": str(quote["total"]), "lines": calculation["lines"]}


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
        tenant = conn.execute("select id, name, slug from public.horekia_tenants where slug = %s and status = 'active'", (tenant_slug,)).fetchone()
        if not tenant:
            raise HTTPException(status_code=404, detail="Empresa no encontrada")
        return conn.execute(
            "select slug, name, description from public.horekia_job_types where tenant_id = %s and status = 'active' order by name",
            (tenant["id"],),
        ).fetchall()


@router.post("/tenants/{tenant_slug}/conversations", status_code=status.HTTP_201_CREATED)
def start_conversation(tenant_slug: str, payload: ConversationStart, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
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
        first_field = _next_missing(fields, {})
        opening = _opening_message(service)
        if first_field:
            opening += f"\n\n{_field_question(first_field, 0)}"
        request = conn.execute(
            "insert into public.horekia_requests (tenant_id, customer_id, job_type_id, status, intake_data, missing_fields, source) values (%s, %s, %s, 'new', %s, %s, 'chat') returning id, status, intake_data, missing_fields, created_at",
            (tenant["id"], customer_id, service["id"], Jsonb({}), Jsonb([field["key"] for field in fields if field.get("required")])),
        ).fetchone()
        conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant["id"], request["id"], opening, Jsonb({"service": service["slug"]}), Jsonb({"source": "service_blueprint"})))
        return {"request_id": str(request["id"]), "tenant": tenant, "service": service, "message": {"sender": "assistant", "body": opening}, "field": _public_field(first_field), "intake_data": {}, "status": request["status"]}


@router.post("/conversations/{request_id}/account")
def complete_customer_account(request_id: UUID, payload: CustomerAccountComplete, settings: Settings = Depends(get_settings)) -> dict[str, Any]:  # noqa: B008
    """Finish the customer account after the deterministic quote is prepared."""

    if payload.password != payload.password_confirmation:
        raise HTTPException(status_code=422, detail="Las contraseñas no coinciden")
    with db_session(settings) as conn:
        request = conn.execute(
            "select id, customer_id, status from public.horekia_requests where tenant_id = %s and id = %s",
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
        return {
            "status": "authenticated",
            "session_token": token,
            "customer": {"id": str(customer["id"]), "name": customer["name"], "email": customer["email"]},
            "quote": _quote_response(quote, quote["calculation_snapshot"] or {"lines": []}),
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
        conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body) values (%s, %s, 'customer', %s)", (tenant_id, request_id, payload.content))
        field = next((item for item in fields if item.get("key") == payload.field_key), None) if payload.field_key else _next_missing(fields, intake)
        coverage = None
        if field:
            value = _coerce_field(field, payload.content)
            if value is None:
                reply = _ask_gemini_public(
                    service_name=service["name"],
                    field=field,
                    user_message=payload.content,
                    settings=settings,
                ) or _friendly_retry(field)
                conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, provenance) values (%s, %s, 'assistant', %s, %s)", (tenant_id, request_id, reply, Jsonb({"source": "service_blueprint"})))
                return {"request_id": str(request_id), "status": "in_progress", "reply": reply, "field": _public_field(field), "intake_data": intake}
            if field.get("key") == COVERAGE_FIELD_KEY:
                profile = conn.execute("select city, display_name from public.horekia_tenant_profiles where tenant_id = %s", (tenant_id,)).fetchone()
                requested_location = str(value)
                coverage = check_service_coverage(profile["city"] if profile else None, requested_location)
                if coverage.get("reason") == "location_not_found":
                    normalized_location = _normalize_location_with_gemini(requested_location, settings)
                    if normalized_location:
                        normalized_coverage = check_service_coverage(profile["city"] if profile else None, normalized_location)
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
                    return {"request_id": str(request_id), "status": "in_progress", "reply": reply, "field": _public_field(field), "intake_data": intake, "coverage": coverage}
                if coverage["status"] == "outside_radius":
                    intake[field["key"]] = value
                    distance = f"{coverage['distance_km']:.1f}".replace(".", ",")
                    radius = f"{coverage['radius_km']:.0f}"
                    business_name = (profile["display_name"] if profile else None) or "la empresa"
                    contact_name = f"**{business_name}**" if business_name != "la empresa" else business_name
                    reply = (
                        f"Lo siento, en esta ocasión no podemos preparar el presupuesto porque la ubicación está a **{distance} km** "
                        f"de nuestra ciudad y nuestro radio habitual de actuación es de **{radius} km**.\n\n"
                        f"Si necesitas realizar la reforma en esa dirección, puedes contactar directamente con {contact_name} "
                        "para consultar si es posible valorar una excepción."
                    )
                    conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'closed', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(intake), Jsonb([]), tenant_id, request_id))
                    conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb(coverage), Jsonb({"source": "coverage_check"})))
                    return {"request_id": str(request_id), "status": "closed", "reply": reply, "field": None, "intake_data": intake, "coverage": coverage, "eligible": False}
            intake[field["key"]] = value
        next_field = _next_missing(fields, intake)
        missing = [item["key"] for item in fields if item.get("required") and item["key"] not in intake]
        if next_field:
            numeric_prompt_index = sum(
                1 for item in blueprint["fields"] if item.get("type") == "number" and item.get("key") in intake
            )
            reply = _field_question(next_field, numeric_prompt_index)
            conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'in_progress', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(intake), Jsonb(missing), tenant_id, request_id))
            structured_data = {"field": next_field["key"]}
            if coverage:
                structured_data["coverage"] = coverage
            conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb(structured_data), Jsonb({"source": "service_blueprint"})))
            response = {"request_id": str(request_id), "status": "in_progress", "reply": reply, "field": _public_field(next_field), "intake_data": intake}
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
        reply = f"He preparado tu solicitud de presupuesto de {service['name']}. Para consultar el importe y acceder al presupuesto, solo falta crear una contraseña para tu cuenta."
        conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'quoted', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(intake), Jsonb([]), tenant_id, request_id))
        conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb({"quote_id": str(quote["id"]), "calculation": calculation}), Jsonb({"source": "calculator"})))
        response = {"request_id": str(request_id), "status": "quoted", "reply": reply, "field": None, "intake_data": intake}
        if authenticated_customer:
            response["quote"] = _quote_response(quote, calculation)
        else:
            response["quote_available"] = True
            response["quote_id"] = str(quote["id"])
        return response
