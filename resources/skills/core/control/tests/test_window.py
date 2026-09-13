"""Tests for observation/control separation and platform dispatch."""

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SKILL_ROOT = Path(__file__).resolve().parents[1]
PATH = SKILL_ROOT / "scripts" / "window.py"
SPEC = importlib.util.spec_from_file_location("control_window_test", PATH)
window = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = window
SPEC.loader.exec_module(window)

LINUX_PATH = SKILL_ROOT / "scripts" / "linux" / "window.py"
LINUX_SPEC = importlib.util.spec_from_file_location("control_linux_window_test", LINUX_PATH)
linux_window = importlib.util.module_from_spec(LINUX_SPEC)
assert LINUX_SPEC and LINUX_SPEC.loader
LINUX_SPEC.loader.exec_module(linux_window)

WINDOWS_PATH = SKILL_ROOT / "scripts" / "windows" / "window.py"
WINDOWS_SPEC = importlib.util.spec_from_file_location("control_windows_window_test", WINDOWS_PATH)
windows_window = importlib.util.module_from_spec(WINDOWS_SPEC)
assert WINDOWS_SPEC and WINDOWS_SPEC.loader
WINDOWS_SPEC.loader.exec_module(windows_window)


class WindowTests(unittest.TestCase):
    def test_linux_set_value_reads_back_the_exact_value(self):
        node = mock.Mock()
        node.queryText.return_value.getText.return_value = "expected"
        self.assertTrue(linux_window.set_control_value(node, "expected"))
        node.queryEditableText.return_value.setTextContents.assert_called_once_with("expected")
        node.queryText.return_value.getText.return_value = "different"
        self.assertFalse(linux_window.set_control_value(node, "expected"))

    def test_windows_field_values_survive_structured_transport(self):
        values = ['--pid', '-pid', '', 'hello "world" $HOME\nnext', '中文 café']
        for value in values:
            with self.subTest(value=value):
                payload = windows_window.request_payload(
                    ["set-value", "--pid", "7", "--new-value", value, "--expected-value", value])
                self.assertEqual(json.loads(json.dumps(payload))["NewValue"], value)
                if os.name == 'nt':
                    # Run the real PowerShell request parser without loading UIA or
                    # observing/mutating the interactive desktop.
                    header = windows_window.BACKEND.read_text().split('Add-Type -AssemblyName UIAutomationClient')[0]
                    with tempfile.TemporaryDirectory() as directory:
                        backend = Path(directory) / 'literal.ps1'
                        backend.write_text(header + '@{actual=$NewValue;expected=$ExpectedValue} | ConvertTo-Json -Compress', encoding='utf-8')
                        stdout = io.StringIO()
                        with mock.patch.object(windows_window, 'BACKEND', backend), \
                             mock.patch.object(sys, 'argv', ['window.py', 'set-value', '--pid', '7', '--new-value', value, '--expected-value', value]), \
                             contextlib.redirect_stdout(stdout):
                            self.assertEqual(windows_window.main(), 0)
                        self.assertEqual(json.loads(stdout.getvalue()), {'actual':value, 'expected':value})

    def test_windows_field_values_never_become_powershell_options(self):
        stdout = io.StringIO()
        completed = SimpleNamespace(returncode=0, stdout='{"status":"ok"}', stderr='')
        with mock.patch.object(sys, 'argv', ['window.py', 'set-value', '--pid', '7', '--new-value', '--pid', '--expected-value', '']), \
             mock.patch.object(windows_window.subprocess, 'run', return_value=completed) as run, \
             contextlib.redirect_stdout(stdout):
            self.assertEqual(windows_window.main(), 0)
        self.assertNotIn('--pid', run.call_args.args[0])
        self.assertEqual(json.loads(run.call_args.kwargs['input'])['NewValue'], '--pid')

    def run_window(self, system: str, active: bool, *arguments: str):
        stdout = io.StringIO()
        completed = SimpleNamespace(returncode=0, stdout='{"status":"ok","lock":{"operation":"op"}}\n')
        with mock.patch.object(sys, "argv", [str(PATH), *arguments]), \
             mock.patch.object(window.platform, "system", return_value=system), \
             mock.patch.object(window, "device_requires_lock", return_value=active), \
             mock.patch.object(window, "app_identity", return_value="example.app"), \
             mock.patch.object(window.subprocess, "run", return_value=completed) as run, \
             contextlib.redirect_stdout(stdout):
            code = window.main()
        return code, stdout.getvalue(), run

    def base(self):
        return ["--device", "device", "--app", "Example", "--app-id", "example.app", "--pid", "12"]

    def test_observation_is_lock_free(self):
        code, _, run = self.run_window(
            "Linux", True, "inspect", *self.base(), "--native-window-id", "44"
        )
        self.assertEqual(code, 0)
        invoked = run.call_args.args[0]
        self.assertIn("scripts/linux/window.py", " ".join(invoked).replace("\\", "/"))
        self.assertNotIn("renew", invoked)

    def test_mutation_fences_device_scoped_action(self):
        code, _, run = self.run_window(
            "Linux", True, "press", *self.base(), "--native-window-id", "44",
            "--lock-window-id", "44", "--lock-token", "token",
            "--match-attribute", "title", "--match-value", "Cancel",
        )
        self.assertEqual(code, 0)
        calls = [call.args[0] for call in run.call_args_list]
        self.assertIn("--device", calls[0])
        self.assertIn("begin", calls[0])
        self.assertIn("finish", calls[-1])
        self.assertNotIn("--block-user-active", calls[1])

    def test_named_mac_permission_owner_preserves_action_fencing(self):
        with mock.patch('macos.helper.enabled', return_value=True):
            code, _, run = self.run_window(
                'Darwin', True, 'press', *self.base(), '--native-window-id', '44',
                '--lock-window-id', '44', '--lock-token', 'token',
                '--match-attribute', 'title', '--match-value', 'Cancel')
        self.assertEqual(code, 0)
        calls = [call.args[0] for call in run.call_args_list]
        begin = next(i for i, call in enumerate(calls) if 'begin' in call)
        action = next(i for i, call in enumerate(calls) if 'press' in call)
        finish = next(i for i, call in enumerate(calls) if 'finish' in call)
        self.assertLess(begin, action)
        self.assertLess(action, finish)
        self.assertEqual(calls[action][1:4], [str(window.SCRIPT_DIR / 'macos/helper.py'), 'window', '--'])

    def test_linux_dispatch_keeps_option_like_field_values_literal(self):
        code, _, run = self.run_window(
            "Linux", True, "set-value", *self.base(), "--native-window-id", "44",
            "--lock-window-id", "44", "--lock-token", "token",
            "--match-attribute", "identifier", "--match-value=--pid",
            "--new-value=--pid", "--expected-value=",
        )
        self.assertEqual(code, 0)
        backend = run.call_args_list[1].args[0]
        self.assertIn("--new-value=--pid", backend)
        self.assertIn("--expected-value=", backend)

    def test_every_ui_mutation_requires_coordination(self):
        with self.assertRaises(SystemExit) as failure, contextlib.redirect_stderr(io.StringIO()):
            self.run_window(
                "Windows", True, "press", *self.base(), "--native-window-id", "44",
                "--match-attribute", "title", "--match-value", "Cancel",
            )
        self.assertEqual(failure.exception.code, 2)

    def test_spoofed_app_identity_is_rejected_before_lock_or_control(self):
        stdout = io.StringIO()
        with mock.patch.object(sys, "argv", [str(PATH), "press", *self.base(),
             "--native-window-id", "44", "--lock-window-id", "44", "--lock-token", "token",
             "--match-attribute", "title", "--match-value", "Cancel"]), \
             mock.patch.object(window.platform, "system", return_value="Linux"), \
             mock.patch.object(window, "device_requires_lock", return_value=True), \
             mock.patch.object(window, "app_identity", return_value="/actual/application"), \
             mock.patch.object(window.subprocess, "run") as run, \
             contextlib.redirect_stdout(stdout):
            code = window.main()
        self.assertEqual(code, 3)
        self.assertIn("blocked_app_identity_mismatch", stdout.getvalue())
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
