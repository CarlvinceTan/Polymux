import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
UI = "apps/Polymux/Sources/Views/Chat.swift"


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.proof = self.repo / "captures"
        self.proof.mkdir()
        self.ui = []
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Evidence Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("commit", "-qm", "Base", "--allow-empty")
        self.git("checkout", "-qb", "change")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True,
                              capture_output=True, text=True)

    def change(self, path=UI, commit=True):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("change\n")
        self.git("add", path)
        if commit:
            self.git("commit", "-qm", "Change")
        if path.startswith(("apps/Polymux/", "apps/site/")) and path not in self.ui:
            self.ui.append(path)

    def check(self, labels="", base="main", options=(), **env):
        return subprocess.run([sys.executable, str(ROOT / "check-evidence.py"), base,
                               str(self.proof), *options], cwd=self.repo, text=True,
                              capture_output=True,
                              env={**os.environ, "VERIFY_LABELS": labels,
                                   "VERIFY_ISSUE": "", "VERIFY_PR": "", **env})

    def register(self, file, theme="light", paths=None, flow="chat", state="messages"):
        options = ["--record", str(file), "--flow", flow, "--state", state, "--theme", theme]
        for path in self.ui if paths is None else paths:
            options.extend(["--path", path])
        return self.check(options=options)

    def screenshot(self, theme="light", paths=None, register=True):
        file = self.proof / f"chat-{theme}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                        "testsrc=size=160x80", "-vf", "hue=h=" + ("0" if theme == "light" else "90"),
                        "-frames:v", "1", str(file)], check=True)
        if register:
            result = self.register(file, theme, paths)
            self.assertEqual(result.returncode, 0, result.stderr)
        return file

    def screenshots(self, paths=None):
        self.screenshot("light", paths)
        self.screenshot("dark", paths)

    def recording(self):
        file = self.proof / "chat.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                        "testsrc=size=160x80:rate=10", "-t", "1", "-pix_fmt",
                        "yuv420p", str(file)], check=True)
        self.assertEqual(self.register(file, "neutral", []).returncode, 0)

    def manifest(self, transform):
        file = self.proof / "evidence.json"
        value = json.loads(file.read_text())
        transform(value)
        file.write_text(json.dumps(value))

    def empty_manifest(self):
        diffs = [self.git("diff", "--binary", "--full-index", "--no-ext-diff", revision).stdout.encode()
                 for revision in ("main...HEAD", "HEAD")]
        (self.proof / "evidence.json").write_text(json.dumps({"version": 1,
            "head": self.git("rev-parse", "HEAD").stdout.strip(),
            "fingerprint": hashlib.sha256(b"\0".join(diffs)).hexdigest(), "captures": []}))

    def test_missing_capture(self):
        self.change()
        self.assertEqual(self.check().returncode, 1)

    def test_valid_capture(self):
        self.change()
        self.screenshots()
        self.assertEqual(self.check().returncode, 0)

    def test_ready_only(self):
        self.change()
        self.screenshot(register=False).rename(self.proof / "ready-home.png")
        self.assertEqual(self.check().returncode, 1)

    def test_invalid_capture(self):
        self.change()
        fake = self.proof / "fake.png"
        fake.write_text("not a screenshot")
        self.assertEqual(self.register(fake).returncode, 0)
        self.assertEqual(self.check().returncode, 1)

    def test_uncommitted_ui(self):
        self.change(commit=False)
        self.assertEqual(self.check().returncode, 1)
        self.screenshots()
        self.assertEqual(self.check().returncode, 0)

    def test_server_change(self):
        self.change("apps/server/internal/server/server.go")
        self.assertEqual(self.check().returncode, 0)

    def test_recording_required(self):
        self.change()
        self.screenshots()
        for label in ("Performance", "Feature, Responsiveness"):
            result = self.check(label)
            self.assertEqual(result.returncode, 1)
            self.assertIn("requires a valid recording", result.stdout)

    def test_valid_recording(self):
        self.change()
        self.screenshots()
        self.recording()
        self.assertEqual(self.check("Performance").returncode, 0)

    def test_missing_theme(self):
        self.change()
        self.screenshot()
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("dark screenshot", result.stdout)

    def test_missing_path(self):
        self.change()
        self.change("apps/site/src/App.svelte")
        self.screenshots(paths=[UI])
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("apps/site/src/App.svelte requires", result.stdout)

    def test_stale_head(self):
        self.change()
        self.screenshots()
        self.git("commit", "-qm", "Next head", "--allow-empty")
        self.assertEqual(self.check().returncode, 1)

    def test_stale_edit(self):
        self.change()
        self.screenshots()
        (self.repo / UI).write_text("later uncommitted change\n")
        self.assertEqual(self.check().returncode, 1)

    def test_stale_recording(self):
        self.change("apps/server/internal/server/server.go")
        self.recording()
        self.assertEqual(self.check("Performance").returncode, 0)
        (self.repo / "apps/server/internal/server/server.go").write_text("later performance change\n")
        self.assertEqual(self.check("Performance").returncode, 1)

    def test_changed_file(self):
        self.change()
        self.screenshots()
        with (self.proof / "chat-light.png").open("ab") as file:
            file.write(b"changed")
        self.assertEqual(self.check().returncode, 1)

    def test_metadata_required(self):
        self.change()
        file = self.screenshot(register=False)
        self.assertEqual(self.register(file, flow=" ").returncode, 1)
        self.assertEqual(self.register(file, state=" ").returncode, 1)
        self.assertEqual(self.register(file, paths=[]).returncode, 1)

    def test_manifest_traversal(self):
        self.change()
        self.screenshots()
        self.manifest(lambda value: value["captures"][0].update(file="../outside.png"))
        self.assertEqual(self.check().returncode, 1)

    def test_symlink(self):
        self.change()
        self.screenshots()
        file = self.proof / "chat-light.png"
        outside = self.repo / "outside.png"
        file.rename(outside)
        file.symlink_to(outside)
        self.assertEqual(self.check().returncode, 1)
        self.assertEqual(self.register(file).returncode, 1)

    def test_only_registered_published(self):
        self.change()
        self.screenshots()
        shutil.copyfile(self.proof / "chat-light.png", self.proof / "ready-old.png")
        output = self.repo / "published"
        self.assertEqual(self.check(options=("--output", str(output))).returncode, 0)
        self.assertEqual({file.name for file in output.iterdir()}, {"chat-light.png", "chat-dark.png", "evidence.json"})

    def test_manifest_symlink(self):
        self.change()
        self.screenshots()
        file = self.proof / "evidence.json"
        outside = self.repo / "outside.json"
        file.rename(outside)
        file.symlink_to(outside)
        self.assertEqual(self.check().returncode, 1)

    def test_directory_symlink(self):
        self.change()
        self.screenshots()
        actual = self.repo / "actual-captures"
        self.proof.rename(actual)
        self.proof.symlink_to(actual)
        self.assertEqual(self.check().returncode, 1)

    def test_scratch_home(self):
        self.change()
        self.screenshots()
        home = self.repo / "scratch-home"
        home.mkdir()
        self.assertEqual(self.check(HOME=str(home), PYTHONNOUSERSITE="1").returncode, 0)

    def test_missing_dependency(self):
        self.change()
        self.screenshots()
        self.assertEqual(self.check(MC_NOPIL="1").returncode, 1)

    def test_card_labels(self):
        self.change("apps/server/internal/server/server.go")
        self.empty_manifest()
        bin_dir = self.repo / "bin"
        bin_dir.mkdir()
        gh = bin_dir / "gh"
        gh.write_text('#!/bin/sh\nprintf \'{"labels":[{"name":"Performance"}]}\\n\'\n')
        gh.chmod(0o755)
        for field in ("VERIFY_ISSUE", "VERIFY_PR"):
            result = self.check(**{field: "42", "PATH": f"{bin_dir}:{os.environ['PATH']}"})
            self.assertEqual(result.returncode, 1)
            self.assertIn("requires a valid recording", result.stdout)

    def test_label_lookup_failure(self):
        self.change("apps/server/internal/server/server.go")
        self.assertEqual(self.check(VERIFY_ISSUE="42", PATH="/usr/bin:/bin").returncode, 1)

    def test_bad_base(self):
        self.assertEqual(self.check(base="missing-ref").returncode, 1)

    def test_external_verifier(self):
        self.change("docs/change.md")
        scripts = self.repo / "scripts"
        scripts.mkdir()
        shutil.copyfile(ROOT / "verify-result.sh", scripts / "verify-result.sh")
        (scripts / "test-readiness.sh").write_text("exit 0\n")
        build = self.repo / ".build"
        build.mkdir()
        (build / "env").write_text(f"WT_NAME=old-checkout\nDD={build}/dd\nSPM={build}/spm\nSIM_UDID=none\n")
        selector = self.repo / "targets.py"
        selector.write_text('print("GO_PKGS=\\\"\\\"\\nSWIFT=\\\"\\\"\\nAPP=0\\nWHY=fixture")\n')
        home = self.repo / "home"
        home.mkdir()
        tools = self.repo / "bin"
        tools.mkdir()
        calls = self.repo / "evidence-calls"
        python = tools / "python3"
        python.write_text(f'''#!/bin/bash
case "$1" in
  */test-ui-guard.py)
    [ -f "$1" ] || exit 2
    exit 0;;
  */test-evidence.py|*/check-evidence.py)
    [ -f "$1" ] || exit 2
    printf '%s\\n' "$1" >> '{calls}'
    exit 0;;
  *) exec '{sys.executable}' "$@";;
esac
''')
        python.chmod(0o755)
        for name in ("xcrun", "pkill"):
            path = tools / name
            path.write_text("#!/bin/sh\nexit 0\n")
            path.chmod(0o755)
        result = subprocess.run(["bash", str(ROOT / "verify.sh")], cwd=self.repo,
                                capture_output=True, text=True, timeout=30,
                                env={**os.environ, "HOME": str(home), "PATH": f"{tools}:{os.environ['PATH']}",
                                     "VERIFY_TARGETS": "affected", "TI_BASE": "main",
                                     "AFFECTED_PY": str(selector),
                                     "VERIFY_ISSUE": "", "VERIFY_PR": "", "VERIFY_LABELS": ""})
        affected = self.repo / ".build/logs/affected-tests.log"
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr
                         + (affected.read_text() if affected.exists() else ""))
        self.assertEqual(calls.read_text().splitlines(), [str(ROOT / "test-evidence.py"), str(ROOT / "check-evidence.py")])
        for name in ("check-evidence.py", "test-evidence.py"):
            (scripts / name).write_text("raise SystemExit('obsolete helper')\n")
        calls.unlink()
        result = subprocess.run(["bash", str(ROOT / "verify.sh")], cwd=self.repo,
                                capture_output=True, text=True, timeout=30,
                                env={**os.environ, "HOME": str(home), "PATH": f"{tools}:{os.environ['PATH']}",
                                     "VERIFY_TARGETS": "affected", "TI_BASE": "main", "AFFECTED_PY": str(selector),
                                     "VERIFY_ISSUE": "", "VERIFY_PR": "", "VERIFY_LABELS": ""})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(calls.read_text().splitlines(), [str(ROOT / "test-evidence.py"), str(ROOT / "check-evidence.py")])


if __name__ == "__main__":
    unittest.main()
