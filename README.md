# presup

## Horekia

Aplicación generalista de presupuestos, entregada llave en mano. La empresa configura su negocio desde su backoffice y ofrece a sus clientes un chat guiado por esa configuración. La IA interpreta y pregunta; el motor determinista calcula.

## Estado

Fase 1: base en implementación sobre `fase-1/base`. Fase 0 quedó registrada en `fase-0/preparacion`, commit `37b1150`. La configuración local conserva credenciales vacías e IA simulada; la conexión a Supabase sigue pendiente. Las migraciones y aplicaciones se preparan en esta fase, pero no se consideran validadas hasta ejecutar las comprobaciones locales.

Repositorio objetivo: https://github.com/neria-rafapenya/presup.git

Directorio de trabajo: `/Users/rafa_penya/presup`. La preparación de `/Users/rafa_penya/Documents/Codex/2026-11-11/new-chat-2/presup` se ha incorporado sin copiar su `.git`. Se ha conservado el título del README original y el historial del repositorio destino (commit inicial `f9b793a`). El estado remoto no se ha consultado en esta revisión; no se han publicado cambios.

La sesión actual puede escribir en `.git` para las operaciones locales necesarias. No se ha hecho push ni se han creado recursos remotos.

## Documentación

- [Decisiones](DECISIONES.md)
- [Inspección y cierre de Fase 0](docs/fase-0.md)
- [Plan de Fase 1](docs/plan-fase-1.md)
- [Roadmap](docs/roadmap.md)
- [Modelo de datos de Fase 1](docs/modelo-datos-fase-1.md)
- [Estado y validación de Fase 1](docs/fase-1.md)

## Preparación del entorno

Se necesitan Git, una versión compatible de Python y Node, yarn y Supabase CLI. Docker Compose se conserva para la entrega llave en mano y la validación en CI o en un entorno controlado; no se usa Docker/Supabase local en este macOS para evitar sobrecargarlo. Las versiones objetivo se fijan en Fase 1.

No copiar credenciales de otros proyectos. El .env local ya existe; en una copia nueva se puede crear desde .env.example. Completar las variables Supabase cuando se configure la base. Mantener AI_MOCK=true para desarrollo sin llamadas a Gemini y .env sin seguimiento de Git. Nunca exponer SUPABASE_SERVICE_ROLE_KEY ni DATABASE_URL mediante variables EXPO_PUBLIC_. No ejecutar migraciones contra producción durante la validación inicial.

## Verificación actual

La estructura, scripts y contratos de Fase 1 se preparan en esta rama. La API y las apps se validan sin Docker; las migraciones y el aislamiento quedan pendientes de una ejecución desechable en CI o en un entorno autorizado. Consulta [fase-1.md](docs/fase-1.md) para el estado verificable.
