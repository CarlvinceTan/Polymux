#!/usr/bin/env python3
"""Atomic cross-agent leases for local GUI windows."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import secrets
import sys
import tempfile
import time
from pathlib import Path


def polymux_home() -> Path:
    """Polymux's home, honouring a side instance the way the app itself does."""
    instance = (os.environ.get("POLYMUX_DEV_INSTANCE") or "").strip()
    return Path.home() / (f".polymux-{instance}" if instance else ".polymux")


# Instance-scoped deliberately: two runs sharing one lease file would hand a
# side instance a lease over a window the user's own session is driving.
STATE_DIR = polymux_home() / "state"
REGISTRY = STATE_DIR / "window-control-leases.json"
LOCK_FILE = STATE_DIR / "window-control-leases.lock"


def resource_key(
    app_id: str,
    window_id: str,
    scope: str = "window",
    tab_id: str | None = None,
) -> str:
    suffix = tab_id if scope == "tab" else "*"
    raw = f"{app_id}\0{window_id}\0{scope}\0{suffix}".encode()
    return hashlib.sha256(raw).hexdigest()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def public_lease(lease: dict) -> dict:
    return {key: value for key, value in lease.items() if key != "token_hash"}


def load_registry() -> dict:
    if not REGISTRY.exists():
        return {"version": 1, "leases": {}}
    try:
        data = json.loads(REGISTRY.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid lease registry: {exc}") from exc
    if data.get("version") != 1 or not isinstance(data.get("leases"), dict):
        raise RuntimeError("unsupported lease registry")
    return data


def save_registry(data: dict) -> None:
    fd, tmp_name = tempfile.mkstemp(prefix="window-leases-", dir=STATE_DIR)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(data, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, REGISTRY)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def output(status: str, **fields: object) -> None:
    print(json.dumps({"status": status, **fields}, sort_keys=True))


def add_resource_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--app-id", required=True)
    parser.add_argument("--window-id", required=True)
    parser.add_argument("--scope", choices=("window", "tab"), default="window")
    parser.add_argument("--tab-id")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)

    acquire = commands.add_parser("acquire")
    add_resource_arguments(acquire)
    acquire.add_argument("--owner", required=True)
    acquire.add_argument(
        "--controller",
        required=True,
        choices=("browser-use", "computer-use", "app-specific"),
    )
    acquire.add_argument("--ttl-seconds", type=int, default=300)

    for name in ("validate", "renew", "release"):
        command = commands.add_parser(name)
        add_resource_arguments(command)
        command.add_argument("--token", required=True)
        if name == "renew":
            command.add_argument("--ttl-seconds", type=int, default=300)

    status = commands.add_parser("status")
    add_resource_arguments(status)
    commands.add_parser("list")
    return parser


def active(lease: dict, now: float) -> bool:
    return float(lease.get("expires_at", 0)) > now


def lease_scope(lease: dict) -> str:
    return str(lease.get("scope", "window"))


def conflicts(requested: dict, held: dict) -> bool:
    if requested["app_id"] != held.get("app_id"):
        return False
    if requested["window_id"] != held.get("window_id"):
        return False
    if requested["scope"] == "window" or lease_scope(held) == "window":
        return True
    return requested.get("tab_id") == held.get("tab_id")


def main() -> int:
    args = build_parser().parse_args()
    if args.command != "list" and args.scope == "tab" and not args.tab_id:
        output("error", reason="tab_scope_requires_tab_id")
        return 2
    if hasattr(args, "ttl_seconds") and not 30 <= args.ttl_seconds <= 3600:
        output("error", reason="ttl_seconds_must_be_30_to_3600")
        return 2

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with LOCK_FILE.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            data = load_registry()
        except RuntimeError as exc:
            output("error", reason=str(exc))
            return 2

        now = time.time()
        leases = data["leases"]
        changed = False

        if args.command == "list":
            visible = {
                key: public_lease(lease)
                for key, lease in leases.items()
                if active(lease, now)
            }
            output("ok", leases=visible)
            return 0

        key = resource_key(args.app_id, args.window_id, args.scope, args.tab_id)
        lease = leases.get(key)
        if lease is None and args.command != "acquire":
            for stored_key, stored_lease in leases.items():
                if (
                    stored_lease.get("app_id") == args.app_id
                    and stored_lease.get("window_id") == args.window_id
                    and lease_scope(stored_lease) == args.scope
                    and (
                        args.scope == "window"
                        or stored_lease.get("tab_id") == args.tab_id
                    )
                ):
                    key = stored_key
                    lease = stored_lease
                    break

        if args.command == "status":
            if lease is None or not active(lease, now):
                output("free", resource=key)
            else:
                output("held", resource=key, lease=public_lease(lease))
            return 0

        if args.command == "acquire":
            requested = {
                "app_id": args.app_id,
                "window_id": args.window_id,
                "scope": args.scope,
                "tab_id": args.tab_id,
            }
            for held_key, held_lease in leases.items():
                if not active(held_lease, now):
                    continue
                if conflicts(requested, held_lease):
                    output(
                        "blocked_held",
                        resource=key,
                        held_resource=held_key,
                        lease=public_lease(held_lease),
                    )
                    return 3
                if (
                    held_lease.get("owner") == args.owner
                    and (
                        held_lease.get("app_id") != args.app_id
                        or held_lease.get("window_id") != args.window_id
                    )
                ):
                    output(
                        "blocked_owner_has_window",
                        resource=key,
                        held_resource=held_key,
                        lease=public_lease(held_lease),
                    )
                    return 3
            token = "lease_" + secrets.token_urlsafe(24)
            lease = {
                "app_id": args.app_id,
                "window_id": args.window_id,
                "tab_id": args.tab_id,
                "scope": args.scope,
                "owner": args.owner,
                "controller": args.controller,
                "token_hash": token_hash(token),
                "acquired_at": now,
                "renewed_at": now,
                "expires_at": now + args.ttl_seconds,
            }
            leases[key] = lease
            changed = True
            output(
                "acquired",
                resource=key,
                token=token,
                lease=public_lease(lease),
            )

        elif lease is None or not active(lease, now):
            output("invalid", resource=key, reason="missing_or_expired")
            return 4
        elif not secrets.compare_digest(
            str(lease.get("token_hash", "")), token_hash(args.token)
        ):
            output("invalid", resource=key, reason="token_mismatch")
            return 4
        elif args.command == "validate":
            output("valid", resource=key, lease=public_lease(lease))
            return 0
        elif args.command == "renew":
            lease["renewed_at"] = now
            lease["expires_at"] = now + args.ttl_seconds
            changed = True
            output("renewed", resource=key, lease=public_lease(lease))
        elif args.command == "release":
            del leases[key]
            changed = True
            output("released", resource=key)

        if changed:
            save_registry(data)
        return 0


if __name__ == "__main__":
    sys.exit(main())
