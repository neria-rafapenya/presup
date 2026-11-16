#!/usr/bin/env python3
"""Replace legacy Horekia redirects and append the POC site definitions."""

from __future__ import annotations

import argparse
import shutil
from datetime import datetime
from pathlib import Path


def remove_block(text: str, start: str) -> str:
    offset = text.find(start)
    if offset < 0:
        return text
    depth = 0
    end = None
    for index in range(offset, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    return text if end is None else text[:offset] + text[end:]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--caddyfile", type=Path, default=Path("/etc/caddy/Caddyfile"))
    parser.add_argument("--snippet", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path, required=True)
    args = parser.parse_args()

    args.backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(args.caddyfile, args.backup_dir / f"Caddyfile.before-horekia-{stamp}")
    text = args.caddyfile.read_text()
    for start in ("horekia.com, www.horekia.com {", "backoffice.horekia.com {"):
        text = remove_block(text, start)
    if "api.horekia.com" not in text:
        text = text.rstrip() + "\n\n" + args.snippet.read_text().rstrip() + "\n"
    args.caddyfile.write_text(text)
    print("Caddyfile actualizado; copia guardada en", args.backup_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
