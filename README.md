# presup

## Horekia

Aplicación generalista de presupuestos, entregada llave en mano. La empresa configura su negocio desde su backoffice y ofrece a sus clientes un chat guiado por esa configuración. La IA interpreta y pregunta; el motor determinista calcula.

## Estado

Fase 1: base POC validada sobre `fase-1/base`; el desarrollo activo se concentra en el backoffice. Fase 0 quedó registrada en `fase-0/preparacion`, commit `37b1150`. La base Supabase real contiene únicamente tablas `horekia_*` con datos ficticios; no se usa Supabase Auth. El detalle está en [fase-1.md](docs/fase-1.md).

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

No copiar credenciales de otros proyectos. El `.env` local ya existe; en una copia nueva se puede crear desde `.env.example` y completar las credenciales del proyecto. Mantener `.env` sin seguimiento de Git. Gemini está configurado para uso real; el backoffice actual no lo invoca todavía. Nunca exponer `DATABASE_URL` mediante variables `EXPO_PUBLIC_`.

## Verificación actual

La API y el backoffice se validan sin Docker; las migraciones y el aislamiento ya se probaron en el proyecto Supabase autorizado usando únicamente el prefijo `horekia_`. Consulta [fase-1.md](docs/fase-1.md) para el estado verificable.

El backoffice tendrá un Wizard de onboarding por tenant: aparecerá automáticamente en el primer acceso mientras falte la configuración inicial y seguirá disponible desde el menú `Wizard` para reanudarlo o ejecutarlo de nuevo.

El Wizard permitirá cargar conocimiento ficticio del negocio mediante CSV. Los productos y precios alimentarán el catálogo y el motor determinista; categorías, patrones de venta, políticas y documentos servirán como contexto para Gemini, siempre aislados por tenant. La empresa final operará únicamente mediante el chatbot; el backoffice es el lugar de configuración y revisión.

La ficha de empresa del Wizard también permite completar los datos comerciales del tenant y cargar la plantilla PDF de presupuesto o proforma que utilizarán las salidas posteriores.
