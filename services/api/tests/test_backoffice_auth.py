from app.auth import BackofficeLogin, _hash_password, _verify_password


def test_backoffice_password_hash_roundtrip() -> None:
    password = "backoffice-seguro-123"
    stored_hash = _hash_password(password)

    assert _verify_password(password, stored_hash) is True
    assert _verify_password("otra-password", stored_hash) is False
    assert _verify_password(password, "invalid-hash") is False


def test_backoffice_login_normalizes_email() -> None:
    payload = BackofficeLogin(email="  ADMIN@HOREKIA.COM ", password="backoffice-seguro-123")

    assert payload.normalized_email() == "admin@horekia.com"
