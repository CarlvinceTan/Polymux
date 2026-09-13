"""Fixed read-only guest collector. No generic unfenced guest-exec interface."""
import argparse
import base64
import json
from pathlib import Path
import shlex
import subprocess
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import resolve_vm_device


def collect(device, python, script, timeout=6):
    host, domain = resolve_vm_device(device)
    # Installation paths select the fixed Control desktop collector, not arbitrary
    # agent commands. This helper is a trusted configured observation provider.
    if Path(script.replace('\\', '/')).name != 'desktop.py':
        raise ValueError('guest collector must be the installed scripts/desktop.py')
    deadline = time.monotonic() + timeout
    def call(payload):
        command = ['virsh', '-c', 'qemu:///system', 'qemu-agent-command', domain, json.dumps(payload)]
        if host:
            command = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=2', host, shlex.join(command)]
        result = subprocess.run(command, capture_output=True, text=True, check=True,
                                timeout=max(.1, deadline - time.monotonic()))
        value = json.loads(result.stdout)
        if 'error' in value:
            raise ValueError('guest collector transport failed')
        return value['return']
    pid = call({'execute': 'guest-exec', 'arguments': {'path': python,
        'arg': ['-B', script], 'capture-output': True}})['pid']
    while time.monotonic() < deadline:
        result = call({'execute': 'guest-exec-status', 'arguments': {'pid': pid}})
        if result.get('exited'):
            if result.get('exitcode') != 0 or result.get('out-truncated'):
                raise ValueError('guest observation failed or was truncated')
            return json.loads(base64.b64decode(result.get('out-data', '')))
        time.sleep(.05)
    raise ValueError('guest observation timed out')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True)
    parser.add_argument('--python', required=True)
    parser.add_argument('--script', required=True)
    args = parser.parse_args()
    print(json.dumps(collect(**vars(args)), ensure_ascii=True))
