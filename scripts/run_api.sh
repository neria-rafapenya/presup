#!/bin/sh
set -eu

PYTHON_BIN="${PYTHON_BIN:-.venv313/bin/python}"
RELOAD_ARGS=""
if [ "${RELOAD:-false}" = "true" ]; then
  RELOAD_ARGS="--reload"
fi
exec "$PYTHON_BIN" -m uvicorn app.main:app --app-dir services/api $RELOAD_ARGS --port "${PORT:-8000}"
