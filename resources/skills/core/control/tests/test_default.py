"""Tests for deriving the browser from current operating-system defaults."""

import importlib
import shlex
import tempfile
import unittest
from pathlib import Path
from unittest import mock


browser = importlib.import_module("browser")


class DefaultBrowserTests(unittest.TestCase):
    def test_dispatches_to_current_platform_and_validates_chromium(self):
        identity = {
            "path": "/example/browser",
            "native_app_id": "example.browser",
            "name": "Example Browser",
            "engine": "chromium",
        }
        with mock.patch.object(
            browser, "macos_default_executable", return_value="/example/browser"
        ) as derive, mock.patch.object(
            browser, "installed_browser", return_value=identity
        ) as validate:
            self.assertEqual(browser.default_browser("Darwin"), identity)
        derive.assert_called_once_with()
        validate.assert_called_once_with("/example/browser")

    def test_linux_resolves_xdg_default_desktop_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            applications = root / "applications"
            applications.mkdir()
            executable = root / "example-browser"
            executable.write_text("example")
            executable.chmod(0o755)
            (applications / "example.desktop").write_text(
                f"[Desktop Entry]\nExec={shlex.quote(executable.as_posix())} %U\n"
            )
            completed = mock.Mock(returncode=0, stdout="example.desktop\n")
            with mock.patch.object(
                browser.shutil, "which", return_value="/usr/bin/xdg-settings"
            ), mock.patch.object(
                browser.subprocess, "run", return_value=completed
            ), mock.patch.dict(
                browser.os.environ,
                {"XDG_DATA_HOME": str(root), "XDG_DATA_DIRS": ""},
                clear=False,
            ):
                self.assertEqual(
                    browser.linux_default_executable(), str(executable.resolve())
                )

    def test_windows_reads_https_user_choice(self):
        completed = mock.Mock(
            returncode=0, stdout=r"C:\Program Files\Example\browser.exe" + "\n"
        )
        with mock.patch.object(
            browser.shutil, "which", return_value="powershell.exe"
        ), mock.patch.object(browser.subprocess, "run", return_value=completed):
            self.assertEqual(
                browser.windows_default_executable(),
                r"C:\Program Files\Example\browser.exe",
            )

    def test_unsupported_platform_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "unsupported"):
            browser.default_browser("Plan9")


if __name__ == "__main__":
    unittest.main()
