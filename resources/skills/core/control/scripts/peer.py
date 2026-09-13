"""Restricted SSH entry point for context and lock RPC; never an arbitrary shell."""
import os
from pathlib import Path
import sys


def dispatch(command):
    if command == 'control-state':
        return ['control.py', 'collect-local']
    if command == 'control-lock':
        return ['lock.py', 'serve']
    raise ValueError('only Control state and lock RPC are allowed')


if __name__ == '__main__':
    try:
        script, *arguments = dispatch(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
        os.execv(sys.executable, [sys.executable, '-B', str(Path(__file__).with_name(script)), *arguments])
    except ValueError as exc:
        raise SystemExit(str(exc))
