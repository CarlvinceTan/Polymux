#!/usr/bin/env python3
"""Read-only health report for Midas's built-in Chronicle on macOS.

Midas records Chronicle inside the app itself: accessibility text frames are
saved as Markdown under the Chronicle directory, indexed per day, and
summarised into timeline.md. There is no separate recorder process to check;
health is the recorder setting plus evidence freshness on disk.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time


def newest_file(root: Path, suffix: str) -> Path | None:
    newest: tuple[float, Path] | None = None
    if not root.is_dir():
        return None
    for path in root.rglob(f"*{suffix}"):
        if not path.is_file():
            continue
        try:
            modified = path.stat().st_mtime
        except OSError:
            continue
        if newest is None or modified > newest[0]:
            newest = (modified, path)
    return newest[1] if newest else None


def file_state(path: Path | None, now: float, fresh_seconds: float) -> dict:
    if path is None:
        return {"available": False, "path": None, "age_seconds": None, "fresh": False}
    try:
        modified = path.stat().st_mtime
    except OSError:
        return {"available": False, "path": None, "age_seconds": None, "fresh": False}
    age = max(0.0, now - modified)
    return {
        "available": True,
        "path": str(path),
        "modified_unix": modified,
        "age_seconds": round(age, 3),
        "fresh": age <= fresh_seconds,
        "freshness_threshold_seconds": fresh_seconds,
    }


def recorder_state(root: Path) -> tuple[dict, list[str]]:
    errors: list[str] = []
    state = {"directory": str(root), "present": root.is_dir(), "enabled": None}
    if not root.is_dir():
        errors.append("Chronicle directory is missing; Chronicle has never run")
        return state, errors
    settings = root / "settings.json"
    try:
        value = json.loads(settings.read_text(encoding="utf-8"))
        state["enabled"] = bool(value.get("enabled", True))
    except (OSError, ValueError):
        # Missing settings mean Midas is using its defaults; not an error.
        state["enabled"] = None
    if state["enabled"] is False:
        errors.append("Chronicle is disabled in Midas settings")
    return state, errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--chronicle-root",
        type=Path,
        default=Path.home() / "Library/Application Support/Midas/chronicle",
    )
    parser.add_argument("--frame-fresh-seconds", type=float, default=120.0)
    parser.add_argument("--timeline-fresh-seconds", type=float, default=1200.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    now = time.time()
    root = args.chronicle_root

    recorder, errors = recorder_state(root)
    frame = file_state(newest_file(root / "index", ".jsonl"), now, args.frame_fresh_seconds)
    timeline = file_state(
        root / "timeline.md" if (root / "timeline.md").is_file() else None,
        now,
        args.timeline_fresh_seconds,
    )
    warnings: list[str] = []
    if not frame["available"]:
        errors.append("No Chronicle frame index is available")
    elif not frame["fresh"]:
        warnings.append("Newest Chronicle frame is stale")
    if not timeline["available"]:
        warnings.append("No Chronicle timeline is available")
    elif not timeline["fresh"]:
        warnings.append("Chronicle timeline is stale")

    status = "unavailable" if errors else "degraded" if warnings else "ok"
    report = {
        "status": status,
        "checked_unix": now,
        "recorder": recorder,
        "latest_frame_index": frame,
        "timeline": timeline,
        "errors": errors,
        "warnings": warnings,
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    return 2 if errors else 1 if warnings else 0


if __name__ == "__main__":
    sys.exit(main())
