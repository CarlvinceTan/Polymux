#!/usr/bin/env python3
"""Record narrow GUI Control route observations without granting trust."""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_STATE = Path.home() / ".midas" / "window-control" / "route-observations.json"


def app_identity(app_path: Path) -> dict[str, str]:
    info_path = app_path / "Contents" / "Info.plist"
    with info_path.open("rb") as handle:
        info = plistlib.load(handle)
    return {
        "path": str(app_path.resolve()),
        "bundle_id": str(info.get("CFBundleIdentifier", "")),
        "executable": str(info.get("CFBundleExecutable", "")),
        "version": str(info.get("CFBundleShortVersionString", "")),
        "app_build": str(info.get("CFBundleVersion", "")),
        "macos_build": subprocess.check_output(
            ["/usr/bin/sw_vers", "-buildVersion"], text=True
        ).strip(),
    }


def stable_app_identity(identity: dict[str, str]) -> tuple[str, str, str]:
    """Identify the installed app independently of version/build metadata."""
    return (identity["path"], identity["bundle_id"], identity["executable"])


def load_state(path: Path) -> dict:
    if not path.exists():
        return {"schema_version": 1, "observations": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") != 1 or not isinstance(data.get("observations"), list):
        raise SystemExit("invalid observation cache")
    return data


def save_state(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="route-observations-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def lookup(args: argparse.Namespace) -> int:
    identity = app_identity(Path(args.app_path))
    observations = load_state(Path(args.state))["observations"]
    matches = [
        item
        for item in observations
        if item["identity"]["path"] == identity["path"]
        and item["capability"] == args.capability
    ]
    exact = [
        item
        for item in matches
        if stable_app_identity(item["identity"]) == stable_app_identity(identity)
    ]
    if exact:
        result = {
            "status": "app_observed",
            "observation": exact[-1],
            "current": identity,
            "version_changed": exact[-1]["identity"] != identity,
        }
    elif matches:
        result = {"status": "stale_observed", "observation": matches[-1], "current": identity}
    else:
        result = {"status": "missing", "current": identity}
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def record(args: argparse.Namespace) -> int:
    path = Path(args.state)
    data = load_state(path)
    identity = app_identity(Path(args.app_path))
    entry = {
        "identity": identity,
        "capability": args.capability,
        "route": args.route,
        "prepared_state": args.prepared_state,
        "result": args.result,
        "observed_at": datetime.now(timezone.utc).isoformat(),
    }
    data["observations"] = [
        item
        for item in data["observations"]
        if not (
            stable_app_identity(item["identity"]) == stable_app_identity(identity)
            and item["capability"] == args.capability
            and item["route"] == args.route
            and item["prepared_state"] == args.prepared_state
        )
    ]
    data["observations"].append(entry)
    save_state(path, data)
    print(json.dumps({"status": "recorded", "observation": entry}, indent=2, sort_keys=True))
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument("--state", default=str(DEFAULT_STATE))
    commands = root.add_subparsers(dest="command", required=True)
    find = commands.add_parser("lookup")
    find.add_argument("--app-path", required=True)
    find.add_argument("--capability", required=True)
    find.set_defaults(func=lookup)
    add = commands.add_parser("record")
    add.add_argument("--app-path", required=True)
    add.add_argument("--capability", required=True)
    add.add_argument("--route", required=True)
    add.add_argument("--prepared-state", required=True)
    add.add_argument("--result", choices=("success", "failure"), required=True)
    add.set_defaults(func=record)
    return root


def main() -> int:
    args = parser().parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
