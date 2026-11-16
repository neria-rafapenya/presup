# Fase 1 — Base y modelo de datos

## Implementado en `fase-1/base`

- Monorepo Yarn 4 con apps separadas `backoffice` y `chat`, y paquete compartido. El backoffice opera la configuración y revisión; `chat` es la interfaz pública separada.
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

Se han comprobado sintaxis Python, JSON, contrato de variables, exclusión de secretos, instalación Yarn, typecheck Expo, configuración Compose, tests FastAPI, arranque de la API y bundles Web del backoffice y del chat. La API y las aplicaciones responden localmente sin Docker; la base usada para la POC es el proyecto Supabase real autorizado y contiene únicamente datos ficticios Horekia. No se usa Supabase Auth.

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

Las credenciales no se versionan. El entorno de trabajo mantiene `AI_MOCK=false` y modelos Gemini configurados para uso real; la ayuda interna y las aclaraciones del chat público pueden usar Gemini. No se usa Docker ni Supabase local en este macOS.

## Cierre

## Cierre verificado de la POC

Fase 1 queda cerrada para el alcance de esta POC:

- PostgreSQL existente conectado mediante `DATABASE_URL`.
- Cinco migraciones y seed aplicados exclusivamente en tablas `horekia_*`.
- 26 tablas Horekia creadas; no se modificaron tablas de negocio existentes.
- Dos identidades de aplicación asociadas a tenants distintos.
- Lecturas propias permitidas, lecturas cruzadas denegadas y escrituras cruzadas denegadas por RLS.
- API, backoffice Web y chat Web arrancados y verificados por HTTP.
- Flujo público probado contra Supabase: selección de servicio, conversación, captura de campos, petición y presupuesto `needs_review`.
- La cobertura geográfica es una regla común del tenant, no un campo de los servicios. Se valida como primera pregunta del chat: la API compara la ciudad o código postal indicado con la ciudad de referencia del tenant usando un cálculo determinista y el radio de acción configurable en `Empresa`. Las instalaciones existentes parten de 100 km. Gemini solo normaliza erratas o expresiones de ubicación cuando el registro local no basta; nunca calcula la distancia ni decide la viabilidad.
- Flujo interno probado: bandeja de peticiones, detalle con mensajes, revisión y cambio de estado de presupuesto.
- El asistente flotante de documentación sigue siendo un módulo independiente del chatbot público; usa el contexto controlado de documentación y Gemini.
- El chat público pide nombre y email antes de iniciar una solicitud. Cuando el motor termina el presupuesto, el cliente crea una contraseña y recibe una sesión de Horekia automáticamente; el importe no se muestra en pantalla: el presupuesto se entrega por email. Si el cliente ya tiene una sesión válida, no se repite el alta.
- La entrega del presupuesto se realiza por email, no en pantalla: el backend genera un PDF estándar, incorpora las páginas de la plantilla PDF del tenant si existe y lo envía mediante Resend. Los intentos quedan registrados en `horekia_quote_deliveries` para evitar duplicados.

El backoffice ya dispone de autenticación propia de la POC mediante `horekia_backoffice_users` y `horekia_backoffice_sessions`, con cuenta maestra inicializada desde variables privadas y sesiones revocables. Supabase Auth sigue fuera de alcance. Storage compartido, subida de adjuntos desde el chat y una gestión multiusuario completa quedan para una fase posterior. La entrega real requiere configurar `RESEND_API_KEY` y un `RESEND_FROM_EMAIL` verificado. El chat público combina Gemini para aclaraciones contextuales y lenguaje natural con la ficha y el motor determinista para capturar datos y calcular importes. La prueba usa datos ficticios y no debe considerarse una tarifa real.
