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

- `fields`: preguntas que el chatbot debe responder o solicitar. Pueden ser números, opciones, booleanos, texto, fechas o archivos.
- `items`: productos, materiales, piezas, mano de obra y recargos con precio base determinista.
- `rules`: mínimos, factores, recargos y fórmulas. Se ejecutarán en el motor de cálculo, no en Gemini.
- `measures`: valores derivados como superficie, horas o unidades facturables.

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
