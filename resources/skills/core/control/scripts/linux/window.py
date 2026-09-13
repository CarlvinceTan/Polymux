"""Exact X11 window observation and AT-SPI control backend."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def emit(status: str, code: int = 0, **fields: object) -> None:
    print(json.dumps({"status": status, **fields}, sort_keys=True))
    raise SystemExit(code)


def run(*args: str) -> str:
    result = subprocess.run(args, capture_output=True, text=True, check=False, timeout=5)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "X11 command failed")
    return result.stdout.strip()


def require_x11() -> None:
    if not os.environ.get("DISPLAY") or not shutil.which("xdotool"):
        emit("blocked_x11_backend_unavailable", 5)


def window_pid(window_id: int) -> int:
    return int(run("xdotool", "getwindowpid", str(window_id)))


def window_row(window_id: int) -> dict:
    values: dict[str, int] = {}
    for line in run("xdotool", "getwindowgeometry", "--shell", str(window_id)).splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            if key in {"X", "Y", "WIDTH", "HEIGHT"}:
                values[key] = int(value)
    title = run("xdotool", "getwindowname", str(window_id))
    return {
        "window_id": window_id,
        "title": title,
        "onscreen": True,
        "x": values.get("X", 0),
        "y": values.get("Y", 0),
        "width": values.get("WIDTH", 0),
        "height": values.get("HEIGHT", 0),
    }


def windows(pid: int) -> list[dict]:
    result = subprocess.run(
        ["xdotool", "search", "--onlyvisible", "--pid", str(pid)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode not in {0, 1}:
        raise RuntimeError(result.stderr.strip())
    rows = [window_row(int(value)) for value in result.stdout.split()]
    return [row for row in rows if row["width"] >= 80 and row["height"] >= 60]


def accessible_controls(pid: int, title: str):
    try:
        import pyatspi  # type: ignore
    except ImportError:
        emit("blocked_atspi_backend_unavailable", 5)
    desktop = pyatspi.Registry.getDesktop(0)
    applications = [app for app in desktop if getattr(app, "get_process_id", lambda: -1)() == pid]
    roots = [child for app in applications for child in app if child.name == title]
    if len(roots) != 1:
        emit("blocked_accessible_window_mapping", 5, matches=len(roots))
    result = []

    def walk(node) -> None:
        if len(result) >= 500:
            return
        try:
            actions = []
            try:
                action = node.queryAction()
                actions = [action.getName(i) for i in range(action.nActions)]
            except Exception:
                pass
            extents = node.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
            attributes = node.getAttributes()
            if isinstance(attributes, list):
                attributes = dict(
                    item.split(":", 1) for item in attributes if ":" in item
                )
            text_value = {}
            if node.getRoleName().casefold() not in {"password text", "password entry"}:
                try:
                    text_value["value"] = node.queryText().getText(0, -1)
                except Exception:
                    pass
            result.append(
                {
                    **text_value,
                    "node": node,
                    "role": node.getRoleName(),
                    "title": node.name or "",
                    "description": node.description or "",
                    "identifier": attributes.get("id", "") if isinstance(attributes, dict) else "",
                    "actions": actions,
                    "frame": {"x": extents.x, "y": extents.y, "width": extents.width, "height": extents.height},
                }
            )
            for child in node:
                walk(child)
        except Exception:
            return

    walk(roots[0])
    return result


def public_controls(rows: list[dict]) -> list[dict]:
    return [{key: value for key, value in row.items() if key != "node"} for row in rows]


def set_control_value(node, value: str) -> bool:
    node.queryEditableText().setTextContents(value)
    return node.queryText().getText(0, -1) == value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("app-identity", "list", "capture", "inspect", "press", "set-value"))
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--window-id", type=int)
    parser.add_argument("--output")
    parser.add_argument("--match-attribute", choices=("role", "title", "description", "identifier"))
    parser.add_argument("--match-value")
    parser.add_argument("--new-value")
    parser.add_argument("--expected-value")
    args = parser.parse_args()
    require_x11()
    try:
        if args.command == "app-identity":
            executable = Path(f"/proc/{args.pid}/exe").resolve(strict=True)
            emit("identified", app_id=str(executable))
        if args.command == "list":
            emit("listed", pid=args.pid, windows=windows(args.pid))
        if args.window_id is None or window_pid(args.window_id) != args.pid:
            emit("blocked_exact_window_missing", 3)
        row = window_row(args.window_id)
        if args.command == "capture":
            if not args.output or not shutil.which("import"):
                emit("blocked_capture_backend_unavailable", 5)
            run("import", "-window", str(args.window_id), str(Path(args.output)))
            emit("captured", output=args.output, width=row["width"], height=row["height"])
        controls = accessible_controls(args.pid, row["title"])
        if args.command == "inspect":
            emit("inspected", window_id=args.window_id, controls=public_controls(controls))
        matches = [item for item in controls if str(item.get(args.match_attribute, "")) == args.match_value]
        if len(matches) != 1:
            emit("blocked_exact_control_match", 5, matches=len(matches))
        node = matches[0]["node"]
        if args.expected_value is not None and node.queryText().getText(0, -1) != args.expected_value:
            emit("conflict", 9, reason="control_value_changed", action_performed=False)
        if args.command == "set-value" and args.expected_value is None:
            emit("blocked_usage", 2)
        if args.command == "press":
            action = node.queryAction()
            indices = [i for i in range(action.nActions) if action.getName(i).casefold() in {"click", "press", "activate"}]
            if len(indices) != 1 or not action.doAction(indices[0]):
                emit("blocked_press_unavailable", 5)
            status = "pressed"
        else:
            if not set_control_value(node, args.new_value):
                emit("blocked_verification_failed", 6)
            status = "value_set"
        emit(status, window_id=args.window_id)
    except (OSError, RuntimeError, ValueError) as exc:
        emit("blocked_linux_backend_failed", 5, reason=str(exc)[:500])
    return 0


if __name__ == "__main__":
    sys.exit(main())
