"""Server-side Google Cloud Fraud Defense token assessment."""

import json
import urllib.error
import urllib.request
from typing import Any

from .config import Settings


class RecaptchaVerificationError(RuntimeError):
    """Raised when Google cannot validate a reCAPTCHA token."""


def assess_token(
    settings: Settings,
    *,
    token: str,
    expected_action: str,
    user_agent: str | None = None,
    user_ip: str | None = None,
) -> dict[str, Any]:
    """Create a Google assessment and return its token properties and risk analysis."""

    if not settings.recaptcha_configured:
        return {"tokenProperties": {"valid": True, "action": expected_action}, "riskAnalysis": {"score": 1.0}}
    if not token.strip():
        raise RecaptchaVerificationError("Falta el token de reCAPTCHA")

    event: dict[str, Any] = {
        "token": token,
        "siteKey": settings.recaptcha_site_key,
        "expectedAction": expected_action,
    }
    if user_agent:
        event["userAgent"] = user_agent
    if user_ip:
        event["userIpAddress"] = user_ip
    body = json.dumps({"event": event}).encode("utf-8")
    url = (
        "https://recaptchaenterprise.googleapis.com/v1/projects/"
        f"{settings.recaptcha_project_id}/assessments?key={settings.recaptcha_api_key}"
    )
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=8, context=None) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RecaptchaVerificationError("No se ha podido validar reCAPTCHA") from exc

    token_properties = result.get("tokenProperties") or {}
    risk_analysis = result.get("riskAnalysis") or {}
    if not token_properties.get("valid"):
        raise RecaptchaVerificationError("El token de reCAPTCHA no es válido")
    if token_properties.get("action") != expected_action:
        raise RecaptchaVerificationError("La acción de reCAPTCHA no coincide")
    hostname = token_properties.get("hostname")
    if hostname and hostname not in {"app.horekia.com", "localhost", "127.0.0.1"}:
        raise RecaptchaVerificationError("El dominio de reCAPTCHA no coincide")
    score = risk_analysis.get("score")
    if isinstance(score, (int, float)) and score < settings.recaptcha_min_score:
        raise RecaptchaVerificationError("La solicitud parece automatizada")
    return result
