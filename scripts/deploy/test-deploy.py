"""Hermetic deployment checks; never address a live launch agent or application."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("deploy_host", Path(__file__).with_name("deploy_host.py"))
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)
OLD = "1" * 40
NEW = "2" * 40
BUILD_SPEC = importlib.util.spec_from_file_location("deploy", Path(__file__).with_name("deploy.py"))
build = importlib.util.module_from_spec(BUILD_SPEC)
BUILD_SPEC.loader.exec_module(build)


class Service:
    def __init__(self, directory):
        self.binary = directory / "server"
        self.data = directory / "data"
        self.data.mkdir()
        (self.data / "state").write_text("valuable old state")
        self.binary.write_text(OLD)
        self.active = True
        self.reject = False
        self.crash = False
        self.stops = 0
        self.starts = 0

    def ready(self):
        if not self.active:
            raise deploy.DeployError("server job is unavailable")

    def stop(self):
        self.active = False
        self.stops += 1

    def start(self):
        self.starts += 1
        with deploy.data_lock(self.data):
            self.active = True
            if self.binary.read_text() == NEW:
                (self.data / "state").write_text("candidate migration changed state")
                (self.data / "new-file").write_text("candidate created this")
                if self.crash:
                    raise InterruptedError("interrupted after replacement")

    def health(self):
        if not self.active or self.reject and self.binary.read_text() == NEW:
            raise deploy.DeployError("health failed")
        return {"status": "ok", "buildSHA": self.binary.read_text()[:40]}


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.service = Service(self.path)
        self.artifact = self.path / "candidate"
        self.artifact.write_text(NEW)
        self.root = self.path / "backups"
        self.version = patch.object(deploy, "run", return_value=NEW)
        self.version.start()
        self.addCleanup(self.version.stop)

    def install(self):
        deploy.install_server(self.artifact, NEW, self.root, self.service, timeout=0)

    def restored(self):
        self.assertEqual(self.service.binary.read_text(), OLD)
        self.assertEqual((self.service.data / "state").read_text(), "valuable old state")
        self.assertFalse((self.service.data / "new-file").exists())
        self.assertTrue(self.service.active)
        self.assertFalse((self.root / "pending.json").exists())
        self.assertEqual(self.service.health()["buildSHA"], OLD)

    def test_success_saves_binary_and_consistent_data(self):
        self.install()
        self.assertEqual(self.service.health()["buildSHA"], NEW)
        saved = next(self.root.glob("*/result.json"))
        self.assertEqual(json.loads(saved.read_text())["result"], "installed")
        self.assertEqual((saved.parent / "server").read_text(), OLD)
        self.assertEqual((saved.parent / "data/state").read_text(), "valuable old state")
        self.assertFalse((self.root / "pending.json").exists())

    def test_failed_health_restores_binary_and_migrated_data(self):
        self.service.reject = True
        with self.assertRaisesRegex(deploy.DeployError, "previous binary and data restored"):
            self.install()
        self.restored()
        failed = list(self.path.glob("data.failed-*"))
        self.assertEqual(len(failed), 1)
        self.assertTrue((failed[0] / "new-file").exists())

    def test_occupied_data_lock_refuses_snapshot_without_mutation(self):
        with deploy.data_lock(self.service.data):
            with self.assertRaisesRegex(deploy.DeployError, "owns the data directory"):
                self.install()
        self.assertEqual(self.service.binary.read_text(), OLD)
        self.assertEqual((self.service.data / "state").read_text(), "valuable old state")
        self.assertFalse((self.service.data / "new-file").exists())
        state = json.loads((self.root / "pending.json").read_text())
        self.assertFalse(state["snapshot"])
        self.assertFalse((Path(state["backup"]) / "server").exists())
        with deploy.locked(self.root):
            deploy.recover(self.root, self.service, timeout=0)
        self.restored()

    def test_data_lock_survives_atomic_restore(self):
        self.service.reject = True
        original = deploy.swap
        observed = []
        def swapped(staged, active):
            original(staged, active)
            if Path(active) == self.service.data:
                with self.assertRaisesRegex(deploy.DeployError, "owns the data directory"):
                    with deploy.data_lock(active):
                        pass
                observed.append(True)
        with patch.object(deploy, "swap", side_effect=swapped):
            with self.assertRaises(deploy.DeployError):
                self.install()
        self.assertEqual(observed, [True])
        self.restored()

    def test_explicit_rollback_check_rejects_a_healthy_candidate(self):
        with self.assertRaisesRegex(deploy.DeployError, "previous binary and data restored"):
            deploy.install_server(self.artifact, NEW, self.root, self.service, timeout=0, rollback_check=True)
        self.restored()

    def test_interruption_after_replace_rolls_back(self):
        self.service.crash = True
        with self.assertRaises(deploy.DeployError):
            self.install()
        self.restored()

    def test_failed_stop_preserves_data_and_pending_recovery(self):
        with patch.object(self.service, "stop", side_effect=deploy.DeployError("did not stop")):
            with self.assertRaisesRegex(deploy.DeployError, "rollback needs recovery"):
                self.install()
        self.assertEqual(self.service.binary.read_text(), OLD)
        self.assertEqual((self.service.data / "state").read_text(), "valuable old state")
        with deploy.locked(self.root):
            deploy.recover(self.root, self.service, timeout=0)
        self.restored()

    def test_pending_migration_is_recovered_before_next_install(self):
        self.service.reject = True
        original_stop = self.service.stop
        def stop():
            if self.service.binary.read_text() == NEW:
                raise deploy.DeployError("candidate will not stop")
            original_stop()
        with patch.object(self.service, "stop", side_effect=stop):
            with self.assertRaisesRegex(deploy.DeployError, "rollback needs recovery"):
                self.install()
        self.assertTrue((self.root / "pending.json").exists())
        with deploy.data_lock(self.service.data), deploy.locked(self.root):
            with self.assertRaisesRegex(deploy.DeployError, "owns the data directory"):
                deploy.recover(self.root, self.service, timeout=0)
        self.assertEqual(self.service.binary.read_text(), NEW)
        self.assertEqual((self.service.data / "state").read_text(), "candidate migration changed state")
        with deploy.locked(self.root):
            deploy.recover(self.root, self.service, timeout=0)
        self.restored()

    def test_wrong_artifact_never_stops_service(self):
        with patch.object(deploy, "run", return_value=OLD):
            with self.assertRaisesRegex(deploy.DeployError, "expected build"):
                self.install()
        self.assertEqual(self.service.stops, 0)
        self.assertEqual(self.service.binary.read_text(), OLD)

    def test_unavailable_job_never_changes_data(self):
        self.service.active = False
        with self.assertRaisesRegex(deploy.DeployError, "job is unavailable"):
            self.install()
        self.assertEqual(self.service.stops, 0)
        self.assertEqual((self.service.data / "state").read_text(), "valuable old state")

    def test_build_match_without_binary_match_still_installs(self):
        self.service.binary.write_text(NEW)
        self.artifact.write_text(NEW + "-different-binary")
        self.install()
        self.assertEqual(self.service.binary.read_text(), self.artifact.read_text())
        self.assertGreater(self.service.stops, 0)

    def test_concurrent_install_is_rejected(self):
        with deploy.locked(self.root):
            with self.assertRaisesRegex(deploy.DeployError, "another deployment"):
                self.install()
        self.assertEqual(self.service.stops, 0)

    def test_old_health_cannot_validate_new_install(self):
        self.service.health = lambda: {"status": "ok", "buildSHA": OLD}
        with self.assertRaisesRegex(deploy.DeployError, "previous binary and data restored"):
            self.install()
        self.restored()


@unittest.skipUnless(sys.platform == "darwin", "Mac application bundle installation")
class AppTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.current = self.make_app("Polymux.app", OLD)
        self.candidate = self.make_app("Candidate.app", NEW)
        self.root = self.path / "backups"

    def make_app(self, name, sha):
        app = self.path / name
        (app / "Contents/MacOS").mkdir(parents=True)
        shutil.copy("/usr/bin/true", app / "Contents/MacOS/Polymux")
        with (app / "Contents/Info.plist").open("wb") as output:
            plistlib.dump({"CFBundleExecutable": "Polymux", "CFBundleIdentifier": "test.polymux.deploy",
                          "CFBundlePackageType": "APPL", "PolymuxBuildSHA": sha}, output)
        subprocess.run(["codesign", "--force", "--sign", "-", str(app)], check=True, capture_output=True)
        return app

    def test_swap_keeps_old_signed_app_as_backup(self):
        deploy.install_app(self.candidate, NEW, self.current, self.root)
        self.assertEqual(deploy.app_sha(self.current), NEW)
        saved = json.loads((self.root / "app.json").read_text())
        self.assertEqual(deploy.app_sha(saved["backup"]), OLD)
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(self.current)], check=True)

    def test_same_build_does_not_restart_or_replace_app(self):
        deploy.install_app(self.candidate, NEW, self.current, self.root)
        with patch.object(deploy, "swap") as swap, patch.object(deploy, "stop_app") as stop:
            deploy.install_app(self.candidate, NEW, self.current, self.root)
            swap.assert_not_called()
            stop.assert_not_called()

    def test_swap_failure_leaves_original_app(self):
        with patch.object(deploy, "swap", side_effect=OSError("swap failed")):
            with self.assertRaises(OSError):
                deploy.install_app(self.candidate, NEW, self.current, self.root)
        self.assertEqual(deploy.app_sha(self.current), OLD)

    def test_installed_verification_failure_restores_old_app(self):
        original = deploy.run
        def run(args, **kwargs):
            if args[0] == "codesign" and args[-1] == str(self.current):
                raise deploy.DeployError("installed signature failed")
            return original(args, **kwargs)
        with patch.object(deploy, "run", side_effect=run):
            with self.assertRaises(deploy.DeployError):
                deploy.install_app(self.candidate, NEW, self.current, self.root)
        self.assertEqual(deploy.app_sha(self.current), OLD)

    def test_launch_failure_restores_and_restarts_previous_app(self):
        observed = []
        def start(app, _launcher):
            observed.append(deploy.app_sha(app))
            if observed[-1] == NEW:
                raise deploy.DeployError("new application failed to launch")
        with patch.object(deploy, "stop_app"), patch.object(deploy, "start_app", side_effect=start):
            with self.assertRaises(deploy.DeployError):
                deploy.install_app(self.candidate, NEW, self.current, self.root, launch=True)
        self.assertEqual(observed, [NEW, OLD])
        self.assertEqual(deploy.app_sha(self.current), OLD)


@unittest.skipUnless(sys.platform == "darwin", "Mac background application launch")
class NativeTests(unittest.TestCase):
    def test_native_launch_preserves_foreground_and_exact_path(self):
        with tempfile.TemporaryDirectory(prefix="polymux-launch-") as directory:
            root = Path(directory).resolve()
            launcher = root / "deploy-launch"
            subprocess.run(["xcrun", "swiftc", "-O", "-o", str(launcher),
                            str(Path(__file__).with_name("deploy-launch.swift"))], check=True, capture_output=True)
            app = root / "Check.app"
            (app / "Contents/MacOS").mkdir(parents=True)
            source = root / "Check.swift"
            source.write_text("import AppKit\nNSApplication.shared.setActivationPolicy(.regular)\nNSApplication.shared.run()\n")
            subprocess.run(["xcrun", "swiftc", "-O", "-o", str(app / "Contents/MacOS/Polymux"), str(source)], check=True, capture_output=True)
            with (app / "Contents/Info.plist").open("wb") as output:
                plistlib.dump({"CFBundleExecutable": "Polymux", "CFBundleIdentifier": "test.polymux." + root.name,
                              "CFBundlePackageType": "APPL", "NSPrincipalClass": "NSApplication"}, output)
            entitlements = root / "entitlements.plist"
            entitlements.write_bytes(plistlib.dumps(build.adhoc_entitlements(build.ROOT / "apps/Polymux/Polymux-macOS.entitlements")))
            subprocess.run(["codesign", "--force", "--options", "runtime", "--sign", "-", "--entitlements", str(entitlements), str(app)], check=True, capture_output=True)
            observer = root / "Observe.swift"
            observer.write_text('''import AppKit
let before = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
guard before > 0 else { exit(77) }
let process = Process()
process.executableURL = URL(fileURLWithPath: CommandLine.arguments[1])
process.arguments = [CommandLine.arguments[2]]
let output = Pipe()
process.standardOutput = output
try process.run()
process.waitUntilExit()
let launched = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)!.trimmingCharacters(in: .whitespacesAndNewlines)
Thread.sleep(forTimeInterval: 0.3)
let after = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
print("\\(before) \\(after) \\(launched)")
exit(process.terminationStatus)
''')
            observed = subprocess.run(["xcrun", "swift", str(observer), str(launcher), str(app)], capture_output=True, text=True, timeout=60)
            if observed.returncode == 77:
                self.skipTest("no active GUI session")
            self.assertEqual(observed.returncode, 0, observed.stderr)
            before, after, pid = map(int, observed.stdout.split())
            try:
                executable = subprocess.check_output(["ps", "-p", str(pid), "-o", "comm="], text=True).strip()
                self.assertEqual(executable, str(app / "Contents/MacOS/Polymux"))
                self.assertEqual(before, after, "background launch changed the foreground application")
                print(f"Background launch preserved foreground PID {before} -> {after}; exact-path app PID {pid}")
            finally:
                if deploy.app_pids(app) == [pid]:
                    os.kill(pid, signal.SIGTERM)


class BuildTests(unittest.TestCase):
    def test_cached_restricted_signature_is_rebuilt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "Polymux.app/Contents"
            app.mkdir(parents=True)
            (app / "Info.plist").write_bytes(plistlib.dumps({"PolymuxBuildSHA": NEW}))
            (root / "manifest.json").write_text(json.dumps({"sha": NEW, "appSHA": NEW}))
            restricted = plistlib.dumps({"com.apple.developer.aps-environment": "production"}).decode()
            with patch.object(build.host, "run", side_effect=["", restricted]):
                self.assertFalse(build.cached(root, NEW, server=False, app=True))
            source = build.ROOT / "apps/Polymux/Polymux-macOS.entitlements"
            original = source.read_bytes()
            value = build.adhoc_entitlements(source)
            self.assertTrue(value["com.apple.security.device.audio-input"])
            self.assertTrue(value["com.apple.security.device.camera"])
            self.assertNotIn("com.apple.developer.aps-environment", value)
            self.assertEqual(source.read_bytes(), original)
            with patch.object(build.host, "run", side_effect=["", plistlib.dumps(value).decode()]):
                self.assertTrue(build.cached(root, NEW, server=False, app=True))

    def test_receipt_advances_only_after_all_hosts_verify(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = root / "receipt.json"
            receipt.write_text(json.dumps({"sha": OLD}))
            arguments = ["deploy.py", "install", "--bundle", str(root), "--receipt", str(receipt)]
            with patch.object(sys, "argv", arguments), patch.object(build, "install", side_effect=build.host.DeployError("client unavailable")):
                with self.assertRaises(build.host.DeployError):
                    build.main()
            self.assertEqual(json.loads(receipt.read_text())["sha"], OLD)
            with patch.object(sys, "argv", arguments), patch.object(build, "install", return_value=NEW):
                build.main()
            self.assertEqual(json.loads(receipt.read_text())["sha"], NEW)

    def test_build_uses_exact_commit_even_with_dirty_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Deploy Test"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "deploy@test.invalid"], check=True)
            (root / "apps/server").mkdir(parents=True)
            (root / "apps/server/input").write_text("committed source")
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "Source"], check=True)
            sha = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
            (root / "apps/server/input").write_text("uncommitted source")
            original = subprocess.run
            observed = []
            def execute(args, **kwargs):
                if args[0] == "go":
                    observed.append((Path(kwargs["cwd"]) / "input").read_text())
                    artifact = Path(args[args.index("-o") + 1])
                    artifact.write_text("#!/bin/sh\necho " + sha + "\n")
                    artifact.chmod(0o755)
                    return subprocess.CompletedProcess(args, 0)
                return original(args, **kwargs)
            with patch.object(build, "ROOT", root), patch.object(subprocess, "run", side_effect=execute):
                bundle = build.build("HEAD", Path(directory) / "output", app=False)
                self.assertEqual(build.build("HEAD", Path(directory) / "output", app=False), bundle)
            self.assertEqual(observed, ["committed source"])
            manifest = json.loads((bundle / "manifest.json").read_text())
            self.assertEqual(manifest["sha"], sha)
            self.assertEqual(manifest["serverSHA256"], deploy.digest(bundle / "polymux-server"))

    def test_corrupt_server_bundle_never_touches_service(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "polymux-server").write_text("wrong artifact")
            (root / "manifest.json").write_text(json.dumps({"sha": NEW, "serverSHA256": "wrong checksum"}))
            with patch.object(build.host, "Launchd") as service:
                with self.assertRaisesRegex(build.host.DeployError, "checksum mismatch"):
                    build.install(root, app=False)
                service.assert_not_called()

    def test_remote_path_rejection_never_transfers_or_removes(self):
        commands = []
        def execute(args, **kwargs):
            commands.append(args)
            return "/unexpected/path"
        with patch.object(build.host, "run", side_effect=execute):
            with self.assertRaisesRegex(build.host.DeployError, "staging path"):
                build.remote_app("cvmac", Path("ignored"), NEW)
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0][0], "ssh")


class HealthTests(unittest.TestCase):
    def test_authenticated_health_requires_exact_build(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.headers.get("Authorization") != "Bearer test-credential":
                    self.send_error(401)
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok", "buildSHA": NEW}).encode())
            def log_message(self, *args):
                pass
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory) / "credential"
            token.write_text("test-credential")
            service = deploy.Launchd.__new__(deploy.Launchd)
            service.token = token
            server = HTTPServer(("127.0.0.1", 0), Handler)
            worker = threading.Thread(target=server.serve_forever)
            worker.start()
            try:
                service.url = "http://127.0.0.1:" + str(server.server_port) + "/health"
                self.assertEqual(deploy.wait_health(service, NEW, timeout=0)["buildSHA"], NEW)
                with self.assertRaisesRegex(deploy.DeployError, "expected build"):
                    deploy.wait_health(service, OLD, timeout=0)
                token.write_text("incorrect")
                with self.assertRaisesRegex(deploy.DeployError, "authenticated server health"):
                    service.health()
            finally:
                server.shutdown()
                worker.join()
                server.server_close()


if __name__ == "__main__":
    unittest.main()
