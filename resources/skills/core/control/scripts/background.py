"""Prepare apps for safe on-demand background control on the current platform."""

from __future__ import annotations

import argparse
import json
import platform
import subprocess
import sys
from pathlib import Path

from config import load_config
from macos.compile import SwiftCompileError, compile_source


SCRIPT_DIR = Path(__file__).resolve().parent
PLATFORM_DIRS = {"darwin": "macos", "windows": "windows", "linux": "linux"}


def backend_command(system: str) -> list[str] | None:
    directory = PLATFORM_DIRS.get(system.lower())
    if not directory:
        return None
    if directory == "macos":
        source = SCRIPT_DIR / directory / "background.swift"
        if not source.is_file():
            return None
        try:
            return [str(compile_source(source, parse_as_library=True))]
        except (OSError, SwiftCompileError):
            return None
    script = SCRIPT_DIR / directory / "background.py"
    return [sys.executable, str(script)] if script.is_file() else None


def add_prepare_arguments(command: argparse.ArgumentParser) -> None:
    command.add_argument("--app", required=True)
    command.add_argument("--process")
    command.add_argument("--bundle-id", default="")
    command.add_argument("--app-path")
    command.add_argument("--check-only", action="store_true")
    command.add_argument("--allow-frontmost-requested", action="store_true")
    command.add_argument("--launch-arg", action="append", default=[])


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    add_prepare_arguments(commands.add_parser("prepare"))
    return parser


def prepare_arguments(args: argparse.Namespace) -> list[str]:
    values = ["prepare", "--app", args.app, "--process", args.process or args.app]
    for option, value in (("--bundle-id", args.bundle_id), ("--app-path", args.app_path)):
        if value:
            values.extend([option, value])
    if args.check_only:
        values.append("--check-only")
    if args.allow_frontmost_requested:
        values.append("--allow-frontmost-requested")
    for value in args.launch_arg:
        values.extend(["--launch-arg", value])
    return values


def main() -> int:
    args = build_parser().parse_args()
    try:
        config = load_config()
        local = next(d for d in config['devices'].values() if d['kind'] == 'local')
        if local.get('user_active', True):
            args.check_only = True
    except (OSError, ValueError, StopIteration) as exc:
        print(json.dumps({'status': 'blocked_device_configuration', 'reason': str(exc)}))
        return 2
    command = backend_command(platform.system())
    if command is None:
        print(
            json.dumps(
                {
                    "app": args.app,
                    "platform": platform.system(),
                    "status": "blocked_platform_backend_unavailable",
                }
            )
        )
        return 5
    return subprocess.run([*command, *prepare_arguments(args)], timeout=30).returncode


if __name__ == "__main__":
    raise SystemExit(main())
