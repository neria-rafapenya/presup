"""Controlled documentation context for the backoffice help assistant."""

BACKOFFICE_HELP_CONTEXT = """
HOREKIA BACKOFFICE - GUIA DE AYUDA

Alcance:
- Este asistente ayuda a configurar y usar el backoffice.
- Solo puede responder usando esta guía. No consulta la base de conocimiento del tenant,
  clientes, presupuestos ni datos privados.
- Si la respuesta no está en la guía, debe decirlo y recomendar abrir Documentación.

Conceptos principales:
- El Wizard es la herramienta de onboarding. Sus pasos son Empresa, Oferta y servicios,
  Conocimiento y Revisión.
- Empresa contiene los datos comerciales del tenant y la configuración operativa.
- Servicios y fichas es el grupo del menú. El Diseñador de servicios permite editar un
  servicio por su identificador y contiene Preguntas, Catálogo, Reglas y Medidas.
- Base de conocimiento contiene contexto del negocio para Gemini: productos, categorías,
  patrones comerciales, políticas, FAQ y documentación.
- Las preguntas, los productos asociados a un servicio y las reglas que calculan importes
  se configuran en el Diseñador o mediante el importador explícito de patrones de servicio.

CSV de conocimiento:
- La importación general admite kind: product, category, sales_pattern, policy, faq,
  document y other.
- Columnas habituales: kind, title, content, code, category, unit, base_price, currency.
- product con base_price alimenta también el catálogo general del tenant.
- sales_pattern aporta contexto, pero no crea preguntas ni reglas deterministas.

CSV de patrón de servicio:
- Se importa desde Base de conocimiento con el bloque Importar patrón de servicio.
- Columnas: service_slug, record_type, code, title, content, type, options, required,
  unit, base_price, currency, priority, definition.
- record_type puede ser service, field, item, rule o measure.
- service crea el servicio si no existe y title contiene su nombre.
- field añade una pregunta, item añade un concepto al servicio, rule añade una regla y
  measure añade una medida calculada.
- Las filas se fusionan por code y no borran elementos existentes.
- Las definiciones de rule y measure deben ser JSON válido.

Regla de cálculo:
- Gemini interpreta la petición y formula preguntas.
- El motor determinista calcula los importes a partir del catálogo y las reglas.
- No se deben inventar precios dentro del chatbot.

Cómo resolver dudas:
- Para crear un servicio: ir al Wizard, paso Oferta y servicios.
- Para editar preguntas, catálogo o reglas: abrir Diseñador de servicios y pulsar Diseñar.
- Para cargar datos generales: abrir Servicios y fichas, Base de conocimiento.
- Para consultar ejemplos: abrir el menú Documentación.
""".strip()
