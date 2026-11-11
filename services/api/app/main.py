"""FastAPI application entrypoint."""

from fastapi import FastAPI

from .config import get_settings

app = FastAPI(title="Horekia API", version="0.1.0")


@app.get("/healthz", tags=["system"])
def healthz() -> dict[str, str]:
    """Liveness endpoint that never exposes configuration or credentials."""

    return {"status": "ok"}


@app.get("/readyz", tags=["system"])
def readyz() -> dict[str, object]:
    """Readiness endpoint; configuration is validated before returning."""

    settings = get_settings()
    return {"status": "ready", "service": "api", "runtime": settings.public_summary()}
