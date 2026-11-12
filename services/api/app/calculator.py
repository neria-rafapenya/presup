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
    missing = [field["key"] for field in fields if field.get("required") and (field["key"] not in intake or intake[field["key"]] in (None, "") )]
    if missing:
        raise CalculationError(f"Faltan campos obligatorios: {', '.join(missing)}")

    measures_values = _calculate_measures(measures, intake)
    items_by_sku = {item["sku"]: item for item in items}
    lines: list[dict[str, Any]] = []
    subtotal = Decimal("0")

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
    return {"currency": currency.upper(), "subtotal": str(subtotal.quantize(CENT, rounding=ROUND_HALF_UP)), "tax_amount": str(tax), "total": str((subtotal + tax).quantize(CENT, rounding=ROUND_HALF_UP)), "lines": lines, "measures": {key: str(value) for key, value in measures_values.items()}, "intake": intake}
