#!/usr/bin/env python3
"""Validate Horekia's local configuration without printing secret values."""

import sys
from pathlib import Path

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.api.app.config import get_settings


def main() -> int:
    try:
        settings = get_settings()
    except (OSError, ValueError, ValidationError) as exc:  # pragma: no cover - CLI boundary
        print(f"Configuración inválida: {exc}", file=sys.stderr)
        return 1
    print("Configuración válida:", settings.public_summary())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
