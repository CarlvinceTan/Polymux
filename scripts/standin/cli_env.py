"""CLI lookup for shell and desktop launchers; custom installs use inherited PATH."""
import os
from pathlib import Path


def environment():
    env = dict(os.environ)
    home = Path.home()
    paths = [env.get('PATH', os.defpath), str(home / '.local/bin'),
             str(home / '.cargo/bin'), '/opt/homebrew/bin', '/usr/local/bin']
    env['PATH'] = os.pathsep.join(paths)
    return env
