"""Discover logind desktops from SSH without activating a session or reading content."""
import os
from pathlib import Path
import subprocess

ENV_KEYS = {'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR',
            'SWAYSOCK', 'HYPRLAND_INSTANCE_SIGNATURE', 'XDG_SESSION_ID', 'DBUS_SESSION_BUS_ADDRESS'}


def command(args):
    return subprocess.run(args, capture_output=True, text=True, check=True, timeout=1).stdout


def parse_session(text):
    row = dict(line.split('=', 1) for line in text.splitlines() if '=' in line)
    if row.get('Type') not in {'x11', 'wayland'} or row.get('Class') not in {'user', 'user-early'}:
        return None
    return {'session_id': 'logind:' + row['Id'], 'uid': int(row['User']), 'type': row['Type'],
            'remote': row.get('Remote') == 'yes', 'state': row.get('State', 'unknown'),
            'presence': 'possible',  # Even idle or locked sessions may have an observer.
            'idle': row.get('IdleHint') == 'yes', 'locked': row.get('LockedHint') == 'yes',
            'display': row.get('Display', '')}


def discover():
    try:
        # One invocation, including other users. A hidden/unreadable desktop remains
        # present for admission even though only same-user windows can be enumerated.
        raw = command(['loginctl', 'list-sessions', '--no-legend', '--no-pager'])
        ids = [line.split()[0] for line in raw.splitlines() if line.split()]
        if not ids:
            # No GUI session in logind does not exclude non-logind X/VNC servers.
            return [], False
        raw = command(['loginctl', 'show-session', *ids, '--no-pager',
                       '-p', 'Id', '-p', 'User', '-p', 'Type', '-p', 'Class', '-p', 'Remote',
                       '-p', 'State', '-p', 'IdleHint', '-p', 'LockedHint', '-p', 'Display'])
        rows = [parse_session(block) for block in raw.strip().split('\n\n') if block]
        # logind enumerates managed sessions, not every possible VNC/custom display.
        # Presence may be inferred for known sessions; device-wide absence is unknown.
        return [row for row in rows if row], False
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        return [], False


def environment(session):
    """Read only the selected display connection keys, scoped to one OS session."""
    if session['uid'] != os.getuid():
        return None
    ident = session['session_id'].removeprefix('logind:')
    candidates = []
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            if path.stat().st_uid != session['uid']:
                continue
            selected = {}
            for item in (path / 'environ').read_bytes().split(b'\0'):
                key, separator, val = item.partition(b'=')
                if separator and key.decode(errors='replace') in ENV_KEYS:
                    selected[key.decode()] = val.decode(errors='replace')
            cgroup = (path / 'cgroup').read_text()
            if f'/session-{ident}.scope' not in cgroup:
                continue
            if selected.get('XDG_SESSION_ID', ident) != ident:
                continue
            if selected.get('DISPLAY') or selected.get('WAYLAND_DISPLAY'):
                candidates.append(selected)
        except OSError:
            continue
    if not candidates:
        return None
    # Prefer the richest connection information within the verified session.
    selected = max(candidates, key=len)
    base = {k:v for k,v in os.environ.items() if k not in ENV_KEYS}
    return {**base, **selected}
