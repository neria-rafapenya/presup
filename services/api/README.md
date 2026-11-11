# API de Horekia

Base FastAPI con configuración validada desde `.env`. El modo local mantiene `AI_MOCK=true` y acepta credenciales externas vacías.

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[dev]'
uvicorn app.main:app --app-dir services/api --reload --port 8000
```

Comprobaciones: `GET /healthz` no revela configuración; `GET /readyz` comprueba el contrato y solo devuelve estados no sensibles.
