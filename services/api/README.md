# API de Horekia

Base FastAPI con configuración validada desde `.env`. La POC usa Supabase real y deja Gemini configurado para uso real; sus datos de negocio son ficticios. El backoffice actual no invoca Gemini todavía porque su alcance es configuración y catálogo.

Los presupuestos se envían por Resend como PDF adjunto. Configura `RESEND_API_KEY`, `RESEND_FROM_EMAIL` y, opcionalmente, `RESEND_FROM_NAME` en `.env`; el remitente debe pertenecer a un dominio verificado en Resend.

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[dev]'
yarn dev:api
```

El script arranca sin watcher por defecto; usar `RELOAD=true yarn dev:api` solo en un entorno donde el watcher de archivos esté permitido. Comprobaciones: `GET /healthz` no revela configuración; `GET /readyz` comprueba el contrato y solo devuelve estados no sensibles.
