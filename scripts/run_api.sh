#!/bin/sh
set -eu

PYTHON_BIN="${PYTHON_BIN:-.venv313/bin/python}"
exec "$PYTHON_BIN" -m uvicorn app.main:app --app-dir services/api --reload --port "${PORT:-8000}"
