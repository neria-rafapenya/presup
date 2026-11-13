"""FastAPI application entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .backoffice import router as backoffice_router
from .config import get_settings
from .public import router as public_router

app = FastAPI(title="Horekia API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:8082",
        "http://127.0.0.1:8082",
    ],
    allow_credentials=False,
    allow_methods=["DELETE", "GET", "PATCH", "POST", "PUT"],
    allow_headers=["Content-Type", "X-Customer-Session"],
)
app.include_router(backoffice_router)
app.include_router(public_router)


@app.get("/healthz", tags=["system"])
def healthz() -> dict[str, str]:
    """Liveness endpoint that never exposes configuration or credentials."""

    return {"status": "ok"}


@app.get("/readyz", tags=["system"])
def readyz() -> dict[str, object]:
    """Readiness endpoint; configuration is validated before returning."""

    settings = get_settings()
    return {"status": "ready", "service": "api", "runtime": settings.public_summary()}
