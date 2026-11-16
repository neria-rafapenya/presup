# Modelo de datos de Fase 1

Las migraciones de `supabase/migrations` están ordenadas por dependencias: extensiones y empresa, configuración y catálogo, peticiones y conversación, presupuestos y operaciones, RLS y, desde `0006`, conocimiento del negocio. En la base compartida no se modifican las tablas `storage.*` de Supabase.

Todas las tablas propias llevan el prefijo `horekia_` y las tablas de negocio llevan `tenant_id`. Las relaciones entre tablas de negocio usan claves foráneas compuestas `(tenant_id, id)` para impedir que una fila de una empresa apunte a una fila de otra. `horekia_sector_packs` es global dentro del espacio de nombres de Horekia y no contiene datos operativos de una empresa.

## Configuración y cálculo

- `tenant_settings` conserva moneda, IVA, revisión humana y versión de configuración.
- `job_types`, `intake_schemas`, `items`, `item_variables`, `price_rules` y `computed_measures` representan la ficha y las reglas; el motor determinista se implementará en Fase 2.
- `vocabulary`, `policies` y `faqs` guardan normalización y contenido revisable.
- `knowledge_entries` es la base de conocimiento del tenant. Sus tipos incluyen `product`, `category`, `sales_pattern`, `policy`, `faq` y `document`; puede alimentarse manualmente o mediante CSV.
- El catálogo reutilizable de productos se mantiene en `items` con `job_type_id` nulo y metadata `catalog_product`. Los conceptos facturables propios de un servicio mantienen `job_type_id`. El patrón guarda únicamente los SKU asociados en `product_options`.
- `tenant_profiles` conserva los datos que el tenant quiere mostrar o usar en sus presupuestos: nombre comercial y razón social, identificación fiscal, persona y cargo de contacto, correos, dirección, disclaimers, garantía, tipo de documento y referencia a la plantilla PDF.
- `customers` conserva los datos de contacto del solicitante. La migración `0008` añade el alta mínima de cuenta (`account_password_hash`, fechas de alta y último acceso) y `customer_sessions` guarda sesiones opacas con caducidad; este acceso de cliente es propio de la POC y no usa Supabase Auth.
- `quote_deliveries` registra el proveedor, destinatario, estado, intentos e identificador de Resend de cada envío. Su clave única por presupuesto y destinatario evita enviar el mismo documento dos veces.
- `tenant_documents` guarda temporalmente las plantillas PDF en la POC. La futura migración a Storage privado mantendrá la misma autorización por tenant.
- Un patrón de servicio combina `job_types`, un `intake_schema` versionado, `items`, `price_rules` y `computed_measures`. Esta composición permite modelar bolsas impresas, reformas o reparaciones sin crear tablas específicas por sector.
- Los importes se almacenan en `numeric`, nunca en `float`; los presupuestos guardan `configuration_snapshot` y `calculation_snapshot` para no cambiar históricos.
- `embeddings.embedding` usa `vector(768)`. Las entradas y los productos podrán generar embeddings con el modelo Gemini configurado para recuperar contexto por tenant; los importes seguirán saliendo de datos y reglas deterministas.

## Acceso

`horekia_app.is_tenant_member` y `horekia_app.has_tenant_role` consultan la membresía del `sub` en `request.jwt.claim.sub`. RLS permite lectura a miembros activos, escritura de configuración a owner/editor y revisión operativa a reviewer mediante políticas específicas. El acceso público al chat no lee tablas directamente: se añadirá en Fase 3 mediante backend y sesiones limitadas.

`horekia_attachments` guarda la relación con los archivos y su ruta, pero esta migración no crea buckets ni políticas en `storage.*` para no modificar tablas compartidas de Supabase. Esa integración se hará mediante una migración aislada tras autorización.

## Inicialización y validación

`supabase/seed.sql` crea dos empresas ficticias, configuración mínima y servicios de prueba. No crea usuarios de Auth ni tarifas reales. Para comprobar aislamiento hay que crear dos usuarios locales, asociar cada uno a una empresa como miembro activo y ejecutar `supabase/tests/rls_isolation.sql` con rol `authenticated`, nunca con `service_role`.

La validación de esta fase requiere:

```sh
supabase start
supabase db reset
supabase test db
```

Estos comandos no se ejecutarán en este Mac local por decisión operativa. Deben ejecutarse en CI o en una base desechable explícitamente autorizada, con dos identidades reales de prueba y sin credenciales de producción.
