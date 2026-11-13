from app.public import _public_field


def test_public_field_exposes_products_by_option() -> None:
    field = {
        "key": "garment_type",
        "label": "¿Qué prenda necesitas?",
        "type": "choice",
        "options": ["camiseta manga larga", "sudadera"],
        "product_options": {
            "camiseta manga larga": ["gildan-64400"],
            "sudadera": ["gildan-18500"],
        },
    }
    items = [
        {
            "sku": "gildan-64400",
            "name": "Camiseta Gildan Ultra Cotton manga larga",
            "description": "Camiseta de manga larga.",
            "unit": "unidad",
            "base_price": "6.90",
            "currency": "EUR",
            "metadata": {"catalog_product": {"brand": "Gildan", "model": "Ultra Cotton 64400"}},
        },
        {
            "sku": "gildan-18500",
            "name": "Sudadera Gildan Heavy Blend 18500",
            "description": "Sudadera.",
            "unit": "unidad",
            "base_price": "14.90",
            "currency": "EUR",
            "metadata": {"catalog_product": {"brand": "Gildan", "model": "Heavy Blend 18500"}},
        },
    ]

    result = _public_field(field, {}, items)

    assert result["products_by_option"]["camiseta manga larga"][0]["sku"] == "gildan-64400"
    assert result["products_by_option"]["sudadera"][0]["metadata"]["catalog_product"]["model"] == "Heavy Blend 18500"
