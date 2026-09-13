"""Linux X11 backend for contained on-demand background launches."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True)


def process_path(pid: int) -> Path:
    return Path(f"/proc/{pid}/exe").resolve(strict=True)


def running_pids(process: str, app_path: str | None) -> list[int]:
    if not app_path:
        return []
    try:
        expected = Path(app_path).resolve(strict=True)
    except OSError:
        return []
    matches: list[int] = []
    for line in run(["pgrep", "-x", process]).stdout.splitlines():
        if not line.isdigit():
            continue
        pid = int(line)
        try:
            executable = process_path(pid)
        except OSError:
            continue
        if executable == expected:
            matches.append(pid)
    return matches


def foreground(xdotool: str) -> tuple[str, int]:
    window = run([xdotool, "getactivewindow"]).stdout.strip()
    pid = run([xdotool, "getwindowpid", window]).stdout.strip() if window.isdigit() else ""
    return window, int(pid) if pid.isdigit() else 0


def prepare(args: argparse.Namespace) -> dict[str, object]:
    xdotool = shutil.which("xdotool")
    if not os.environ.get("DISPLAY") or not xdotool:
        return {
            "status": "blocked_platform_backend_unavailable",
            "app": args.app,
            "reason": "X11 and xdotool are required",
            "exit_code": 5,
        }
    pids = running_pids(args.process, args.app_path)
    prior_window, prior_pid = foreground(xdotool)
    if not prior_window or not prior_pid:
        return {"status": "blocked_state_unavailable", "app": args.app, "exit_code": 6}
    if prior_pid in pids:
        status = "ready_existing_frontmost_requested" if args.allow_frontmost_requested else "blocked_user_active"
        return {"status": status, "app": args.app, "pid": prior_pid, "exit_code": 0 if args.allow_frontmost_requested else 3}
    if pids:
        return {"status": "ready_existing_background", "app": args.app, "pids": pids}
    path = Path(args.app_path) if args.app_path else None
    if path is None or not path.is_file() or not os.access(path, os.X_OK):
        return {"status": "blocked_app_identity_unavailable", "app": args.app, "exit_code": 2}
    if args.check_only:
        return {"status": "ready_on_demand_launch", "app": args.app, "app_path": str(path)}

    stop = threading.Event()
    target_pids: set[int] = set()
    result = {"takeovers": 0, "recovered": True}

    def contain() -> None:
        while not stop.wait(0.01):
            _, active_pid = foreground(xdotool)
            if active_pid not in target_pids:
                continue
            result["takeovers"] += 1
            restored = run([xdotool, "windowactivate", "--sync", prior_window])
            if restored.returncode:
                result["recovered"] = False
                return

    watcher = threading.Thread(target=contain, daemon=True)
    watcher.start()
    try:
        process = subprocess.Popen([str(path), *args.launch_arg])
        target_pids.add(process.pid)
        for _ in range(100):
            target_pids.update(running_pids(args.process, args.app_path))
            time.sleep(0.05)
        stop.set()
        watcher.join()
        final_window, final_pid = foreground(xdotool)
        if not result["recovered"] or final_window != prior_window or final_pid != prior_pid:
            return {"status": "blocked_foreground_recovery_failed", "app": args.app, "exit_code": 11}
        pids = running_pids(args.process, args.app_path) or sorted(target_pids)
        return {
            "status": "ready_background_recovered_launch" if result["takeovers"] else "ready_background_launch",
            "app": args.app,
            "pids": pids,
            "takeovers": result["takeovers"],
        }
    finally:
        stop.set()
        watcher.join()


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("command", choices=("prepare",))
    result.add_argument("--app", required=True)
    result.add_argument("--process", required=True)
    result.add_argument("--bundle-id", default="")
    result.add_argument("--app-path")
    result.add_argument("--check-only", action="store_true")
    result.add_argument("--allow-frontmost-requested", action="store_true")
    result.add_argument("--launch-arg", action="append", default=[])
    return result


def main() -> int:
    result = prepare(parser().parse_args())
    print(json.dumps(result, sort_keys=True))
    return int(result.get("exit_code", 0))


if __name__ == "__main__":
    raise SystemExit(main())
