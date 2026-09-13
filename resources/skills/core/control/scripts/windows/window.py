"""Dispatch exact-window operations to the native Windows PowerShell backend."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


BACKEND = Path(__file__).with_suffix(".ps1")
OPTION_NAMES = {
    "--pid": "ProcessId", "--window-id": "WindowId", "--output": "Output",
    "--match-attribute": "MatchAttribute", "--match-value": "MatchValue",
    "--new-value": "NewValue", "--expected-value": "ExpectedValue",
}


def request_payload(arguments: list[str]) -> dict:
    if not arguments or arguments[0] not in {"app-identity", "list", "capture", "inspect", "press", "set-value"}:
        raise ValueError("invalid Windows operation")
    payload = {"Command": arguments[0]}
    options = arguments[1:]
    if len(options) % 2:
        raise ValueError("each Windows option requires a value")
    for option, value in zip(options[::2], options[1::2]):
        key = OPTION_NAMES.get(option)
        if key is None or key in payload:
            raise ValueError("unknown or repeated Windows option")
        payload[key] = int(value) if key in {"ProcessId", "WindowId"} else value
    if payload.get("ProcessId", 0) <= 0:
        raise ValueError("a positive process ID is required")
    return payload


def main() -> int:
    executable = "powershell.exe"
    command = [
        executable,
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(BACKEND),
    ]
    try:
        # JSON prevents PowerShell from interpreting field text as option names.
        payload = request_payload(sys.argv[1:])
        result = subprocess.run(command, input=json.dumps(payload), capture_output=True,
                                text=True, encoding="utf-8", check=False, timeout=10)
    except (OSError, ValueError) as exc:
        print(json.dumps({"status": "blocked_windows_backend_unavailable", "reason": str(exc)}))
        return 5
    output = result.stdout.strip()
    if output:
        # ASCII JSON also survives Python's legacy Windows pipe encoding.
        try:
            print(json.dumps(json.loads(output)))
        except ValueError:
            print(json.dumps({"status": "blocked_windows_backend_failed", "reason": "invalid backend JSON"}))
            return 5
    else:
        print(json.dumps({"status": "blocked_windows_backend_failed", "reason": result.stderr.strip()[:500]}))
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
