# presup

## Horekia

Aplicación generalista de presupuestos, entregada llave en mano. La empresa configura su negocio desde su backoffice y ofrece a sus clientes un chat guiado por esa configuración. La IA interpreta y pregunta; el motor determinista calcula.

## Estado

Fase 0: preparación documental lista. Inspección del entorno realizada. Configuración local creada con credenciales vacías e IA simulada; conexión a Supabase pendiente. Todavía no existe aplicación ejecutable ni migraciones aplicadas.

Repositorio objetivo: https://github.com/neria-rafapenya/presup.git

Directorio de trabajo: `/Users/rafa_penya/presup`. La preparación de `/Users/rafa_penya/Documents/Codex/2026-11-11/new-chat-2/presup` se ha incorporado sin copiar su `.git`. Se ha conservado el título del README original y el historial del repositorio destino (commit inicial `f9b793a`). El estado remoto no se ha consultado en esta revisión; no se han publicado cambios.

La sesión permite modificar los archivos de trabajo, pero no escribir en `.git`: la creación de la rama `fase-0/preparacion` ha fallado por permisos. Los cambios quedan en el árbol de trabajo de `main`, sin commit. Antes de implementar Fase 1 hay que trasladarlos a una rama y registrarlos desde una sesión con escritura en `.git`.

## Documentación

- [Decisiones](DECISIONES.md)
- [Inspección y cierre de Fase 0](docs/fase-0.md)
- [Plan de Fase 1](docs/plan-fase-1.md)
- [Roadmap](docs/roadmap.md)

## Preparación del entorno

Se necesitan Git, una versión compatible de Python y Node, yarn y, para validar la infraestructura local, Docker con su daemon activo y Supabase CLI. Docker CLI está instalado, pero su daemon no está disponible; Supabase CLI no está en PATH. Las versiones objetivo se fijarán en Fase 1 tras comprobar compatibilidad.

No copiar credenciales de otros proyectos. El .env local ya existe; en una copia nueva se puede crear desde .env.example. Completar las variables Supabase cuando se configure la base. Mantener AI_MOCK=true para desarrollo sin llamadas a Gemini y .env sin seguimiento de Git. Nunca exponer SUPABASE_SERVICE_ROLE_KEY ni DATABASE_URL mediante variables EXPO_PUBLIC_. No ejecutar migraciones contra producción durante la validación inicial.

## Verificación actual

No hay dependencias que instalar ni servidores que arrancar en esta fase. Se valida la documentación, la exclusión de secretos y la ausencia de cambios de infraestructura. Los scripts de desarrollo se crearán en Fase 1.
