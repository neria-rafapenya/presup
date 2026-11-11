# Plan de Fase 1 — Base y modelo de datos

## Objetivo

Entregar monorepo, base FastAPI, esquemas y migraciones reproducibles para una empresa por instalación, con aislamiento verificable.

## Secuencia

Requisitos comprobados al incorporar la preparación: la rama `fase-0/preparacion` quedó registrada en `37b1150` y la rama de trabajo `fase-1/base` ya existe. Por decisión operativa no se usa Docker ni Supabase local en este macOS. Supabase CLI 3.1.0 está disponible para tareas controladas, pero la validación de migraciones se hará en CI o en una base desechable explícitamente autorizada; no se usará una base remota de producción.

1. Usar el contrato de configuración creado en Fase 0, con Supabase y Gemini reales configurables. Fijar versiones compatibles de Python y Node/Expo y documentar herramientas requeridas. No introducir variables sin avisar y solicitar su incorporación cuando sean necesarias.
2. Crear apps/backoffice y apps/chat con Expo; services/api con FastAPI; packages/shared con JSON Schema; directorios supabase, infra y docs. Configurar yarn y archivos de bloqueo.
3. Añadir healthcheck local sin revelar configuración; scripts de arranque y validación de configuración al inicio. Instalar únicamente las dependencias necesarias para el stack autorizado.
4. Definir fichas, reglas, procedencia de valores y representación monetaria. Diseñar orden de reglas y versiones de configuración, sin implementar todavía el motor.
5. Crear migraciones por dependencias: empresa y miembros; configuración y catálogo; peticiones y conversaciones; presupuestos e historial; importaciones, correcciones, consumo y recuperación.
6. Añadir RLS por empresa y rol; evitar claves foráneas que permitan cruces de tenant. En la base compartida, no modificar `storage.*` sin autorización separada. Acceso público de chat mediante backend, sin lectura anónima general de tablas.
7. Preparar datos ficticios mínimos y pruebas de aislamiento en una base Supabase autorizada. No cargar tarifas reales; Gemini se activa para los flujos que ya tengan adaptador y contrato verificable.
8. Documentar tablas, relaciones, inicialización de una única empresa y comandos exactos de validación. Actualizar README.

## Modelo mínimo

tenants, tenant_users, tenant_settings, sector_packs, job_types, intake_schemas, items, item_variables, price_rules, computed_measures, vocabulary, policies, faqs, customers, consents, requests, messages, attachments, quotes, quote_lines, quote_events, corrections, embeddings, imports, usage_limits y usage_log.

sector_packs es global. Las tablas de negocio incorporan tenant_id. pgvector debe mantener coherencia con la dimensión del modelo de embeddings seleccionado; esa decisión se documenta antes de aplicar la migración correspondiente.

## Validación prevista

- Migrar una base desechable desde cero y comprobar repetibilidad del procedimiento.
- Verificar lecturas y escrituras de dos tenants ficticios mediante identidades reales de prueba y JWT, sin usar credenciales que omitan RLS para esas comprobaciones.
- Rechazar referencias cruzadas y acciones incompatibles con los roles owner, editor y revisor.
- Verificar adjuntos privados y denegación de acceso anónimo a datos de negocio.
- Arrancar API y ambas aplicaciones; comprobar salud, tipado y build.
- Comprobar que .env y secretos no aparecen en archivos versionados.

Los comandos ejecutables se añadirán con la implementación; este plan no afirma que exista código ni tests que ya hayan pasado.

## Cierre

Resumen de cambios, comandos probados, resultados de aislamiento, criterios pendientes y validación del usuario antes de iniciar Fase 2.

## Estado de esta implementación

La estructura y los contratos de Fase 1 están implementados en `fase-1/base`. La API y el bundle Web de backoffice arrancan y responden localmente sin Docker. Las migraciones se aplicaron a la base POC existente usando exclusivamente el espacio de nombres `horekia_*`; la prueba RLS con dos identidades de aplicación pasó. El detalle y los comandos reproducibles están en [fase-1.md](fase-1.md) y [modelo-datos-fase-1.md](modelo-datos-fase-1.md). Supabase Auth y Storage compartido quedan fuera de esta POC; Gemini queda configurado para uso real y se incorporará a los flujos que lo necesiten.

El Wizard de onboarding pertenece al alcance de la Fase 5 de producto. La POC actual ya muestra el flujo básico y lo recuerda en el navegador; la detección y persistencia del estado por tenant, junto con el flujo completo de pasos, quedan para la implementación de producto.
