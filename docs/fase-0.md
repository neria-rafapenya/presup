# Fase 0 — Preparación

Fecha: 11 de noviembre de 2026.

## Evidencias

| Comprobación | Resultado |
| --- | --- |
| Repositorio local | `/Users/rafa_penya/presup`, commit inicial `f9b793a`; origin apunta a neria-rafapenya/presup |
| Preparación de origen | `/Users/rafa_penya/Documents/Codex/2026-11-11/new-chat-2/presup`; ocho archivos incorporados, sin copiar `.git` |
| Cambios previos del destino | README versionado con título `presup`, sin modificaciones; `.DS_Store` sin seguimiento. Ambos se conservan; README fusionado y `.DS_Store` excluido |
| .env del proyecto | Copiado al no existir en el destino, con permisos privados y excluido de Git; contenido no mostrado |
| DECISIONES.md | Incorporado y revisado: FastAPI, backoffice de la empresa cliente y entrega llave en mano |
| Instrucciones | Se aplican las instrucciones AGENTS.md aportadas en la conversación |
| Historial Git | Se conserva el del destino; no se consulta ni publica el estado remoto |
| Rama de Fase 0 | `fase-0/preparacion`, commit `37b1150` (`docs: preparar Horekia y verificar fase 0`); rama de Fase 1 creada como `fase-1/base` |
| Git | 2.48.1 |
| Python instalado | 3.13.14 |
| Node instalado | 25.2.1 |
| yarn | 4.14.1 |
| Docker CLI | 29.5.3; `docker info` falla porque no está disponible el socket del daemon |
| Supabase CLI | No disponible en PATH |

No se ha buscado un .env en proyectos ajenos ni se han reutilizado sus secretos. Las versiones instaladas son inventario, no la matriz de compatibilidad final.

## Entregado

- DECISIONES.md con alcance confirmado y pendientes explícitos.
- README y plan de Fase 1.
- Roadmap conservado como referencia.
- .gitignore que excluye secretos y archivos generados.
- .env local excluido de Git y .env.example con el mismo contrato y sin secretos.
- README y referencias de rutas actualizados al repositorio destino; eliminadas afirmaciones antiguas sobre repositorio vacío y permisos remotos.

## Comprobación reproducible

Desde la raíz del repositorio:

```sh
git status --short
git diff --check
git check-ignore .env .env.local .DS_Store
git ls-files -- .env
git check-ignore .env.example
```

Los tres archivos privados o de sistema deben estar excluidos; `git ls-files -- .env` debe devolver salida vacía. `git check-ignore .env.example` debe devolver salida vacía y código 1, porque el ejemplo sí se puede versionar. No mostrar el contenido de `.env` en terminal ni incluirlo en commits.

También se compara localmente el contrato de once variables entre `.env` y `.env.example`, la igualdad del `.env` con su origen, `AI_MOCK=true`, las credenciales vacías y los enlaces relativos de la documentación. Estas comprobaciones no conectan con Supabase ni Gemini.

## Criterios de cierre

- [x] Repositorio local e historial de destino inspeccionados; origin identificado.
- [x] Alcance del backoffice y FastAPI documentados.
- [x] Estado del entorno identificado.
- [x] Preparación documental y plan siguiente disponibles.
- [x] Sin despliegues durante Fase 0; la conexión remota y la IA se dejan para las fases de implementación.
- [x] Resolver la configuración inicial: el usuario confirma que no existe archivo previo y autoriza crearlo.
- [x] Completar .env.example con las variables iniciales y valores locales no secretos.
- [x] Incorporar preparación sin sobrescribir cambios existentes ni copiar su `.git`.
- [x] Revisar exclusión del `.env`, contrato de variables y enlaces de documentación.
- [x] Crear y registrar la rama de fase desde una sesión con escritura en `.git`.
- [ ] Sincronizar con GitHub cuando corresponda; no se ha comprobado disponibilidad de push.

Estado: Fase 0 cerrada documentalmente y registrada en `37b1150`; la rama `fase-1/base` está preparada para la implementación. La validación posterior se realiza sin Docker local y con el proyecto Supabase autorizado, usando datos ficticios y tablas `horekia_*`.
