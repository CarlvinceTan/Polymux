#!/usr/bin/env python3
"""Read-only health report for OpenAI's built-in Chronicle on macOS."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from typing import Iterable


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
SUMMARY_SUFFIX = "memory-summary.md"


def newest_file(root: Path, suffixes: Iterable[str]) -> Path | None:
    allowed = {suffix.lower() for suffix in suffixes}
    newest: tuple[float, Path] | None = None
    if not root.is_dir():
        return None
    for path in root.rglob("*"):
        if not path.is_file() or not any(
            path.name.lower().endswith(suffix) for suffix in allowed
        ):
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


def process_state(pid_file: Path) -> tuple[dict, list[str]]:
    errors: list[str] = []
    state = {
        "pid_file": str(pid_file),
        "pid": None,
        "running": False,
        "executable": None,
        "verified": False,
    }
    try:
        raw_pid = pid_file.read_text(encoding="utf-8").strip()
        pid = int(raw_pid)
        if pid <= 0:
            raise ValueError
        state["pid"] = pid
    except FileNotFoundError:
        errors.append("Chronicle PID file is missing")
        return state, errors
    except (OSError, ValueError):
        errors.append("Chronicle PID file is unreadable or invalid")
        return state, errors

    result = subprocess.run(
        ["/bin/ps", "-p", str(pid), "-o", "comm="],
        check=False,
        capture_output=True,
        text=True,
    )
    executable = result.stdout.strip() if result.returncode == 0 else ""
    state["executable"] = executable or None
    state["running"] = bool(executable)
    state["verified"] = Path(executable).name == "codex_chronicle"
    if not executable:
        errors.append("Saved Chronicle PID is not running")
    elif not state["verified"]:
        errors.append("Saved Chronicle PID belongs to a different executable")
    return state, errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    default_tmp = Path(os.environ.get("TMPDIR", "/tmp"))
    parser.add_argument("--tmp-root", type=Path, default=default_tmp)
    parser.add_argument(
        "--memory-root",
        type=Path,
        default=Path.home() / ".codex/memories/extensions/chronicle",
    )
    parser.add_argument("--frame-fresh-seconds", type=float, default=120.0)
    parser.add_argument("--summary-fresh-seconds", type=float, default=1200.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    now = time.time()
    pid_file = args.tmp_root / "codex_chronicle/chronicle-started.pid"
    recordings = args.tmp_root / "chronicle/screen_recording"
    resources = args.memory_root / "resources"

    recorder, errors = process_state(pid_file)
    frame = file_state(newest_file(recordings, IMAGE_SUFFIXES), now, args.frame_fresh_seconds)
    summary = file_state(
        newest_file(resources, {SUMMARY_SUFFIX}), now, args.summary_fresh_seconds
    )
    warnings: list[str] = []
    if not frame["available"]:
        errors.append("No Chronicle raw frame is available")
    elif not frame["fresh"]:
        warnings.append("Newest Chronicle raw frame is stale")
    if not summary["available"]:
        warnings.append("No generated Chronicle summary is available")
    elif not summary["fresh"]:
        warnings.append("Newest generated Chronicle summary is stale")

    status = "unavailable" if errors else "degraded" if warnings else "ok"
    report = {
        "status": status,
        "checked_unix": now,
        "recorder": recorder,
        "raw_frame": frame,
        "generated_summary": summary,
        "errors": errors,
        "warnings": warnings,
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    return 2 if errors else 1 if warnings else 0


if __name__ == "__main__":
    sys.exit(main())
