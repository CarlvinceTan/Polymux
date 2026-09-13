"""Manage, capture, and safely inject input into a libvirt guest."""

from __future__ import annotations

import argparse
import json
import re
import secrets
import shlex
import struct
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from config import resolve_vm_device
from vm.mutex import mutation_mutex


SSH_OPTIONS = [
    "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
    "-o", "ServerAliveInterval=3", "-o", "ServerAliveCountMax=2",
]
QMP_ABSOLUTE_MAX = 0x7FFF
BACKEND_TIMEOUT_SECONDS = 60
MUTATION_MUTEX_TTL_SECONDS = 600
POINTER_BUTTONS = (
    "left", "middle", "right", "wheel-up", "wheel-down", "wheel-left", "wheel-right"
)
LINUX_KEY_ALIASES = {
    "alt": "KEY_LEFTALT",
    "altgr": "KEY_RIGHTALT",
    "backspace": "KEY_BACKSPACE",
    "capslock": "KEY_CAPSLOCK",
    "ctrl": "KEY_LEFTCTRL",
    "delete": "KEY_DELETE",
    "down": "KEY_DOWN",
    "end": "KEY_END",
    "enter": "KEY_ENTER",
    "esc": "KEY_ESC",
    "escape": "KEY_ESC",
    "home": "KEY_HOME",
    "insert": "KEY_INSERT",
    "left": "KEY_LEFT",
    "leftalt": "KEY_LEFTALT",
    "leftctrl": "KEY_LEFTCTRL",
    "leftshift": "KEY_LEFTSHIFT",
    "meta": "KEY_LEFTMETA",
    "numlock": "KEY_NUMLOCK",
    "pagedown": "KEY_PAGEDOWN",
    "pageup": "KEY_PAGEUP",
    "pause": "KEY_PAUSE",
    "print": "KEY_SYSRQ",
    "return": "KEY_ENTER",
    "right": "KEY_RIGHT",
    "rightalt": "KEY_RIGHTALT",
    "rightctrl": "KEY_RIGHTCTRL",
    "rightshift": "KEY_RIGHTSHIFT",
    "scrolllock": "KEY_SCROLLLOCK",
    "shift": "KEY_LEFTSHIFT",
    "space": "KEY_SPACE",
    "super": "KEY_LEFTMETA",
    "tab": "KEY_TAB",
    "up": "KEY_UP",
    "win": "KEY_LEFTMETA",
}


def png_dimensions(path: Path) -> tuple[int, int]:
    """Read PNG dimensions without adding an image-processing dependency."""
    with path.open("rb") as handle:
        header = handle.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"captured file is not a valid PNG: {path}")
    width, height = struct.unpack(">II", header[16:24])
    if width < 1 or height < 1:
        raise ValueError(f"captured PNG has invalid dimensions: {width}x{height}")
    return width, height


def absolute_coordinate(pixel: int, extent: int) -> int:
    if extent < 1 or pixel < 0 or pixel >= extent:
        raise ValueError(f"pixel {pixel} is outside extent {extent}")
    if extent == 1:
        return 0
    return round(pixel * QMP_ABSOLUTE_MAX / (extent - 1))


def linux_key_name(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    if normalized in LINUX_KEY_ALIASES:
        return LINUX_KEY_ALIASES[normalized]
    if len(normalized) == 1 and normalized.isascii() and normalized.isalnum():
        return f"KEY_{normalized.upper()}"
    if re.fullmatch(r"f(?:[1-9]|1[0-9]|2[0-4])", normalized):
        return f"KEY_{normalized.upper()}"
    if re.fullmatch(r"key_[a-z0-9_]+", normalized):
        return normalized.upper()
    raise ValueError(
        f"unsupported key {value!r}; use a simple key name or Linux KEY_* symbol"
    )


class VmControl:
    def __init__(self, host: str | None, domain: str):
        self.host = host
        self.domain = domain

    def virsh(self, *args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
        command = ["virsh", "-c", "qemu:///system", *args]
        if self.host:
            command = ["ssh", *SSH_OPTIONS, self.host, shlex.join(command)]
        try:
            return subprocess.run(
                command,
                capture_output=capture,
                text=True,
                timeout=BACKEND_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("libvirt backend command timed out") from exc

    def qmp(self, payload: dict) -> object:
        result = self.virsh(
            "qemu-monitor-command",
            self.domain,
            "--pretty",
            json.dumps(payload, separators=(",", ":")),
            capture=True,
        )
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "QMP command failed")
        try:
            response = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError("QMP returned invalid JSON") from exc
        if "error" in response:
            error = response["error"]
            raise RuntimeError(str(error.get("desc") if isinstance(error, dict) else error))
        return response.get("return")

    def domain_state(self) -> str | None:
        result = self.virsh("domstate", self.domain, capture=True)
        if result.returncode:
            return None
        return next((line.strip().replace("\r", "") for line in result.stdout.splitlines() if line.strip()), None)

    def guest_ping(self) -> bool:
        result = self.virsh(
            "qemu-agent-command", self.domain, '{"execute":"guest-ping"}', capture=True
        )
        return result.returncode == 0

    def status(self) -> int:
        state = self.domain_state()
        if state is None:
            return die(f"Cannot read {self.domain} state through {self.host}")
        print(f"VM: {state}")
        if state == "running" and self.guest_ping():
            print("VM readiness: QGA ready")
            return 0
        if state == "shut off":
            print("VM readiness: off")
            return 0
        print("VM readiness: QGA unavailable")
        return 1

    def stop(self) -> int:
        state = self.domain_state()
        if state is None:
            return die(f"Cannot read {self.domain} state through {self.host}")
        if state == "shut off":
            print("VM is already off.")
            return 0
        if state != "running":
            return die(f"Refusing graceful shutdown from unexpected state: {state}")
        if not self.guest_ping():
            return die("Refusing shutdown because the QEMU Guest Agent is not ready")
        if self.virsh("shutdown", self.domain, "--mode", "agent").returncode:
            return die("The graceful shutdown request failed")
        for _ in range(45):
            if self.domain_state() == "shut off":
                print("VM is off (verified: shut off).")
                return 0
            time.sleep(2)
        return die("Graceful shutdown did not reach shut off; no forced power-off was attempted")

    def start(self) -> int:
        state = self.domain_state()
        if state is None:
            return die(f"Cannot read {self.domain} state through {self.host}")
        if state == "shut off":
            if self.virsh("start", self.domain).returncode:
                return die("The VM start request failed")
        elif state != "running":
            return die(f"Refusing start from unexpected state: {state}")
        for _ in range(60):
            if self.domain_state() == "running" and self.guest_ping():
                print("VM is running and QGA ready.")
                return 0
            time.sleep(2)
        return die("VM did not become QGA-ready within two minutes")

    def screenshot(self, output: Path) -> int:
        output = output.expanduser().resolve()
        captured_file = (
            f"/tmp/control-{self.domain}-screenshot-{secrets.token_hex(8)}.png"
            if self.host
            else str(output)
        )
        try:
            captured = self.virsh(
                "screenshot",
                self.domain,
                captured_file,
                "--screen",
                "0",
                capture=True,
            )
            if captured.returncode:
                raise RuntimeError(
                    captured.stderr.strip()
                    or captured.stdout.strip()
                    or "virsh screenshot failed"
                )
            if self.host:
                try:
                    copied = subprocess.run(
                        [
                            "scp",
                            "-q",
                            *SSH_OPTIONS,
                            f"{self.host}:{captured_file}",
                            str(output),
                        ],
                        timeout=BACKEND_TIMEOUT_SECONDS,
                    )
                except subprocess.TimeoutExpired as exc:
                    raise RuntimeError("VM screenshot copy timed out") from exc
                if copied.returncode:
                    return copied.returncode
            width, height = png_dimensions(output)
            print(json.dumps({"path": str(output), "width": width, "height": height}))
            return 0
        finally:
            if self.host:
                try:
                    subprocess.run(
                        [
                            "ssh",
                            *SSH_OPTIONS,
                            self.host,
                            shlex.join(["unlink", captured_file]),
                        ],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        timeout=BACKEND_TIMEOUT_SECONDS,
                    )
                except subprocess.TimeoutExpired:
                    pass

    def require_absolute_pointer(self) -> None:
        mice = self.qmp({"execute": "query-mice"})
        if not isinstance(mice, list) or not any(
            isinstance(mouse, dict) and mouse.get("current") and mouse.get("absolute")
            for mouse in mice
        ):
            raise RuntimeError("the guest has no current absolute pointer device")

    def click(self, frame: Path, x: int, y: int, button: str) -> int:
        width, height = png_dimensions(frame.expanduser())
        absolute_x = absolute_coordinate(x, width)
        absolute_y = absolute_coordinate(y, height)
        self.require_absolute_pointer()
        self.qmp(
            {
                "execute": "input-send-event",
                "arguments": {
                    "events": [
                        {"type": "abs", "data": {"axis": "x", "value": absolute_x}},
                        {"type": "abs", "data": {"axis": "y", "value": absolute_y}},
                    ]
                },
            }
        )
        for down in (True, False):
            self.qmp(
                {
                    "execute": "input-send-event",
                    "arguments": {
                        "events": [
                            {"type": "btn", "data": {"down": down, "button": button}}
                        ]
                    },
                }
            )
            if down:
                time.sleep(0.05)
        print(json.dumps({"button": button, "x": x, "y": y, "frame": str(frame)}))
        return 0

    def key(self, keys: list[str], hold_ms: int) -> int:
        if not keys:
            raise ValueError("at least one key is required")
        keycodes = [linux_key_name(key) for key in keys]
        result = self.virsh(
            "send-key",
            self.domain,
            "--codeset",
            "linux",
            "--holdtime",
            str(hold_ms),
            *keycodes,
            capture=True,
        )
        if result.returncode:
            raise RuntimeError(
                result.stderr.strip()
                or result.stdout.strip()
                or "virsh send-key failed"
            )
        print(json.dumps({"keys": keycodes, "hold_ms": hold_ms}))
        return 0


def die(message: str) -> int:
    print(f"ERROR: {message}", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["status", "start", "stop", "screenshot", "click", "key"])
    parser.add_argument("--device", required=True, help="VM device ID from instance/control.json")
    parser.add_argument("--out", type=Path, help="screenshot output path")
    parser.add_argument("--frame", type=Path, help="PNG used to derive click coordinates")
    parser.add_argument("--x", type=int, help="horizontal pixel in --frame")
    parser.add_argument("--y", type=int, help="vertical pixel in --frame")
    parser.add_argument("--button", choices=POINTER_BUTTONS, default="left")
    parser.add_argument(
        "--key",
        action="append",
        dest="keys",
        help="simple key name or Linux KEY_* symbol; repeat for a chord",
    )
    parser.add_argument("--hold-ms", type=int, default=100, help="keyboard hold time from 1 to 5000 ms")
    parser.add_argument("--owner", help="stable caller identity; required for a user-active VM mutation")
    args = parser.parse_args()
    try:
        host, domain = resolve_vm_device(args.device)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    if host is not None and not re.fullmatch(r"[A-Za-z0-9._@-]+", host):
        parser.error("invalid VM host")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", domain):
        parser.error("invalid VM device ID")
    control = VmControl(host, domain)
    if args.command == "screenshot":
        if args.out is None:
            parser.error("screenshot requires --out")
        try:
            return control.screenshot(args.out)
        except (OSError, ValueError, RuntimeError) as exc:
            return die(str(exc))
    if args.command == "status":
        return control.status()
    if args.command == "click" and (args.frame is None or args.x is None or args.y is None):
        parser.error("click requires --frame, --x, and --y")
    if args.command == "key":
        if not args.keys:
            parser.error("key requires at least one --key")
        if not 1 <= args.hold_ms <= 5000:
            parser.error("--hold-ms must be between 1 and 5000")
    try:
        with mutation_mutex(
            args.device,
            domain,
            args.owner,
            ttl_seconds=MUTATION_MUTEX_TTL_SECONDS,
        ):
            if args.command == "click":
                return control.click(args.frame, args.x, args.y, args.button)
            if args.command == "key":
                return control.key(args.keys, args.hold_ms)
            return getattr(control, args.command)()
    except (OSError, ValueError, RuntimeError) as exc:
        return die(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
