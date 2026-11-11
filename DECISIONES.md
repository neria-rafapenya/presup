# Decisiones de Horekia

Fecha: 2026-11-11. Fase 0.

Preparación incorporada y revisada en `/Users/rafa_penya/presup`. Se conserva el historial Git del destino y no se copia el `.git` de la preparación.

## Confirmadas

- Nombre comercial: Horekia. Repositorio: neria-rafapenya/presup.
- Entrega llave en mano en servidores del cliente.
- Backoffice para la empresa instalada: configuración, equipo, peticiones y presupuestos. Sin centro de tenants del proveedor ni superadministración comercial.
- tenant_id y RLS se conservan para aislamiento técnico. Una empresa inicial por instalación; dos empresas ficticias únicamente en pruebas de aislamiento.
- Backend Python con FastAPI.
- Frontends Expo y React Native Web, separados en backoffice y chat; paquetes frontend con yarn.
- Supabase PostgreSQL y pgvector; Storage queda externo y aislado; no se usa Supabase Auth. Migraciones SQL versionadas.
- Adaptador Gemini con modelos configurables y modo simulado para desarrollo y pruebas.
- La IA interpreta y pregunta; el motor determinista calcula. Revisión humana inicial.
- Docker Compose y Caddy como objetivo de instalación. Terraform solo para recursos verificables.
- Español inicial, estructura preparada para catalán.
- Una fase por rama, commits pequeños y validación al cerrar cada fase.
- No desplegar, crear servicios remotos ni consumir IA real durante la preparación.
- No usar Docker ni Supabase local en este macOS durante el desarrollo; Docker Compose queda como artefacto de entrega y validación en CI o en un entorno controlado.

## Pendientes y condición de resolución

- Rama de Fase 0 creada y registrada como `fase-0/preparacion`, commit `37b1150` (`docs: preparar Horekia y verificar fase 0`). La rama de trabajo de Fase 1 es `fase-1/base`.
- Validar migraciones y aislamiento en una base desechable de CI o en un entorno Supabase explícitamente autorizado. Supabase CLI 3.1.0 está instalado, pero no se usará para levantar contenedores en este equipo.

- El usuario confirma que no existe un .env previo y autoriza su creación. Se crean .env local y .env.example con el mismo contrato, credenciales vacías y AI_MOCK=true.
- Variables iniciales: AI_MOCK, SUPABASE_URL, DATABASE_URL, GEMINI_API_KEY, GEMINI_MODEL, GEMINI_EMBEDDING_MODEL y EXPO_PUBLIC_API_URL.
- DATABASE_URL es exclusivo del backend. Las operaciones ordinarias respetarán RLS usando la identidad de aplicación del JWT, sin depender de Supabase Auth.
- La carga automática de .env y la validación de estas variables se implementarán en Fase 1. Todavía no existe aplicación ejecutable.
- Completar DATABASE_URL al validar migraciones; Gemini no es necesario con AI_MOCK=true. SMTP se definirá en Fase 8.
- Seleccionar versiones compatibles de Python, Node y Expo al iniciar Fase 1; las versiones instaladas no se adoptan automáticamente como versiones objetivo.
- Confirmar modelos de texto, visión y embeddings mediante configuración; alinear dimensión de vectores antes de aplicar pgvector.
- Servidor, dominios, SMTP y cuentas de producción se resolverán en las fases correspondientes.

Supabase y Gemini son dependencias externas previstas. La entrega en servidores del cliente no implica que estos servicios estén autoalojados.
