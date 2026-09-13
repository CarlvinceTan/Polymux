"""Automatic guest-session mutexes for potentially mutating VM operations."""

from __future__ import annotations

import contextlib
import json
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from config import device_requires_lock


LOCK = SCRIPTS_DIR / "lock.py"


def lock_command(
    action: str,
    device: str,
    domain: str,
    *,
    owner: str | None = None,
    token: str | None = None,
    ttl_seconds: int = 300,
    operation: str | None = None,
    outcome: str | None = None,
) -> dict:
    command = [
        sys.executable, str(LOCK), action,
        "--device", device,
        "--app-id", "control.vm",
        "--window-id", domain,
        "--kind", "device",
    ]
    if action == "acquire":
        command.extend(["--owner", owner or "", "--ttl-seconds", str(ttl_seconds)])
    else:
        command.extend(["--token", token or ""])
    if action == "begin":
        command.extend(["--ttl-seconds", str(ttl_seconds)])
    if action == "finish":
        command.extend(["--operation", operation or "", "--outcome", outcome or "unknown"])
    result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=15)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("VM mutex returned invalid data") from exc
    if result.returncode:
        raise RuntimeError(f"VM mutex {action} failed: {payload.get('status', 'unknown')}")
    return payload


@contextlib.contextmanager
def mutation_mutex(
    device: str,
    domain: str,
    owner: str | None,
    *,
    ttl_seconds: int = 300,
) -> Iterator[None]:
    if not device_requires_lock(device):
        yield
        return
    if not owner:
        raise ValueError("VM mutation requires --owner for agent coordination")
    if ttl_seconds < 1:
        raise ValueError("VM mutex TTL must be positive")
    acquired = lock_command(
        "acquire", device, domain, owner=owner, ttl_seconds=ttl_seconds
    )
    token = acquired.get("token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("VM mutex acquisition returned no token")
    begun = lock_command("begin", device, domain, token=token, ttl_seconds=ttl_seconds)
    operation = begun.get("lock", {}).get("operation")
    if not operation:
        lock_command("release", device, domain, token=token)
        raise RuntimeError("VM action fence unavailable")
    outcome = "unknown"
    try:
        yield
        outcome = "verified"
    finally:
        lock_command("finish", device, domain, token=token, operation=operation, outcome=outcome)
        if outcome != "unknown":
            lock_command("release", device, domain, token=token)
