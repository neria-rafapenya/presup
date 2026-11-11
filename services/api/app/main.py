"""FastAPI application entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .backoffice import router as backoffice_router
from .config import get_settings

app = FastAPI(title="Horekia API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8081", "http://127.0.0.1:8081"],
    allow_credentials=False,
    allow_methods=["GET", "PATCH", "POST"],
    allow_headers=["Content-Type"],
)
app.include_router(backoffice_router)


@app.get("/healthz", tags=["system"])
def healthz() -> dict[str, str]:
    """Liveness endpoint that never exposes configuration or credentials."""

    return {"status": "ok"}


@app.get("/readyz", tags=["system"])
def readyz() -> dict[str, object]:
    """Readiness endpoint; configuration is validated before returning."""

    settings = get_settings()
    return {"status": "ready", "service": "api", "runtime": settings.public_summary()}
