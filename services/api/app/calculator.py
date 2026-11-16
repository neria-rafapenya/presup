"""Deterministic quote calculation for service blueprints."""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any


class CalculationError(ValueError):
    """Raised when a blueprint cannot calculate a quote from the supplied intake."""


CENT = Decimal("0.01")


def _decimal(value: Any, label: str) -> Decimal:
    try:
        return Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise CalculationError(f"El valor de {label} debe ser numérico") from exc


def _value(data: dict[str, Any], key: str, measures: dict[str, Decimal]) -> Any:
    if key in data:
        return data[key]
    return measures.get(key)


def _field_is_visible(field: dict[str, Any], data: dict[str, Any]) -> bool:
    visibility = field.get("visible_when")
    if not isinstance(visibility, dict):
        return True
    controller = visibility.get("field")
    expected = visibility.get("equals")
    if not isinstance(controller, str) or expected is None:
        return False
    actual = data.get(controller)
    return str(actual).casefold() == str(expected).casefold()


def _condition_matches(condition: Any, data: dict[str, Any], measures: dict[str, Decimal]) -> bool:
    if not condition:
        return True
    if not isinstance(condition, dict):
        return False
    for key, expected in condition.items():
        actual = _value(data, key, measures)
        if isinstance(expected, dict):
            if "gte" in expected and _decimal(actual, key) < _decimal(expected["gte"], key):
                return False
            if "lte" in expected and _decimal(actual, key) > _decimal(expected["lte"], key):
                return False
        elif str(actual).lower() != str(expected).lower():
            return False
    return True


def _quantity(definition: dict[str, Any], data: dict[str, Any], measures: dict[str, Decimal]) -> Decimal:
    source = definition.get("quantity", 1)
    if isinstance(source, str):
        return _decimal(_value(data, source, measures), source)
    return _decimal(source, "quantity")


def _calculate_measures(definitions: list[dict[str, Any]], data: dict[str, Any]) -> dict[str, Decimal]:
    measures: dict[str, Decimal] = {}
    for measure in definitions:
        expression = measure.get("expression") or {}
        if "source" in expression:
            measures[measure["code"]] = _decimal(data.get(expression["source"]), expression["source"])
            continue
        left = expression.get("left")
        right = expression.get("right")
        operation = expression.get("operation", "multiply")
        if left is None or right is None:
            continue
        left_value = _decimal(_value(data, left, measures) if isinstance(left, str) else left, str(left))
        right_value = _decimal(_value(data, right, measures) if isinstance(right, str) else right, str(right))
        if operation == "add":
            measures[measure["code"]] = left_value + right_value
        elif operation == "subtract":
            measures[measure["code"]] = left_value - right_value
        elif operation == "divide":
            if right_value == 0:
                raise CalculationError(f"No se puede dividir entre cero en {measure['code']}")
            measures[measure["code"]] = left_value / right_value
        else:
            measures[measure["code"]] = left_value * right_value
    return measures


def _field_number(fields: list[dict[str, Any]], data: dict[str, Any], *terms: str) -> tuple[Decimal, dict[str, Any]] | None:
    for field in fields:
        key = str(field.get("key") or "")
        label = str(field.get("label") or "")
        searchable = f"{key} {label}".casefold()
        if not any(term.casefold() in searchable for term in terms) or key not in data:
            continue
        try:
            return _decimal(data[key], key), field
        except CalculationError:
            continue
    return None


def _length_in_meters(value: Decimal, field: dict[str, Any]) -> Decimal:
    unit = str(field.get("unit") or "").casefold().replace("²", "2")
    if "mm" in unit:
        return value / Decimal("1000")
    if "cm" in unit:
        return value / Decimal("100")
    return value


def _catalog_product_quantity(item: dict[str, Any], fields: list[dict[str, Any]], data: dict[str, Any], measures: dict[str, Decimal]) -> Decimal:
    """Infer a useful quantity for a selected catalog product without giving pricing authority to the LLM."""

    unit = str(item.get("unit") or "unidad").casefold().replace("²", "2")
    count_value = _field_number(fields, data, "numero", "cantidad", "unidades", "ejemplares")
    count = count_value[0] if count_value else Decimal("1")
    if unit in {"m2", "m²", "metro cuadrado", "metros cuadrados"}:
        direct_area = _field_number(fields, data, "superficie", "area", "área")
        if direct_area:
            area_per_unit = direct_area[0]
        else:
            width = _field_number(fields, data, "ancho", "anchura")
            height = _field_number(fields, data, "alto", "altura")
            area_per_unit = _length_in_meters(width[0], width[1]) * _length_in_meters(height[0], height[1]) if width and height else Decimal("1")
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        catalog = metadata.get("catalog_product") if isinstance(metadata.get("catalog_product"), dict) else {}
        minimum = _decimal(catalog.get("min_billable_m2", 0), "mínimo facturable")
        return max(area_per_unit, minimum) * count
    if unit in {"metro lineal", "metros lineales", "m", "ml", "m.l."}:
        linear_value = _field_number(fields, data, "metro", "metros", "lineal", "longitud")
        return linear_value[0] if linear_value else count
    return count if unit in {"unidad", "ud", "pieza", "piezas", "hora", "horas", "día", "dias", "días"} else Decimal("1")


def _selected_catalog_product_lines(items: list[dict[str, Any]], fields: list[dict[str, Any]], data: dict[str, Any], measures: dict[str, Decimal], billed_skus: set[str]) -> list[dict[str, Any]]:
    items_by_sku = {str(item.get("sku")): item for item in items if item.get("sku")}
    lines: list[dict[str, Any]] = []
    selected_skus = [str(value) for key, value in data.items() if key.endswith("_product_sku") and value]
    for sku in dict.fromkeys(selected_skus):
        if sku in billed_skus:
            continue
        item = items_by_sku.get(sku)
        if not item or item.get("base_price") is None:
            continue
        quantity = _catalog_product_quantity(item, fields, data, measures)
        unit_price = _decimal(item["base_price"], sku)
        amount = (quantity * unit_price).quantize(CENT, rounding=ROUND_HALF_UP)
        lines.append({
            "sku": sku,
            "description": item["name"],
            "quantity": str(quantity),
            "unit_price": str(unit_price),
            "amount": str(amount),
            "trace": {"source": "selected_catalog_product", "item": sku},
        })
    return lines


def _pattern_answers(fields: list[dict[str, Any]], items: list[dict[str, Any]], data: dict[str, Any]) -> list[dict[str, Any]]:
    items_by_sku = {str(item.get("sku")): item for item in items if item.get("sku")}
    patterns: list[dict[str, Any]] = []
    for field in fields:
        key = str(field.get("key") or "")
        if not key or key not in data or data[key] in (None, ""):
            continue
        value = data[key]
        product_sku = data.get(f"{key}_product_sku")
        product = items_by_sku.get(str(product_sku)) if product_sku else None
        if isinstance(value, dict):
            response = " · ".join(str(value[key]) for key in ("name", "system", "code") if value.get(key))
        else:
            response = "Sí" if value is True else "No" if value is False else str(value)
        patterns.append({
            "key": key,
            "label": field.get("label") or key,
            "response": response,
            "unit": field.get("unit"),
            "product_sku": product_sku,
            "product_name": product.get("name") if product else None,
        })
    return patterns


def calculate_quote(
    *,
    fields: list[dict[str, Any]],
    items: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    measures: list[dict[str, Any]],
    intake: dict[str, Any],
    tax_rate: Decimal | int | float = 0,
    currency: str = "EUR",
) -> dict[str, Any]:
    missing = [
        field["key"]
        for field in fields
        if field.get("required") and _field_is_visible(field, intake)
        and (field["key"] not in intake or intake[field["key"]] in (None, ""))
    ]
    if missing:
        raise CalculationError(f"Faltan campos obligatorios: {', '.join(missing)}")

    measures_values = _calculate_measures(measures, intake)
    items_by_sku = {item["sku"]: item for item in items}
    lines: list[dict[str, Any]] = []
    subtotal = Decimal("0")

    billed_skus = {
        str((rule.get("definition") or {}).get("item"))
        for rule in rules
        if (rule.get("definition") or {}).get("item")
    }
    for line in _selected_catalog_product_lines(items, fields, intake, measures_values, billed_skus):
        lines.append(line)
        subtotal += _decimal(line["amount"], line["sku"] or "producto")

    for rule in sorted(rules, key=lambda current: (current.get("priority", 100), current.get("code", ""))):
        definition = rule.get("definition") or {}
        if not _condition_matches(definition.get("when"), intake, measures_values):
            continue
        kind = rule.get("kind")
        if kind == "minimum":
            field = definition.get("field")
            minimum = definition.get("minimum")
            if field and minimum is not None and _decimal(_value(intake, field, measures_values), field) < _decimal(minimum, field):
                raise CalculationError(f"{field} debe ser como mínimo {_decimal(minimum, field)}")
            minimum_amount = definition.get("amount")
            if minimum_amount is not None and subtotal < _decimal(minimum_amount, "importe mínimo"):
                adjustment = (_decimal(minimum_amount, "importe mínimo") - subtotal).quantize(CENT, rounding=ROUND_HALF_UP)
                lines.append({"sku": None, "description": f"Ajuste a mínimo ({rule['code']})", "quantity": "1", "unit_price": str(adjustment), "amount": str(adjustment), "trace": {"rule": rule["code"]}})
                subtotal += adjustment
            continue
        if kind == "factor":
            field = definition.get("field")
            value = _decimal(_value(intake, field, measures_values), field) if field else Decimal("0")
            factor = Decimal("1")
            for tier in sorted(definition.get("tiers", []), key=lambda current: _decimal(current.get("gte", 0), "tier"), reverse=True):
                if value >= _decimal(tier.get("gte", 0), "tier"):
                    factor = _decimal(tier.get("factor", 1), "factor")
                    break
            adjustment = (subtotal * factor - subtotal).quantize(CENT, rounding=ROUND_HALF_UP)
            if adjustment:
                lines.append({"sku": None, "description": f"Ajuste {rule['code']}", "quantity": "1", "unit_price": str(adjustment), "amount": str(adjustment), "trace": {"rule": rule["code"], "factor": str(factor)}})
                subtotal += adjustment
            continue
        if kind == "surcharge" and (definition.get("percentage") is not None or definition.get("percentage_field")):
            percentage_source = definition.get("percentage_field")
            percentage = _decimal(
                _value(intake, percentage_source, measures_values) if percentage_source else definition.get("percentage"),
                percentage_source or "porcentaje",
            )
            adjustment = (subtotal * percentage / Decimal("100")).quantize(CENT, rounding=ROUND_HALF_UP)
            if adjustment:
                lines.append({"sku": None, "description": f"Recargo {rule['code']}", "quantity": "1", "unit_price": str(adjustment), "amount": str(adjustment), "trace": {"rule": rule["code"], "percentage": str(percentage)}})
                subtotal += adjustment
            continue
        item_sku = definition.get("item")
        item = items_by_sku.get(item_sku)
        if not item:
            raise CalculationError(f"La regla {rule['code']} referencia un concepto inexistente: {item_sku}")
        if item.get("base_price") is None:
            raise CalculationError(f"El concepto {item_sku} no tiene precio base")
        quantity = _quantity(definition, intake, measures_values)
        unit_price = _decimal(item["base_price"], item_sku)
        amount = (quantity * unit_price).quantize(CENT, rounding=ROUND_HALF_UP)
        lines.append({"sku": item_sku, "description": item["name"], "quantity": str(quantity), "unit_price": str(unit_price), "amount": str(amount), "trace": {"rule": rule["code"], "item": item_sku}})
        subtotal += amount

    tax = (subtotal * _decimal(tax_rate, "IVA") / Decimal("100")).quantize(CENT, rounding=ROUND_HALF_UP)
    return {"currency": currency.upper(), "subtotal": str(subtotal.quantize(CENT, rounding=ROUND_HALF_UP)), "tax_amount": str(tax), "total": str((subtotal + tax).quantize(CENT, rounding=ROUND_HALF_UP)), "lines": lines, "patterns": _pattern_answers(fields, items, intake), "measures": {key: str(value) for key, value in measures_values.items()}, "intake": intake}
