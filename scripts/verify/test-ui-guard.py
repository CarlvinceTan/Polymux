#!/usr/bin/env python3
"""Hermetic UI environment tests; no app launch, capture, or permission request."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parent
STUB = r'''
import json, os, pathlib, sys
root = pathlib.Path(os.environ['UI_STUB_ROOT'])
state = json.loads((root/'state.json').read_text())
args = sys.argv[1:]
if pathlib.Path(sys.argv[0]).name == 'cua-driver':
    assert args[-2:] == ['--socket',os.environ['POLYMUX_CUA_SOCKET']]
    args = args[:-2]
with (root/'calls.jsonl').open('a') as log: log.write(json.dumps([pathlib.Path(sys.argv[0]).name, *args])+'\n')
if pathlib.Path(sys.argv[0]).name == 'observer':
    if args[0] == 'windows':
        dialogs = state.get('dialogs', [])
        if state.get('afterChild') and not (root/'started').exists(): dialogs = []
        print(json.dumps({'available':state.get('windowsAvailable',True), 'windows':dialogs}))
    else: print(json.dumps({'available':state.get('appAvailable',True), 'accessibility':state.get('appAX',True)}))
elif args == ['status']: print('Cua Driver daemon is '+('running' if state.get('running',True) else 'not running'))
elif args[:2] == ['permissions','status']:
    print(json.dumps({'accessibility':state.get('observerAX',True), 'screen_recording':state.get('screen',True),
        'source':{'bundle_id':'test.observer'}, 'direct_capture_verification':
        {'source':'permissions_grant','bundle_id':'test.observer'} if state.get('captureVerified',True) else None}))
elif args[0] == 'get_window_state':
    if state.get('captureError'): print(json.dumps({'error':'capture unavailable'}))
    else:
        value=json.loads(args[1]); path=pathlib.Path(value['screenshot_out_file']); path.write_bytes(b'test-only-image')
        print(json.dumps({'screenshot_file_path':str(path), 'tree_markdown':'- [0] AXWindow "Permission"\n  - AXStaticText = "bash wants access to control System Events"\n- [1] AXMenuBar\n  - AXStaticText = "private recent file"'}))
elif args[0] == 'end_session': print('{}')
else: raise SystemExit(9)
'''


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="polymux-ui-guard-test-")
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name in ("cua-driver", "observer"):
            path = self.bin / name
            path.write_text("#!" + sys.executable + "\n" + STUB)
            path.chmod(0o700)
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"], UI_STUB_ROOT=str(self.root),
                        POLYMUX_CUA_SOCKET=str(self.root / "existing-daemon.sock"))
        self.state = {}

    def tearDown(self):
        self.temp.cleanup()

    def argv(self, code="pass"):
        (self.root / "state.json").write_text(json.dumps(self.state))
        return [sys.executable, str(ROOT / "ui-guard.py"), "--helper", str(self.bin / "observer"),
                "--app", str(self.root / "Polymux.app"), "--evidence", str(self.root / "evidence"),
                "--interval", "0.05", "--", sys.executable, "-c", code]

    def run_guard(self, code="pass"):
        return subprocess.run(self.argv(code), env=self.env, text=True, capture_output=True, timeout=15)

    def calls(self):
        return [json.loads(line) for line in (self.root / "calls.jsonl").read_text().splitlines()]

    def dialog(self):
        return {"pid": 123, "window_id": 456, "owner": "UserNotificationCenter", "title": "Permission"}

    def marker(self):
        return "from pathlib import Path; Path(" + repr(str(self.root / "started")) + ").touch(); "

    def wait_for(self, path):
        deadline = time.monotonic() + 5
        while not path.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(path.exists(), str(path))

    def alive(self, pid):
        try:
            os.kill(pid, 0)
            state = subprocess.run(["ps", "-p", str(pid), "-o", "stat="], text=True, capture_output=True).stdout.strip()
            return bool(state) and not state.startswith("Z")
        except ProcessLookupError:
            return False

    def test_clear_environment_preserves_command_result(self):
        self.assertEqual(self.run_guard().returncode, 0)
        self.assertEqual(self.run_guard("raise SystemExit(7)").returncode, 7)
        self.assertFalse((self.root / "evidence/environment.json").exists())

    def test_dialog_prevents_command_and_saves_exact_window(self):
        self.state = {"dialogs": [self.dialog()]}
        result = self.run_guard(self.marker())
        self.assertEqual(result.returncode, 11, result.stderr)
        self.assertFalse((self.root / "started").exists())
        self.assertIn("blocked by system dialog: bash wants access to control System Events", result.stdout)
        self.assertNotIn("private recent file", result.stdout)
        self.assertTrue((self.root / "evidence/system-dialog.png").exists())
        capture = next(call for call in self.calls() if call[1] == "get_window_state")
        args = json.loads(capture[2])
        self.assertEqual((args["pid"], args["window_id"]), (123, 456))
        self.assertNotIn("accessibility", [call[1] for call in self.calls() if call[0] == "observer"])
        self.assertTrue(any(call[1] == "end_session" for call in self.calls()))

    def test_target_accessibility_blocks_before_command(self):
        self.state = {"appAX": False}
        result = self.run_guard(self.marker())
        self.assertEqual(result.returncode, 11)
        self.assertIn("not trusted for the built Polymux app", result.stdout)
        self.assertFalse((self.root / "started").exists())

    def test_observer_permissions_never_request_grants(self):
        for setting in ("observerAX", "screen"):
            with self.subTest(setting=setting):
                self.state = {setting: False}
                result = self.run_guard(self.marker())
                self.assertEqual(result.returncode, 11)
                self.assertFalse((self.root / "started").exists())
        self.assertFalse(any("grant" in call for call in self.calls()))

    def test_missing_observer_does_not_start_daemon(self):
        self.state = {"running": False}
        result = self.run_guard(self.marker())
        self.assertEqual(result.returncode, 11)
        self.assertEqual(self.calls(), [["cua-driver", "status"]])
        self.assertFalse((self.root / "started").exists())

    def test_unverified_capture_does_not_trigger_permission_setup(self):
        self.state = {"captureVerified": False, "dialogs": [self.dialog()]}
        result = self.run_guard(self.marker())
        self.assertEqual(result.returncode, 11)
        self.assertIn("leave permission setup for a person", result.stdout)
        self.assertFalse((self.root / "started").exists())
        self.assertFalse(any(call[1] == "get_window_state" for call in self.calls()))

    def test_unavailable_probe_fails_closed(self):
        for setting in ("windowsAvailable", "appAvailable"):
            with self.subTest(setting=setting):
                self.state = {setting: False}
                self.assertEqual(self.run_guard(self.marker()).returncode, 11)
                self.assertFalse((self.root / "started").exists())

    def test_capture_failure_still_blocks_with_metadata(self):
        self.state = {"dialogs": [self.dialog()], "captureError": True}
        result = self.run_guard(self.marker())
        self.assertEqual(result.returncode, 11)
        self.assertIn("screenshot unavailable", result.stdout)
        self.assertTrue((self.root / "evidence/system-dialog.json").exists())
        self.assertFalse((self.root / "evidence/system-dialog.png").exists())

    def test_dialog_stops_only_owned_group_even_when_child_ignores_term(self):
        self.state = {"afterChild": True, "dialogs": [self.dialog()]}
        child = "import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(300)"
        code = ("import os,subprocess,sys,time; from pathlib import Path; "
                "p=subprocess.Popen([sys.executable,'-c'," + repr(child) + "]); "
                "Path(" + repr(str(self.root / "pids")) + ").write_text(str(os.getpid())+' '+str(p.pid)); "
                + self.marker() + "time.sleep(300)")
        unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"])
        try:
            start = time.monotonic()
            result = self.run_guard(code)
            self.assertEqual(result.returncode, 11, result.stderr)
            self.assertLess(time.monotonic() - start, 8)
            self.assertIsNone(unrelated.poll())
            pids = [int(pid) for pid in (self.root / "pids").read_text().split()]
            deadline = time.monotonic() + 2
            while any(self.alive(pid) for pid in pids) and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertFalse(any(self.alive(pid) for pid in pids))
        finally:
            unrelated.terminate()
            unrelated.wait()

    def test_wrapper_signal_stops_owned_command(self):
        code = "import time; " + self.marker() + "time.sleep(300)"
        process = subprocess.Popen(self.argv(code), env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.wait_for(self.root / "started")
        process.send_signal(signal.SIGTERM)
        stdout, stderr = process.communicate(timeout=10)
        self.assertEqual(process.returncode, 143, stderr + stdout)

    def test_only_read_only_cua_tools_are_used(self):
        self.state = {"dialogs": [self.dialog()]}
        self.run_guard()
        self.assertTrue(all(call[1] in ("status", "permissions", "get_window_state", "end_session")
                            for call in self.calls() if call[0] == "cua-driver"))

    def test_policy_audit_flags_commands_without_exposing_them(self):
        path = self.root / "agent.log"
        cases = [
            ({"name": "exec_command", "arguments": json.dumps({"cmd": 'osascript -e \'tell application "System Events" to get name\''})}, True),
            ({"part": {"state": {"input": {"command": '/usr/bin/osascript -e \'tell application "System Events" to get name\''}}}}, True),
            ({"output": 'osascript -e \'tell application "System Events" to get name\''}, False),
            ({"command": 'rg "System Events" scripts/osascript.sh'}, False),
            ({"cmd": 'rg "NSAppleScript|System Events" scripts'}, False),
            ({"cmd": 'cat "osascript;System Events.txt"'}, False),
            ({"prompt": "Never script System Events using osascript"}, False),
        ]
        for value, forbidden in cases:
            with self.subTest(value=value):
                path.write_text(json.dumps(value) + "\n")
                result = subprocess.run([sys.executable, str(ROOT / "ui-guard.py"), "--audit-log", str(path)],
                                        text=True, capture_output=True, timeout=3)
                self.assertEqual(result.returncode, 11 if forbidden else 0)
                self.assertNotIn("tell application", result.stdout)

    def test_external_verifier_uses_its_paired_classifier(self):
        old = self.root / "older/scripts"
        old.mkdir(parents=True)
        (old / "verify-result.sh").write_text("verify_result() { echo FAIL; }\n")
        source = next(line for line in (ROOT / "verify.sh").read_text().splitlines()
                      if line.startswith('. "') and "verify-result.sh" in line)
        result = subprocess.run(["bash", "-c", source + "\nverify_result macos-test 11 /dev/null"],
                                env=dict(self.env, ROOT=str(old.parent), SD=str(ROOT)), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "BLOCKED")

    def test_failed_observer_build_keeps_build_failure_and_never_starts_ui(self):
        source = (ROOT / "step.sh").read_text()
        function = source[source.index("step() {"):]
        marker = self.root / "should-not-run"
        script = ('UI_READY=0; FAIL=1; SECONDS=0; mark() { :; }; ROWS=();\n' + function
                  + '\nstep macos-test touch "$MARKER"\nprintf "%s\\n" "${ROWS[@]}"\n[ "$FAIL" = 1 ]')
        result = subprocess.run(["bash", "-c", script], env=dict(self.env, MARKER=str(marker)),
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SKIP", result.stdout)
        self.assertFalse(marker.exists())

if __name__ == "__main__":
    unittest.main()
