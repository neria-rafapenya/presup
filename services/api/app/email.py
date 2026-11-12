"""Transactional email provider for customer quote delivery."""

import base64
import json
import ssl
import urllib.error
import urllib.request
from html import escape
from typing import Any

import certifi

from .config import Settings


class EmailDeliveryError(RuntimeError):
    """Raised when a quote email cannot be submitted to the provider."""


def send_quote_email(
    *,
    settings: Settings,
    recipient: str,
    recipient_name: str | None,
    subject: str,
    tenant_name: str,
    service_name: str,
    total: str,
    currency: str,
    pdf_content: bytes,
    pdf_filename: str,
    reply_to: str | None = None,
) -> str:
    """Send a quote PDF through Resend and return the provider message id."""

    if not settings.email_configured:
        raise EmailDeliveryError("El correo transaccional no está configurado: falta Resend o el remitente verificado")
    greeting = f"Hola {escape(recipient_name)}," if recipient_name else "Hola,"
    text_body = (
        f"{greeting}\n\n"
        f"Adjuntamos tu presupuesto de {service_name} preparado por {tenant_name}.\n"
        f"Importe orientativo: {total} {currency}.\n\n"
        "El presupuesto queda pendiente de revisión por la empresa."
    )
    html_body = (
        f"<p>{greeting}</p>"
        f"<p>Adjuntamos tu presupuesto de <strong>{escape(service_name)}</strong> "
        f"preparado por <strong>{escape(tenant_name)}</strong>.</p>"
        f"<p>Importe orientativo: <strong>{escape(total)} {escape(currency)}</strong>.</p>"
        "<p>El presupuesto queda pendiente de revisión por la empresa.</p>"
    )
    from_header = f"{settings.resend_from_name} <{settings.resend_from_email}>" if settings.resend_from_name else settings.resend_from_email
    payload: dict[str, Any] = {
        "from": from_header,
        "to": [recipient],
        "subject": subject,
        "text": text_body,
        "html": html_body,
        "attachments": [{"filename": pdf_filename, "content": base64.b64encode(pdf_content).decode("ascii")}],
    }
    if reply_to:
        payload["reply_to"] = [reply_to]
    request = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {settings.resend_api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        with urllib.request.urlopen(request, timeout=20, context=ssl_context) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace").strip()
        try:
            provider_error = json.loads(response_body)
            detail = (
                provider_error.get("message")
                or provider_error.get("error")
                or provider_error.get("detail")
            )
        except (OSError, json.JSONDecodeError):
            detail = None
        if not detail:
            detail = f"Resend rechazó el envío (HTTP {exc.code})"
            if response_body:
                detail += f": {response_body[:300]}"
        raise EmailDeliveryError(str(detail)) from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise EmailDeliveryError("No se ha podido conectar con Resend") from exc
    message_id = result.get("id")
    if not message_id:
        raise EmailDeliveryError("Resend no devolvió un identificador de envío")
    return str(message_id)
