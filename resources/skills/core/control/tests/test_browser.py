"""Tests for native browser identity and driver-agnostic inventory."""

import contextlib
import io
import json
import plistlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = SKILL_ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from browser import engine_for, installed_browser
from browser import runtime as browser


class BrowserIdentityTests(unittest.TestCase):
    def test_browser_identity_preserves_unknown_engine(self):
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "browser"
            executable.write_text("example")
            executable.chmod(0o755)
            self.assertEqual(installed_browser(str(executable))["engine"], "unknown")

    @mock.patch("browser.platform.system", return_value="Darwin")
    def test_browser_identity_preserves_safari_and_firefox(self, _platform):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            safari = root / "Safari.app" / "Contents"
            safari_executable = safari / "MacOS" / "Safari"
            safari_executable.parent.mkdir(parents=True)
            safari_executable.write_text("example")
            safari_executable.chmod(0o755)
            with (safari / "Info.plist").open("wb") as handle:
                plistlib.dump({"CFBundleIdentifier": "com.apple.Safari"}, handle)
            self.assertEqual(installed_browser(str(safari_executable))["engine"], "webkit")

            firefox = root / "Firefox.app" / "Contents"
            firefox_executable = firefox / "MacOS" / "firefox"
            firefox_executable.parent.mkdir(parents=True)
            firefox_executable.write_text("example")
            firefox_executable.chmod(0o755)
            (firefox / "Resources").mkdir()
            (firefox / "Resources" / "omni.ja").touch()
            self.assertEqual(installed_browser(str(firefox_executable))["engine"], "gecko")

    def test_engine_uses_runtime_markers_not_browser_name(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / "unfamiliar-browser"
            executable.touch()
            (root / "icudtl.dat").touch()
            self.assertEqual(engine_for(str(executable), "example.unknown"), "chromium")

    def test_engine_follows_linux_style_executable_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installation = root / "opt" / "example"
            installation.mkdir(parents=True)
            executable = installation / "example-browser"
            executable.touch(mode=0o755)
            (installation / "icudtl.dat").touch()
            binary_directory = root / "usr" / "bin"
            binary_directory.mkdir(parents=True)
            link = binary_directory / "example-browser"
            link.symlink_to(executable)
            self.assertEqual(engine_for(str(link), "example.unknown"), "chromium")

    def test_gecko_and_webkit_are_distinct(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / "unfamiliar-browser"
            executable.touch()
            (root / "omni.ja").touch()
            self.assertEqual(engine_for(str(executable), "example.unknown"), "gecko")
        self.assertEqual(engine_for("/missing", "com.apple.Safari.WebApp"), "webkit")

    def test_user_data_dir_is_derived_from_process_arguments(self):
        self.assertEqual(
            browser.command_user_data_dir(
                '/example/browser --user-data-dir="/example/Profile Root"'
            ),
            Path("/example/Profile Root"),
        )

    def test_default_reports_identity_without_a_controller(self):
        configured = {
            "path": "/example/browser",
            "native_app_id": "example.browser",
            "name": "Example Browser",
            "engine": "chromium",
        }
        output = io.StringIO()
        with mock.patch.object(browser, "default_browser", return_value=configured), \
             contextlib.redirect_stdout(output), \
             self.assertRaises(SystemExit) as raised:
            browser.main(["default"])
        self.assertEqual(raised.exception.code, 0)
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["path"], "/example/browser")
        self.assertNotIn("controller", payload)

    def test_tab_inventory_lists_page_targets_through_devtools(self):
        with mock.patch.object(
            browser, "websocket_messages",
            return_value={1: {"result": {"targetInfos": [
                {"type": "page", "targetId": "target-1", "title": "Example",
                 "url": "https://example.invalid"},
                {"type": "service_worker", "targetId": "worker-1",
                 "title": "Worker", "url": "https://example.invalid/sw.js"},
                {"type": "page", "targetId": "target-2"},
            ]}}},
        ) as messages:
            tabs = browser.browser_tabs(9222, "/devtools/browser/example")
        self.assertEqual(
            [tab["targetId"] for tab in tabs], ["target-1", "target-2"]
        )
        self.assertEqual(tabs[0]["title"], "Example")
        self.assertEqual(tabs[1], {"targetId": "target-2", "title": "", "url": ""})
        self.assertEqual(messages.call_args.args[:2], (9222, "/devtools/browser/example"))
        self.assertEqual(
            messages.call_args.args[2][0]["method"], "Target.getTargets"
        )

    def test_tab_inventory_fails_without_a_target_list(self):
        with mock.patch.object(
            browser, "websocket_messages", return_value={1: {"result": {}}}
        ), self.assertRaisesRegex(ValueError, "no target list"):
            browser.browser_tabs(9222, "/devtools/browser/example")

    def test_tab_inventory_reports_no_controller(self):
        configured = {
            "path": "/example/browser",
            "native_app_id": "example.browser",
            "name": "Example Browser",
            "engine": "chromium",
        }
        tabs = [{"targetId": "target-1", "title": "Example", "url": "https://example.invalid"}]
        with mock.patch.object(browser, "default_browser", return_value=configured), \
             mock.patch.object(browser, "browser_process", return_value={"pid": 7}), \
             mock.patch.object(
                 browser,
                 "devtools_endpoint",
                 return_value=(Path("/example/data"), 9222, "/devtools/browser/example"),
             ), \
             mock.patch.object(browser, "browser_tabs", return_value=tabs), \
             mock.patch.object(
                 browser,
                 "attention_for_tabs",
                 return_value={"target-1": {"selected": True, "focused": True}},
             ), \
             mock.patch.object(browser, "browser_foreground", return_value=True), \
             mock.patch.object(
                 browser,
                 "websocket_messages",
                 return_value={1: {"result": {"windowId": 9}}},
             ):
            inventory = browser.default_tabs()
        self.assertNotIn("controller", inventory)
        self.assertEqual(inventory["browser_pid"], 7)
        self.assertEqual(inventory["tabs"][0]["tab_id"], "target-1")
        self.assertEqual(inventory["tabs"][0]["window_id"], "9")
        self.assertIs(inventory["tabs"][0]["selected"], True)
        self.assertIs(inventory["tabs"][0]["focused"], True)
        self.assertIs(inventory["browser_foreground"], True)

    def test_target_attention_fails_closed_for_invalid_target_id(self):
        self.assertEqual(
            browser.target_attention(9222, "../unsafe"),
            {"selected": "unknown", "focused": "unknown"},
        )

    def test_background_browser_cannot_report_a_user_focused_tab(self):
        configured = {
            "path": "/example/browser",
            "native_app_id": "example.browser",
            "name": "Example Browser",
            "engine": "chromium",
        }
        tabs = [{"targetId": "ABC123", "title": "Duplicate", "url": "https://example.invalid"}]
        with mock.patch.object(browser, "default_browser", return_value=configured), \
             mock.patch.object(browser, "browser_process", return_value={"pid": 7}), \
             mock.patch.object(
                 browser, "devtools_endpoint",
                 return_value=(Path("/example/data"), 9222, "/devtools/browser/example"),
             ), mock.patch.object(browser, "browser_tabs", return_value=tabs), \
             mock.patch.object(
                 browser, "websocket_messages",
                 return_value={1: {"result": {"windowId": 9}}},
             ), mock.patch.object(
                 browser, "attention_for_tabs",
                 return_value={"ABC123": {"selected": True, "focused": True}},
             ), mock.patch.object(browser, "browser_foreground", return_value=False):
            inventory = browser.default_tabs()
        self.assertIs(inventory["tabs"][0]["selected"], True)
        self.assertIs(inventory["tabs"][0]["focused"], False)

    def test_tab_inventory_preserves_exact_url(self):
        configured = {
            "path": "/example/browser", "native_app_id": "example.browser",
            "name": "Example Browser", "engine": "chromium",
        }
        exact_url = "http://localhost/callback?code=exact#state=exact"
        tabs = [{"targetId": "ABC123", "title": "Callback", "url": exact_url}]
        with mock.patch.object(browser, "default_browser", return_value=configured), \
             mock.patch.object(browser, "browser_process", return_value={"pid": 7}), \
             mock.patch.object(browser, "devtools_endpoint", return_value=(Path("/data"), 9222, "/ws")), \
             mock.patch.object(browser, "browser_tabs", return_value=tabs), \
             mock.patch.object(browser, "attention_for_tabs", return_value={"ABC123": {"selected": False, "focused": False}}), \
             mock.patch.object(browser, "browser_foreground", return_value=False), \
             mock.patch.object(browser, "websocket_messages", return_value={1: {"result": {"windowId": 9}}}):
            inventory = browser.default_tabs()
        self.assertEqual(inventory["tabs"][0]["url"], exact_url)




    def test_removed_page_commands_are_rejected(self):
        for command in ("run", "latch", "new", "release", "show"):
            with self.subTest(command=command), \
                 contextlib.redirect_stderr(io.StringIO()), \
                 self.assertRaises(SystemExit) as raised:
                browser.main([command, "--lease", "lease_example"])
            self.assertEqual(raised.exception.code, 2)

    def test_windows_browser_process_resolves_exact_main_executable(self):
        completed = mock.Mock(
            returncode=0,
            stdout=json.dumps([{
                "ProcessId": 42,
                "ParentProcessId": 7,
                "ExecutablePath": r"C:\Browser\browser.exe",
                "CommandLine": r'"C:\Browser\browser.exe" --restore-last-session',
            }]),
        )
        with mock.patch.object(browser.platform, "system", return_value="Windows"), \
             mock.patch.object(browser.shutil, "which", return_value="powershell.exe"), \
             mock.patch.object(browser.subprocess, "run", return_value=completed):
            value = browser.browser_process(r"C:\Browser\browser.exe")
        self.assertEqual(value["pid"], 42)
        self.assertEqual(value["executable"], r"C:\Browser\browser.exe")

    def test_default_profile_paths_cover_standard_windows_and_linux_browsers(self):
        with mock.patch.object(browser.platform, "system", return_value="Windows"), \
             mock.patch.dict(browser.os.environ, {"LOCALAPPDATA": r"C:\Users\me\AppData\Local"}):
            value = browser.default_user_data_dir({"path": r"C:\Google\chrome.exe"})
            self.assertIn("Google", str(value))
            self.assertIn("User Data", str(value))
        with mock.patch.object(browser.platform, "system", return_value="Linux"), \
             mock.patch.dict(browser.os.environ, {"XDG_CONFIG_HOME": "/home/me/.config"}):
            value = browser.default_user_data_dir({"path": "/usr/bin/chromium"})
            self.assertEqual(value, Path("/home/me/.config/chromium"))

    def test_windows_devtools_listener_requires_exact_pid_and_loopback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "DevToolsActivePort").write_text(
                "9222\n/devtools/browser/example\n", encoding="utf-8"
            )
            completed = mock.Mock(
                returncode=0,
                stdout=json.dumps([{"OwningProcess": 42, "LocalAddress": "127.0.0.1"}]),
            )
            with mock.patch.object(browser.platform, "system", return_value="Windows"), \
                 mock.patch.object(browser, "command_user_data_dir", return_value=root), \
                 mock.patch.object(browser.shutil, "which", return_value="powershell.exe"), \
                 mock.patch.object(browser.subprocess, "run", return_value=completed):
                value = browser.devtools_endpoint(
                    {"path": r"C:\Browser\browser.exe"}, {"pid": 42, "arguments": ""}
                )
            self.assertEqual(value[1], 9222)


if __name__ == "__main__":
    unittest.main()
