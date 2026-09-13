"""Windows backend for safe contained on-demand background launches."""

from __future__ import annotations

import argparse
import csv
import ctypes
import io
import json
import os
import subprocess
import threading
import time
from ctypes import wintypes
from pathlib import Path


def user32():
    return ctypes.windll.user32


def process_path(pid: int) -> str:
    api = ctypes.windll.kernel32
    api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    api.OpenProcess.restype = wintypes.HANDLE
    api.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    ]
    api.QueryFullProcessImageNameW.restype = wintypes.BOOL
    api.CloseHandle.argtypes = [wintypes.HANDLE]
    api.CloseHandle.restype = wintypes.BOOL
    handle = api.OpenProcess(0x1000, False, pid)
    if not handle:
        return ""
    try:
        size = wintypes.DWORD(32768)
        value = ctypes.create_unicode_buffer(size.value)
        if not api.QueryFullProcessImageNameW(handle, 0, value, ctypes.byref(size)):
            return ""
        return value.value
    finally:
        api.CloseHandle(handle)


def running_pids(process: str, app_path: str | None) -> list[int]:
    if not app_path:
        return []
    expected = os.path.normcase(os.path.abspath(app_path))
    name = process if process.lower().endswith(".exe") else f"{process}.exe"
    result = subprocess.run(
        ["tasklist", "/FI", f"IMAGENAME eq {name}", "/FO", "CSV", "/NH"],
        capture_output=True,
        text=True,
    )
    pids: list[int] = []
    for row in csv.reader(io.StringIO(result.stdout)):
        if len(row) > 1 and row[1].replace(",", "").isdigit():
            pid = int(row[1].replace(",", ""))
            if os.path.normcase(os.path.abspath(process_path(pid))) == expected:
                pids.append(pid)
    return pids


def foreground() -> tuple[int, int]:
    api = user32()
    window = int(api.GetForegroundWindow())
    pid = ctypes.c_ulong()
    api.GetWindowThreadProcessId(window, ctypes.byref(pid))
    return window, int(pid.value)


def prepare(args: argparse.Namespace) -> dict[str, object]:
    pids = running_pids(args.process, args.app_path)
    prior_window, prior_pid = foreground()
    if not prior_window or not prior_pid:
        return {"status": "blocked_state_unavailable", "app": args.app, "exit_code": 6}
    if prior_pid in pids:
        status = "ready_existing_frontmost_requested" if args.allow_frontmost_requested else "blocked_user_active"
        return {"status": status, "app": args.app, "pid": prior_pid, "exit_code": 0 if args.allow_frontmost_requested else 3}
    if pids:
        return {"status": "ready_existing_background", "app": args.app, "pids": pids}
    path = Path(args.app_path) if args.app_path else None
    if path is None or not path.is_file():
        return {"status": "blocked_app_identity_unavailable", "app": args.app, "exit_code": 2}
    if args.check_only:
        return {"status": "ready_on_demand_launch", "app": args.app, "app_path": str(path)}

    stop = threading.Event()
    target_pids: set[int] = set()
    result = {"takeovers": 0, "recovered": True}

    def contain() -> None:
        while not stop.wait(0.01):
            _, active_pid = foreground()
            if active_pid not in target_pids:
                continue
            result["takeovers"] += 1
            if not user32().SetForegroundWindow(prior_window):
                result["recovered"] = False
                return

    watcher = threading.Thread(target=contain, daemon=True)
    watcher.start()
    try:
        process = subprocess.Popen([str(path), *args.launch_arg])
        target_pids.add(process.pid)
        for _ in range(100):
            target_pids.update(running_pids(args.process, args.app_path))
            if target_pids:
                time.sleep(0.05)
            if process.poll() is not None and not running_pids(args.process, args.app_path):
                break
        stop.set()
        watcher.join()
        final_window, final_pid = foreground()
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
