# Horekia — Roadmap de producto y desarrollo

Fecha: 11 de noviembre de 2026.
Estado: Fase 1 en implementación; migraciones y servicios aún pendientes de validación local.
Base: PROMPT_CODEX_presup.md, ajustado a las decisiones confirmadas en esta conversación.

## 1. Producto y modelo de entrega

Horekia permite que una empresa configure su negocio y ofrezca a sus clientes un asistente para solicitar presupuestos. Es generalista: productos, servicios, formularios de petición y reglas de cálculo se configuran como datos.

Se entrega como instalación llave en mano en los servidores del cliente. Cada instalación comienza con la empresa cliente y sus usuarios. El backoffice pertenece a esa empresa y permite gestionar su actividad, configuración, equipo, peticiones y presupuestos.

No forma parte del alcance un centro de administración de empresas clientes, un panel superadministrador del proveedor ni una plataforma de suscripciones SaaS. Se conserva tenant_id y aislamiento por RLS como base técnica del modelo original; esto no añade una interfaz de gestión de tenants ni habilita otras empresas en una instalación por defecto.

La aplicación y su API se desplegarán en la infraestructura del cliente. Supabase y Gemini son dependencias externas previstas en el documento; no debe describirse la solución como completamente alojada en sus servidores. Si un cliente requiere base de datos e IA dentro de su infraestructura, se deberá definir ese alcance por separado.

## 2. Decisiones confirmadas

| Área | Decisión |
| --- | --- |
| Producto | Horekia |
| Repositorio | https://github.com/neria-rafapenya/presup.git |
| Directorio de trabajo | /Users/rafa_penya/presup |
| Backend | Python con FastAPI |
| Interfaces | Expo + React Native Web, backoffice y chat separados |
| Datos, acceso y archivos | Supabase: PostgreSQL, Auth y Storage; pgvector para recuperación |
| IA | Adaptador Gemini, modelos configurables; simulación en desarrollo y pruebas |
| Despliegue objetivo | Docker Compose y Caddy con HTTPS en servidores del cliente |
| Infraestructura declarativa | Terraform solo para recursos verificables y gestionables |
| Idiomas | Español inicial; estructura preparada para catalán |
| Gestión del desarrollo | Una rama y commits pequeños por fase; validación al cerrar cada fase |

El nombre presup se mantiene para el repositorio y la estructura de código; Horekia es el nombre del producto. Las credenciales existentes se inspeccionarán sin mostrar valores. No se crean recursos remotos ni se consumen APIs reales por el hecho de aprobar este roadmap.

## 3. Principios funcionales

- La IA clasifica, extrae datos, detecta carencias y redacta preguntas. El motor determinista calcula todos los importes.
- El tenant configura mediante formularios y un asistente de puesta en marcha; las plantillas de prompt pertenecen al producto.
- Las propuestas de IA requieren confirmación antes de convertirse en configuración activa.
- Los campos interpretados, los valores por defecto y los datos deducidos de imágenes muestran su procedencia y quedan sujetos a revisión.
- Los paquetes de sector son plantillas opcionales. Añadir un negocio compatible con los modelos de precio existentes no exige modificar el motor.
- La revisión humana estará activada inicialmente. Las políticas determinan qué puede ver el cliente final.
- Los cambios de tarifas y reglas no deben alterar presupuestos anteriores: cada cálculo conservará los datos y versiones utilizados.

## 4. Fases y criterios de cierre

### Fase 0 — Preparación y decisiones

Objetivo: convertir el repositorio en un punto de partida seguro y reproducible.

Entregables:
- Inspección del repositorio, instrucciones locales y estado de Git antes de modificar archivos.
- Inspección de nombres de variables del .env, sin revelar secretos ni sobrescribirlo.
- DECISIONES.md con FastAPI, modelo llave en mano, alcance del backoffice y dependencias externas.
- .env.example sin valores, exclusión de secretos y documentación de requisitos locales.
- Plan concreto de Fase 1 con comandos de validación.

Cierre: decisiones documentadas y dependencias identificadas; cualquier acceso o variable imprescindible que falte queda señalado antes del trabajo que lo necesite.

### Fase 1 — Monorepo, datos y aislamiento

Objetivo: disponer de la estructura base y de migraciones reproducibles.

Entregables:
- apps/backoffice, apps/chat, services/api, packages/shared, supabase, infra y docs.
- Base FastAPI, comprobación de salud y scripts locales; uso de yarn para los paquetes frontend.
- Esquemas compartidos de fichas, reglas y presupuestos.
- Migraciones de empresa, usuarios y roles, configuración, paquetes, tipos de trabajo, fichas, partidas, variables, medidas, reglas, vocabulario, políticas y FAQs.
- Migraciones de clientes, consentimientos, peticiones, mensajes, adjuntos, presupuestos, líneas, eventos, correcciones, importaciones, embeddings y consumo.
- RLS y relaciones que impidan referencias entre tenants; políticas de Storage y acceso privado a adjuntos.
- Documentación del modelo y procedimiento para inicializar una única empresa por instalación.

Cierre: migraciones desde cero y pruebas de aislamiento con dos empresas ficticias, incluidos intentos de escritura cruzada. Las dos empresas son datos de prueba, no un panel de producto.

### Fase 2 — Motor determinista de presupuestos

Objetivo: calcular sin depender de IA.

Entregables:
- Modelos catálogo, configurable y proyecto.
- Reglas de tramos, factores, precio unitario, fórmulas, condiciones, recargos, mínimos, márgenes y costes fijos.
- Fórmulas mediante operaciones permitidas, sin ejecución arbitraria de código.
- Aritmética decimal, moneda, IVA configurable, orden de aplicación y política explícita de redondeo.
- Líneas, desglose explicable, supuestos y fotografía de la configuración utilizada.

Cierre: casos ficticios del documento: imprenta 212,22 € antes de IVA; reforma subtotal 3.751,00 € y total con imprevistos 4.126,10 € antes de IVA. Pruebas adicionales para límites de tramos, entradas inválidas y redondeo.

### Fase 3 — API y permisos

Objetivo: exponer configuración, conversaciones y revisión con contratos estables.

Entregables:
- Validación de JWT Supabase y permisos owner, editor y revisor vinculados a la empresa autenticada.
- Operaciones de configuración, peticiones, adjuntos, cálculo y revisión.
- Acceso público al chat con identificador de empresa y sesión de conversación limitada; el identificador público no se trata como secreto.
- Autorización de cada conversación y adjunto, límites de uso y dominios permitidos; CORS no sustituye autenticación ni control de abuso.
- OpenAPI y pruebas de integración con IA simulada.

Cierre: flujo autenticado completo y rechazo de accesos ajenos o acciones sin permisos.

### Fase 4 — Asistente guiado por configuración

Objetivo: completar la ficha necesaria para presupuestar.

Entregables:
- Adaptadores simulado y Gemini con salida estructurada validada, visión y embeddings configurables.
- Clasificación, recuperación de contexto de la empresa, extracción, normalización y detección de datos pendientes.
- Preguntas derivadas de la ficha, con un máximo de dos a cuatro por mensaje y opciones cerradas donde proceda.
- Procedencia de cada interpretación, consentimiento, contacto y derivación a persona.
- Políticas aplicadas por el backend y presentación de importes exclusivamente desde el motor.
- Auditoría del pipeline, consumo, caché, reintentos acotados y modo alternativo sin IA al alcanzar límites.
- Correcciones humanas reutilizables como vocabulario o ejemplos confirmados; no se promete entrenamiento automático del modelo.

Cierre: escenarios de bolsas personalizadas y reforma en modo simulado; verificación con IA real cuando haya credenciales y cuota disponibles. Sin importes generados por el LLM ni exposición de contexto de otra empresa.

### Fase 5 — Backoffice del cliente y puesta en marcha

Objetivo: que la empresa configure y opere Horekia sin asistencia técnica habitual.

Entregables:
- Acceso, empresa, usuarios y roles dentro de la instalación.
- Wizard reanudable: empresa, negocio, oferta, tarifas, reglas, fichas, asistente, simulación y canales.
- Edición manual completa de configuración; las propuestas de IA se muestran antes de guardar.
- Bandeja, revisión de conversación y adjuntos, campos interpretados, edición de líneas y aprobación.
- Pantallas de configuración, importaciones, consumo y métricas operativas.

Cierre: una empresa configura un negocio ficticio, prueba el chat y revisa un presupuesto desde su backoffice. Sin listado de clientes del proveedor ni selector de tenants.

### Fase 6 — Chat público y embebible

Objetivo: recibir peticiones desde una página pública o desde la web del cliente.

Entregables:
- Página propia y cargador embebible mediante iframe.
- Identidad visual, mensajes, idiomas, botones, imágenes y PDF, reanudación segura y resumen.
- Contacto, consentimiento y enlace a la política de privacidad de la empresa.
- Límites de archivos, mensajes y frecuencia, más mecanismo antibots configurable.
- Interfaz accesible y adaptada a móvil.

Cierre: ambos escenarios de referencia completan el flujo desde una web HTML de prueba, respetando políticas de visibilidad de precios.

### Fase 7 — Plantillas, importaciones e integración

Objetivo: reducir el esfuerzo de configuración y reutilizar datos existentes.

Entregables:
- Paquetes opcionales de imprenta, textil personalizado, reformas y distribuidor; precios claramente ficticios.
- CSV/Excel e históricos con validación, mapeo confirmado, vista previa, registro y reversión.
- Importación documental asistida sujeta a revisión y límites de formato.
- Contrato genérico de ERP y adaptadores de archivos programados y REST configurable.
- Protección de credenciales y validación de destinos de conectores.
- Actualización de embeddings después de importaciones confirmadas.

Cierre: una importación alimenta fichas y cálculo; un adaptador de prueba demuestra lectura y escritura previstas. No se incluye integración con un ERP concreto sin especificación.

### Fase 8 — PDF, envío y seguimiento

Objetivo: cerrar el ciclo comercial del presupuesto aprobado.

Entregables:
- PDF con identidad, importes, condiciones, validez y supuestos de la empresa.
- Envío SMTP configurable tras aprobación, con estado de envío verificable.
- Enlaces de aceptación y rechazo limitados al presupuesto y con caducidad.
- Recordatorios configurables, avisos y eventos; prevención de envíos duplicados.

Cierre: aprobación, envío de prueba, aceptación o rechazo y actualización de la bandeja. La aceptación comercial no se presenta como firma electrónica certificada.

### Fase 9 — Instalación llave en mano

Objetivo: entregar una instalación repetible en la infraestructura del cliente.

Entregables:
- Imágenes Docker de API, backoffice y chat; Docker Compose y ejemplo Caddy.
- Configuración por instalación, dominios, HTTPS y gestión de secretos.
- Scripts de migración, inicialización de empresa y carga opcional de paquetes.
- Guía de instalación, actualización, reversión, copias y restauración, incluyendo Supabase y Storage.
- Inventario de cuentas, servicios externos y costes a cargo del cliente; límites de IA.
- Terraform solo cuando las capacidades y credenciales se hayan verificado; pasos manuales para el resto.

Cierre: instalación limpia y prueba de restauración documentadas. Servidor, dominios y cuentas se concretan antes del despliegue real.

### Fase 10 — Validación y entrega

Objetivo: demostrar el producto completo y dejarlo operable por el cliente.

Entregables:
- Pruebas de motor, pipeline simulado, API, permisos y flujo completo.
- Demostraciones independientes con negocios ficticios de textil y reformas.
- Manual de empresa, arquitectura, modelo, prompts, despliegue y limitaciones conocidas.
- Procedimientos de exportación y borrado de datos del cliente final, conservación y consentimiento.
- Lista de entrega con código, configuración, accesos, operación y alcance de soporte según lo pactado.

Cierre: demostración de extremo a extremo, verificaciones superadas y aceptación de la instalación entregada.

## 5. Hitos y secuencia

| Hito | Fases | Resultado verificable |
| --- | --- | --- |
| Base técnica | 0–3 | Datos aislados, cálculo reproducible y API |
| Demostración funcional | 4–6 | Empresa configurable y chat que genera peticiones revisables |
| Operativa comercial | 7–8 | Importación, integración genérica, PDF y seguimiento |
| Entrega llave en mano | 9–10 | Instalación reproducible, validada y documentada |

Las fases conservan el orden del documento original. Los esquemas y datos mínimos ficticios necesarios para probar motor y pipeline se preparan antes de los paquetes completos de Fase 7. Del mismo modo, Fase 3 define los contratos de PDF y envío; su implementación se completa en Fase 8. Las pruebas y la documentación se mantienen durante todas las fases.

No se fijan fechas ni costes sin conocer el estado real del repositorio y el entorno. Al cerrar cada fase se actualizarán avance, pendientes y siguiente alcance, y se esperará validación antes de iniciar la siguiente.

## 6. Decisiones diferidas, sin bloquear el roadmap

- Comprobar repositorio, .env y cualquier DECISIONES.md existente durante Fase 0.
- Confirmar con la empresa el alcance de catálogos, tarifas, impuestos, políticas y formatos reales antes de cargar datos de producción.
- Elegir modelos y dimensión de embeddings de forma coherente con pgvector antes de activarlos.
- Confirmar cuentas Supabase/Gemini, SMTP, servidor, dominios, conservación de datos y responsabilidades operativas cuando corresponda.
- Revisar las condiciones y límites vigentes de los servicios externos al integrarlos; la capa gratuita de la POC no garantiza operación gratuita en producción.
- Cualquier ampliación fuera de este alcance se documenta antes de implementarse.

La preparación de Fase 0 está incorporada al repositorio de trabajo; su comprobación actual y los requisitos pendientes para Fase 1 se documentan en [fase-0.md](fase-0.md). Todavía no hay aplicación ejecutable, migraciones ni infraestructura desplegada.
