"""Build an exact Git commit and deploy it to cvmini and the paired Mac client."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

SPEC = importlib.util.spec_from_file_location("deploy_host", Path(__file__).with_name("deploy_host.py"))
host = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(host)
ROOT = Path(__file__).resolve().parents[2]
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=30"]


def adhoc_entitlements(path):
    value = plistlib.loads(Path(path).read_bytes())
    # APNS requires an Apple-issued signing identity and provisioning profile.
    value.pop("com.apple.developer.aps-environment", None)
    return value


def build(ref, output, server=True, app=True):
    sha = host.revision(host.run(["git", "-C", str(ROOT), "rev-parse", "--verify", "--end-of-options", ref + "^{commit}"]))
    output = Path(output).resolve() / sha
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    with host.locked(output):
        if cached(output, sha, server, app):
            return output
        return snapshot(sha, output, server, app)


def cached(output, sha, server, app):
    try:
        manifest = json.loads((output / "manifest.json").read_text())
        if manifest.get("sha") != sha:
            return False
        if server and (manifest.get("serverSHA256") != host.digest(output / "polymux-server") or
                       host.run([str(output / "polymux-server"), "--version"]) != sha):
            return False
        if app:
            if manifest.get("appSHA") != sha or host.app_sha(output / "Polymux.app") != sha:
                return False
            host.run(["codesign", "--verify", "--deep", "--strict", str(output / "Polymux.app")])
            signed = host.run(["codesign", "-d", "--entitlements", ":-", str(output / "Polymux.app")])
            if "com.apple.developer.aps-environment" in plistlib.loads(signed.encode()):
                return False
        return True
    except (OSError, ValueError, host.DeployError):
        return False


def snapshot(sha, output, server, app):
    with tempfile.TemporaryDirectory(prefix="source-", dir=output) as temporary:
        source = Path(temporary)
        archive = output / "source.tar"
        try:
            with archive.open("wb") as destination:
                subprocess.run(["git", "-C", str(ROOT), "archive", sha], stdout=destination, check=True)
            host.run(["tar", "-xf", str(archive), "-C", str(source)])
        finally:
            archive.unlink(missing_ok=True)
        if server:
            with (output / "server-build.log").open("w") as log:
                subprocess.run(["go", "build", "-tags", "sqlite_fts5", "-trimpath", "-ldflags", "-X main.buildSHA=" + sha,
                                "-o", str(output / "polymux-server"), "./cmd/server"],
                               cwd=source / "apps/server", check=True, stdout=log, stderr=subprocess.STDOUT)
            if host.run([str(output / "polymux-server"), "--version"]) != sha:
                raise host.DeployError("built server has an unexpected commit")
        if app:
            with (output / "app-build.log").open("w") as log:
                subprocess.run([sys.executable, str(source / "scripts/control/fetch_cua.py")], check=True,
                               stdout=log, stderr=subprocess.STDOUT)
                subprocess.run(["xcodebuild", "build", "-project", str(source / "apps/Polymux/Polymux.xcodeproj"),
                                "-scheme", "Polymux", "-configuration", "Release", "-destination", "platform=macOS",
                                "-derivedDataPath", str(output / "build"), "-jobs", "4", "CODE_SIGNING_ALLOWED=NO"],
                               check=True, stdout=log, stderr=subprocess.STDOUT)
            built = output / "build/Build/Products/Release/Polymux.app"
            app_path = output / "Polymux.app"
            if app_path.exists():
                shutil.rmtree(app_path)
            host.run(["ditto", str(built), str(app_path)])
            info = app_path / "Contents/Info.plist"
            value = plistlib.loads(info.read_bytes())
            value["PolymuxBuildSHA"] = sha
            info.write_bytes(plistlib.dumps(value))
            entitlements = adhoc_entitlements(source / "apps/Polymux/Polymux-macOS.entitlements")
            entitlement_path = output / "entitlements.plist"
            entitlement_path.write_bytes(plistlib.dumps(entitlements))
            launcher = app_path / "Contents/Helpers/deploy-launch"
            host.run(["xcrun", "swiftc", "-O", "-o", str(launcher), str(source / "scripts/deploy/deploy-launch.swift")])
            host.run(["codesign", "--force", "--options", "runtime", "--sign", "-",
                      str(app_path / "Contents/Helpers/cua-driver")])
            host.run(["codesign", "--force", "--options", "runtime", "--sign", "-", str(launcher)])
            host.run(["codesign", "--force", "--options", "runtime", "--entitlements", str(entitlement_path),
                      "--sign", "-", str(app_path)])
            host.run(["codesign", "--verify", "--deep", "--strict", str(app_path)])
            if host.app_sha(app_path) != sha:
                raise host.DeployError("built application has an unexpected commit")
    manifest = {"sha": sha}
    if server:
        manifest["serverSHA256"] = host.digest(output / "polymux-server")
    if app:
        manifest["appSHA"] = host.app_sha(output / "Polymux.app")
    host.save(output / "manifest.json", manifest)
    return output


def remote_app(name, artifact, sha):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@:-]*", name):
        raise host.DeployError("invalid SSH host")
    directory = host.run(SSH + [name, "umask 077; mktemp -d /tmp/polymux-deploy.XXXXXXXX"], timeout=60)
    if not re.fullmatch(r"/tmp/polymux-deploy\.[A-Za-z0-9]+", directory):
        raise host.DeployError("remote staging path was not recognized")
    try:
        with tempfile.TemporaryDirectory(prefix="polymux-transfer-") as temporary:
            archive = Path(temporary) / "Polymux.zip"
            host.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(artifact), str(archive)])
            host.run(["scp", "-o", "BatchMode=yes", "-o", "ConnectTimeout=30", str(archive),
                      str(Path(__file__).with_name("deploy_host.py")), name + ":" + directory + "/"], timeout=180)
            checksum = host.run(SSH + [name, shlex.join(["shasum", "-a", "256", directory + "/Polymux.zip"])], timeout=60).split()[0]
            if checksum != host.digest(archive):
                raise host.DeployError("remote application transfer checksum mismatch")
        command = shlex.join(["ditto", "-x", "-k", directory + "/Polymux.zip", directory])
        command += " && " + shlex.join(["python3", directory + "/deploy_host.py", "app", "--artifact",
                                       directory + "/Polymux.app", "--sha", sha, "--launch"])
        print(host.run(SSH + [name, command], timeout=120))
    finally:
        host.run(SSH + [name, shlex.join(["rm", "-rf", directory])], timeout=60)


def install(bundle, server=True, app=True, clients=("cvmac",)):
    bundle = Path(bundle).resolve()
    manifest = json.loads((bundle / "manifest.json").read_text())
    sha = host.revision(manifest["sha"])
    root = Path.home() / "polymux/deployments"
    if server:
        binary = bundle / "polymux-server"
        if host.digest(binary) != manifest.get("serverSHA256"):
            raise host.DeployError("server artifact checksum mismatch")
        service = host.Launchd(Path.home() / "Library/LaunchAgents/com.polymux.server.plist",
                              Path.home() / "Library/Application Support/Polymux/server/devices/local-token")
        host.install_server(binary, sha, root, service)
        print("deploy: cvmini server verified at " + sha)
    if app:
        artifact = bundle / "Polymux.app"
        if manifest.get("appSHA") != sha:
            raise host.DeployError("application manifest commit mismatch")
        host.install_app(artifact, sha, Path("/Applications/Polymux.app"), root, launch=True)
        print("deploy: cvmini application verified at " + sha)
        for client in clients:
            remote_app(client, artifact, sha)
    return sha


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "install", "update"])
    parser.add_argument("--ref", default="origin/main")
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / ".build/deploy")
    parser.add_argument("--client", action="append", help="SSH client host; defaults to cvmac")
    parser.add_argument("--receipt", type=Path, help="save the commit only after every requested host verifies")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--server-only", action="store_true")
    selection.add_argument("--apps-only", action="store_true")
    args = parser.parse_args()
    server, app = not args.apps_only, not args.server_only
    if args.action == "install":
        if not args.bundle:
            parser.error("install requires --bundle")
        bundle = args.bundle
    else:
        if args.ref == "origin/main":
            host.run(["git", "-C", str(ROOT), "fetch", "origin", "main"], timeout=90)
        bundle = build(args.ref, args.output, server, app)
        print("deploy: prepared " + str(bundle))
    if args.action != "build":
        sha = install(bundle, server, app, tuple(args.client or ["cvmac"]))
        if args.receipt:
            host.save(args.receipt, {"sha": sha})


if __name__ == "__main__":
    try:
        main()
    except (host.DeployError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"deploy: {error}", file=sys.stderr)
        sys.exit(1)
