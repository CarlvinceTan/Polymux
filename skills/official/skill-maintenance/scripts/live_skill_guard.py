#!/usr/bin/env python3
"""Pre-tool hook: block direct writes to live skills outside maintenance.

Register in ~/.flareai/hooks.json:

    {
      "version": 1,
      "hooks": [
        {
          "event": "pre-tool",
          "tools": ["write", "edit", "bash"],
          "command": "python3 ~/.flareai/skills/skill-maintenance/scripts/live_skill_guard.py"
        }
      ]
    }

The hook receives {event, tool, arguments} on stdin. Exit 0 allows the call;
a non-zero exit blocks it and stderr becomes the message shown to the model.
Writes must go through skill_maintenance.py staging instead; candidate and
review paths under ~/.flareai/skill-maintenance remain writable.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

LIVE_ROOTS = [Path.home() / ".flareai" / "skills", Path.home() / ".agents" / "skills"]
ALLOWED_ROOT = Path.home() / ".flareai" / "skill-maintenance"


def normalized(raw: str) -> Path | None:
    try:
        return Path(raw).expanduser().resolve(strict=False)
    except (OSError, ValueError):
        return None


def in_live_root(path: Path) -> bool:
    if ALLOWED_ROOT in path.parents or path == ALLOWED_ROOT:
        return False
    return any(root in path.parents or path == root for root in LIVE_ROOTS)


def candidate_paths(tool: str, arguments: dict) -> list[Path]:
    paths: list[Path] = []
    if tool in ("write", "edit"):
        raw = arguments.get("path") or arguments.get("file_path") or ""
        found = normalized(str(raw)) if raw else None
        if found:
            paths.append(found)
    elif tool == "bash":
        command = str(arguments.get("command", ""))
        # Conservative: any literal live-root path in a shell command counts.
        for match in re.findall(r"(?:~|/Users/[^\s'\"]+)/\.(?:flareai|agents)/skills[^\s'\"]*", command):
            found = normalized(match)
            if found:
                paths.append(found)
    return paths


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return 0  # Never block on a malformed payload.
    tool = str(payload.get("tool", ""))
    arguments = payload.get("arguments") or {}
    if not isinstance(arguments, dict):
        return 0
    if tool == "bash":
        command = str(arguments.get("command", ""))
        # Read-only shell use of live skills is fine.
        if not re.search(r"\b(rm|mv|cp|tee|sed\s+-i|>\s*|>>\s*|mkdir|touch|ln|chmod|python3?\b[^|]*\bwrite)", command):
            return 0
    hits = [p for p in candidate_paths(tool, arguments) if in_live_root(p)]
    if not hits:
        return 0
    print(
        "Direct writes to live skills are not allowed. Stage the change with "
        "skill-maintenance (scripts/skill_maintenance.py stage ...) and promote "
        f"it after checks pass. Blocked path(s): {', '.join(str(p) for p in hits)}",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
