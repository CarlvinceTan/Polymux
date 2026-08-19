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


def flareai_home() -> Path:
    """FlareAI's home, honouring a side instance the way the app itself does."""
    instance = (os.environ.get("FLAREAI_DEV_INSTANCE") or "").strip()
    return Path.home() / (f".flareai-{instance}" if instance else ".flareai")


STATE_DIR = flareai_home() / "state" / "window-control"

# The registry belongs to this installation, not to the app. Every route in it
# pins an exact macOS build and app bundle identity verified on *this* machine,
# so a shipped one is wrong for every other machine and stale after any macOS
# update — `lookup-*` would refuse it as `blocked_compiled_host_stale` anyway.
# It therefore sits beside the quarantine and incident state, is created empty
# on first use, and fills as audits on this host enroll routes.
DEFAULT_REGISTRY = STATE_DIR / "app-control-registry.json"

ROUTE_KINDS = (
    "control_routes",
    "launch_routes",
    "foregrounding_launch_routes",
    "recovery_routes",
)


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


def empty_registry() -> dict[str, object]:
    return {
        "schema_version": 1,
        "host": {
            "product": "macOS",
            "product_version": sw_vers("-productVersion"),
            "build": sw_vers("-buildVersion"),
        },
        **{kind: [] for kind in ROUTE_KINDS},
    }


def open_registry(path: Path) -> dict[str, object]:
    """
    This installation's registry, created empty and stamped with the current
    host when it is missing. A registry recorded against a different macOS
    build is reset rather than refused: its routes were verified against a
    build that is no longer running, so keeping them would only produce
    `blocked_compiled_host_stale` on every lookup.
    """
    current = empty_registry()
    if path.exists():
        existing = load_json(path)
        if (
            isinstance(existing, dict)
            and existing.get("schema_version") == 1
            and existing.get("host", {}) == current["host"]
        ):
            return existing
    atomic_json_write(path, current)
    return current


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


def resolve_app_path(app: str, bundle_id: str | None) -> Path | None:
    """
    The bundle for an app FlareAI has never controlled here. Spotlight answers
    by bundle id, which is the identity a route is pinned to; the name-based
    guesses are only a fallback for a caller that has no id yet.
    """
    if bundle_id:
        found = subprocess.run(
            ["/usr/bin/mdfind", f"kMDItemCFBundleIdentifier == '{bundle_id}'"],
            check=False,
            capture_output=True,
            text=True,
        )
        for line in found.stdout.splitlines():
            candidate = Path(line.strip())
            if candidate.suffix == ".app" and (candidate / "Contents" / "Info.plist").exists():
                return candidate
    for parent in (
        Path("/Applications"),
        Path("/System/Applications"),
        Path("/System/Applications/Utilities"),
        Path.home() / "Applications",
    ):
        candidate = parent / f"{app}.app"
        if (candidate / "Contents" / "Info.plist").exists():
            return candidate
    return None


def quarantined_routes(state_dir: Path) -> dict[str, dict]:
    quarantine = state_dir / "quarantined-routes.json"
    state = load_json(quarantine, {"schema_version": 1, "routes": {}})
    routes = state.get("routes", {})
    return routes if isinstance(routes, dict) else {}


def incident_kind(record: dict) -> str:
    """
    Launch and control fail independently, so they are banned independently: an
    app that surfaced when launched can still be safe to read once it is running,
    and a controller that surfaced it says nothing about the launcher. Older
    incidents carry no kind, so it is read off the controller that reported it.
    """
    kind = record.get("kind")
    if isinstance(kind, str) and kind in {"launch", "control"}:
        return kind
    return "launch" if "launch" in str(record.get("controller", "")) else "control"


def quarantined_for_app(state_dir: Path, app_id: str, kind: str) -> dict | None:
    """
    Whether this app has already misbehaved here, in this way. A first use is
    allowed once; what stops it repeating is the incident recorded when it went
    wrong, so that incident has to be found by app rather than only by the route
    id — which for a first use no longer exists once the attempt is over.
    """
    for record in quarantined_routes(state_dir).values():
        if (
            isinstance(record, dict)
            and record.get("app_id") == app_id
            and incident_kind(record) == kind
        ):
            return record
    return None


def first_use_identity(args: argparse.Namespace) -> tuple[Path, dict[str, str]] | None:
    path = resolve_app_path(args.app, args.bundle_id)
    if path is None:
        return None
    try:
        return path, app_identity(path)
    except (OSError, plistlib.InvalidFileException):
        return None


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
    try:
        registry = open_registry(Path(args.registry))
        current_version = sw_vers("-productVersion")
        current_build = sw_vers("-buildVersion")
    except (OSError, subprocess.CalledProcessError):
        emit("blocked_state_unavailable")
        return 2

    host = registry.get("host", {})
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
        if matches:
            launch_behavior = "restore_previous_frontmost"
    if not matches:
        return offer_first_use_launch(args)
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
    try:
        registry = open_registry(Path(args.registry))
        current_version = sw_vers("-productVersion")
        current_build = sw_vers("-buildVersion")
    except (OSError, subprocess.CalledProcessError):
        emit("blocked_state_unavailable")
        return 2

    host = registry.get("host", {})
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
    if not matches:
        return offer_first_use_control(args)
    if len(matches) != 1:
        emit("blocked_compiled_control_ambiguous")
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
    if args.kind:
        record["kind"] = args.kind
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
    try:
        registry = open_registry(DEFAULT_REGISTRY)
    except (OSError, subprocess.CalledProcessError):
        registry = {"foregrounding_launch_routes": []}
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


IDENTITY_KEYS = ("bundle_id", "executable", "version", "app_build")


def enroll_route(args: argparse.Namespace) -> int:
    """
    Adds one audited route to this installation's registry.

    Enrollment is deliberately not a free-form edit: the app bundle on disk has
    to still answer with the identity the route claims, because that tuple is
    the whole basis on which a later lookup trusts the route without launching
    anything.
    """
    try:
        route = json.loads(args.json)
    except json.JSONDecodeError:
        emit("blocked_route_json_invalid")
        return 2
    if not isinstance(route, dict):
        emit("blocked_route_json_invalid")
        return 2
    missing = [key for key in ("route_id", "app", "path", *IDENTITY_KEYS) if not route.get(key)]
    if missing:
        emit("blocked_route_incomplete", missing=",".join(missing))
        return 2

    try:
        observed = app_identity(Path(route["path"]))
    except (OSError, plistlib.InvalidFileException):
        emit("blocked_app_identity_unavailable", route_id=route["route_id"])
        return 6
    claimed = {key: str(route.get(key, "")) for key in IDENTITY_KEYS}
    if observed != claimed:
        emit(
            "blocked_route_identity_mismatch",
            route_id=route["route_id"],
            claimed=json.dumps(claimed, sort_keys=True),
            observed=json.dumps(observed, sort_keys=True),
        )
        return 7

    registry_path = Path(args.registry)
    try:
        registry = open_registry(registry_path)
    except (OSError, subprocess.CalledProcessError):
        emit("blocked_state_unavailable")
        return 2
    routes = [
        existing
        for existing in registry.get(args.kind, [])
        if existing.get("route_id") != route["route_id"]
    ]
    routes.append(route)
    registry[args.kind] = routes
    atomic_json_write(registry_path, registry)
    emit("enrolled_route", route_id=route["route_id"], kind=args.kind)
    return 0


def offer_first_use_launch(args: argparse.Namespace) -> int:
    """
    No compiled route for this app, so the answer is "try it once, watched"
    rather than "no". The launcher offered is the strict non-activating one, and
    the helper that receives it arms the focus, window-exposure and recovery
    monitors either way — so a first use is as contained as a compiled one, and
    it is the recorded outcome that makes the second use confident.
    """
    incident = quarantined_for_app(Path(args.state_dir), args.bundle_id or args.app, "launch")
    if incident:
        emit(
            "blocked_route_quarantined",
            route_id=incident.get("route_id"),
            event=incident.get("event"),
            timestamp=incident.get("timestamp"),
        )
        return 5
    resolved = first_use_identity(args)
    if resolved is None:
        emit("blocked_app_identity_unavailable")
        return 6
    path, identity = resolved
    emit(
        "first_use_monitored",
        route_id=first_use_route_id("launch", identity, ""),
        command="/usr/bin/open",
        arg=["-g", "-j", "-a", str(path)],
        launch_behavior="nonactivating",
        app_path=str(path),
        **identity,
    )
    return 0


def offer_first_use_control(args: argparse.Namespace) -> int:
    """The control half of the same rule: attempt it under the lease, remember."""
    incident = quarantined_for_app(Path(args.state_dir), args.bundle_id or args.app, "control")
    if incident:
        emit(
            "blocked_route_quarantined",
            route_id=incident.get("route_id"),
            event=incident.get("event"),
            timestamp=incident.get("timestamp"),
        )
        return 5
    resolved = first_use_identity(args)
    if resolved is None:
        emit("blocked_app_identity_unavailable")
        return 6
    path, identity = resolved
    emit(
        "first_use_monitored",
        route_id=first_use_route_id("control", identity, args.capability),
        controller="exact-window-capture+accessibility",
        prepared_state="observed",
        capability=args.capability,
        app_path=str(path),
        **identity,
    )
    return 0


def first_use_route_id(kind: str, identity: dict[str, str], capability: str) -> str:
    """
    Pinned to the identity it was observed against, so an app update does not
    inherit the last version's result — and stable, so the incident recorded
    against a failed first use is the same id a retry would look up.
    """
    parts = [
        "firstuse",
        kind,
        identity["bundle_id"] or "unknown",
        f"{identity['version']}-{identity['app_build']}",
    ]
    if capability:
        parts.append(capability)
    return ":".join(part.replace(":", "-") for part in parts)


def remember_route(args: argparse.Namespace) -> int:
    """
    Enrolls what a passing monitored attempt just proved. This is the whole of
    "it remembers": the next request for the same app, version and capability
    resolves to a compiled route and skips the first-use path entirely.
    """
    resolved = first_use_identity(args)
    if resolved is None:
        emit("blocked_app_identity_unavailable")
        return 6
    path, identity = resolved
    capability = getattr(args, "capability", "") or ""
    capabilities = [item for item in capability.split(",") if item]
    kind = {
        "launch": "launch_routes",
        # A first use that took focus and was recovered is not a hidden route,
        # and forgetting it would mean taking the user's focus again every time.
        # Recorded as what it is, so the next launch takes the compiled recovery
        # path deliberately instead of rediscovering the same surprise.
        "foregrounding": "foregrounding_launch_routes",
        "control": "control_routes",
    }[args.kind]
    route: dict[str, object] = {
        "route_id": first_use_route_id(args.kind, identity, ""),
        "status": "verified_safe",
        "app": args.app,
        "path": str(path),
        **identity,
        "trials": 1,
        "evidence": f"Passing monitored first use on this host at {now()}.",
    }
    if kind == "control_routes":
        route["route_id"] = first_use_route_id(args.kind, identity, "")
        route["controller"] = "exact-window-capture+accessibility"
        route["prepared_state"] = args.prepared_state or "observed"
        route["capabilities"] = capabilities
    else:
        route["controller"] = (
            "compiled-hidden-launch"
            if kind == "launch_routes"
            else "compiled-foregrounding-launch"
        )
        route["prepared_state"] = "hidden"
        route["command"] = args.launcher or "/usr/bin/open"
        route["args"] = args.arg or ["-g", "-j", "-a", str(path)]

    registry_path = Path(args.registry)
    try:
        registry = open_registry(registry_path)
    except (OSError, subprocess.CalledProcessError):
        emit("blocked_state_unavailable")
        return 2
    existing = [
        item for item in registry.get(kind, []) if item.get("route_id") != route["route_id"]
    ]
    # A capability learnt later joins the ones already proven for this exact
    # build rather than replacing them: capture is not withdrawn by proving press.
    if kind == "control_routes":
        previous = next(
            (
                item
                for item in registry.get(kind, [])
                if item.get("route_id") == route["route_id"]
            ),
            None,
        )
        if previous:
            route["capabilities"] = sorted(
                {*previous.get("capabilities", []), *capabilities},
            )
            route["trials"] = int(previous.get("trials", 1)) + 1
    existing.append(route)
    registry[kind] = existing
    atomic_json_write(registry_path, registry)
    emit(
        "remembered_route",
        route_id=route["route_id"],
        kind=kind,
        capabilities=",".join(route.get("capabilities", [])) or None,
    )
    return 0


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_routes(args: argparse.Namespace) -> int:
    """
    Prints what *this* installation has verified, which is the only honest answer
    to "what is supported here": coverage is per host build and per app build,
    so it is read out of the registry rather than from a list written elsewhere.
    """
    try:
        registry = open_registry(Path(args.registry))
    except (OSError, subprocess.CalledProcessError):
        emit("blocked_state_unavailable")
        return 2
    host = registry.get("host", {})
    print(f"host={host.get('product_version')} build={host.get('build')}")
    for kind in ROUTE_KINDS:
        routes = registry.get(kind, [])
        if args.kind and args.kind != kind:
            continue
        print(f"{kind}={len(routes)}")
        for route in sorted(routes, key=lambda item: str(item.get("app", ""))):
            capabilities = ",".join(route.get("capabilities", [])) or "-"
            print(
                f"  {route.get('app')}\t{route.get('route_id')}"
                f"\t{route.get('version')}/{route.get('app_build')}\t{capabilities}"
            )
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
    incident.add_argument(
        "--kind",
        choices=["launch", "control"],
        help="Which capability failed, so a launch ban and a control ban stay apart",
    )
    incident.add_argument("--state-dir", default=str(STATE_DIR))

    remember = commands.add_parser("remember-route")
    remember.add_argument(
        "--kind", required=True, choices=["launch", "foregrounding", "control"]
    )
    remember.add_argument("--app", required=True)
    remember.add_argument("--bundle-id")
    remember.add_argument("--capability", help="Comma-separated capabilities proven")
    remember.add_argument("--prepared-state")
    remember.add_argument("--launcher")
    remember.add_argument("--arg", action="append")
    remember.add_argument("--registry", default=str(DEFAULT_REGISTRY))
    remember.add_argument("--state-dir", default=str(STATE_DIR))

    enroll = commands.add_parser("enroll-route")
    enroll.add_argument("--kind", required=True, choices=list(ROUTE_KINDS))
    enroll.add_argument("--json", required=True, help="The route object to enroll")
    enroll.add_argument("--registry", default=str(DEFAULT_REGISTRY))

    listing = commands.add_parser("list-routes")
    listing.add_argument("--kind", choices=list(ROUTE_KINDS))
    listing.add_argument("--registry", default=str(DEFAULT_REGISTRY))

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
    if args.command == "remember-route":
        return remember_route(args)
    if args.command == "list-routes":
        return list_routes(args)
    if args.command == "enroll-route":
        return enroll_route(args)
    if args.command == "record-incident":
        return record_incident(args)
    return check_route(args)


if __name__ == "__main__":
    raise SystemExit(main())
