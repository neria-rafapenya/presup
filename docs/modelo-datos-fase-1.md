# Modelo de datos de Fase 1

Las migraciones de `supabase/migrations` están ordenadas por dependencias: extensiones y empresa, configuración y catálogo, peticiones y conversación, presupuestos y operaciones, y finalmente RLS/Storage.

Todas las tablas de negocio llevan `tenant_id`. Las relaciones entre tablas de negocio usan claves foráneas compuestas `(tenant_id, id)` para impedir que una fila de una empresa apunte a una fila de otra. `sector_packs` es global y no contiene datos operativos de una empresa.

## Configuración y cálculo

- `tenant_settings` conserva moneda, IVA, revisión humana y versión de configuración.
- `job_types`, `intake_schemas`, `items`, `item_variables`, `price_rules` y `computed_measures` representan la ficha y las reglas; el motor determinista se implementará en Fase 2.
- `vocabulary`, `policies` y `faqs` guardan normalización y contenido revisable.
- Los importes se almacenan en `numeric`, nunca en `float`; los presupuestos guardan `configuration_snapshot` y `calculation_snapshot` para no cambiar históricos.
- `embeddings.embedding` usa `vector(768)`. Es el contrato inicial documentado para el modelo de embeddings que se configure antes de activar IA real; con `AI_MOCK=true` no se generan vectores.

## Acceso

`app.is_tenant_member` y `app.has_tenant_role` consultan la membresía de `auth.uid()`. RLS permite lectura a miembros activos, escritura de configuración a owner/editor y revisión operativa a reviewer mediante políticas específicas. El acceso público al chat no lee tablas directamente: se añadirá en Fase 3 mediante backend y sesiones limitadas.

El bucket `attachments` es privado. La ruta debe comenzar por el UUID de tenant y Storage aplica la misma pertenencia y roles que las tablas.

## Inicialización y validación

`supabase/seed.sql` crea dos empresas ficticias, configuración mínima y servicios de prueba. No crea usuarios de Auth ni tarifas reales. Para comprobar aislamiento hay que crear dos usuarios locales, asociar cada uno a una empresa como miembro activo y ejecutar `supabase/tests/rls_isolation.sql` con rol `authenticated`, nunca con `service_role`.

La validación de esta fase requiere:

```sh
supabase start
supabase db reset
supabase test db
```

Estos comandos no se ejecutarán en este Mac local por decisión operativa. Deben ejecutarse en CI o en una base desechable explícitamente autorizada, con dos identidades reales de prueba y sin credenciales de producción.
