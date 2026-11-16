from app.public import _apply_gemini_updates, _field_is_visible, _hours_review_note, _next_missing, _opening_message, _quote_completion_reply, _reply_requests_coverage


def test_public_opening_invites_free_description() -> None:
    opening = _opening_message({"name": "Instalación de ventanas"}, "Rafa Penya")
    assert "ciudad o código postal" in opening
    assert "**¿en qué ciudad o código postal deberíamos realizar el servicio?**" in opening
    assert "zona de actuación" in opening


def test_gemini_updates_are_validated_against_blueprint() -> None:
    fields = [{"key": "window_type", "label": "Tipo de ventana", "type": "choice", "required": True, "options": ["Corredera", "Fija"]}]
    updated, accepted = _apply_gemini_updates(fields, {}, {"updates": [{"field": "window_type", "value": "corredera"}, {"field": "unknown", "value": "inventado"}]})
    assert updated == {"window_type": "Corredera"}
    assert accepted == {"window_type"}


def test_gemini_cannot_treat_a_window_option_as_location() -> None:
    fields = [
        {"key": "window_type", "label": "Tipo de ventana", "type": "choice", "required": True, "options": ["Fijas", "Correderas"]},
        {"key": "ubicacion_servicio", "label": "Ciudad", "type": "text", "required": True},
    ]
    updated, accepted = _apply_gemini_updates(
        fields,
        {"window_type": "Fijas"},
        {"updates": [{"field": "ubicacion_servicio", "value": "Fijas"}]},
        "fijas",
    )
    assert updated == {"window_type": "Fijas"}
    assert accepted == set()


def test_visible_when_matches_choice_value() -> None:
    field = {"key": "custom_dimensions", "required": True, "visible_when": {"field": "format_type", "equals": "Personalizado"}}
    assert _field_is_visible(field, {"format_type": "Personalizado"}) is True
    assert _field_is_visible(field, {"format_type": "A4"}) is False


def test_visible_when_matches_boolean_value() -> None:
    field = {"key": "hours", "required": True, "visible_when": {"field": "remove", "equals": "true"}}
    assert _field_is_visible(field, {"remove": True}) is True
    assert _field_is_visible(field, {"remove": False}) is False


def test_hidden_required_field_is_not_next_question() -> None:
    fields = [
        {"key": "format_type", "type": "choice", "required": True, "options": ["A4", "Personalizado"]},
        {"key": "custom_dimensions", "type": "text", "required": True, "visible_when": {"field": "format_type", "equals": "Personalizado"}},
        {"key": "page_count", "type": "number", "required": True},
    ]
    assert _next_missing(fields, {"format_type": "A4"})["key"] == "page_count"
    assert _next_missing(fields, {"format_type": "Personalizado"})["key"] == "custom_dimensions"


def test_validated_location_is_not_requested_again() -> None:
    assert _reply_requests_coverage("¿En qué ciudad o código postal deberíamos realizar el servicio?") is True
    assert _reply_requests_coverage("Para terminar, ¿podrías indicarme en qué localidad o dirección se realizará el servicio?") is True
    assert _reply_requests_coverage("Perfecto, ahora dime cuántas ventanas necesitas.") is False


def test_authenticated_quote_completion_is_warm_and_mentions_account() -> None:
    reply = _quote_completion_reply("Ventanas", authenticated_customer=True, email_sent=True)
    assert "cálculo aproximado" in reply
    assert "**Mis presupuestos**" in reply
    assert "¡Un abrazo!" in reply


def test_estimated_hours_are_presented_as_reviewable_reference() -> None:
    note = _hours_review_note(
        [{"key": "horas_estimadas", "label": "¿Cuántas horas necesitaremos?", "type": "number", "unit": "hora(s)"}],
        {"horas_estimadas": 8},
        {"horas_estimadas"},
    )
    assert note is not None
    assert "8 horas" in note
    assert "orientativo" in note
    assert "estudio de viabilidad" in note
