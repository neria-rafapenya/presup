import pytest
from pydantic import ValidationError

from app.public import ContactRequest


def test_contact_request_normalizes_email_and_accepts_optional_fields() -> None:
    payload = ContactRequest(
        name="  Ana García ",
        email=" ANA@EJEMPLO.COM ",
        company="Empresa Demo",
        message="Quiero conocer cómo funcionaría HorekIA en mi negocio.",
        privacyAcknowledged=True,
    )

    assert payload.name == "Ana García"
    assert payload.email == "ana@ejemplo.com"
    assert payload.privacy_acknowledged is True


def test_contact_request_requires_privacy_consent() -> None:
    with pytest.raises(ValidationError, match="aceptar el tratamiento"):
        ContactRequest(
            name="Ana García",
            email="ana@ejemplo.com",
            company="Empresa Demo",
            message="Quiero conocer cómo funcionaría HorekIA en mi negocio.",
        )
