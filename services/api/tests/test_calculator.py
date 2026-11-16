from decimal import Decimal

from app.calculator import calculate_quote


def test_selected_catalog_product_is_billed_using_window_area() -> None:
    result = calculate_quote(
        fields=[
            {"key": "tipo_de_ventana", "type": "choice", "required": True},
            {"key": "ancho_de_la_ventana", "type": "number", "unit": "cm", "required": True},
            {"key": "alto_de_la_ventana", "type": "number", "unit": "cm", "required": True},
            {"key": "numero_de_ventanas", "type": "number", "unit": "unidad", "required": True},
        ],
        items=[
            {
                "sku": "alu-ventana-fija-rpt-estandar",
                "name": "Ventana fija · RPT estándar",
                "unit": "m²",
                "base_price": "200",
                "metadata": {"catalog_product": {"min_billable_m2": 0.5}},
            },
        ],
        rules=[],
        measures=[],
        intake={
            "tipo_de_ventana": "Fijas",
            "tipo_de_ventana_product_sku": "alu-ventana-fija-rpt-estandar",
            "ancho_de_la_ventana": "100",
            "alto_de_la_ventana": "100",
            "numero_de_ventanas": "2",
        },
        tax_rate=0,
    )

    assert result["subtotal"] == "400.00"
    assert result["total"] == "400.00"
    assert result["lines"][0]["quantity"] == "2"
    assert Decimal(result["lines"][0]["unit_price"]) == Decimal("200")


def test_explicit_rule_does_not_double_bill_selected_product() -> None:
    result = calculate_quote(
        fields=[{"key": "producto", "type": "choice", "required": True}],
        items=[{"sku": "producto-1", "name": "Producto 1", "unit": "unidad", "base_price": "25", "metadata": {}}],
        rules=[{"code": "producto", "kind": "formula", "priority": 10, "definition": {"item": "producto-1", "quantity": 1}}],
        measures=[],
        intake={"producto": "opción", "producto_product_sku": "producto-1"},
        tax_rate=0,
    )

    assert result["subtotal"] == "25.00"
    assert len(result["lines"]) == 1


def test_selected_catalog_product_is_billed_using_linear_length() -> None:
    result = calculate_quote(
        fields=[{"key": "tipo_trabajo", "type": "choice", "required": True}, {"key": "metros_barandilla", "type": "number", "unit": "m", "required": True}],
        items=[{"sku": "pintura-metal", "name": "Esmalte metálico exterior", "unit": "metro lineal", "base_price": "16", "metadata": {"catalog_product": {}}}],
        rules=[],
        measures=[],
        intake={"tipo_trabajo": "Barandilla", "tipo_trabajo_product_sku": "pintura-metal", "metros_barandilla": "12.5"},
        tax_rate=0,
    )

    assert result["subtotal"] == "200.00"
    assert result["lines"][0]["quantity"] == "12.5"


def test_percentage_surcharge_is_applied_to_previous_subtotal() -> None:
    result = calculate_quote(
        fields=[{"key": "trabajo", "type": "choice", "required": True}],
        items=[{"sku": "base", "name": "Base", "unit": "unidad", "base_price": "100", "metadata": {}}],
        rules=[
            {"code": "base", "kind": "formula", "priority": 10, "definition": {"item": "base", "quantity": 1}},
            {"code": "fuera_horario", "kind": "surcharge", "priority": 20, "definition": {"when": {"trabajo": "Fuera de horario"}, "percentage": 25}},
        ],
        measures=[],
        intake={"trabajo": "Fuera de horario"},
        tax_rate=0,
    )

    assert result["subtotal"] == "125.00"


def test_hidden_required_field_is_not_missing() -> None:
    result = calculate_quote(
        fields=[
            {"key": "trabajo", "type": "choice", "required": True},
            {"key": "paredes", "type": "number", "required": True, "visible_when": {"field": "trabajo", "equals": "Paredes"}},
            {"key": "puertas", "type": "number", "required": True, "visible_when": {"field": "trabajo", "equals": "Puertas"}},
        ],
        items=[],
        rules=[],
        measures=[],
        intake={"trabajo": "Paredes", "paredes": "20"},
        tax_rate=0,
    )

    assert result["total"] == "0.00"


def test_window_quote_adds_labor_and_removal_to_products() -> None:
    result = calculate_quote(
        fields=[
            {"key": "tipo_de_ventana", "type": "choice", "required": True},
            {"key": "tipo_de_vidrio", "type": "choice", "required": True},
            {"key": "tipo_de_persiana", "type": "choice", "required": True},
            {"key": "ancho_de_la_ventana", "type": "number", "unit": "cm", "required": True},
            {"key": "alto_de_la_ventana", "type": "number", "unit": "cm", "required": True},
            {"key": "numero_de_ventanas", "type": "number", "unit": "unidad", "required": True},
            {"key": "quieres_que_realicemos_la_instalacion", "type": "boolean", "required": True},
            {"key": "hay_que_desmontar_la_carpinteria_existente", "type": "boolean", "required": True},
        ],
        items=[
            {"sku": "window", "name": "Ventana", "unit": "m²", "base_price": "200", "metadata": {"catalog_product": {}}},
            {"sku": "glass", "name": "Vidrio bajo emisivo", "unit": "m²", "base_price": "25", "metadata": {"catalog_product": {}}},
            {"sku": "blind", "name": "Persiana", "unit": "m²", "base_price": "70", "metadata": {"catalog_product": {}}},
            {"sku": "install", "name": "Instalación", "unit": "unidad", "base_price": "100", "metadata": {}},
            {"sku": "remove", "name": "Desmontaje", "unit": "unidad", "base_price": "50", "metadata": {}},
        ],
        rules=[
            {"code": "install", "kind": "formula", "priority": 10, "definition": {"item": "install", "when": {"quieres_que_realicemos_la_instalacion": True}, "quantity": "numero_de_ventanas"}},
            {"code": "remove", "kind": "formula", "priority": 20, "definition": {"item": "remove", "when": {"hay_que_desmontar_la_carpinteria_existente": True}, "quantity": "numero_de_ventanas"}},
        ],
        measures=[
            {"code": "ancho_m", "expression": {"left": "ancho_de_la_ventana", "right": 100, "operation": "divide"}},
            {"code": "alto_m", "expression": {"left": "alto_de_la_ventana", "right": 100, "operation": "divide"}},
            {"code": "superficie_por_ventana", "expression": {"left": "ancho_m", "right": "alto_m", "operation": "multiply"}},
        ],
        intake={
            "tipo_de_ventana": "Fijas",
            "tipo_de_ventana_product_sku": "window",
            "tipo_de_vidrio": "Bajo emisivo",
            "tipo_de_vidrio_product_sku": "glass",
            "tipo_de_persiana": "Persiana de aluminio inyectado",
            "tipo_de_persiana_product_sku": "blind",
            "ancho_de_la_ventana": "100",
            "alto_de_la_ventana": "100",
            "numero_de_ventanas": "2",
            "quieres_que_realicemos_la_instalacion": True,
            "hay_que_desmontar_la_carpinteria_existente": True,
        },
        tax_rate=0,
    )

    assert result["subtotal"] == "890.00"
    assert {line["sku"] for line in result["lines"]} == {"window", "glass", "blind", "install", "remove"}
