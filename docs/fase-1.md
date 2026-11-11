# Fase 1 — Base y modelo de datos

## Implementado en `fase-1/base`

- Monorepo Yarn 4 con apps separadas `backoffice` y `chat`, y paquete compartido.
- API FastAPI con `/healthz`, `/readyz` y validación segura de configuración.
- Contratos JSON Schema para fichas, reglas de precio y presupuestos.
- Migraciones Supabase ordenadas por dependencias para el modelo mínimo de Fase 1.
- Claves foráneas compuestas con `tenant_id`, RLS por pertenencia y rol, y bucket privado de adjuntos.
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
| Supabase CLI | 3.1.0 para tareas controladas | instalado; no se levanta Supabase local |

## Validación realizada

Se han comprobado sintaxis Python, JSON, contrato de variables, exclusión de secretos, instalación Yarn, typecheck Expo, configuración Compose y consistencia de documentación. No se han ejecutado `supabase db reset`, pruebas RLS ni `docker compose up`: por decisión del usuario no se usará Docker/Supabase local en este macOS. No se ha usado ninguna cuenta AWS, Supabase remota o Gemini.

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

Las credenciales de `.env` deben seguir vacías y `AI_MOCK=true` durante toda esta fase. El resultado de cada comando se debe registrar antes de cerrar Fase 1. No ejecutar esos comandos en el Mac local actual.
