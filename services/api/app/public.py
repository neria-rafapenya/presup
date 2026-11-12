"""Public tenant chat API, deliberately separate from the backoffice help chat."""

from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .calculator import CalculationError, calculate_quote
from .config import Settings, get_settings
from .db import POC_TENANT_ID, db_session

router = APIRouter(prefix="/api/v1/public", tags=["public-chat"])


class ConversationStart(BaseModel):
    job_type_slug: str = Field(min_length=1, max_length=120)
    customer_name: str | None = Field(default=None, max_length=160)
    customer_email: str | None = Field(default=None, max_length=240)
    customer_phone: str | None = Field(default=None, max_length=80)


class ChatMessage(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    field_key: str | None = Field(default=None, max_length=64)


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
    return {"fields": schema["fields"] if schema else [], "items": items, "rules": rules, "measures": measures}


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


def _field_question(field: dict[str, Any]) -> str:
    question = field["label"]
    if field.get("type") == "choice" and field.get("options"):
        question += f" ({', '.join(field['options'])})"
    if field.get("unit"):
        question += f" [{field['unit']}]"
    if field.get("example"):
        question += f" Ejemplo: {field['example']}"
    return question + "."


def _opening_message(service: dict[str, Any]) -> str:
    service_name = service["name"].strip().lower()
    if service_name.startswith("reforma de "):
        need = f"Necesitas reformar tu {service_name.removeprefix('reforma de ')}."
    else:
        need = f"Necesitas un presupuesto de {service_name}."
    return f"{need} Necesito que me respondas a algunas preguntas para poder ofrecerte el presupuesto más adecuado a tus preferencias."


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
        unit = f" en {field['unit']}" if field.get("unit") else ""
        example = f" Por ejemplo: {field['example']}." if field.get("example") else ""
        return f"Perfecto. Para continuar necesito indicar la cantidad{unit}.{example}"
    if field.get("type") == "boolean":
        return f"Gracias. Para continuar, ¿{label}? Responde sí o no."
    return f"Gracias. Para continuar necesito que me indiques {label}."


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
        normalized = value.lower()
        exact = next((option for option in options if option.lower() == normalized), None)
        if exact:
            return exact
        words = normalized.replace(",", " ").replace(".", " ").replace(";", " ").replace(":", " ").split()
        return next((option for option in options if option.lower() in words), None)
    return value or None


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    return value


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
        customer_id = None
        if payload.customer_name or payload.customer_email or payload.customer_phone:
            customer = conn.execute(
                "insert into public.horekia_customers (tenant_id, name, email, phone) values (%s, %s, %s, %s) returning id",
                (tenant["id"], payload.customer_name, payload.customer_email, payload.customer_phone),
            ).fetchone()
            customer_id = customer["id"]
        blueprint = _blueprint(conn, tenant["id"], service["id"])
        first_field = _next_missing(blueprint["fields"], {})
        opening = _opening_message(service)
        if first_field:
            opening += f" {_field_question(first_field)}"
        request = conn.execute(
            "insert into public.horekia_requests (tenant_id, customer_id, job_type_id, status, intake_data, missing_fields, source) values (%s, %s, %s, 'new', %s, %s, 'chat') returning id, status, intake_data, missing_fields, created_at",
            (tenant["id"], customer_id, service["id"], Jsonb({}), Jsonb([field["key"] for field in blueprint["fields"] if field.get("required")])),
        ).fetchone()
        conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant["id"], request["id"], opening, Jsonb({"service": service["slug"]}), Jsonb({"source": "service_blueprint"})))
        return {"request_id": str(request["id"]), "tenant": tenant, "service": service, "message": {"sender": "assistant", "body": opening}, "intake_data": {}, "status": request["status"]}


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
        request = conn.execute("select id, job_type_id, status, intake_data from public.horekia_requests where tenant_id = %s and id = %s", (tenant_id, request_id)).fetchone()
        if not request:
            raise HTTPException(status_code=404, detail="Conversación no encontrada")
        service = conn.execute("select id, name, slug from public.horekia_job_types where tenant_id = %s and id = %s", (tenant_id, request["job_type_id"])).fetchone()
        blueprint = _blueprint(conn, tenant_id, request["job_type_id"])
        intake = dict(request["intake_data"] or {})
        conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body) values (%s, %s, 'customer', %s)", (tenant_id, request_id, payload.content))
        field = next((item for item in blueprint["fields"] if item.get("key") == payload.field_key), None) if payload.field_key else _next_missing(blueprint["fields"], intake)
        if field:
            value = _coerce_field(field, payload.content)
            if value is None:
                reply = _friendly_retry(field)
                conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, provenance) values (%s, %s, 'assistant', %s, %s)", (tenant_id, request_id, reply, Jsonb({"source": "service_blueprint"})))
                return {"request_id": str(request_id), "status": "in_progress", "reply": reply, "intake_data": intake}
            intake[field["key"]] = value
        next_field = _next_missing(blueprint["fields"], intake)
        missing = [item["key"] for item in blueprint["fields"] if item.get("required") and item["key"] not in intake]
        if next_field:
            reply = _field_question(next_field)
            conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'in_progress', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(intake), Jsonb(missing), tenant_id, request_id))
            conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb({"field": next_field["key"]}), Jsonb({"source": "service_blueprint"})))
            return {"request_id": str(request_id), "status": "in_progress", "reply": reply, "intake_data": intake}
        try:
            tenant_settings = conn.execute("select currency, tax_rate, configuration_version from public.horekia_tenant_settings where tenant_id = %s", (tenant_id,)).fetchone()
            quote, calculation = _create_quote(conn, tenant_id, request_id, service["id"], blueprint, intake, tenant_settings)
        except CalculationError as exc:
            reply = f"Necesito revisar un dato antes de calcular: {exc}"
            conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'needs_review', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(intake), Jsonb([]), tenant_id, request_id))
            conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, provenance) values (%s, %s, 'assistant', %s, %s)", (tenant_id, request_id, reply, Jsonb({"source": "calculator", "error": str(exc)})))
            return {"request_id": str(request_id), "status": "needs_review", "reply": reply, "intake_data": intake}
        reply = f"He preparado una solicitud de presupuesto de {service['name']}. Total orientativo: {calculation['total']} {calculation['currency']}. Queda pendiente de revisión."
        conn.execute("update public.horekia_requests set intake_data = %s, missing_fields = %s, status = 'quoted', updated_at = now() where tenant_id = %s and id = %s", (Jsonb(intake), Jsonb([]), tenant_id, request_id))
        conn.execute("insert into public.horekia_messages (tenant_id, request_id, sender, body, structured_data, provenance) values (%s, %s, 'assistant', %s, %s, %s)", (tenant_id, request_id, reply, Jsonb({"quote_id": str(quote["id"]), "calculation": calculation}), Jsonb({"source": "calculator"})))
        return {"request_id": str(request_id), "status": "quoted", "reply": reply, "intake_data": intake, "quote": _quote_response(quote, calculation)}
