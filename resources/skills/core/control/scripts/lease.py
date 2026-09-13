"""Keep an acquired lease alive while a driver or agent performs other work."""
import argparse
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

LOCK = Path(__file__).with_name('lock.py')


class Heartbeat:
    """A bounded keeper. Release is the caller's completion decision, never a pause."""
    def __init__(self, resource, token, *, interval=30, lifetime=3600):
        self.resource, self.token = list(resource), token
        self.interval, self.lifetime = interval, lifetime
        self.stop = threading.Event()
        self.error = None
        self.thread = None

    def renew(self):
        result = subprocess.run([sys.executable, str(LOCK), 'renew', *self.resource,
            '--token', self.token, '--ttl-seconds', '120'], capture_output=True, text=True, timeout=15)
        if result.returncode:
            raise RuntimeError('lease heartbeat rejected: ' + result.stdout[:300])

    def start(self):
        self.renew()
        def run():
            deadline = time.monotonic() + self.lifetime
            while not self.stop.wait(self.interval):
                if time.monotonic() >= deadline:
                    break
                try:
                    self.renew()
                except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
                    self.error = str(exc)
                    break
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()
        return self

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=16)

    def __enter__(self):
        return self.start()

    def __exit__(self, *args):
        self.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--token', required=True)
    parser.add_argument('--duration', type=int, default=3600)
    parser.add_argument('resource', nargs=argparse.REMAINDER, help='-- followed by lock resource arguments')
    args = parser.parse_args()
    if not 30 <= args.duration <= 3600:
        parser.error('duration must be 30 to 3600 seconds')
    resource = args.resource[1:] if args.resource[:1] == ['--'] else args.resource
    try:
        with Heartbeat(resource, args.token, lifetime=args.duration) as keeper:
            print(json.dumps({'status': 'keeping_lease', 'duration': args.duration}), flush=True)
            deadline = time.monotonic() + args.duration
            while keeper.error is None and time.monotonic() < deadline:
                keeper.stop.wait(min(1, max(0, deadline-time.monotonic())))
            if keeper.error:
                raise RuntimeError(keeper.error)
        return 0
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        print(json.dumps({'status': 'keeper_stopped', 'reason': str(exc)}))
        return 3

if __name__ == '__main__':
    raise SystemExit(main())
