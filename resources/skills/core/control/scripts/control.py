"""Portable command-driven device state for the Control skill."""

from __future__ import annotations

import argparse
import copy
import json
import platform
import hashlib
import os
import time
import socket
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from config import coordination_policy, load_config as load_control_config
from browser import default_browser
from transport import command_json
from storage import runtime_dir
# Existing callers may import these rendering helpers from control.
from output import quote_yaml, yaml_lines, yaml_scalar, compact_state, prepare_view


SKILL_ROOT = Path(__file__).resolve().parents[1]
PLATFORM_NAMES = {
    "darwin": "macos",
    "windows": "windows",
    "linux": "linux",
    "ios": "ios",
    "android": "android",
}


class ControlError(RuntimeError):
    pass


@dataclass
class StateResult:
    state: dict[str, Any] | None
    error: str | None = None
    warnings: list[str | dict[str, Any]] = field(default_factory=list)


def normalize_platform(value: str | None = None) -> str:
    raw = (value or platform.system()).strip().lower()
    return PLATFORM_NAMES.get(raw, raw or "unknown")


def resolve_command(command: list[str]) -> list[str]:
    """Resolve configured script paths relative to the Control skill root."""
    resolved = [value.replace("${skill}", str(SKILL_ROOT)) for value in command]
    executable = Path(resolved[0]).expanduser()
    if not executable.is_absolute() and (resolved[0].startswith(".") or "/" in resolved[0]):
        resolved[0] = str((SKILL_ROOT / executable).resolve())
    return resolved


def validate_command(command: object, name: str) -> list[str]:
    if not isinstance(command, list) or not command:
        raise ControlError(f"{name} must be a non-empty string list")
    if not all(isinstance(value, str) and value for value in command):
        raise ControlError(f"{name} arguments must be non-empty strings")
    return resolve_command(command)


def run_json_command(command: object, timeout: float) -> dict[str, Any]:
    resolved = validate_command(command, "state_command")
    try:
        return command_json(resolved, timeout)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise ControlError(str(exc)) from exc


def builtin_local_state(device: dict[str, Any]) -> dict[str, Any]:
    value = command_json([sys.executable, str(SCRIPT_DIR / "desktop.py")], 4.5)
    value.update(platform=normalize_platform(device.get("platform")), kind=device.get("kind"),
                 name=device.get("name") or socket.gethostname().split(".")[0])
    return value


def normalize_state(value: dict[str, Any], device: dict[str, Any]) -> dict[str, Any]:
    from browser.redact import ambient
    state = ambient(copy.deepcopy(value))
    state["platform"] = normalize_platform(state.get("platform") or device.get("platform"))
    state["kind"] = device.get("kind")
    state["name"] = state.get("name") or device.get("name") or device["id"]
    allowed = {"platform", "kind", "name", "active", "apps", "surfaces", "browsers",
               "capabilities", "observed_at", "completeness", "revision", "default_browser", "human_active", "sessions", "session_inventory_complete", "permission_owner", "tab_inventory"}
    state = {key: state[key] for key in state if key in allowed}
    state["device_id"] = device["id"]
    state["user_active"] = device.get("user_active", True)
    state["coordination"] = coordination_policy(device)
    state.setdefault("observed_at", time.time())
    state.setdefault("completeness", "unknown")
    state.setdefault("surfaces", [])
    if not isinstance(state["surfaces"], list):
        raise ControlError("state surfaces must be an array")
    for surface in state["surfaces"]:
        if not isinstance(surface, dict):
            raise ControlError("surface must be an object")
        surface["device_id"] = device["id"]
        surface.setdefault("observed_at", state["observed_at"])
    if not isinstance(state["name"], str):
        raise ControlError("state name must be a string")
    if "apps" in state and not isinstance(state["apps"], dict):
        raise ControlError("state apps must be an object")
    return state


def collect_device(device: dict[str, Any], timeout: float) -> StateResult:
    try:
        command = device.get("command")
        if command is not None:
            value = run_json_command(command, timeout)
        elif device.get("kind") == "local":
            value = builtin_local_state(device)
        else:
            value = {"completeness": "unavailable", "capabilities": {},
                     "_warnings": ["no state collector configured"]}
        warnings = value.pop("_warnings", [])
        return StateResult(normalize_state(value, device), warnings=warnings)
    except (ControlError, OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        return StateResult(None, str(exc))


def validate_device(device: dict[str, Any]) -> None:
    for key in ("id", "name", "kind", "platform"):
        if not isinstance(device.get(key), str) or not device[key].strip():
            raise ControlError(f"device {key} is required")
    if device.get("command") is not None:
        validate_command(device["command"], f"devices.{device['id']}.state_command")


def devices_from_config(
    config: dict[str, Any], *, user_active_only: bool = False
) -> list[dict[str, Any]]:
    configured = config.get("devices", {})
    if not isinstance(configured, dict):
        raise ControlError("instance/control.json devices must be an object")
    devices: list[dict[str, Any]] = []
    for device_id, values in configured.items():
        if not isinstance(values, dict):
            continue
        user_active = values.get("user_active", True)
        if not isinstance(user_active, bool):
            raise ControlError(f"device {device_id!r} user_active must be a boolean")
        if user_active_only and not user_active:
            continue
        device = {
            "id": device_id,
            "name": device_id,
            "kind": values.get("kind"),
            "platform": values.get("platform"),
            "user_active": user_active,
            "command": values.get("state_command"),
            "power": values.get("power"),
        }
        validate_device(device)
        devices.append(device)
    return devices


def run_probe(command: object, timeout: float) -> subprocess.CompletedProcess[str]:
    resolved = validate_command(command, "reachability probe")
    try:
        return subprocess.run(
            resolved, stdin=subprocess.DEVNULL, text=True, capture_output=True,
            timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ControlError(str(exc)) from exc


def doctor_device(device: dict[str, Any], timeout: float) -> tuple[dict[str, Any], bool]:
    """Verify one configured device and every configured read-only power probe."""
    report: dict[str, Any] = {"user_active": device["user_active"], "coordination": coordination_policy(device)}
    failed = False
    power = device.get("power")
    power_probe: tuple[subprocess.CompletedProcess[str] | None, str | None] | None = None

    def read_power_status() -> tuple[subprocess.CompletedProcess[str] | None, str | None]:
        nonlocal power_probe
        if power_probe is None:
            try:
                power_probe = (run_probe(power.get("status"), timeout), None)
            except ControlError as exc:
                power_probe = (None, str(exc))
        return power_probe

    command = device.get("command")
    if command is not None or device.get("kind") == "local":
        result = collect_device(device, timeout)
        report.update(
            source="command" if command else "builtin",
            reachable=result.state is not None,
        )
        if result.error:
            report["error"] = result.error
        if result.warnings:
            report["warnings"] = result.warnings
        failed = result.state is None
    elif device.get("kind") == "vm":
        try:
            result = run_probe([
                sys.executable, str(SKILL_ROOT / "scripts" / "vm" / "libvirt.py"),
                "status", "--device", device["id"],
            ], timeout)
            report.update(source="libvirt", reachable=result.returncode == 0)
            if result.returncode:
                report["error"] = (
                    result.stderr.strip() or result.stdout.strip()
                    or f"VM status exited {result.returncode}"
                )[:500]
                failed = True
        except ControlError as exc:
            report.update(source="libvirt", reachable=False, error=str(exc))
            failed = True
    else:
        status_command = power.get("status") if isinstance(power, dict) else None
        if status_command is None:
            report.update(
                source="none", reachable=False,
                error="configured device has no state_command or power.status probe",
            )
            failed = True
        else:
            status, probe_error = read_power_status()
            if probe_error is None and status is not None:
                online = status.returncode == 0
                report.update(source="power.status", reachable=online)
                if not online:
                    report["error"] = (
                        "device is offline" if status.returncode == 1 else
                        (status.stderr.strip() or status.stdout.strip()
                         or f"power.status exited {status.returncode}")[:500]
                    )
                    failed = True
            else:
                report.update(source="power.status", reachable=False, error=probe_error)
                failed = True

    if isinstance(power, dict):
        power_report = {
            "wake_configured": "wake" in power,
            "sleep_configured": "sleep" in power,
        }
        status, probe_error = read_power_status()
        if probe_error is None and status is not None:
            if status.returncode == 0:
                power_report["status"] = "online"
            elif status.returncode == 1:
                power_report["status"] = "offline"
                failed = True
            else:
                power_report.update(
                    status="error",
                    error=(status.stderr.strip() or status.stdout.strip()
                           or f"exit {status.returncode}")[:500],
                )
                failed = True
        else:
            power_report.update(status="error", error=probe_error)
            failed = True
        report["power"] = power_report
    return report, failed


def cmd_collect_local(args: argparse.Namespace) -> int:
    local = next(d for d in load_control_config()["devices"].values() if d["kind"] == "local")
    device = {
        "id": socket.gethostname(),
        "name": args.name,
        "kind": "local",
        "platform": args.platform,
        "user_active": local.get("user_active", True),
    }
    value = run_json_command(args.collector_command, args.timeout) if args.collector_command else builtin_local_state(device)
    normalized = normalize_state(value, device)
    normalized["_warnings"] = value.get("_warnings", [])
    print(json.dumps(normalized, ensure_ascii=True))
    return 0


def device_snapshot(device_id, configuration, timeout=8):
    from config import device_config
    target = device_config(device_id, configuration)
    configured_id = next(k for k,v in configuration["devices"].items() if v is target)
    device = next(d for d in devices_from_config(configuration) if d["id"] == configured_id)
    result = collect_device(device, timeout)
    value = result.state or {"device_id": device_id, "name": device_id, "kind": device["kind"],
                            "platform": device["platform"], "completeness": "unavailable", "surfaces": [],
                            "observed_at": time.time(), "user_active": device.get("user_active", True)}
    warnings = list(result.warnings)
    if result.error:
        warnings.append(result.error)
    if device["kind"] == "local":
        def provider(item):
            name, command = item
            try:
                payload = command_json(resolve_command(command), min(timeout, 3))
                if payload.get("schema_version") != 1 or not isinstance(payload.get("surfaces"), list):
                    raise ValueError("provider requires schema_version 1 and a surfaces array")
                timestamp = payload.get("observed_at")
                if not isinstance(timestamp, (int, float)) or not 0 <= time.time() - timestamp < 5:
                    raise ValueError("provider observation is stale or undated")
                return name, payload, None
            except (OSError, ValueError, subprocess.SubprocessError) as exc:
                return name, None, str(exc)
        items = list(configuration.get("providers", {}).items())
        with ThreadPoolExecutor(max_workers=max(1, min(8, len(items)))) as pool:
            for name, payload, error in pool.map(provider, items):
                if error:
                    warnings.append({"provider": name, "reason": error})
                else:
                    for surface in payload["surfaces"]:
                        if not isinstance(surface, dict):
                            continue
                        value.setdefault("surfaces", []).append({**surface, "device_id": device_id,
                            "provider": name, "observed_at": payload["observed_at"]})
    if value.get("completeness") == "unavailable" and value.get("surfaces"):
        value["completeness"] = "partial"
    value["coordination"] = coordination_policy(device)
    value["_warnings"] = warnings
    # Providers are merged after native normalization, so redact the final result.
    from browser.redact import ambient
    return ambient(value)


def cmd_collect_device(args):
    print(json.dumps(device_snapshot(args.device, load_control_config(), args.timeout), ensure_ascii=True))
    return 0


def stable_revision(value):
    def stable(item):
        if isinstance(item, dict):
            return {k: stable(v) for k, v in item.items() if k not in {"observed_at", "revision", "elapsed_ms", "cached"}}
        if isinstance(item, list):
            return [stable(v) for v in item]
        return item
    return hashlib.sha256(json.dumps(stable(value), sort_keys=True).encode()).hexdigest()[:20]


def cmd_state(args: argparse.Namespace) -> int:
    started = time.monotonic()
    configuration = load_control_config()
    devices = devices_from_config(configuration)
    selected = getattr(args, "device", None)
    if selected:
        devices = [d for d in devices if d["id"] == selected]
        if not devices:
            raise ControlError("unknown device")
    key = hashlib.sha256(json.dumps([configuration, selected], sort_keys=True).encode()).hexdigest()
    cache = runtime_dir() / ("state-" + key + ".json")
    output = None
    if not getattr(args, "fresh", False):
        try:
            candidate = json.loads(cache.read_text())
            if 0 <= time.time() - candidate["observed_at"] < 2:
                output = candidate
                output["cached"] = True
        except (OSError, ValueError, KeyError):
            pass
    if output is None:
        def collect(item):
            try:
                state = command_json([sys.executable, str(Path(__file__).resolve()), "collect-device",
                    "--device", item["id"], "--timeout", str(args.timeout)], args.timeout)
                state["coordination"] = coordination_policy(item)
                return state
            except (OSError, ValueError, subprocess.SubprocessError) as exc:
                return {"device_id": item["id"], "name": item["id"], "platform": item["platform"],
                    "kind": item["kind"], "completeness": "unavailable", "coordination": coordination_policy(item),
                        "_warnings": [str(exc)[:250]]}
        # One worker per device avoids N waves of timeouts. Configuration is bounded to 32 devices.
        with ThreadPoolExecutor(max_workers=max(1, len(devices))) as pool:
            states = list(pool.map(collect, devices))
        output = {"schema_version": 1, "observed_at": time.time(), "devices": states, "cached": False}
        output["revision"] = stable_revision(output)
        temporary = cache.with_name(cache.name + f".{os.getpid()}.tmp")
        try:
            temporary.write_text(json.dumps(output))
            temporary.chmod(0o600)
            os.replace(temporary, cache)
        finally:
            temporary.unlink(missing_ok=True)
    output["elapsed_ms"] = round((time.monotonic() - started) * 1000)
    if getattr(args, "since", None) == output["revision"]:
        output = {k: output[k] for k in ("schema_version", "revision", "observed_at", "elapsed_ms", "cached")}
        output["unchanged"] = True
    else:
        output = prepare_view(output, app_id=getattr(args, "app_id", None), full=getattr(args, "full", False))
    print(json.dumps(output, ensure_ascii=True) if getattr(args, "json", False) else "\n".join(yaml_lines(output)))
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    if getattr(args, "fix", False) or getattr(args, "offline", False):
        raise ControlError("doctor is read-only; --fix and --offline are unsupported")
    report: dict[str, Any] = {"configuration": "instance/control.json", "devices": {}}
    failed = False
    configuration = load_control_config()
    devices = devices_from_config(configuration, user_active_only=False)
    try:
        browser = default_browser()
        report["browser"] = {"path": browser["path"], "name": browser["name"]}
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        report["browser"] = {"status": "unavailable", "reason": str(exc)}
        failed = True
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(devices)))) as pool:
        results = list(pool.map(lambda item: doctor_device(item, args.timeout), devices))
    for device, (device_report, device_failed) in zip(devices, results):
        report["devices"][device.get("id", "unknown")] = device_report
        failed = failed or device_failed
    print("\n".join(yaml_lines(report)))
    return 1 if failed else 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Control device state through configured commands")
    commands = root.add_subparsers(dest="command", required=True)

    state = commands.add_parser("state")
    state.add_argument("--timeout", type=float, default=8.0)
    state.add_argument("--json", action="store_true")
    state.add_argument("--full", action="store_true", help="retain full surface metadata")
    state.add_argument("--fresh", action="store_true", help="bypass the two-second ambient cache")
    state.add_argument("--device")
    state.add_argument("--app-id")
    state.add_argument("--since", help="omit unchanged snapshot content")
    state.set_defaults(func=cmd_state)

    worker = commands.add_parser("collect-device")
    worker.add_argument("--device", required=True)
    worker.add_argument("--timeout", type=float, default=8.0)
    worker.set_defaults(func=cmd_collect_device)

    doctor = commands.add_parser("doctor")
    doctor.add_argument("--timeout", type=float, default=30.0)
    doctor.add_argument(
        "--fix",
        action="store_true",
        help="apply supported repairs",
    )
    doctor.add_argument(
        "--offline", action="store_true", help="skip network checks"
    )
    doctor.set_defaults(func=cmd_doctor)

    local = commands.add_parser("collect-local")
    local.add_argument("--name")
    local.add_argument("--platform")
    local.add_argument("--collector-command", nargs=argparse.REMAINDER)
    local.add_argument("--timeout", type=float, default=8.0)
    local.set_defaults(func=cmd_collect_local)
    return root


def main() -> int:
    try:
        args = parser().parse_args()
        if hasattr(args, "timeout") and not 0.1 <= args.timeout <= 60:
            raise ControlError("timeout must be 0.1 to 60 seconds")
        return args.func(args)
    except FileNotFoundError:
        print("\n".join(yaml_lines({
            "status": "setup_required",
            "configuration": "instance/control.json",
            "next": "references/setup.md",
        })))
        return 2
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print("\n".join(yaml_lines({
            "status": "blocked_device_configuration",
            "configuration": "instance/control.json",
            "reason": str(exc),
        })))
        return 2
    except ControlError as exc:
        print(f"control: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
