from app.public import _field_is_visible, _next_missing


def test_visible_when_matches_choice_value() -> None:
    field = {"key": "custom_dimensions", "required": True, "visible_when": {"field": "format_type", "equals": "Personalizado"}}
    assert _field_is_visible(field, {"format_type": "Personalizado"}) is True
    assert _field_is_visible(field, {"format_type": "A4"}) is False


def test_hidden_required_field_is_not_next_question() -> None:
    fields = [
        {"key": "format_type", "type": "choice", "required": True, "options": ["A4", "Personalizado"]},
        {"key": "custom_dimensions", "type": "text", "required": True, "visible_when": {"field": "format_type", "equals": "Personalizado"}},
        {"key": "page_count", "type": "number", "required": True},
    ]
    assert _next_missing(fields, {"format_type": "A4"})["key"] == "page_count"
    assert _next_missing(fields, {"format_type": "Personalizado"})["key"] == "custom_dimensions"
