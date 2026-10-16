#!/usr/bin/env python3
"""Stop one owned UI command when its environment cannot support verification."""
import argparse
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import shlex
import signal
import subprocess
import sys
import time
import uuid


class Blocked(Exception):
    pass


def clean(value):
    return re.sub(r"[\x00-\x1f\x7f]", " ", str(value)).strip()[:600]


class Observer:
    def __init__(self, helper, app, evidence):
        self.helper, self.app, self.evidence = helper, app, evidence
        self.session = "polymux-ui-" + uuid.uuid4().hex[:12]
        self.used = False
        home = Path(pwd.getpwuid(os.getuid()).pw_dir)
        self.socket = os.environ.get("POLYMUX_CUA_SOCKET", str(home / "Library/Caches/cua-driver/cua-driver.sock"))
        self.cli = shutil.which("cua-driver")
        if not self.cli:
            for candidate in (Path.home() / "code/agents/bin/cua-driver", Path.home() / ".local/bin/cua-driver",
                              Path("/Applications/CuaDriver.app/Contents/MacOS/cua-driver")):
                if candidate.is_file() and os.access(candidate, os.X_OK):
                    self.cli = str(candidate)
                    break
        if not self.cli:
            raise Blocked("UI observer unavailable: cua-driver is not installed")

    def command(self, args, timeout=4):
        try:
            if args[0] == self.cli:
                args = [*args, "--socket", self.socket]
            result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
            if result.returncode:
                raise Blocked("UI observer unavailable: read-only probe failed")
            return result.stdout
        except (OSError, subprocess.TimeoutExpired) as error:
            raise Blocked("UI observer unavailable: read-only probe did not answer") from error

    def value(self, args, timeout=4):
        try:
            value = json.loads(self.command(args, timeout))
            if not isinstance(value, dict):
                raise ValueError("expected object")
            return value
        except (ValueError, TypeError) as error:
            raise Blocked("UI observer unavailable: invalid probe response") from error

    def call(self, tool, **args):
        self.used = True
        value = self.value([self.cli, tool, json.dumps(dict(args, session=self.session))])
        if value.get("error") or value.get("isError"):
            raise Blocked("UI observer unavailable: " + clean(tool) + " failed")
        return value

    def start(self):
        # Never start a daemon or request a macOS permission as verification setup.
        if "daemon is running" not in self.command([self.cli, "status"]).lower():
            raise Blocked("UI observer unavailable: existing cua-driver daemon is not running")
        self.check()
        value = self.value([self.helper, "accessibility", self.app], timeout=7)
        if not value.get("available"):
            raise Blocked(clean(value.get("reason", "Polymux Accessibility status unavailable")))
        if value.get("accessibility") is not True:
            raise Blocked("Accessibility is not trusted for the built Polymux app")

    def check(self):
        permissions = self.value([self.cli, "permissions", "status", "--json"])
        if permissions.get("accessibility") is not True:
            raise Blocked("UI observer Accessibility is not trusted")
        if permissions.get("screen_recording") is not True:
            raise Blocked("UI observer Screen Recording is not granted; dialog evidence unavailable")
        verified = permissions.get("direct_capture_verification") or {}
        identity = permissions.get("source") or {}
        if not isinstance(verified, dict) or not isinstance(identity, dict):
            raise Blocked("UI observer unavailable: invalid capture permission response")
        if permissions.get("screen_recording_capturable") is not True and not (
                verified.get("source") == "permissions_grant" and verified.get("bundle_id")
                and verified.get("bundle_id") == identity.get("bundle_id")):
            raise Blocked("UI observer capture has not been explicitly verified; leave permission setup for a person")
        value = self.value([self.helper, "windows"])
        if value.get("available") is not True or not isinstance(value.get("windows"), list):
            raise Blocked("UI observer unavailable: system windows could not be inspected")
        for window in value["windows"]:
            self.dialog(window)

    def dialog(self, window):
        title = clean(window.get("title") or window.get("owner") or "system dialog")
        target = dict(pid=window["pid"], window_id=window["window_id"])
        capture = self.evidence / "system-dialog.png"
        detail = ""
        try:
            state = self.call("get_window_state", **target, screenshot_out_file=str(capture), timeout_ms=1000,
                              max_depth=5, max_elements=150)
            # Menu bar text can include unrelated recent files; retain only the exact dialog surface.
            tree = state.get("tree_markdown", "").split("\n- ", 1)[0]
            texts = re.findall(r'AXStaticText[^\n]*?(?:= |\()"([^"\n]+)"', tree)
            if texts:
                title = clean(" ".join(texts))
            if state.get("screenshot_file_path") and capture.is_file():
                detail = "; exact-window screenshot: " + str(capture)
            else:
                detail = "; exact-window screenshot unavailable"
        except Blocked:
            detail = "; exact-window screenshot unavailable"
        self.evidence.mkdir(parents=True, exist_ok=True)
        (self.evidence / "system-dialog.json").write_text(json.dumps(dict(target, owner=window.get("owner"), title=title)))
        if "system events" in title.lower():
            print("lane policy: System Events permission dialog detected; scripting System Events is prohibited", flush=True)
        raise Blocked("blocked by system dialog: " + title + detail)

    def close(self):
        try:
            if self.used and "daemon is running" in self.command([self.cli, "status"]).lower():
                self.call("end_session")
        except Blocked:
            pass


def stop(process):
    def running():
        rows = subprocess.run(["ps", "-axo", "pgid=,stat="], text=True, capture_output=True, check=True).stdout
        return any(parts[0] == str(process.pid) and not parts[1].startswith("Z")
                   for line in rows.splitlines() if len(parts := line.split()) == 2)
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except PermissionError:
        if not running():
            return
        raise
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        process.poll()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            if not running():
                return
            raise
        time.sleep(0.05)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def audit(path, offset):
    def forbidden(command):
        target = command.lower()
        if "system events" not in target and "com.apple.systemevents" not in target:
            return False
        try:
            lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|")
            lexer.whitespace_split = True
            segments = [[]]
            for word in lexer:
                if word and all(character in ";&|" for character in word):
                    segments.append([])
                else:
                    segments[-1].append(word)
        except ValueError:
            return False
        for argv in segments:
            while argv and ("=" in argv[0] or argv[0] == "env"):
                argv.pop(0)
            if not argv:
                continue
            program = Path(argv[0]).name
            if program == "osascript":
                return True
            if program in ("bash", "zsh", "sh") and len(argv) > 2 and argv[1] in ("-c", "-lc"):
                if forbidden(argv[2]):
                    return True
            if program in ("swift", "python", "python3", "ruby") and any("NSAppleScript" in arg for arg in argv[1:]):
                return True
        return False

    def commands(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ("cmd", "command", "code") and isinstance(child, str):
                    yield child
                elif key == "arguments" and isinstance(child, str):
                    try:
                        yield from commands(json.loads(child))
                    except ValueError:
                        pass
                elif isinstance(child, (dict, list)):
                    yield from commands(child)
        elif isinstance(value, list):
            for child in value:
                yield from commands(child)

    with open(path) as stream:
        stream.seek(max(0, offset))
        pending = None
        for line in stream:
            try:
                values = commands(json.loads(line))
                if any(forbidden(command) for command in values):
                    return True
            except ValueError:
                if line.lstrip().startswith("+ ") and forbidden(line.lstrip()[2:]):
                    return True
                if line.strip() == "exec":
                    pending = ""
                elif pending is not None:
                    pending += line
                    if len(pending) > 16384:
                        pending = None
                        continue
                    try:
                        argv = shlex.split(pending)
                    except ValueError:
                        continue
                    if len(argv) >= 3 and Path(argv[0]).name in ("zsh", "bash", "sh") and argv[1] in ("-lc", "-c"):
                        if forbidden(argv[2]):
                            return True
                    pending = None
    return False


def run(args):
    process = None
    observer = None
    evidence = Path(args.evidence).resolve()
    evidence.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        observer = Observer(args.helper, args.app, evidence)
        observer.start()
        process = subprocess.Popen(args.command, start_new_session=True)
        while process.poll() is None:
            try:
                process.wait(timeout=args.interval)
            except subprocess.TimeoutExpired:
                observer.check()
        observer.check()
        return process.returncode
    except Blocked as error:
        if process:
            stop(process)
        reason = clean(error)
        (evidence / "environment.json").write_text(json.dumps({"reason": reason, "time": time.time()}))
        print("verify: ENV " + reason, flush=True)
        return 11
    finally:
        if process:
            stop(process)
        if observer:
            observer.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit-log")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--helper")
    parser.add_argument("--app")
    parser.add_argument("--evidence")
    parser.add_argument("--interval", type=float, default=1)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.audit_log:
        if audit(args.audit_log, args.offset):
            print("lane policy: System Events scripting detected in a tool command; permission prompts must be left for a person")
            return 11
        return 0
    if args.command[:1] == ["--"]:
        args.command.pop(0)
    if not args.helper or not args.app or not args.evidence or not args.command or not 0.05 <= args.interval <= 5:
        parser.error("provide a command and a polling interval from 0.05 to 5 seconds")
    def interrupted(signum, frame):
        raise SystemExit(128 + signum)
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGALRM, signal.SIGHUP):
        signal.signal(signum, interrupted)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
