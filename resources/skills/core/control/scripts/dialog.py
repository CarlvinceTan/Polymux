"""Inspect an exact dialog or press one exact semantic button."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from config import device_requires_lock

SCRIPT_DIR = Path(__file__).resolve().parent
LOCK = SCRIPT_DIR / "lock.py"
WINDOW = SCRIPT_DIR / "window.py"
STATIC_TEXT_ROLES = {"axstatictext", "controltype.text", "label", "static", "static text"}
VERIFICATION_TIMEOUT_SECONDS = 2.0
VERIFICATION_INTERVAL_SECONDS = 0.05
IDENTITY_RETRY_SECONDS = 1.0
CLASSIFICATION_TERMS = {
    "permission": (
        "allow access",
        "accessibility",
        "screen recording",
        "microphone",
        "camera",
        "location services",
        "privacy & security",
    ),
    "authentication": (
        "password",
        "passcode",
        "touch id",
        "authenticate",
        "authentication",
        "administrator",
        "authorization required",
        "user account control",
    ),
    "consent": ("terms of service", "privacy policy", "license agreement", "i agree"),
    "destructive": ("delete permanently", "erase", "discard changes", "empty trash"),
}


class DialogError(RuntimeError):
    pass


def run_json(command: list[str]) -> tuple[int, dict[str, Any]]:
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError as exc:
        raise DialogError(str(exc)) from exc
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        detail = result.stderr.strip() or "helper returned invalid JSON"
        raise DialogError(detail[:500]) from exc
    if not isinstance(payload, dict):
        raise DialogError("helper JSON must be an object")
    return result.returncode, payload


def lock_window_id(native_window_id: int) -> str:
    return str(native_window_id)


def lock_command(action: str, args: argparse.Namespace, *, token: str | None = None) -> list[str]:
    command = [
        sys.executable,
        str(LOCK),
        action,
        "--device",
        args.device,
        "--app-id",
        args.app_id,
        "--window-id",
        lock_window_id(args.native_window_id),
        "--kind",
        "window",
    ]
    if action == "acquire":
        command.extend(["--owner", args.owner])
    elif token:
        command.extend(["--token", token])
    return command


def window_command(
    action: str,
    args: argparse.Namespace,
    *,
    token: str | None = None,
    match: tuple[str, str] | None = None,
) -> list[str]:
    command = [
        sys.executable,
        str(WINDOW),
        action,
        "--device",
        args.device,
        "--app",
        args.app,
        "--app-id",
        args.app_id,
        "--pid",
        str(args.pid),
    ]
    if action != "list":
        command.extend(["--native-window-id", str(args.native_window_id)])
    if token is not None:
        command.extend(
            [
                "--lock-window-id",
                lock_window_id(args.native_window_id),
                "--lock-token",
                str(token),
            ]
        )
    if match:
        command.extend(["--match-attribute", match[0], "--match-value", match[1]])
    return command


def visible_text(control: dict[str, Any]) -> str:
    keys = ["role", "title", "description", "identifier"]
    if str(control.get("role", "")).casefold() in STATIC_TEXT_ROLES:
        keys.append("value")
    return " ".join(str(control.get(key, "")) for key in keys).casefold()


def detected_kind(controls: list[dict[str, Any]]) -> str | None:
    if any(str(control.get("role", "")).casefold() == "axsecuretextfield" for control in controls):
        return "authentication"
    text = "\n".join(visible_text(control) for control in controls)
    for kind, terms in CLASSIFICATION_TERMS.items():
        if any(term in text for term in terms):
            return kind
    return None


def classification(controls: list[dict[str, Any]]) -> str:
    return detected_kind(controls) or "unclassified"


def public_controls(controls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    allowed = ("role", "title", "description", "identifier", "actions", "frame")
    result: list[dict[str, Any]] = []
    for control in controls:
        row = {key: control[key] for key in allowed if control.get(key) not in (None, "", [])}
        if (
            str(control.get("role", "")).casefold() in STATIC_TEXT_ROLES
            and control.get("value") not in (None, "", [])
        ):
            row["value"] = control["value"]
        result.append(row)
    return result


def public_buttons(controls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return public_controls(
        [control for control in controls if "AXPress" in control.get("actions", [])]
    )


def canonical_controls(controls: list[dict[str, Any]]) -> str:
    stable = [{key: value for key, value in control.items() if key != "frame"} for control in controls]
    return json.dumps(stable, ensure_ascii=False, sort_keys=True)


def exact_button_match(controls: list[dict[str, Any]], args: argparse.Namespace) -> tuple[str, str]:
    matches: list[tuple[str, str]] = []
    for control in controls:
        if "AXPress" not in control.get("actions", []):
            continue
        if args.button:
            visible = (str(control.get("title", "")), str(control.get("description", "")))
            if not any(value.casefold() == args.button.casefold() for value in visible if value):
                continue
            for attribute in ("identifier", "title", "description"):
                value = str(control.get(attribute, ""))
                if value:
                    matches.append((attribute, value))
                    break
        elif str(control.get(args.match_attribute, "")) == args.match_value:
            matches.append((args.match_attribute, args.match_value))
    if len(matches) == 1:
        return matches[0]
    if matches:
        raise DialogError("multiple pressable controls match the requested button")
    raise DialogError("the requested exact button is not available")


def target_window_present(payload: dict[str, Any], native_window_id: int) -> bool:
    windows = payload.get("windows")
    if not isinstance(windows, list):
        raise DialogError("window verification returned invalid data")
    return any(
        isinstance(window, dict) and window.get("window_id") == native_window_id
        for window in windows
    )


def validate_target_identity(args: argparse.Namespace) -> None:
    deadline = time.monotonic() + IDENTITY_RETRY_SECONDS
    while True:
        code, payload = run_json(window_command("list", args))
        if not code and payload.get("status") == "listed":
            break
        if time.monotonic() >= deadline:
            raise DialogError(
                str(payload.get("status") or "window identity discovery failed")
            )
        time.sleep(VERIFICATION_INTERVAL_SECONDS)
    canonical_app_id = payload.get("app_id")
    if not isinstance(canonical_app_id, str) or not canonical_app_id:
        raise DialogError("window identity discovery returned no canonical application ID")
    if canonical_app_id != args.app_id:
        raise DialogError("supplied application ID does not match the target process")
    if not target_window_present(payload, args.native_window_id):
        raise DialogError("target window is no longer present")


def inspect_window(args: argparse.Namespace, token: str | None = None) -> list[dict[str, Any]]:
    code, payload = run_json(window_command("inspect", args, token=token))
    if code or payload.get("status") != "inspected":
        raise DialogError(str(payload.get("status") or "dialog inspection failed"))
    controls = payload.get("controls")
    if not isinstance(controls, list) or not all(isinstance(item, dict) for item in controls):
        raise DialogError("dialog inspection returned invalid controls")
    return controls


def verify_pressed_action(
    args: argparse.Namespace,
    before: list[dict[str, Any]],
) -> tuple[int, dict[str, Any]]:
    deadline = time.monotonic() + VERIFICATION_TIMEOUT_SECONDS
    last_reason = "transition_unverified"
    while True:
        try:
            listed_code, listed = run_json(window_command("list", args))
            if listed_code:
                last_reason = "window_list_failed"
            elif not target_window_present(listed, args.native_window_id):
                return 0, {"status": "transition_observed", "verification": "dialog_closed"}
            else:
                updated = inspect_window(args)
                if canonical_controls(updated) != canonical_controls(before):
                    return 0, {"status": "transition_observed", "verification": "dialog_changed"}
                last_reason = "dialog_unchanged"
        except DialogError:
            # A dialog can disappear from the accessibility tree slightly before
            # Core Graphics removes its window. Keep observing the same identity.
            last_reason = "transition_unverified"
        if time.monotonic() >= deadline:
            return 6, {
                "status": "blocked_verification_failed",
                "reason": last_reason,
                "action_performed": True,
            }
        time.sleep(VERIFICATION_INTERVAL_SECONDS)


def execute(args: argparse.Namespace) -> tuple[int, dict[str, Any]]:
    try:
        validate_target_identity(args)
    except DialogError as exc:
        return 5, {"status": "blocked_unsupported", "reason": str(exc)}
    try:
        requires_lock = device_requires_lock(args.device)
    except (OSError, ValueError) as exc:
        raise DialogError(str(exc)) from exc
    token: str | None = getattr(args, "lock_token", None)
    borrowed = token is not None
    if args.command == "resolve" and requires_lock and not borrowed:
        if not args.owner:
            raise DialogError("resolve on a user-active device requires --owner")
        code, acquired = run_json(lock_command("acquire", args))
        token = acquired.get("token")
        if code or acquired.get("status") != "acquired" or not isinstance(token, str):
            return code or 3, {**acquired, "stage": "acquire"}

    outcome: tuple[int, dict[str, Any]]
    try:
        controls = inspect_window(args)
        kind = classification(controls)
        if args.command == "inspect":
            outcome = (
                0,
                {
                    "status": "inspected_dialog",
                    "kind": kind,
                    "window_id": args.native_window_id,
                    "buttons": public_buttons(controls),
                    "controls": public_controls(controls),
                },
            )
        else:
            match = exact_button_match(controls, args)
            pressed_code, pressed = run_json(window_command("press", args, token=token, match=match))
            press_completed = not pressed_code and pressed.get("status") == "pressed"
            press_uncertain = (
                pressed.get("status") == "blocked_action_failed"
                and pressed.get("ax_error") == -25204
            )
            if not press_completed and not press_uncertain:
                outcome = (pressed_code or 5, {**pressed, "stage": "press"})
            else:
                verification_code, verification = verify_pressed_action(args, controls)
                if press_uncertain and verification_code:
                    verification["action_may_have_been_performed"] = True
                outcome = (
                    verification_code,
                    {
                        **verification,
                        "kind": kind,
                        "matched": {"attribute": match[0], "value": match[1]},
                    },
                )
    except Exception as exc:
        outcome = (5, {"status": "blocked_unsupported", "reason": str(exc)})

    if token is not None and not borrowed:
        release_code, released = run_json(lock_command("release", args, token=token))
        if release_code or released.get("status") != "released":
            return 6, {"status": "blocked_lock_release_failed", "result": outcome[1]}
    return outcome


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("command", choices=("inspect", "resolve"))
    result.add_argument("--device", required=True)
    result.add_argument("--app", required=True)
    result.add_argument("--app-id", required=True)
    result.add_argument("--pid", required=True, type=int)
    result.add_argument("--native-window-id", required=True, type=int)
    result.add_argument("--owner")
    result.add_argument("--lock-token", help="borrow an existing exact-window lease without releasing it")
    result.add_argument("--button")
    result.add_argument("--match-attribute", choices=("role", "title", "description", "identifier"))
    result.add_argument("--match-value")
    return result


def main() -> int:
    args = parser().parse_args()
    direct_match = args.match_attribute is not None or args.match_value is not None
    if args.command == "resolve":
        if bool(args.button) == bool(direct_match):
            parser().error("resolve requires either --button or one exact --match-attribute/--match-value pair")
        if direct_match and (args.match_attribute is None or args.match_value is None):
            parser().error("exact matching requires both --match-attribute and --match-value")
    elif args.button or direct_match:
        parser().error("inspect does not accept resolution arguments")
    try:
        code, payload = execute(args)
    except DialogError as exc:
        code, payload = 5, {"status": "blocked_internal", "reason": str(exc)}
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
