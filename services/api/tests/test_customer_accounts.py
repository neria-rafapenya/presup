from app.public import CustomerLogin, _hash_customer_password, _verify_customer_password


def test_customer_password_hash_roundtrip() -> None:
    password = "cliente-seguro-123"
    stored_hash = _hash_customer_password(password)

    assert _verify_customer_password(password, stored_hash) is True
    assert _verify_customer_password("otra-password", stored_hash) is False
    assert _verify_customer_password(password, "invalid-hash") is False


def test_customer_login_normalizes_email() -> None:
    payload = CustomerLogin(email="  Cliente@Ejemplo.COM ", password="cliente-seguro-123")

    assert payload.email == "cliente@ejemplo.com"
