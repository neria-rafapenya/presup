# Patrones de servicio

Un patrón de servicio describe cómo un tenant vende, pregunta y calcula un tipo de trabajo. No hay formularios específicos para imprentas, reformas o talleres: todos usan la misma estructura declarativa.

## Estructura

```json
{
  "fields": [],
  "items": [],
  "rules": [],
  "measures": []
}
```

- `fields`: preguntas que el chatbot debe responder o solicitar. Pueden ser números, opciones, colores, booleanos, texto, fechas o archivos.
- `items`: conceptos facturables propios del servicio, como materiales, mano de obra y recargos.
- `rules`: mínimos, factores, recargos y fórmulas. Se ejecutarán en el motor de cálculo, no en Gemini.
- `measures`: valores derivados como superficie, horas o unidades facturables.

## Productos concretos y catálogo

Un concepto genérico como `camiseta manga larga` puede asociarse a uno o varios productos
concretos del catálogo general del tenant. Los productos se crean desde el menú `Productos`
y guardan sus datos agnósticos en `metadata.catalog_product`: categoría jerárquica, marca,
modelo, material, gramaje, colores, tallas, imagen y referencia externa. No se crean dentro
del patrón ni se duplican por servicio.

La pregunta de tipo `choice` puede incluir `product_options`, por ejemplo:

```json
{
  "camiseta manga larga": ["gildan-64400"],
  "sudadera": ["gildan-18500"]
}
```

En el diseñador, cada opción permite elegir una categoría, después un producto y pulsar
`Asignar`; se pueden asociar varios productos. En el frontend, el cliente selecciona primero
la opción y después el modelo en una galería.
La conversación conserva el SKU elegido para que las reglas deterministas apliquen el precio
del producto exacto. Más adelante estos productos podrán sincronizarse con el ERP del tenant.

## Colores

Cuando el cliente deba escoger un color, usa un `field` de tipo `color` en lugar de una lista
de texto. Su `color_config` puede indicar el origen (`product`, `tenant_palette`, `mixed` o
`free`), los sistemas admitidos (`RAL`, `NCS`, `Pantone`, `HEX`, `RGB` o `CMYK`) y una paleta
con nombre, código y muestra hexadecimal. El chatbot muestra una tabla visual con buscador y
permite introducir un color personalizado si `allow_custom` está activo. La respuesta se guarda
como objeto estructurado, por ejemplo `{ "name": "Antracita", "system": "RAL", "code": "7016", "hex": "#383E42" }`.

En el CSV de patrón, la columna `color_config` contiene ese JSON. El código de color es un dato
de selección, no un precio: el importe se resuelve aparte mediante el producto asociado o una
regla determinista.

## Ejemplo: bolsas impresas

Campos habituales:

- Tipo de bolsa.
- Material.
- Unidades, con mínimo.
- Talla.
- Color de base.
- Tipo de impresión.
- Número de caras.
- Diseño aportado por el cliente.

Conceptos y reglas:

- Bolsa de algodón por unidad.
- Impresión digital por unidad.
- Preparación de diseño si no se aporta archivo.
- Descuento por tramos de cantidad.
- Mínimo de unidades.

## Ejemplo: reforma de baño

Campos habituales:

- Estancia.
- Superficie en m².
- Tipo de baldosa y suelo.
- Grifería y modelo.
- Sanitarios.
- Horas estimadas de mano de obra.

El motor calcula materiales por superficie, mano de obra por horas, desplazamiento, residuos, margen e impuestos.

## Ejemplo: taller mecánico

Campos habituales:

- Operación: mantenimiento, reparación o sustitución.
- Pieza o material.
- Modelo del vehículo.
- Horas de mano de obra.
- Fotografía de la avería.

El motor combina piezas, consumibles y horas de taller. La imagen puede servir a Gemini para identificar información pendiente, pero la pieza y el precio deben confirmarse antes de calcular.

## Flujo del chatbot

1. Gemini identifica el patrón de servicio.
2. Recupera conocimiento y catálogo del tenant, siempre filtrados por `tenant_id`.
3. Extrae los valores conocidos del mensaje y de los archivos.
4. Formula únicamente las preguntas obligatorias que falten.
5. Entrega una solicitud estructurada al motor determinista.
6. El motor devuelve líneas, importes, supuestos y trazabilidad.
7. Gemini redacta una respuesta concisa sin inventar importes.

El backoffice permite crear el servicio y editar su patrón desde el Wizard. Los servicios nuevos empiezan en blanco, sin preguntas, conceptos ni reglas. Las ayudas de imprenta, reformas y taller son únicamente plantillas de arranque: no representan tipos cerrados de negocio. El tenant puede cargar una ayuda y después escribir, renombrar, eliminar y ordenar sus propios campos, opciones, conceptos y reglas. Cada pregunta admite una explicación y un ejemplo visible para que el equipo configure el patrón sin tener que conocer el modelo técnico.
