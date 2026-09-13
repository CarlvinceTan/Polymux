"""Platform-neutral exact-window observation and control."""

from __future__ import annotations

import argparse
import json
import platform
import subprocess
import sys
from pathlib import Path

from config import device_requires_lock
from macos.compile import SwiftCompileError, compile_source


SCRIPT_DIR = Path(__file__).resolve().parent
LOCK_SCRIPT = SCRIPT_DIR / "lock.py"
PLATFORM_SOURCES = {"Darwin": SCRIPT_DIR / "macos" / "window.swift"}
PLATFORM_BACKENDS = {
    "Windows": SCRIPT_DIR / "windows" / "window.py",
    "Linux": SCRIPT_DIR / "linux" / "window.py",
}
OBSERVATION_COMMANDS = {"list", "capture", "inspect", "tabs"}


def emit(status: str, **fields: object) -> None:
    print(json.dumps({"status": status, **fields}, sort_keys=True))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("command", choices=["list", "capture", "inspect", "tabs", "press", "set-value"])
    result.add_argument("--device", required=True)
    result.add_argument("--app", required=True)
    result.add_argument("--app-id")
    result.add_argument("--pid", required=True, type=int)
    result.add_argument("--lock-window-id")
    result.add_argument("--lock-token")
    result.add_argument("--native-window-id", type=int)
    result.add_argument("--output")
    result.add_argument("--match-attribute", choices=["role", "title", "description", "identifier"])
    result.add_argument("--match-value")
    result.add_argument("--new-value")
    result.add_argument("--expected-value", help="current value observed for this exact control")
    return result


def app_identity(backend_command: list[str], pid: int, system: str) -> str:
    identified = subprocess.run(
        [*backend_command, "app-identity", "--pid", str(pid)],
        capture_output=True,
        text=True, timeout=10,
    )
    try:
        payload = json.loads(identified.stdout)
    except json.JSONDecodeError as exc:
        raise ValueError("application identity backend returned invalid data") from exc
    value = payload.get("app_id") if identified.returncode == 0 else None
    if not isinstance(value, str) or not value:
        raise ValueError(str(payload.get("status") or "application identity unavailable"))
    return value.casefold() if system == "Windows" else value


def dispatch() -> int:
    args = parser().parse_args()
    mutation = args.command not in OBSERVATION_COMMANDS
    try:
        requires_lock = device_requires_lock(args.device)
    except (OSError, ValueError) as exc:
        emit("blocked_device_configuration", reason=str(exc))
        return 2
    if args.command != "list" and args.native_window_id is None:
        parser().error("exact-window commands require --native-window-id")
    if mutation and not args.app_id:
        parser().error("control mutation requires the adapter-supplied --app-id")
    if mutation and requires_lock and (not args.lock_window_id or not args.lock_token):
        parser().error("control requires a coordination lease")
    if not mutation and (args.lock_window_id or args.lock_token):
        parser().error("observation commands do not accept control locks")
    if mutation and requires_lock and args.lock_window_id != str(args.native_window_id):
        emit("blocked_lock_window_mismatch")
        return 3
    if args.command == "capture" and not args.output:
        parser().error("capture requires --output")
    if args.command in {"press", "set-value"} and (
        not args.match_attribute or args.match_value is None
    ):
        parser().error("control mutation requires --match-attribute and --match-value")
    if args.command == "set-value" and (args.new_value is None or args.expected_value is None):
        parser().error("set-value requires --new-value and --expected-value")
    system = platform.system()
    source = PLATFORM_SOURCES.get(system)
    script = PLATFORM_BACKENDS.get(system)
    if source is None and (script is None or not script.is_file()):
        emit("blocked_platform_backend_unavailable", platform=system)
        return 5
    if source is not None:
        try:
            from macos import helper
            backend_command = ([sys.executable, str(SCRIPT_DIR / 'macos/helper.py'), 'window', '--']
                               if helper.enabled() else [str(compile_source(source, parse_as_library=True))])
        except (OSError, SwiftCompileError):
            emit("blocked_controller_compile")
            return 5
    else:
        backend_command = [sys.executable, str(script)]

    try:
        canonical_app_id = app_identity(backend_command, args.pid, system)
    except (OSError, ValueError) as exc:
        emit("blocked_app_identity_unavailable", reason=str(exc))
        return 3
    supplied_app_id = args.app_id.casefold() if system == "Windows" and args.app_id else args.app_id
    if supplied_app_id is not None and supplied_app_id != canonical_app_id:
        emit("blocked_app_identity_mismatch", app_id=canonical_app_id)
        return 3
    args.app_id = canonical_app_id

    if mutation and requires_lock and system == "Darwin":
        identity = subprocess.run(
            [
                *backend_command, "validate-identity",
                "--lock-window-id", args.lock_window_id,
                "--native-window-id", str(args.native_window_id),
            ],
            capture_output=True,
            text=True, timeout=10,
        )
        if identity.returncode:
            print(identity.stdout.strip())
            return identity.returncode
    operation = None
    if mutation and requires_lock:
        lock = subprocess.run(
            [
                sys.executable, str(LOCK_SCRIPT), "begin", "--app-id", args.app_id,
                "--device", args.device,
                "--window-id", args.lock_window_id, "--kind", "window",
                "--token", args.lock_token,
            ],
            capture_output=True,
            text=True, timeout=10,
        )
        if lock.returncode:
            print(lock.stdout.strip())
            return 3
        try:
            operation = json.loads(lock.stdout)["lock"]["operation"]
        except (ValueError, KeyError):
            emit("blocked_action_fence_unavailable")
            return 3
    command = [*backend_command, args.command, "--pid", str(args.pid)]
    for option, value in (
        ("--window-id", args.native_window_id),
        ("--output", args.output),
        ("--match-attribute", args.match_attribute),
        ("--match-value", args.match_value),
        ("--new-value", args.new_value),
        ("--expected-value", args.expected_value),
    ):
        if value is not None:
            if system == "Linux":
                # Bind text explicitly so argparse cannot reinterpret a field
                # value such as --pid as another backend option.
                command.append(f"{option}={value}")
            else:
                command.extend([option, str(value)])
    try:
        controlled = subprocess.run(command, capture_output=True, text=True, timeout=10)
        payload = json.loads(controlled.stdout)
        if not isinstance(payload, dict):
            raise ValueError("backend returned no result object")
        code = controlled.returncode
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        payload, code = {"status": "action_outcome_unknown" if mutation else "blocked_observation",
                         "reason": str(exc)}, 5
    if operation:
        outcome = "verified" if code == 0 else "not-applied" if payload.get("status") in {
            "conflict", "blocked_exact_control_match", "blocked_exact_window_missing", "blocked_usage"
        } else "unknown"
        try:
            finished = subprocess.run([sys.executable, str(LOCK_SCRIPT), "finish", "--device", args.device,
                "--app-id", args.app_id, "--window-id", args.lock_window_id, "--kind", "window",
                "--token", args.lock_token, "--operation", operation, "--outcome", outcome],
                capture_output=True, text=True, timeout=10)
            if finished.returncode or outcome == "unknown":
                payload = {"status": "action_outcome_unknown", "operation": operation, "result": payload}
                code = 5
        except (OSError, subprocess.SubprocessError) as exc:
            payload, code = {"status": "action_outcome_unknown", "operation": operation, "reason": str(exc)}, 5
    payload["app_id"] = canonical_app_id
    print(json.dumps(payload, sort_keys=True))
    return code


def main() -> int:
    try:
        return dispatch()
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        emit("blocked_before_dispatch", reason=str(exc), action_performed=False)
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
