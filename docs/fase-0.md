# Fase 0 — Preparación

Fecha: 11 de noviembre de 2026.

## Evidencias

| Comprobación | Resultado |
| --- | --- |
| Repositorio local | `/Users/rafa_penya/presup`, rama `main`, commit inicial `f9b793a`; origin apunta a neria-rafapenya/presup |
| Preparación de origen | `/Users/rafa_penya/Documents/Codex/2026-11-11/new-chat-2/presup`; ocho archivos incorporados, sin copiar `.git` |
| Cambios previos del destino | README versionado con título `presup`, sin modificaciones; `.DS_Store` sin seguimiento. Ambos se conservan; README fusionado y `.DS_Store` excluido |
| .env del proyecto | Copiado al no existir en el destino, con permisos privados, credenciales vacías y AI_MOCK=true; contenido no mostrado |
| DECISIONES.md | Incorporado y revisado: FastAPI, backoffice de la empresa cliente y entrega llave en mano |
| Instrucciones | Se aplican las instrucciones AGENTS.md aportadas en la conversación |
| Historial Git | Se conserva el del destino; no se consulta ni publica el estado remoto |
| Rama de Fase 0 | Intento de `git switch -c fase-0/preparacion` rechazado al escribir en `.git`; árbol de trabajo en `main`, sin commit |
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
- [x] Sin despliegues, recursos remotos ni llamadas a IA real.
- [x] Resolver la configuración inicial: el usuario confirma que no existe archivo previo y autoriza crearlo.
- [x] Completar .env.example con las variables iniciales y valores locales no secretos.
- [x] Incorporar preparación sin sobrescribir cambios existentes ni copiar su `.git`.
- [x] Revisar exclusión del `.env`, contrato de variables y enlaces de documentación.
- [ ] Crear y registrar la rama de fase desde una sesión con escritura en `.git`.
- [ ] Sincronizar con GitHub cuando corresponda; no se ha comprobado disponibilidad de push.

Estado: preparación documental y configuración de Fase 0 comprobadas localmente. El cierre en Git queda pendiente por permisos sobre `.git`. Antes de implementar Fase 1, registrar esta preparación en su rama; para validar sus migraciones locales, disponer además de Docker activo y Supabase CLI. Las credenciales Supabase vacías siguen siendo un pendiente explícito; no hay aplicación ejecutable ni pruebas de aislamiento superadas.
