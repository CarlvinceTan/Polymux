"""Run commands in a libvirt/QEMU guest through qemu-guest-agent."""

import argparse
import base64
import json
import math
import shlex
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from config import resolve_vm_device
from vm.mutex import mutation_mutex


SSH_OPTIONS = [
    "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
    "-o", "ServerAliveInterval=3", "-o", "ServerAliveCountMax=2",
]
BACKEND_TIMEOUT_SECONDS = 30
MUTEX_MARGIN_SECONDS = 120


def mutation_ttl(timeout: float) -> int:
    return max(300, math.ceil(timeout) + MUTEX_MARGIN_SECONDS)


def run_local_or_ssh(host: str | None, command: list[str]) -> subprocess.CompletedProcess:
    if host:
        command = ["ssh", *SSH_OPTIONS, host, shlex.join(command)]
    try:
        return subprocess.run(
            command,
            text=True,
            capture_output=True,
            timeout=BACKEND_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("QGA backend command timed out") from exc


def virsh(host: str | None, domain: str, payload: dict) -> dict:
    cmd = [
        "virsh",
        "-c",
        "qemu:///system",
        "qemu-agent-command",
        domain,
        json.dumps(payload, separators=(",", ":")),
    ]
    proc = run_local_or_ssh(host, cmd)
    if proc.returncode != 0:
        raise SystemExit(proc.stderr.strip() or proc.stdout.strip())
    return json.loads(proc.stdout)


def decode_field(result: dict, name: str) -> str:
    value = result.get("return", {}).get(name)
    if not value:
        return ""
    return base64.b64decode(value).decode(errors="replace")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True, help="VM device ID from instance/control.json")
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--owner", help="stable caller identity; required for a user-active VM")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="guest command after --")
    args = parser.parse_args()

    if not math.isfinite(args.timeout) or args.timeout <= 0:
        parser.error("--timeout must be a positive finite number")

    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("provide a guest command after --")

    try:
        host, domain = resolve_vm_device(args.device)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))

    try:
        mutex_ttl = mutation_ttl(args.timeout)
        with mutation_mutex(
            args.device, domain, args.owner, ttl_seconds=mutex_ttl
        ):
            payload = {
                "execute": "guest-exec",
                "arguments": {
                    "path": command[0],
                    "arg": command[1:],
                    "capture-output": True,
                },
            }
            pid = virsh(host, domain, payload)["return"]["pid"]
            deadline = time.time() + args.timeout
            status = None
            while time.time() < deadline:
                status = virsh(
                    host,
                    domain,
                    {"execute": "guest-exec-status", "arguments": {"pid": pid}},
                )
                if status.get("return", {}).get("exited"):
                    break
                time.sleep(1)
            else:
                raise SystemExit(f"timeout waiting for guest pid {pid}")

            sys.stdout.write(decode_field(status, "out-data"))
            sys.stderr.write(decode_field(status, "err-data"))
            return int(status.get("return", {}).get("exitcode", 0))
    except (OSError, RuntimeError, ValueError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
