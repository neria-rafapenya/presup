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
- Columnas: service_slug, record_type, order, code, title, content, type, options, required,
  unit, min, max, example, base_price, currency, priority, rule_kind, definition,
  expression y metadata.
- record_type puede ser service, field, item, rule o measure.
- service crea el servicio si no existe y title contiene su nombre.
- field añade una pregunta, item añade un concepto al servicio, rule añade una regla y
  measure añade una medida calculada.
- Las filas se fusionan por code y no borran elementos existentes.
- Desde el Diseñador se puede exportar el servicio completo con el orden de las preguntas,
  opciones, límites, ejemplos, catálogo, reglas, medidas y metadatos.
- La importación mantiene la fusión segura por defecto. El backoffice ofrece un modo
  explícito de reemplazo para que también se eliminen los elementos que no estén en el CSV.
- Las definiciones de rule y measure deben ser JSON válido.
- Un field de tipo choice puede incluir depends_on como JSON con field y options_by_value
  para que sus opciones dependan de una respuesta anterior. Por ejemplo, material puede
  ofrecer opciones distintas según bag_type. El Diseñador permite configurarlo sin escribir
  el JSON.
- Una dependencia no es una regla de precio. Sirve para filtrar las opciones que verá el
  cliente y para impedir combinaciones incompatibles. La pregunta controladora debe ser
  anterior y también debe ser de tipo choice.
- Ejemplo: bag_type puede tener mochila, tote bag y saco; bag_material puede depender de
  bag_type. tote bag admite algodón, hilo y lana; mochila admite poliéster y algodón; saco
  admite rafia y algodón.
- En el Diseñador, abre la pregunta de material, busca Opciones dependientes, selecciona
  Depende de → Tipo de bolsa y escribe las opciones válidas separadas por comas para cada
  respuesta. Guarda la pregunta. No hace falta crear una regla determinista para filtrar.
- En un CSV de patrón de servicio, la columna depends_on contiene un JSON como:
  {"field":"bag_type","options_by_value":{"tote bag":["algodón","hilo","lana"],"mochila":["poliéster","algodón"],"saco":["rafia","algodón"]}}
- La columna options del field dependiente debe contener la unión de todas las opciones.
  El backend entrega al chat solo las opciones correspondientes a la respuesta anterior y
  rechaza una opción incompatible escrita manualmente.
- Las reglas kind formula, unit_price, surcharge, factor y minimum siguen siendo necesarias
  aparte cuando la combinación válida debe cambiar el precio o añadir una línea de catálogo.

Regla de cálculo:
- Gemini interpreta la petición y formula preguntas.
- El motor determinista calcula los importes a partir del catálogo y las reglas.
- No se deben inventar precios dentro del chatbot.

Cómo resolver dudas:
- Para crear un servicio: ir al Wizard, paso Oferta y servicios.
- Para editar preguntas, catálogo o reglas: abrir Diseñador de servicios y pulsar Diseñar.
- Para cargar datos generales: abrir Servicios y fichas, Base de conocimiento.
- Para consultar ejemplos: abrir el menú Documentación.

Guía de Servicios:
- Un servicio representa una línea de trabajo que el tenant quiere presupuestar.
- Para crear uno: abrir Wizard, paso Oferta y servicios, pulsar Nuevo servicio, escribir
  nombre y descripción y guardar. El slug se genera automáticamente.
- Para diseñarlo: localizarlo en la lista y pulsar Diseñar. El diseñador contiene Preguntas,
  Catálogo, Reglas y Medidas.
- En Preguntas se añaden Texto, Número, Opción, Sí/No o Imagen. En una reforma de baño son
  ejemplos Tipo de reforma, Superficie del suelo, Material del suelo y Retirada de azulejos.
- Las preguntas de tipo Opción pueden ser dependientes. Por ejemplo, después de preguntar
  Tipo de bolsa, la pregunta Material puede mostrar algodón, hilo y lana para una tote bag,
  poliéster y algodón para una mochila, o rafia y algodón para un saco.
- En Catálogo se añaden materiales, productos, mano de obra y extras con unidad y precio base.
- En Reglas se configuran mínimos, descuentos, recargos y fórmulas deterministas. Ejemplo:
  floor_material_by_area calcula superficie_suelo por precio del material de suelo.
- Cada bloque tiene su propio botón Guardar y la pantalla permanece abierta para continuar.
- También se puede importar un patrón CSV desde Base de conocimiento. Usa record_type=field
  para preguntas, item para conceptos, rule para reglas y measure para medidas. service_slug
  identifica el servicio y code identifica cada bloque; las filas se fusionan por code.
- Ejemplo de reforma de baño: preguntas de superficie y material, conceptos de baldosa a 22
  EUR por m², mano de obra a 32 EUR por hora y retirada de azulejos a 12 EUR por m².
""".strip()
