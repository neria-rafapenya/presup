# Despliegue POC de Horekia

Estado: desplegado y verificado el 16 de noviembre de 2026.

## URLs

- API: https://api.horekia.com
- Backoffice: https://backoffice.horekia.com
- Chat público: https://app.horekia.com

## VPS

- Servidor: IONOS VPS Ubuntu 24.04, `217.160.50.110`.
- Código: `/var/www/horekia/presup`.
- Entorno privado: `/var/www/horekia/presup/.env`, permisos `600`.
- API: `127.0.0.1:8010`, proceso PM2 `horekia-poc`.
- Imágenes: `/var/lib/horekia/uploads/products`.
- Copias Caddy: `/var/backups/horekia`.

Cuinaria mantiene su proceso PM2 `horekia` y sus directorios. No se reutiliza ni se detiene.

## Caddy

La configuración versionada está en `infra/Caddyfile.horekia` y el proceso de actualización en `scripts/update_caddy.py`. Caddy termina TLS y publica los bundles estáticos; `/api` se reenvía a la API. Los certificados HTTPS se obtienen automáticamente.

## Cuenta maestra

La cuenta inicial del backoffice se crea con `scripts/bootstrap_backoffice.py` usando `BACKOFFICE_MASTER_EMAIL` y `BACKOFFICE_MASTER_PASSWORD` del `.env` privado. Las sesiones se almacenan como hashes en `horekia_backoffice_sessions`; no se usa Supabase Auth.

## Verificaciones realizadas

- 22 tests Python y typecheck de ambos frontends.
- Migraciones 0017–0019 y RLS: lecturas propias, lecturas cruzadas denegadas y escrituras cruzadas denegadas.
- API `/healthz` y `/readyz`.
- Preflight CORS para `backoffice.horekia.com`.
- Login maestro: sin sesión devuelve 401 y con sesión permite el resumen.
- Bundles web y endpoint público de servicios.
- HTTPS público en los tres dominios.
