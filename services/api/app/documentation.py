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
- En Empresa, Ciudad de referencia es el punto de partida para comprobar la cobertura y
  Radio de acción (km) define la distancia máxima que se quiere atender. Las instalaciones
  existentes parten de 100 km y el tenant puede cambiar ese valor.
- Servicios y fichas es el grupo del menú. El Diseñador de servicios permite editar un
  servicio por su identificador y contiene Preguntas, Catálogo, Reglas y Medidas.
- Base de conocimiento contiene contexto del negocio para Gemini: productos, categorías,
  patrones comerciales, políticas, FAQ y documentación.
- Las preguntas, las asociaciones de productos a un servicio y las reglas que calculan
  importes se configuran en el Diseñador. Los productos se gestionan aparte desde el menú
  Productos y pueden reutilizarse en varios servicios.
- Productos es el catálogo reutilizable del tenant. Su ruta es `/products` en el backoffice.
  Desde ahí se pueden crear, editar, filtrar y archivar productos sin abrir ningún patrón.
- Cada producto tiene un SKU único, nombre, descripción, ruta jerárquica de categorías, marca,
  modelo, material, gramaje, colores, tallas, imagen opcional, unidad, precio base y moneda.
  La ruta de categorías se escribe separando niveles con `>`, por ejemplo `Imprenta > Textil
  personalizado > Camisetas`.
- Para la POC, las imágenes de producto se cargan mediante el botón de subida del producto y
  se sirven desde un directorio de archivos del servidor. Si un producto no tiene imagen, el
  catálogo y la galería muestran `noimage.png`. En producción está previsto alojarlas en el
  hosting de IONOS bajo el dominio `horekia.com`, sin cambiar la asociación del producto con
  su SKU.
- El catálogo es agnóstico: no hay campos exclusivos para imprentas, reformas o talleres.
  Los datos sectoriales se guardan como atributos del producto y más adelante podrán llegar
  desde el ERP del tenant mediante el SKU.

CSV de conocimiento:
- La importación general admite kind: product, category, sales_pattern, policy, faq,
  document y other.
- Columnas habituales: kind, title, content, code, category, unit, base_price, currency.
- product con base_price alimentaba el catálogo general en la primera POC. Para el flujo actual,
  los productos se crean desde Productos; la importación de patrón solo conserva sus SKU.
- sales_pattern aporta contexto, pero no crea preguntas ni reglas deterministas.

CSV de patrón de servicio:
- Se importa desde Base de conocimiento con el bloque Importar patrón de servicio.
- Columnas: service_slug, record_type, order, code, title, content, type, options, required,
  unit, min, max, example, base_price, currency, priority, rule_kind, definition,
  expression, metadata, depends_on, visible_when, product_options y color_config.
- record_type puede ser service, field, item, rule o measure. Los productos no se incluyen en
  el patrón: se crean en Productos y quedan disponibles para asociarlos por SKU.
- service crea el servicio si no existe y title contiene su nombre.
- La fila service puede incluir metadata como {"sector_pack":"imprenta"} para asignar el
  servicio a un tipo de servicio existente. Los tipos de servicio son categorías superiores
  tenant-scoped y se pueden crear desde el Diseñador.
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
- product_options permite asociar modelos concretos a las opciones de una pregunta de tipo
  choice. En el Diseñador se selecciona categoría, producto y `Asignar`; su valor se guarda
  como JSON, por ejemplo {"camiseta manga corta":["gildan-5000","stanley-stella-creator"]}.
  El cliente ve una galería de productos al elegir la opción y el presupuesto conserva el SKU.
- Procedimiento para asociar productos a una pregunta: abre Diseñador de servicios, entra en
  el servicio, abre una pregunta de tipo Opción y localiza `Productos disponibles por opción`.
  En cada opción de `Opciones posibles`, selecciona primero una categoría, después un producto
  y pulsa `Asignar`. Repite la operación para añadir más modelos. Los productos asignados
  aparecen debajo y se pueden quitar individualmente. Guarda la pregunta cuando termines.
- Si una opción no tiene productos asociados, el chat puede mostrar la opción sin galería.
  Si tiene productos asociados, el cliente debe escoger uno de los modelos disponibles y el
  SKU se conserva en la solicitud para que las reglas usen el precio correcto.
- Los conceptos facturables del patrón siguen siendo distintos: materiales, mano de obra,
  extras y recargos específicos del servicio se mantienen como `item` dentro del patrón.
  Un producto reutilizable no debe duplicarse como `item` en cada servicio.
- El menú Productos permite crear, editar, filtrar y archivar productos del tenant. Cada uno
  puede incluir catalog_product con category_path, brand, model, material, grammage_g, colors,
  sizes e image_url. Esta estructura es agnóstica y permite sustituir la carga manual por una
  futura sincronización con el ERP del tenant.
- visible_when permite mostrar y preguntar un field solo cuando se cumple una condición.
  Ejemplo: {"field":"format_type","equals":"Personalizado"} hace que custom_dimensions
  solo aparezca después de elegir Personalizado. La pregunta debe ser obligatoria si se
  necesita para completar el presupuesto.
- Para pedir un color, usa un field de tipo `color` y configura `color_config` en el Diseñador.
  Puedes elegir el origen entre colores del producto, paleta del negocio, producto + paleta o
  código libre, y habilitar RAL, NCS, Pantone, HEX, RGB o CMYK. El frontend muestra una tabla
  visual con buscador y, si `allow_custom` está activo, permite introducir un nombre o código
  personalizado. La respuesta se guarda estructurada con `name`, `system`, `code`, `hex`, `rgb`
  o `cmyk`; Gemini no debe inventar códigos. En el CSV, `color_config` contiene este JSON.
- Las reglas kind formula, unit_price, surcharge, factor y minimum siguen siendo necesarias
  aparte cuando la combinación válida debe cambiar el precio o añadir una línea de catálogo.
- Si el cliente describe una necesidad que contradice una opción seleccionada, por ejemplo
  pintar una cerca y escoger pintura para suelos, el chatbot debe pedir confirmación antes de
  continuar. No debe aceptar silenciosamente esa combinación ni calcular el presupuesto con ella.
- Las horas introducidas por el cliente son siempre una estimación: el chatbot debe confirmarlas
  como referencia y advertir que se revisarán técnicamente. El presupuesto es orientativo y el
  alcance, las horas o el importe final pueden variar después del estudio de viabilidad y del
  contrato.

Regla de cálculo:
- Gemini interpreta la petición y formula preguntas.
- El motor determinista calcula los importes a partir del catálogo y las reglas.
- No se deben inventar precios dentro del chatbot.
- El chatbot público funciona de forma conversacional cuando Gemini está activo: el cliente puede
  explicar libremente su necesidad y Gemini usa el patrón, el catálogo y la base de conocimiento
  para entenderla, recomendar opciones y decidir qué dato falta. Los patrones no desaparecen:
  definen los datos válidos, las preguntas obligatorias y las condiciones que el servidor valida.
- Gemini nunca tiene autoridad para fijar precios ni calcular importes. El servidor acepta solo
  valores compatibles con el patrón y el motor determinista crea el presupuesto cuando los datos
  obligatorios y la cobertura están completos. Si Gemini no responde, el chatbot conserva un
  recorrido de respaldo basado en las preguntas del patrón.

Cómo resolver dudas:
- Para crear un servicio: ir al Wizard, paso Oferta y servicios.
- Para configurar la cobertura: abrir Empresa, completar Ciudad de referencia y Radio de
  acción (km), y pulsar Guardar datos de empresa. La ubicación se comprueba antes de las
  demás preguntas del presupuesto con un cálculo determinista; Gemini solo ayuda a
  normalizar una ciudad o código postal que no se reconoce localmente.
- Para editar preguntas, catálogo o reglas: abrir Diseñador de servicios y pulsar Diseñar.
- Para crear o mantener productos reutilizables: abrir Servicios y fichas, Productos. Después,
  desde una pregunta de tipo Opción, asociarlos en Productos disponibles por opción.
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
- Para pintura, ventanas, bolsas o textil, añade una pregunta de tipo Color. El cliente verá una
  paleta visual en el chat, podrá buscar por nombre o código y escoger un color personalizado si
  el negocio lo permite. La selección no calcula por sí sola: el precio debe venir del producto,
  del catálogo o de una regla determinista.
- Las preguntas de tipo Opción pueden ser dependientes. Por ejemplo, después de preguntar
  Tipo de bolsa, la pregunta Material puede mostrar algodón, hilo y lana para una tote bag,
  poliéster y algodón para una mochila, o rafia y algodón para un saco.
- En Catálogo se añaden materiales, productos, mano de obra y extras con unidad y precio base.
- En Reglas se configuran mínimos, descuentos, recargos y fórmulas deterministas. Ejemplo:
  floor_material_by_area calcula superficie_suelo por precio del material de suelo.
- En Pintura exterior, la opción `Cercas, barandillas, rejas y vallas metálicas` usa el producto
  de esmalte para metal y pregunta los metros lineales. No debe asociarse con los productos de
  pintura epoxi o clorocaucho para suelos.
- Cada bloque tiene su propio botón Guardar y la pantalla permanece abierta para continuar.
- También se puede importar un patrón CSV desde Base de conocimiento. Usa record_type=field
  para preguntas, item para conceptos, rule para reglas y measure para medidas. service_slug
  identifica el servicio y code identifica cada bloque; las filas se fusionan por code.
- Ejemplo de reforma de baño: preguntas de superficie y material, conceptos de baldosa a 22
  EUR por m², mano de obra a 32 EUR por hora y retirada de azulejos a 12 EUR por m².
""".strip()
