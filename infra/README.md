# Infraestructura local

`docker-compose.yml` contiene únicamente la API de Fase 1. Supabase sigue siendo una dependencia externa. Este compose queda para la entrega llave en mano y la validación en CI o en un entorno controlado; no se debe levantar en el macOS de desarrollo actual.

```sh
docker compose -f infra/docker-compose.yml config
docker compose -f infra/docker-compose.yml up --build api
```

No ejecutar este compose contra producción ni incluir `.env` en una imagen o commit.
