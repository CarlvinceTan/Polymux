#!/usr/bin/env python3
"""Resolve compiled GUI routes and quarantine routes after focus incidents."""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parent.parent
DEFAULT_REGISTRY = SKILL_DIR / "references" / "app-control-registry.json"
STATE_DIR = Path.home() / ".flareai" / "state" / "window-control"


def atomic_json_write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f"{path.name}-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_json(path: Path, default: object | None = None) -> object:
    if not path.exists() and default is not None:
        return default
    with path.open("rb") as handle:
        return json.load(handle)


def sw_vers(flag: str) -> str:
    return subprocess.run(
        ["/usr/bin/sw_vers", flag],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def app_identity(path: Path) -> dict[str, str]:
    with (path / "Contents" / "Info.plist").open("rb") as handle:
        info = plistlib.load(handle)
    return {
        "bundle_id": str(info.get("CFBundleIdentifier", "")),
        "executable": str(info.get("CFBundleExecutable", "")),
        "version": str(info.get("CFBundleShortVersionString", "")),
        "app_build": str(info.get("CFBundleVersion", "")),
    }


def running_bundle_pids(bundle_id: str) -> set[int]:
    result = subprocess.run(
        ["/usr/bin/lsappinfo", "find", f"bundleid={bundle_id}"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return set()
    pids: set[int] = set()
    for token in result.stdout.splitlines():
        token = token.strip()
        if not token:
            continue
        info = subprocess.run(
            ["/usr/bin/lsappinfo", "info", "-only", "pid", token],
            check=False,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if info.startswith('"pid"='):
            try:
                pids.add(int(info.removeprefix('"pid"=')))
            except ValueError:
                continue
    return pids


def frontmost_pid() -> int | None:
    token = subprocess.run(
        ["/usr/bin/lsappinfo", "front"],
        check=False,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if not token:
        return None
    info = subprocess.run(
        ["/usr/bin/lsappinfo", "info", "-only", "pid", token],
        check=False,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if not info.startswith('"pid"='):
        return None
    try:
        return int(info.removeprefix('"pid"='))
    except ValueError:
        return None


def emit(status: str, **fields: object) -> None:
    print(f"status={status}")
    for key, value in fields.items():
        if isinstance(value, list):
            for item in value:
                print(f"{key}={item}")
        elif value is not None:
            print(f"{key}={value}")


def lookup_launch(args: argparse.Namespace) -> int:
    registry = load_json(Path(args.registry))
    if not isinstance(registry, dict) or registry.get("schema_version") != 1:
        emit("blocked_registry_invalid")
        return 2

    host = registry.get("host", {})
    try:
        current_version = sw_vers("-productVersion")
        current_build = sw_vers("-buildVersion")
    except (OSError, subprocess.CalledProcessError):
        emit("blocked_state_unavailable")
        return 2
    if host.get("product_version") != current_version or host.get("build") != current_build:
        emit(
            "blocked_compiled_host_stale",
            expected_version=host.get("product_version"),
            current_version=current_version,
            expected_build=host.get("build"),
            current_build=current_build,
        )
        return 3

    matches = [
        route
        for route in registry.get("launch_routes", [])
        if route.get("app") == args.app
        and (not args.bundle_id or route.get("bundle_id") == args.bundle_id)
    ]
    launch_behavior = "nonactivating"
    if not matches:
        matches = [
            route
            for route in registry.get("foregrounding_launch_routes", [])
            if route.get("app") == args.app
            and (not args.bundle_id or route.get("bundle_id") == args.bundle_id)
        ]
        launch_behavior = "restore_previous_frontmost"
    if len(matches) != 1:
        emit("blocked_compiled_route_missing" if not matches else "blocked_compiled_route_ambiguous")
        return 4
    route = matches[0]

    quarantine = Path(args.state_dir) / "quarantined-routes.json"
    quarantined = load_json(quarantine, {"schema_version": 1, "routes": {}})
    incident = quarantined.get("routes", {}).get(route["route_id"])
    superseded_foreground_incident = (
        launch_behavior == "restore_previous_frontmost"
        and incident
        and incident.get("event") in {
            "unexpected_foreground_activation",
            "unexpected_window_exposure",
        }
    )
    if incident and not superseded_foreground_incident:
        emit("blocked_route_quarantined", route_id=route["route_id"])
        return 5

    try:
        observed = app_identity(Path(route["path"]))
    except (OSError, plistlib.InvalidFileException):
        emit("blocked_app_identity_unavailable", route_id=route["route_id"])
        return 6
    expected = {key: str(route.get(key, "")) for key in observed}
    if observed != expected:
        emit(
            "blocked_compiled_app_stale",
            route_id=route["route_id"],
            expected=json.dumps(expected, sort_keys=True),
            observed=json.dumps(observed, sort_keys=True),
        )
        return 7

    emit(
        "verified_safe" if launch_behavior == "nonactivating" else "verified_monitored_recovery",
        route_id=route["route_id"],
        command=route["command"],
        arg=route["args"],
        bundle_id=route["bundle_id"],
        executable=route["executable"],
        launch_behavior=launch_behavior,
    )
    return 0


def lookup_control(args: argparse.Namespace) -> int:
    registry = load_json(Path(args.registry))
    if not isinstance(registry, dict) or registry.get("schema_version") != 1:
        emit("blocked_registry_invalid")
        return 2

    host = registry.get("host", {})
    try:
        current_version = sw_vers("-productVersion")
        current_build = sw_vers("-buildVersion")
    except (OSError, subprocess.CalledProcessError):
        emit("blocked_state_unavailable")
        return 2
    if host.get("product_version") != current_version or host.get("build") != current_build:
        emit(
            "blocked_compiled_host_stale",
            expected_version=host.get("product_version"),
            current_version=current_version,
            expected_build=host.get("build"),
            current_build=current_build,
        )
        return 3

    matches = [
        route
        for route in registry.get("control_routes", [])
        if route.get("app") == args.app
        and (not args.bundle_id or route.get("bundle_id") == args.bundle_id)
        and args.capability in route.get("capabilities", [])
    ]
    if len(matches) != 1:
        emit("blocked_compiled_control_missing" if not matches else "blocked_compiled_control_ambiguous")
        return 4
    route = matches[0]

    quarantine = Path(args.state_dir) / "quarantined-routes.json"
    quarantined = load_json(quarantine, {"schema_version": 1, "routes": {}})
    if route["route_id"] in quarantined.get("routes", {}):
        emit("blocked_route_quarantined", route_id=route["route_id"])
        return 5

    try:
        observed = app_identity(Path(route["path"]))
    except (OSError, plistlib.InvalidFileException):
        emit("blocked_app_identity_unavailable", route_id=route["route_id"])
        return 6
    expected = {key: str(route.get(key, "")) for key in observed}
    if observed != expected:
        emit(
            "blocked_compiled_app_stale",
            route_id=route["route_id"],
            expected=json.dumps(expected, sort_keys=True),
            observed=json.dumps(observed, sort_keys=True),
        )
        return 7

    emit(
        "verified_safe",
        route_id=route["route_id"],
        controller=route["controller"],
        prepared_state=route["prepared_state"],
        capability=args.capability,
    )
    return 0


def verify_audit_identity(args: argparse.Namespace) -> int:
    path = Path(args.app_path).resolve()
    if path.suffix != ".app" or not path.is_dir():
        emit("blocked_audit_app_path_invalid")
        return 2
    try:
        observed = app_identity(path)
        current_version = sw_vers("-productVersion")
        current_build = sw_vers("-buildVersion")
    except (OSError, plistlib.InvalidFileException, subprocess.CalledProcessError):
        emit("blocked_state_unavailable")
        return 2
    if observed["bundle_id"] != args.bundle_id:
        emit(
            "blocked_audit_identity_mismatch",
            expected_bundle_id=args.bundle_id,
            observed_bundle_id=observed["bundle_id"],
        )
        return 3

    bundle_pids = running_bundle_pids(args.bundle_id)
    if args.pid is not None and args.pid not in bundle_pids:
        emit("blocked_audit_pid_mismatch", pid=args.pid)
        return 4
    current_frontmost = frontmost_pid()
    if args.require_nonfrontmost and (
        current_frontmost is None
        or (args.pid is not None and current_frontmost == args.pid)
        or (args.pid is None and current_frontmost in bundle_pids)
    ):
        emit("blocked_user_active", frontmost_pid=current_frontmost)
        return 5

    emit(
        "verified_audit_identity",
        app_path=str(path),
        bundle_id=observed["bundle_id"],
        executable=observed["executable"],
        version=observed["version"],
        app_build=observed["app_build"],
        product_version=current_version,
        host_build=current_build,
        pid=args.pid,
    )
    return 0


def record_incident(args: argparse.Namespace) -> int:
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "timestamp": now,
        "route_id": args.route_id,
        "app_id": args.app_id,
        "controller": args.controller,
        "event": args.event,
        "details": args.details,
    }
    state_dir = Path(args.state_dir)
    incidents = state_dir / "incidents.jsonl"
    quarantine = state_dir / "quarantined-routes.json"
    state_dir.mkdir(parents=True, exist_ok=True)
    with incidents.open("a") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())

    quarantined = load_json(quarantine, {"schema_version": 1, "routes": {}})
    quarantined.setdefault("routes", {})[args.route_id] = record
    atomic_json_write(quarantine, quarantined)
    emit("recorded_and_quarantined", route_id=args.route_id)
    return 0


def check_route(args: argparse.Namespace) -> int:
    quarantine = Path(args.state_dir) / "quarantined-routes.json"
    quarantined = load_json(quarantine, {"schema_version": 1, "routes": {}})
    incident = quarantined.get("routes", {}).get(args.route_id)
    registry = load_json(DEFAULT_REGISTRY, {"foregrounding_launch_routes": []})
    monitored_recovery_route = any(
        route.get("route_id") == args.route_id
        for route in registry.get("foregrounding_launch_routes", [])
    )
    if (
        incident
        and monitored_recovery_route
        and incident.get("event") in {
            "unexpected_foreground_activation",
            "unexpected_window_exposure",
        }
    ):
        emit(
            "route_not_quarantined",
            route_id=args.route_id,
            superseded_event=incident.get("event"),
        )
        return 0
    if incident:
        emit(
            "blocked_route_quarantined",
            route_id=args.route_id,
            event=incident.get("event"),
            timestamp=incident.get("timestamp"),
        )
        return 5
    emit("route_not_quarantined", route_id=args.route_id)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)

    lookup = commands.add_parser("lookup-launch")
    lookup.add_argument("--app", required=True)
    lookup.add_argument("--bundle-id")
    lookup.add_argument("--registry", default=str(DEFAULT_REGISTRY))
    lookup.add_argument("--state-dir", default=str(STATE_DIR))

    control = commands.add_parser("lookup-control")
    control.add_argument("--app", required=True)
    control.add_argument("--bundle-id")
    control.add_argument(
        "--capability",
        required=True,
        choices=["capture", "inspect", "press", "set-value", "multiple-window-isolation"],
    )

    audit = commands.add_parser("verify-audit-identity")
    audit.add_argument("--app-path", required=True)
    audit.add_argument("--bundle-id", required=True)
    audit.add_argument("--pid", type=int)
    audit.add_argument("--require-nonfrontmost", action="store_true")
    control.add_argument("--registry", default=str(DEFAULT_REGISTRY))
    control.add_argument("--state-dir", default=str(STATE_DIR))

    incident = commands.add_parser("record-incident")
    incident.add_argument("--route-id", required=True)
    incident.add_argument("--app-id", required=True)
    incident.add_argument("--controller", required=True)
    incident.add_argument("--event", required=True)
    incident.add_argument("--details", default="")
    incident.add_argument("--state-dir", default=str(STATE_DIR))

    check = commands.add_parser("check-route")
    check.add_argument("--route-id", required=True)
    check.add_argument("--state-dir", default=str(STATE_DIR))
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "lookup-launch":
        return lookup_launch(args)
    if args.command == "lookup-control":
        return lookup_control(args)
    if args.command == "verify-audit-identity":
        return verify_audit_identity(args)
    if args.command == "record-incident":
        return record_incident(args)
    return check_route(args)


if __name__ == "__main__":
    raise SystemExit(main())
