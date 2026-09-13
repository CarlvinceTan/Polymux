"""Read non-secret Control configuration by dotted key."""

from __future__ import annotations

import argparse
import json
import os
import platform
import socket
import sys
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
CONFIG = SKILL_ROOT / "instance" / "control.json"
CONFIG_LABEL = "instance/control.json"
DEVICE_KINDS = {"local", "remote", "vm", "phone"}
VM_HOST_KINDS = {"local", "remote"}
COMPUTER_PLATFORMS = {"linux", "macos", "windows"}
VM_PLATFORMS = {"linux", "windows"}
PHONE_PLATFORMS = {"android", "ios"}
ROOT_FIELDS = {"devices", "providers"}
DEVICE_FIELDS = {"kind", "platform", "host", "user_active", "state_command", "power", "lock_command"}
POWER_FIELDS = {"status", "wake", "sleep"}
PLATFORM_NAMES = {"Darwin": "macos", "Linux": "linux", "Windows": "windows"}


def validate_command(value: object, name: str) -> None:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{name} must be a non-empty string array")
    if not all(isinstance(argument, str) and argument for argument in value):
        raise ValueError(f"{name} arguments must be non-empty strings")


def validate_devices(value: dict) -> None:
    devices = value.get("devices")
    if not isinstance(devices, dict):
        raise ValueError(f"{CONFIG_LABEL} devices must be an object")
    if len(devices) > 32:
        raise ValueError("at most 32 devices are supported per authority")
    if not devices:
        raise ValueError(f"{CONFIG_LABEL} devices must not be empty")
    for device_id, device in devices.items():
        if not isinstance(device_id, str) or not device_id.strip():
            raise ValueError("device IDs must be non-empty strings")
        if not isinstance(device, dict):
            raise ValueError(f"device {device_id!r} must be an object")
        unknown = set(device) - DEVICE_FIELDS
        if unknown:
            fields = ", ".join(sorted(unknown))
            raise ValueError(f"device {device_id!r} has unsupported fields: {fields}")
        kind = device.get("kind")
        if kind not in DEVICE_KINDS:
            allowed = ", ".join(sorted(DEVICE_KINDS))
            raise ValueError(f"device {device_id!r} kind must be one of: {allowed}")
        platform = device.get("platform")
        if not isinstance(platform, str) or not platform.strip():
            raise ValueError(f"device {device_id!r} platform is required")
        platform = platform.casefold()
        if kind == "phone":
            allowed_platforms = PHONE_PLATFORMS
        elif kind == "vm":
            allowed_platforms = VM_PLATFORMS
        else:
            allowed_platforms = COMPUTER_PLATFORMS
        if platform not in allowed_platforms:
            allowed = ", ".join(sorted(allowed_platforms))
            raise ValueError(
                f"device {device_id!r} platform for {kind} must be one of: {allowed}"
            )
        user_active = device.get("user_active", True)
        if not isinstance(user_active, bool):
            raise ValueError(f"device {device_id!r} user_active must be a boolean")
        state_command = device.get("state_command")
        if state_command is not None:
            validate_command(state_command, f"devices.{device_id}.state_command")
        if device.get("lock_command") is not None:
            validate_command(device["lock_command"], f"devices.{device_id}.lock_command")
        power = device.get("power")
        if power is not None:
            if not isinstance(power, dict) or not power:
                raise ValueError(f"devices.{device_id}.power must be a non-empty object")
            unknown_power = set(power) - POWER_FIELDS
            if unknown_power:
                fields = ", ".join(sorted(unknown_power))
                raise ValueError(
                    f"devices.{device_id}.power has unsupported fields: {fields}"
                )
            for action, command in power.items():
                validate_command(command, f"devices.{device_id}.power.{action}")
            if "status" not in power:
                raise ValueError(f"devices.{device_id}.power.status is required")
            if "sleep" in power and "wake" not in power:
                raise ValueError(
                    f"devices.{device_id}.power.wake is required when sleep is configured"
                )

    local_devices = [
        device_id for device_id, device in devices.items()
        if device.get("kind") == "local"
    ]
    if len(local_devices) != 1:
        raise ValueError(f"{CONFIG_LABEL} devices must contain exactly one local device")

    for device_id, device in devices.items():
        kind = device.get("kind")
        if kind != "vm":
            if "host" in device:
                raise ValueError(f"device {device_id!r} host is only valid for a VM")
            continue
        host = device.get("host")
        if not isinstance(host, str) or not host.strip():
            raise ValueError(f"VM {device_id!r} host is required")
        if host not in devices:
            raise ValueError(f"VM {device_id!r} host {host!r} is not a configured device")
        if devices[host].get("kind") not in VM_HOST_KINDS:
            raise ValueError(
                f"VM {device_id!r} host {host!r} must be a local or remote device"
            )


def parse_config(text: str) -> dict:
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError(f"{CONFIG_LABEL} must contain a JSON object")
    unknown = set(value) - ROOT_FIELDS
    if unknown:
        fields = ", ".join(sorted(unknown))
        raise ValueError(f"{CONFIG_LABEL} has unsupported top-level fields: {fields}")
    providers = value.get("providers", {})
    if not isinstance(providers, dict):
        raise ValueError("providers must be an object of collector argument arrays")
    for name, command in providers.items():
        if not isinstance(name, str) or not name.strip():
            raise ValueError("provider names must be non-empty")
        validate_command(command, f"providers.{name}")
    validate_devices(value)
    return value


def load_config() -> dict:
    try:
        text = CONFIG.read_text(encoding="utf-8")
    except FileNotFoundError:
        # A clean install needs no personal configuration or consent dialog.
        # Treat an unconfigured local desktop as shared; never infer human absence.
        return local_defaults(True)
    value = parse_config(text)
    local_id = next(
        device_id
        for device_id, device in value["devices"].items()
        if device["kind"] == "local"
    )
    host = socket.gethostname()
    valid_local_ids = {host.casefold(), host.split(".")[0].casefold()}
    if local_id.casefold() not in valid_local_ids:
        raise ValueError(
            f"local device ID {local_id!r} must match this computer's hostname"
        )
    return value


def local_defaults(user_active: bool = True, *, hostname: str | None = None,
                   system: str | None = None) -> dict:
    """In-memory local routing shared by all agents; no files or browser setup."""
    if not isinstance(user_active, bool):
        raise ValueError("user_active must be a boolean")
    operating_system = system or platform.system()
    platform_name = PLATFORM_NAMES.get(operating_system)
    if platform_name is None:
        raise ValueError(f"Control setup is unsupported on {operating_system}")
    device_id = (hostname or socket.gethostname()).split(".", 1)[0].strip()
    if not device_id:
        raise ValueError("local hostname is unavailable")
    value: dict = {
        "devices": {
            device_id: {
                "kind": "local",
                "platform": platform_name,
                "user_active": user_active,
            }
        }
    }
    parse_config(json.dumps(value))
    return value


def initialize_local(
    user_active: bool,
    *,
    path: Path = CONFIG,
    hostname: str | None = None,
    system: str | None = None,
) -> dict:
    """Create the minimal local configuration without overwriting an installation."""
    value = local_defaults(user_active, hostname=hostname, system=system)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise ValueError(f"{path} already exists; setup will not overwrite it") from exc
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return value


def device_config(device_id: str, value: dict | None = None) -> dict:
    config = value if value is not None else load_config()
    devices = config["devices"]
    if device_id not in devices:
        host = socket.gethostname().casefold()
        if device_id.casefold() in {host, host.split('.')[0]}:
            local = next((d for d in devices.values() if d.get('kind') == 'local'), None)
            if local is not None:
                return local
        raise ValueError(f"unknown device {device_id!r}")
    return devices[device_id]


def coordination_policy(device: dict) -> dict:
    """Sharing policy is configuration, not a live human-presence measurement."""
    shared = device.get("user_active", True)
    if not isinstance(shared, bool):
        raise ValueError("user_active must be a boolean")
    return {"session_mode": "shared" if shared else "unattended",
            "human_attention_required": shared, "lease_required": True}


def device_requires_lock(device_id: str, value: dict | None = None) -> bool:
    device_config(device_id, value)
    return True


def device_shared(device_id: str, value: dict | None = None) -> bool:
    return coordination_policy(device_config(device_id, value))["human_attention_required"]


def resolve_vm_device(device_id: str, value: dict | None = None) -> tuple[str | None, str]:
    """Resolve a configured VM to its optional remote host and libvirt domain."""
    config = value if value is not None else load_config()
    device = device_config(device_id, config)
    if device.get("kind") != "vm":
        raise ValueError(f"device {device_id!r} is not a VM")
    host_id = device["host"]
    host = None if device_config(host_id, config).get("kind") == "local" else host_id
    return host, device_id


def get_value(key: str):
    value = load_config()
    for part in key.split("."):
        if not isinstance(value, dict) or part not in value:
            raise KeyError(key)
        value = value[part]
    return value


def parse_boolean(value: str) -> bool:
    lowered = value.casefold()
    if lowered not in {"true", "false"}:
        raise argparse.ArgumentTypeError("must be true or false")
    return lowered == "true"


def main(arguments: list[str] | None = None) -> int:
    values = list(sys.argv[1:] if arguments is None else arguments)
    if values and values[0] == "initialize":
        parser = argparse.ArgumentParser(description="Create a first-run Control configuration.")
        parser.add_argument("initialize")
        parser.add_argument("--user-active", required=True, type=parse_boolean)
        args = parser.parse_args(values)
        try:
            created = initialize_local(args.user_active)
        except (OSError, ValueError) as exc:
            parser.error(str(exc))
        device_id = next(iter(created["devices"]))
        print(json.dumps({
            "status": "configuration_created",
            "configuration": CONFIG_LABEL,
            "device": device_id,
            "user_active": args.user_active,
        }, separators=(",", ":")))
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("key", help="Dotted key such as devices.server.platform")
    args = parser.parse_args(values)
    try:
        value = get_value(args.key)
    except (OSError, json.JSONDecodeError, ValueError, KeyError) as exc:
        parser.error(f"cannot read {args.key!r}: {exc}")
    if isinstance(value, (dict, list)):
        print(json.dumps(value, separators=(",", ":")))
    elif isinstance(value, bool):
        print(str(value).lower())
    else:
        print(value)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
