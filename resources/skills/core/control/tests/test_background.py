"""Tests for the unified background entry point."""

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SKILL_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = SKILL_ROOT / "scripts" / "background.py"
sys.path.insert(0, str(MODULE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("control_background", MODULE_PATH)
background = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = background
SPEC.loader.exec_module(background)

LINUX_PATH = SKILL_ROOT / "scripts" / "linux" / "background.py"
LINUX_SPEC = importlib.util.spec_from_file_location("control_linux_background", LINUX_PATH)
linux_background = importlib.util.module_from_spec(LINUX_SPEC)
assert LINUX_SPEC and LINUX_SPEC.loader
LINUX_SPEC.loader.exec_module(linux_background)

WINDOWS_PATH = SKILL_ROOT / "scripts" / "windows" / "background.py"
WINDOWS_SPEC = importlib.util.spec_from_file_location("control_windows_background", WINDOWS_PATH)
windows_background = importlib.util.module_from_spec(WINDOWS_SPEC)
assert WINDOWS_SPEC and WINDOWS_SPEC.loader
WINDOWS_SPEC.loader.exec_module(windows_background)


class BackgroundTests(unittest.TestCase):
    def test_platforms_dispatch_directly_to_native_backends(self):
        with mock.patch.object(
            background, "compile_source", return_value=Path("/test/background")
        ):
            self.assertEqual(background.backend_command("Darwin"), [str(Path("/test/background"))])
        self.assertEqual(
            background.backend_command("Windows")[-1],
            str(background.SCRIPT_DIR / "windows" / "background.py"),
        )
        self.assertEqual(
            background.backend_command("Linux")[-1],
            str(background.SCRIPT_DIR / "linux" / "background.py"),
        )
        self.assertIsNone(background.backend_command("Plan9"))

    def test_linux_existing_processes_require_exact_executable_path(self):
        with tempfile.TemporaryDirectory() as directory:
            expected = Path(directory) / "example"
            other = Path(directory) / "other"
            expected.touch()
            other.touch()
            with mock.patch.object(
                linux_background,
                "run",
                return_value=SimpleNamespace(stdout="10\n11\n"),
            ), mock.patch.object(
                linux_background,
                "process_path",
                side_effect=[expected.resolve(), other.resolve()],
            ):
                self.assertEqual(
                    linux_background.running_pids("example", str(expected)),
                    [10],
                )
        self.assertEqual(linux_background.running_pids("example", None), [])

    def test_windows_existing_processes_require_exact_executable_path(self):
        rows = '"example.exe","10"\n"example.exe","11"\n'
        with mock.patch.object(
            windows_background.subprocess,
            "run",
            return_value=SimpleNamespace(stdout=rows),
        ), mock.patch.object(
            windows_background,
            "process_path",
            side_effect=[r"C:\\Apps\\example.exe", r"C:\\Other\\example.exe"],
        ):
            self.assertEqual(
                windows_background.running_pids(
                    "example", r"C:\\Apps\\example.exe"
                ),
                [10],
            )
        self.assertEqual(windows_background.running_pids("example", None), [])


if __name__ == "__main__":
    unittest.main()
