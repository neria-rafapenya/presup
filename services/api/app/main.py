"""FastAPI application entrypoint."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .backoffice import router as backoffice_router
from .auth import router as backoffice_auth_router
from .config import get_settings
from .public import router as public_router

app = FastAPI(title="Horekia API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=False,
    allow_methods=["DELETE", "GET", "PATCH", "POST", "PUT"],
    allow_headers=["Content-Type", "X-Customer-Session", "X-Backoffice-Session"],
)
app.include_router(backoffice_auth_router)
app.include_router(backoffice_router)
app.include_router(public_router)

_settings = get_settings()
_media_root = Path(_settings.product_upload_dir).parent
_media_root.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(_media_root), check_dir=False), name="media")


@app.get("/healthz", tags=["system"])
def healthz() -> dict[str, str]:
    """Liveness endpoint that never exposes configuration or credentials."""

    return {"status": "ok"}


@app.get("/readyz", tags=["system"])
def readyz() -> dict[str, object]:
    """Readiness endpoint; configuration is validated before returning."""

    settings = get_settings()
    return {"status": "ready", "service": "api", "runtime": settings.public_summary()}
