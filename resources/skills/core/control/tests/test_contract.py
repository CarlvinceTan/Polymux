"""Contract tests for fail-closed background control."""

import ast
import subprocess
import sys
import unittest
import json
import re
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = SKILL_ROOT / "scripts"


class ControlContractTests(unittest.TestCase):
    @staticmethod
    def local_device() -> str:
        from config import load_config
        devices = load_config()["devices"]
        return next(key for key, value in devices.items() if value["kind"] == "local")

    def run_adapter(self, name: str, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(DIRECTORY / name), *arguments],
            capture_output=True,
            text=True,
        )

    def test_missing_app_cannot_be_launched(self):
        result = self.run_adapter(
            "background.py", "prepare", "--app", "DefinitelyMissingControlTestApp",
            "--check-only",
        )
        self.assertIn(result.returncode, (2, 5, 6))
        self.assertIn("blocked_", result.stdout)

    def test_window_rejects_lock_identity_mismatch_before_control(self):
        result = self.run_adapter(
            "window.py", "press", "--device", self.local_device(), "--app", "Example",
            "--app-id", "example.app", "--pid", "1", "--lock-window-id", "2",
            "--lock-token", "test", "--native-window-id", "1",
            "--match-attribute", "title", "--match-value", "Nothing",
        )
        self.assertEqual(result.returncode, 3)
        self.assertIn("blocked_lock_window_mismatch", result.stdout)

    def test_dialog_resolve_requires_an_exact_button(self):
        result = self.run_adapter(
            "dialog.py", "resolve", "--device", self.local_device(), "--app", "Example", "--app-id", "example.app",
            "--pid", "1", "--native-window-id", "1", "--owner", "agent-1",
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("resolve requires either --button", result.stderr)

    def test_python_and_swift_filenames_have_at_most_two_words(self):
        violations = []
        for root in (SKILL_ROOT / "scripts", SKILL_ROOT / "tests"):
            for path in root.rglob("*"):
                if path.suffix not in {".py", ".swift"} or path.stem.startswith("__"):
                    continue
                if len([part for part in re.split(r"[-_]+", path.stem) if part]) > 2:
                    violations.append(str(path.relative_to(SKILL_ROOT)))
        self.assertEqual(violations, [])

    def test_sources_have_no_unnecessary_shebangs(self):
        violations = []
        for root in (SKILL_ROOT / "scripts", SKILL_ROOT / "tests"):
            for path in root.rglob("*"):
                if path.suffix in {".py", ".swift"} and path.read_text().startswith("#!"):
                    violations.append(str(path.relative_to(SKILL_ROOT)))
        self.assertEqual(violations, [])

    def test_init_files_are_not_comment_or_docstring_only(self):
        violations = []
        for root in (SKILL_ROOT / "scripts", SKILL_ROOT / "tests"):
            for path in root.rglob("__init__.py"):
                tree = ast.parse(path.read_text())
                if not tree.body or (
                    len(tree.body) == 1
                    and isinstance(tree.body[0], ast.Expr)
                    and isinstance(tree.body[0].value, ast.Constant)
                ):
                    violations.append(str(path.relative_to(SKILL_ROOT)))
        self.assertEqual(violations, [])

    def test_browser_has_no_redundant_package_entrypoint(self):
        self.assertFalse((DIRECTORY / "browser" / "__main__.py").exists())


if __name__ == "__main__":
    unittest.main()
