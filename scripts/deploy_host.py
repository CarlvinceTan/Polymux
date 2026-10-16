"""Install staged Polymux builds on one Mac, retaining recoverable backups."""
import argparse
import contextlib
import ctypes
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid


class DeployError(RuntimeError):
    pass


def run(args, **options):
    result = subprocess.run(args, check=False, capture_output=True, text=True, **options)
    if result.returncode:
        raise DeployError(f"{Path(args[0]).name} exited {result.returncode}")
    return result.stdout.strip()


def digest(path):
    checksum = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def save(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w") as output:
        json.dump(value, output, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


@contextlib.contextmanager
def locked(root):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    root.chmod(0o700)
    with (root / "lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise DeployError("another deployment is running") from error
        yield


def revision(value):
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise DeployError("a full build commit is required")
    return value


def atomic_copy(source, target):
    target = Path(target)
    staged = target.with_name(target.name + ".deploy-" + uuid.uuid4().hex)
    try:
        shutil.copy2(source, staged)
        with staged.open("rb") as file:
            os.fsync(file.fileno())
        os.replace(staged, target)
    finally:
        staged.unlink(missing_ok=True)


class Launchd:
    def __init__(self, plist, token, health=None):
        self.plist = Path(plist).expanduser().resolve()
        config = plistlib.loads(self.plist.read_bytes())
        arguments = config["ProgramArguments"]
        self.binary = Path(arguments[0])
        try:
            self.data = Path(arguments[arguments.index("-data") + 1])
            address = arguments[arguments.index("-listen") + 1]
        except (ValueError, IndexError) as error:
            raise DeployError("server launch agent must declare -data and -listen") from error
        if not self.binary.is_absolute() or not self.data.is_absolute():
            raise DeployError("server launch agent paths must be absolute")
        self.domain = f"gui/{os.getuid()}"
        self.target = self.domain + "/" + config["Label"]
        self.url = health or "http://" + address + "/health"
        self.token = Path(token).expanduser()

    def ready(self):
        run(["launchctl", "print", self.target])

    def stop(self):
        status = subprocess.run(["launchctl", "print", self.target], capture_output=True, text=True)
        if status.returncode:
            return
        match = re.search(r"\bpid = (\d+)", status.stdout)
        run(["launchctl", "bootout", self.target])
        if match:
            pid = int(match[1])
            until = time.monotonic() + 30
            while time.monotonic() < until:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    return
                time.sleep(0.1)
            raise DeployError("server did not stop; data was not changed")

    def start(self):
        run(["launchctl", "bootstrap", self.domain, str(self.plist)])

    def health(self):
        request = urllib.request.Request(self.url, headers={
            "Authorization": "Bearer " + self.token.read_text().strip(),
        })
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                value = json.load(response)
        except (OSError, ValueError, urllib.error.URLError) as error:
            raise DeployError("authenticated server health check failed") from error
        if value.get("status") != "ok":
            raise DeployError("server is not healthy")
        return {"status": "ok", "buildSHA": value.get("buildSHA")}


def wait_health(service, sha, timeout=30):
    until = time.monotonic() + timeout
    while True:
        try:
            health = service.health()
            if sha is None or health.get("buildSHA") == sha:
                return health
        except DeployError:
            pass
        if time.monotonic() >= until:
            raise DeployError("server did not become healthy at the expected build")
        time.sleep(0.25)


def restore(root, state, service, timeout):
    service.stop()
    backup = Path(state["backup"])
    if state["snapshot"]:
        data = Path(state["data"])
        staged = data.with_name(data.name + ".restore-" + uuid.uuid4().hex)
        shutil.copytree(backup / "data", staged, symlinks=True)
        atomic_copy(backup / "server", state["binary"])
        if data.exists():
            failed = data.with_name(data.name + ".failed-" + uuid.uuid4().hex)
            os.replace(data, failed)
            state["failedData"] = str(failed)
        os.replace(staged, data)
    service.start()
    wait_health(service, state["previous"].get("buildSHA"), timeout)
    state["result"] = "rolled_back"
    save(backup / "result.json", state)
    (root / "pending.json").unlink()


def recover(root, service, timeout=30):
    pending = root / "pending.json"
    if pending.exists():
        state = json.loads(pending.read_text())
        if state.get("result") != "installed":
            restore(root, state, service, timeout)
        else:
            pending.unlink()


def install_server(artifact, sha, root, service, timeout=30, rollback_check=False):
    revision(sha)
    artifact, root = Path(artifact), Path(root)
    if run([str(artifact), "--version"], timeout=10) != sha:
        raise DeployError("staged server does not report its expected build")
    with locked(root):
        recover(root, service, timeout)
        if service.binary.is_symlink() or service.data.is_symlink():
            raise DeployError("server binary and data must be ordinary deployment paths")
        service.ready()
        previous = service.health()
        if not rollback_check and previous.get("buildSHA") == sha and digest(artifact) == digest(service.binary):
            return
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S")
        backup = root / (stamp + "-" + sha[:12] + "-" + uuid.uuid4().hex[:8])
        backup.mkdir(mode=0o700)
        state = {"binary": str(service.binary), "data": str(service.data), "backup": str(backup),
                 "sha": sha, "previous": previous, "snapshot": False}
        save(root / "pending.json", state)
        try:
            service.stop()
            shutil.copy2(service.binary, backup / "server")
            shutil.copytree(service.data, backup / "data", symlinks=True)
            state["snapshot"] = True
            save(root / "pending.json", state)
            atomic_copy(artifact, service.binary)
            service.start()
            wait_health(service, sha, timeout)
            if rollback_check:
                raise DeployError("forced candidate rejection for the rollback check")
            state["result"] = "installed"
            save(backup / "result.json", state)
            save(root / "pending.json", state)
            (root / "pending.json").unlink()
        except BaseException:
            state.pop("result", None)
            try:
                save(root / "pending.json", state)
                restore(root, state, service, timeout)
            except BaseException as error:
                raise DeployError(f"deployment failed; rollback needs recovery from {backup}") from error
            raise DeployError(f"deployment failed; previous binary and data restored from {backup}")


def app_sha(app):
    return plistlib.loads((Path(app) / "Contents/Info.plist").read_bytes()).get("PolymuxBuildSHA")


def swap(left, right):
    # RENAME_SWAP keeps the application path present throughout bundle replacement.
    library = ctypes.CDLL(None, use_errno=True)
    rename = library.renamex_np
    rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
    if rename(os.fsencode(left), os.fsencode(right), 2):
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def app_pids(app):
    executable = str(Path(app) / "Contents/MacOS/Polymux")
    processes = run(["ps", "-axo", "pid=,comm="])
    return [int(pid) for line in processes.splitlines() for pid, command in [line.strip().split(None, 1)]
            if command == executable]


def stop_app(app):
    pids = app_pids(app)
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    until = time.monotonic() + 30
    while app_pids(app):
        if time.monotonic() >= until:
            raise DeployError("application did not stop")
        time.sleep(0.1)


def start_app(app):
    run(["open", str(app)])
    until = time.monotonic() + 15
    while not app_pids(app):
        if time.monotonic() >= until:
            raise DeployError("installed application did not launch")
        time.sleep(0.25)


def install_app(artifact, sha, destination, root, launch=False):
    revision(sha)
    artifact, destination, root = Path(artifact), Path(destination), Path(root)
    if app_sha(artifact) != sha:
        raise DeployError("staged application does not report its expected build")
    run(["codesign", "--verify", "--deep", "--strict", str(artifact)])
    with locked(root):
        if (root / "pending.json").exists():
            raise DeployError("recover the interrupted server deployment first")
        if destination.is_symlink():
            raise DeployError("application destination must not be a symlink")
        if destination.exists() and app_sha(destination) == sha and digest(artifact / "Contents/MacOS/Polymux") == digest(destination / "Contents/MacOS/Polymux"):
            run(["codesign", "--verify", "--deep", "--strict", str(destination)])
            if launch and not app_pids(destination):
                start_app(destination)
            return
        staged = destination.with_name(".Polymux-staged-" + uuid.uuid4().hex + ".app")
        run(["ditto", str(artifact), str(staged)])
        backup = destination.with_name(".Polymux-backup-" + uuid.uuid4().hex + ".app")
        replaced = destination.exists()
        installed = False
        try:
            if launch:
                stop_app(destination)
            if replaced:
                swap(staged, destination)
            else:
                os.replace(staged, destination)
            installed = True
            if app_sha(destination) != sha:
                raise DeployError("installed application build does not match")
            run(["codesign", "--verify", "--deep", "--strict", str(destination)])
            if launch:
                start_app(destination)
        except BaseException:
            if installed and launch:
                stop_app(destination)
            if installed and replaced:
                swap(staged, destination)
            elif installed:
                os.replace(destination, staged)
            if launch and replaced:
                start_app(destination)
            raise
        finally:
            if staged.exists():
                os.replace(staged, backup)
        save(root / "app.json", {"sha": sha, "path": str(destination), "backup": str(backup) if replaced else None})


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["server", "app", "recover"])
    parser.add_argument("--artifact", type=Path)
    parser.add_argument("--sha")
    parser.add_argument("--root", type=Path, default=Path.home() / "polymux/deployments")
    parser.add_argument("--plist", default=str(Path.home() / "Library/LaunchAgents/com.polymux.server.plist"))
    parser.add_argument("--token", default=str(Path.home() / "Library/Application Support/Polymux/server/devices/local-token"))
    parser.add_argument("--health")
    parser.add_argument("--app", type=Path, default=Path("/Applications/Polymux.app"))
    parser.add_argument("--launch", action="store_true", help="restart the installed application")
    parser.add_argument("--rollback-check", action="store_true", help="reject the healthy candidate to exercise server rollback")
    args = parser.parse_args()
    def interrupted(_signal, _frame):
        raise InterruptedError("deployment interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    if args.kind == "recover":
        with locked(args.root):
            recover(args.root, Launchd(args.plist, args.token, args.health))
    elif not args.artifact or not args.sha:
        parser.error("--artifact and --sha are required for installation")
    elif args.kind == "server":
        install_server(args.artifact, args.sha, args.root, Launchd(args.plist, args.token, args.health),
                       rollback_check=args.rollback_check)
    else:
        install_app(args.artifact, args.sha, args.app, args.root, args.launch)
    print(f"deploy: {args.kind} verified" + (f" at {args.sha}" if args.sha else ""))


if __name__ == "__main__":
    try:
        main()
    except (DeployError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"deploy: {error}", file=sys.stderr)
        sys.exit(1)
