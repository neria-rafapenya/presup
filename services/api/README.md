# API de Horekia

Base FastAPI con configuración validada desde `.env`. El modo local mantiene `AI_MOCK=true` y acepta credenciales externas vacías.

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[dev]'
yarn dev:api
```

El script arranca sin watcher por defecto; usar `RELOAD=true yarn dev:api` solo en un entorno donde el watcher de archivos esté permitido. Comprobaciones: `GET /healthz` no revela configuración; `GET /readyz` comprueba el contrato y solo devuelve estados no sensibles.
