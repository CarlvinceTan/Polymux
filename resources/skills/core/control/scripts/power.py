"""Command-driven power control with independent final-state verification."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

from config import load_config


SKILL_ROOT = Path(__file__).resolve().parents[1]
TIMEOUT_SECONDS = 60
POLL_SECONDS = 3


class PowerError(RuntimeError):
    """A configured power capability is unavailable or unsafe."""


def mapping(value: object, name: str) -> dict:
    if not isinstance(value, dict):
        raise PowerError(f"{name} must be a mapping")
    return value


def device_config(config: dict, device_id: str) -> tuple[dict, dict]:
    devices = mapping(config.get("devices"), "devices")
    if device_id not in devices:
        available = ", ".join(sorted(devices))
        suffix = f"; available devices: {available}" if available else ""
        raise PowerError(f"unknown device {device_id!r}{suffix}")
    device = mapping(devices[device_id], f"devices.{device_id}")
    power = mapping(device.get("power"), f"devices.{device_id}.power")
    return device, power


class PowerController:
    def __init__(self, config: dict, device_id: str):
        self.config = config
        self.device_id = device_id
        self.device, self.power = device_config(config, device_id)

    def emit(self, status: str, **fields: object) -> None:
        print(json.dumps({"device": self.device_id, "status": status, **fields}, sort_keys=True))

    def action(self, name: str) -> list[str]:
        return self.command(
            self.power.get(name), f"devices.{self.device_id}.power.{name}"
        )

    def command(self, value: object, name: str) -> list[str]:
        if not isinstance(value, list) or not value:
            raise PowerError(f"{name} must be a non-empty list")
        if not all(isinstance(argument, str) and argument for argument in value):
            raise PowerError(f"{name} arguments must be non-empty strings")
        return [argument.replace("${skill}", str(SKILL_ROOT)) for argument in value]

    def run(self, command: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )

    def online(self) -> bool:
        try:
            result = self.run(self.action("status"))
        except OSError as exc:
            raise PowerError(f"status command could not run: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            raise PowerError("status command timed out") from exc
        if result.returncode == 0:
            return True
        if result.returncode == 1:
            return False
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        raise PowerError(f"status command failed: {detail[:500]}")

    def status(self) -> int:
        online = self.online()
        self.emit("online" if online else "offline")
        return 0

    def wake(self) -> int:
        if self.online():
            result = self.run(self.action("wake"))
            if result.returncode:
                raise PowerError("wake command failed while the device was online")
            if not self.online():
                raise PowerError("wake verification lost device reachability")
            self.emit("online", changed=False)
            return 0
        result = self.run(self.action("wake"))
        if result.returncode:
            raise PowerError("wake command failed")
        deadline = time.monotonic() + TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if self.online():
                self.emit("online", changed=True)
                return 0
            time.sleep(POLL_SECONDS)
        raise PowerError("wake command completed, but the device did not become reachable")

    def sleep(self) -> int:
        if not self.online():
            raise PowerError("device is already offline")
        wake = self.run(self.action("wake"))
        if wake.returncode:
            raise PowerError("sleep refused because the wake command failed")
        try:
            result = self.run(self.action("sleep"))
        except subprocess.TimeoutExpired:
            result = None
        deadline = time.monotonic() + TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if not self.online():
                self.emit("offline", changed=True)
                return 0
            time.sleep(POLL_SECONDS)
        if result is not None and result.returncode:
            raise PowerError("sleep command failed and the device remained online")
        raise PowerError("sleep command completed, but the device remained online")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("status", "wake", "sleep"))
    parser.add_argument("--device", required=True, help="device ID from instance/control.json")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        controller = PowerController(load_config(), args.device)
        return getattr(controller, args.command)()
    except (OSError, ValueError, PowerError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"device": args.device, "status": "error", "reason": str(exc)}, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
