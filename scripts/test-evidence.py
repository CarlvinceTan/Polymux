import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.proof = self.repo / "proof"
        self.proof.mkdir()
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Evidence Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("commit", "-qm", "Base", "--allow-empty")
        self.git("checkout", "-qb", "change")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True,
                              capture_output=True, text=True)

    def change(self, path, commit=True):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("change\n")
        self.git("add", path)
        if commit:
            self.git("commit", "-qm", "Change")

    def check(self, labels="", base="main", **env):
        return subprocess.run(["python3", str(ROOT / "check-evidence.py"), base,
                               str(self.proof)], cwd=self.repo, text=True,
                              capture_output=True,
                              env={**os.environ, "VERIFY_LABELS": labels,
                                   "VERIFY_ISSUE": "", "VERIFY_PR": "", **env})

    def screenshot(self):
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                        "testsrc=size=160x80", "-frames:v", "1",
                        str(self.proof / "chat.png")], check=True)

    def test_missing_capture(self):
        self.change("apps/Polymux/Sources/Views/Chat.swift")
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires a valid screenshot", result.stdout)

    def test_valid_capture(self):
        self.change("apps/Polymux/Sources/Views/Chat.swift")
        self.screenshot()
        self.assertEqual(self.check().returncode, 0)

    def test_invalid_capture(self):
        self.change("apps/site/src/App.svelte")
        (self.proof / "fake.png").write_text("not a screenshot")
        self.assertEqual(self.check().returncode, 1)

    def test_uncommitted_ui(self):
        self.change("apps/site/src/styles.css", commit=False)
        self.assertEqual(self.check().returncode, 1)

    def test_server_change(self):
        self.change("apps/server/internal/server/server.go")
        self.assertEqual(self.check().returncode, 0)

    def test_recording_required(self):
        self.change("apps/Polymux/Sources/Views/Chat.swift")
        self.screenshot()
        for label in ["Performance", "Feature, Responsiveness"]:
            result = self.check(label)
            self.assertEqual(result.returncode, 1)
            self.assertIn("requires a valid recording", result.stdout)

    def test_valid_recording(self):
        self.change("apps/Polymux/Sources/Views/Chat.swift")
        self.screenshot()
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                        "testsrc=size=160x80:rate=10", "-t", "1", "-pix_fmt",
                        "yuv420p", str(self.proof / "chat.mp4")], check=True)
        self.assertEqual(self.check("Performance").returncode, 0)

    def test_missing_dependency(self):
        self.change("apps/site/src/App.svelte")
        self.screenshot()
        self.assertEqual(self.check(MC_NOPIL="1").returncode, 1)

    def test_card_labels(self):
        self.change("apps/server/internal/server/server.go")
        bin_dir = self.repo / "bin"
        bin_dir.mkdir()
        gh = bin_dir / "gh"
        gh.write_text('#!/bin/sh\nprintf \'{"labels":[{"name":"Performance"}]}\\n\'\n')
        gh.chmod(0o755)
        result = self.check(VERIFY_ISSUE="42", PATH=f"{bin_dir}:{os.environ['PATH']}")
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires a valid recording", result.stdout)
        result = self.check(VERIFY_PR="branch", PATH=f"{bin_dir}:{os.environ['PATH']}")
        self.assertEqual(result.returncode, 1)

    def test_label_lookup_failure(self):
        self.change("apps/server/internal/server/server.go")
        self.assertEqual(self.check(VERIFY_ISSUE="42", PATH="/usr/bin:/bin").returncode, 1)

    def test_bad_base(self):
        self.assertEqual(self.check(base="missing-ref").returncode, 1)


if __name__ == "__main__":
    unittest.main()
