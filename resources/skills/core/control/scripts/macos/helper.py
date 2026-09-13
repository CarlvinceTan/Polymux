"""Install and call the named macOS permission owner through Launch Services.

Installation is explicit; ambient state never installs, signs, or requests consent.
The app is an on-demand helper with no Dock icon, login item, or network listener.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from macos.compile import compile_source

ROOT = Path(__file__).resolve().parent
APP = Path.home() / 'Applications/Control Skill.app'
REQUESTS = Path.home() / 'Library/Application Support/Control/mac-requests'
ACTIVATION = REQUESTS.parent / 'mac-helper.json'
BUNDLE_ID = 'local.control-skill.helper'
SOURCES = {'Control Skill': ('helper.swift', True), 'state': ('state.swift', False),
           'window': ('window.swift', True)}


def manifest():
    names = [name for name, _ in SOURCES.values()] + ['tabs.js']
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in names}


def info_plist():
    return {'CFBundleIdentifier': BUNDLE_ID, 'CFBundleName': 'Control Skill',
            'CFBundleDisplayName': 'Control Skill', 'CFBundleExecutable': 'Control Skill',
            'CFBundlePackageType': 'APPL', 'CFBundleVersion': '1', 'CFBundleShortVersionString': '1.0',
            'LSUIElement': True, 'LSMinimumSystemVersion': '12.0',
            'NSAppleEventsUsageDescription': 'Control Skill reads browser tab titles and addresses to provide context and avoid interrupting your active tab.'}


def installed():
    return platform.system() == 'Darwin' and (APP / 'Contents/Info.plist').is_file()


def enabled():
    if platform.system() != 'Darwin': return False
    try:
        value = json.loads(ACTIVATION.read_text())
        return value.get('bundle_id') == BUNDLE_ID and value.get('enabled') is True
    except FileNotFoundError:
        return False


def enable():
    status = call('status')
    if status.get('accessibility') is not True:
        raise ValueError('grant Accessibility to Control Skill in macOS before enabling this permission owner')
    data = json.dumps({'bundle_id': BUNDLE_ID, 'enabled': True})
    temporary = ACTIVATION.with_name('mac-helper.' + uuid.uuid4().hex + '.tmp')
    try:
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w') as handle: handle.write(data)
        os.replace(temporary, ACTIVATION)
    finally:
        temporary.unlink(missing_ok=True)
    return {'status': 'enabled', 'permission_owner': 'Control Skill', 'bundle_id': BUNDLE_ID}


def verify():
    with (APP / 'Contents/Info.plist').open('rb') as handle:
        info = plistlib.load(handle)
    if info.get('CFBundleIdentifier') != BUNDLE_ID:
        raise ValueError('the installed application is not the Control Skill helper')
    build = json.loads((APP / 'Contents/Resources/build.json').read_text())
    if build['sources'] != manifest():
        raise ValueError('Control Skill helper needs updating; run macos/helper.py install')
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(APP)],
                   capture_output=True, check=True, timeout=3)
    return build


def choose_identity(identity=None):
    if identity:
        return identity
    result = subprocess.run(['/usr/bin/security', 'find-identity', '-v', '-p', 'codesigning'],
                            capture_output=True, text=True, timeout=5)
    values = re.findall(r'\b([0-9A-F]{40}) "Developer ID Application:[^"\n]+"', result.stdout)
    # Never guess among several publishers. Local ad-hoc signing still gives a
    # named app, but permission retention across rebuilds is not guaranteed.
    return values[0] if len(values) == 1 else '-'


def install(identity=None):
    if platform.system() != 'Darwin':
        raise ValueError('the named helper is only needed on macOS')
    APP.parent.mkdir(parents=True, exist_ok=True)
    REQUESTS.mkdir(mode=0o700, parents=True, exist_ok=True)
    import fcntl
    with (REQUESTS.parent / 'helper-install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if APP.exists():
            try:
                existing = verify()
                if identity is None or existing.get('signing_identity') == identity:
                    return {'status': 'already_installed', 'app': str(APP), **existing}
            except (OSError, ValueError, KeyError, subprocess.SubprocessError):
                with (APP / 'Contents/Info.plist').open('rb') as handle:
                    if plistlib.load(handle).get('CFBundleIdentifier') != BUNDLE_ID:
                        raise ValueError('refusing to replace an unrelated application')
        selected = choose_identity(identity)
        with tempfile.TemporaryDirectory(prefix='.control-build-', dir=APP.parent) as temporary:
            staging = Path(temporary) / APP.name
            for directory in ['MacOS', 'Helpers', 'Resources']:
                (staging / 'Contents' / directory).mkdir(parents=True)
            with (staging / 'Contents/Info.plist').open('wb') as handle:
                plistlib.dump(info_plist(), handle)
            entitlement = Path(temporary) / 'entitlements.plist'
            with entitlement.open('wb') as handle:
                plistlib.dump({'com.apple.security.automation.apple-events': True}, handle)
            for executable, (source, library) in SOURCES.items():
                binary = compile_source(ROOT / source, parse_as_library=library)
                target = staging / 'Contents' / ('MacOS' if executable == 'Control Skill' else 'Helpers') / executable
                shutil.copyfile(binary, target); target.chmod(0o700)
                if executable != 'Control Skill':
                    subprocess.run(['/usr/bin/codesign', '--force', '--sign', selected, '--timestamp=none',
                        '--identifier', BUNDLE_ID + '.' + executable, '--options', 'runtime',
                        '--entitlements', str(entitlement), str(target)], capture_output=True, check=True, timeout=20)
            build = {'sources': manifest(), 'signing_identity': selected,
                     'permission_retention': 'signed_identity' if selected != '-' else 'may_require_reapproval_after_updates'}
            (staging / 'Contents/Resources/build.json').write_text(json.dumps(build))
            shutil.copyfile(ROOT / 'tabs.js', staging / 'Contents/Resources/tabs.js')
            subprocess.run(['/usr/bin/codesign', '--force', '--sign', selected, '--timestamp=none',
                '--options', 'runtime', '--entitlements', str(entitlement), str(staging)],
                capture_output=True, check=True, timeout=20)
            subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(staging)],
                           capture_output=True, check=True, timeout=3)
            backup = REQUESTS.parent / ('helper-backup-' + uuid.uuid4().hex + '.app')
            if APP.exists(): APP.rename(backup)
            try:
                staging.rename(APP)
            except Exception:
                if backup.exists(): backup.rename(APP)
                raise
        return {'status': 'installed', 'app': str(APP), **build}


def launch_command(request):
    # Launch Services establishes the app's own responsibility instead of making
    # a subprocess inherit the terminal/agent's permission identity.
    return ['/usr/bin/open', '-n', '-g', '-j', str(APP), '--args', '--request', str(request)]


def call(operation, *, arguments=None, browser=None, timeout=15):
    verify()
    REQUESTS.mkdir(mode=0o700, parents=True, exist_ok=True)
    if REQUESTS.is_symlink() or REQUESTS.stat().st_uid != os.getuid() or REQUESTS.stat().st_mode & 0o077:
        raise ValueError('Control Skill request directory must be private to this account')
    nonce = uuid.uuid4().hex
    request, response = REQUESTS / (nonce + '.json'), REQUESTS / (nonce + '.result')
    payload = {'operation': operation, 'expires_at': time.time() + timeout}
    if arguments is not None: payload['arguments'] = arguments
    if browser is not None: payload['browser'] = browser
    data = json.dumps(payload).encode()
    if len(data) > 65536: raise ValueError('Control Skill request is too large')
    try:
        fd = os.open(request, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as handle: handle.write(data)
        subprocess.run(launch_command(request), capture_output=True, check=True, timeout=5)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                if response.is_symlink(): raise ValueError('invalid helper response')
                if response.stat().st_size > 2 * 1024 * 1024: raise ValueError('helper response exceeded limit')
                result = json.loads(response.read_text())
                if result.get('permission_identity') != BUNDLE_ID: raise ValueError('unexpected permission identity')
                if result.get('status') != 'ok': raise ValueError(result.get('reason', 'helper failed'))
                return result['result']
            except (FileNotFoundError, json.JSONDecodeError):
                time.sleep(.025)
        raise ValueError('Control Skill helper timed out; do not automatically replay a mutation')
    finally:
        request.unlink(missing_ok=True); response.unlink(missing_ok=True)


def json_call(operation, **kwargs):
    value = call(operation, **kwargs)
    if value.get('exit_code') != 0:
        raise ValueError(value.get('stderr') or value.get('stdout') or 'native helper failed')
    return json.loads(value['stdout'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['install', 'enable', 'status', 'native', 'metadata', 'window',
        'request-accessibility', 'request-screen-capture', 'request-automation'])
    parser.add_argument('--identity', help='existing signing identity; - selects local ad-hoc signing')
    parser.add_argument('--browser', help='running browser bundle ID for metadata/automation consent')
    args, arguments = parser.parse_known_args()
    if args.command != 'window' and arguments:
        parser.error('unexpected arguments')
    if args.command == 'install':
        result = install(args.identity)
    elif args.command == 'enable':
        result = enable()
    elif args.command == 'window':
        arguments = arguments[1:] if arguments[:1] == ['--'] else arguments
        result = call('window', arguments=arguments)
        sys.stdout.write(result['stdout']); sys.stderr.write(result['stderr']); return result['exit_code']
    else:
        result = call(args.command, browser=args.browser, timeout=120 if args.command.startswith('request-') else 15)
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        print(json.dumps({'status': 'unavailable', 'reason': str(exc)})); raise SystemExit(2)
