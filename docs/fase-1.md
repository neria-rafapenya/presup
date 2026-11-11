# Fase 1 — Base y modelo de datos

## Implementado en `fase-1/base`

- Monorepo Yarn 4 con apps separadas `backoffice` y `chat`, y paquete compartido. El trabajo activo se concentra ahora en `backoffice`.
- API FastAPI con `/healthz`, `/readyz` y validación segura de configuración.
- Contratos JSON Schema para fichas, reglas de precio y presupuestos.
- Migraciones Supabase ordenadas por dependencias para el modelo mínimo de Fase 1.
- Tablas propias con prefijo `horekia_`, claves foráneas compuestas con `tenant_id` y RLS por identidad de aplicación y rol.
- Datos ficticios mínimos para dos empresas y esqueleto de prueba de aislamiento.
- Compose de desarrollo para la API y matriz de versiones documentada.

## Matriz inicial

| Herramienta | Objetivo de Fase 1 | Estado observado |
| --- | --- | --- |
| Python | 3.13.x | 3.13.14 disponible |
| Node | 20 LTS | 25.2.1 activo; no adoptado como objetivo |
| Yarn | 4.14.1 | 4.14.1 disponible |
| Expo | SDK 54 | declarado en ambas apps; instalación pendiente |
| Docker | solo entrega/CI controlada | CLI 29.5.3; no se usa en este macOS |
| Supabase CLI | solo tareas controladas | no disponible en PATH; no se levanta Supabase local |

## Validación realizada

Se han comprobado sintaxis Python, JSON, contrato de variables, exclusión de secretos, instalación Yarn, typecheck Expo, configuración Compose, tests FastAPI, arranque de la API y bundle Web del backoffice. La API y el backoffice responden localmente sin Docker; la base usada para la POC es el proyecto Supabase real autorizado y contiene únicamente datos ficticios Horekia. No se usa Supabase Auth.

## Comandos de validación cuando el entorno esté disponible

Desde la raíz:

```sh
python3 scripts/validate_config.py
python3 -m compileall -q services/api scripts
yarn install
yarn typecheck
# En CI o en un entorno desechable autorizado:
supabase db reset
supabase test db
docker compose -f infra/docker-compose.yml config
docker compose -f infra/docker-compose.yml up --build api
```

Las credenciales no se versionan. El entorno de trabajo mantiene `AI_MOCK=false` y modelos Gemini configurados para uso real; el backoffice actual no realiza llamadas Gemini. No se usa Docker ni Supabase local en este macOS.

## Cierre

## Cierre verificado de la POC

Fase 1 queda cerrada para el alcance de esta POC:

- PostgreSQL existente conectado mediante `DATABASE_URL`.
- Cinco migraciones y seed aplicados exclusivamente en tablas `horekia_*`.
- 26 tablas Horekia creadas; no se modificaron tablas de negocio existentes.
- Dos identidades de aplicación asociadas a tenants distintos.
- Lecturas propias permitidas, lecturas cruzadas denegadas y escrituras cruzadas denegadas por RLS.
- API y backoffice Web arrancados y verificados por HTTP; chat queda fuera del foco de desarrollo actual.

Fuera del backoffice actual quedan Supabase Auth, Storage compartido, flujos de chat y el despliegue. Gemini está configurado para uso real, pero todavía no es invocado por estas pantallas.
