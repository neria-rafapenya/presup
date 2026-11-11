# Plan de Fase 1 — Base y modelo de datos

## Objetivo

Entregar monorepo, base FastAPI, esquemas y migraciones reproducibles para una empresa por instalación, con aislamiento verificable.

## Secuencia

Requisitos comprobados al incorporar la preparación: crear y registrar la rama de fase desde una sesión con escritura en `.git`, arrancar el daemon de Docker e instalar o habilitar Supabase CLI. Actualmente no hay aplicación ni migraciones; la validación local de Supabase no se puede ejecutar todavía. No sustituir estas comprobaciones por operaciones sobre una base remota.

1. Usar el contrato de configuración creado en Fase 0 y completar los valores Supabase cuando se vaya a validar la conexión. Fijar versiones compatibles de Python y Node/Expo y documentar herramientas requeridas. No introducir variables sin avisar y solicitar su incorporación cuando sean necesarias.
2. Crear apps/backoffice y apps/chat con Expo; services/api con FastAPI; packages/shared con JSON Schema; directorios supabase, infra y docs. Configurar yarn y archivos de bloqueo.
3. Añadir healthcheck local sin revelar configuración; scripts de arranque y validación de configuración al inicio. Instalar únicamente las dependencias necesarias para el stack autorizado.
4. Definir fichas, reglas, procedencia de valores y representación monetaria. Diseñar orden de reglas y versiones de configuración, sin implementar todavía el motor.
5. Crear migraciones por dependencias: empresa y miembros; configuración y catálogo; peticiones y conversaciones; presupuestos e historial; importaciones, correcciones, consumo y recuperación.
6. Añadir RLS por empresa y rol; evitar claves foráneas que permitan cruces de tenant; políticas de Storage. Acceso público de chat mediante backend, sin lectura anónima general de tablas.
7. Preparar datos ficticios mínimos y pruebas de aislamiento. No cargar tarifas reales ni activar Gemini.
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
