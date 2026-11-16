# Infraestructura local

`docker-compose.yml` contiene únicamente la API de Fase 1. Supabase sigue siendo una dependencia externa. Este compose queda para la entrega llave en mano y la validación en CI o en un entorno controlado; no se debe levantar en el macOS de desarrollo actual.

## VPS IONOS de la POC

El despliegue actual mantiene Cuinaria intacta y publica Horekia en un subdirectorio separado, `/var/www/horekia/presup`, con la API en `127.0.0.1:8010` bajo PM2 (`horekia-poc`). Caddy sirve los bundles estáticos y publica la API en `api.horekia.com`:

- `backoffice.horekia.com` → `apps/backoffice/dist`
- `app.horekia.com` → `apps/chat/dist`
- `horekia.com` y `www.horekia.com` → `apps/commercial/dist`
- `api.horekia.com` → `127.0.0.1:8010`

Los archivos de referencia son `ecosystem.horekia.config.cjs` y `Caddyfile.horekia`. El `.env` de producción queda únicamente en el VPS con permisos `600`; nunca se copia al repositorio ni se incluye en una imagen. El usuario maestro se crea con `scripts/bootstrap_backoffice.py` después de aplicar la migración `0019_backoffice_auth.sql`.

```sh
docker compose -f infra/docker-compose.yml config
docker compose -f infra/docker-compose.yml up --build api
```

No ejecutar este compose contra producción ni incluir `.env` en una imagen o commit.
