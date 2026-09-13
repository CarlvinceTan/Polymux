"""Read-only X11, Sway and Hyprland adapters. Other compositors report unknown."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time


def run(command, env=None):
    value = subprocess.run(command, capture_output=True, text=True, timeout=1, check=True, env=env)
    return value.stdout


def collect_current(env=None):
    env = os.environ if env is None else env
    def run(command):
        return globals()["run"](command, env)
    from desktop import generation
    apps, surfaces, errors = {}, [], []
    active = None
    focus_known = False
    provider = 'unavailable'
    records = []
    if env.get('WAYLAND_DISPLAY'):
        if env.get('SWAYSOCK') and shutil.which('swaymsg'):
            provider = 'sway'
            def walk(node):
                nonlocal active
                if node.get('pid') and node.get('type') in {'con', 'floating_con'}:
                    ident = str(node['id'])
                    records.append((ident, node['pid'], node.get('name') or '', node.get('visible', True)))
                    if node.get('focused'):
                        active = ident
                for child in node.get('nodes', []) + node.get('floating_nodes', []):
                    walk(child)
            walk(json.loads(run(['swaymsg', '-t', 'get_tree', '-r'])))
            focus_known = True
        elif env.get('HYPRLAND_INSTANCE_SIGNATURE') and shutil.which('hyprctl'):
            provider = 'hyprland'
            for node in json.loads(run(['hyprctl', '-j', 'clients'])):
                records.append((str(node['address']), node['pid'], node.get('title') or '', not node.get('hidden', False)))
            active = json.loads(run(['hyprctl', '-j', 'activewindow'])).get('address')
            focus_known = True
        else:
            errors.append('Wayland compositor does not expose a supported inventory/attention API')
    elif env.get('DISPLAY') and shutil.which('xprop'):
        provider = 'x11'
        root = run(['xprop', '-root', '_NET_CLIENT_LIST', '_NET_ACTIVE_WINDOW'])
        for line in root.splitlines():
            ids = re.findall(r'0x[0-9a-fA-F]+', line)
            if line.startswith('_NET_ACTIVE_WINDOW') and ids:
                focus_known = True
                active = str(int(ids[0], 16)) if int(ids[0], 16) else None
            if not line.startswith('_NET_CLIENT_LIST'):
                continue
            for ident in ids:
                try:
                    props = run(['xprop', '-id', ident, '_NET_WM_PID', '_NET_WM_NAME'])
                    pid = re.search(r'_NET_WM_PID[^=]*=\s*(\d+)', props)
                    title = re.search(r'_NET_WM_NAME[^=]*=\s*(.*)', props)
                    if pid:
                        records.append((str(int(ident,16)), int(pid[1]), title[1].strip('"') if title else '', True))
                except (OSError, ValueError, subprocess.SubprocessError):
                    errors.append('a window disappeared during inventory')
    else:
        errors.append('no supported native desktop inventory')
    for ident, pid, title, visible in records:
        try:
            path = os.readlink(f'/proc/{pid}/exe')
            instance = generation(pid)
        except (OSError, ValueError):
            errors.append('a window process could not be identified')
            continue
        info = {'app_id': path, 'instance_id': instance, 'pid': pid, 'name': Path(path).name, 'path': path}
        app = apps.setdefault(path + ':' + instance, {**info, 'windows': []})
        window = {'window_id': ident, 'title': title, 'onscreen': visible}
        app['windows'].append(window)
        surfaces.append({**info, **window, 'kind': 'window', 'provider': provider, 'identity': 'exact',
            'human_active': ident == active if focus_known else 'unknown',
            'capabilities': {'observe': True, 'background_actions': provider == 'x11'}})
    value = {'apps': apps, 'surfaces': surfaces, 'active': {'window_id': active}, 'observed_at': time.time(),
            'provider': provider, 'capabilities': {'windows': provider != 'unavailable', 'focused_window': focus_known},
            'completeness': 'partial' if errors else 'complete', '_warnings': list(dict.fromkeys(errors))}

    from linux.tabs import collect as collect_tabs
    return collect_tabs(value, env)


def collect():
    from linux.sessions import discover, environment
    from attention import apply_sessions
    from concurrent.futures import ThreadPoolExecutor
    sessions, complete = discover()
    if not complete and not sessions:
        value = collect_current()
        value.update(sessions=[], session_inventory_complete=False)
        return apply_sessions(value)
    def read(session):
        try:
            env = environment(session)
            if env is None:
                raise ValueError('session desktop is not observable by this account')
            result = collect_current(env)
            session['active'] = result.get('active', {})
            session['observable'] = result.get('capabilities', {}).get('windows') is True
            for row in result.get('surfaces', []):
                row['session_id'] = session['session_id']
                # Actions also need an adapter that enters this session. Never send
                # HWND/XID coordinates to the collector's different desktop.
                if env.get('DISPLAY') != os.environ.get('DISPLAY'):
                    row['capabilities']['background_actions'] = False
            for row in result.get('apps', {}).values():
                row['session_id'] = session['session_id']
            return result
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            session['observable'] = False
            return {'_warnings': [str(exc)], 'apps': {}, 'surfaces': []}
    with ThreadPoolExecutor(max_workers=max(1, min(8, len(sessions)))) as pool:
        parts = list(pool.map(read, sessions))
    warnings = [w for part in parts for w in part.get('_warnings', [])]
    value = {'apps': {k:v for p in parts for k,v in p.get('apps', {}).items()},
             'surfaces': [s for p in parts for s in p.get('surfaces', [])],
             'sessions': sessions, 'session_inventory_complete': complete,
             'active': sessions[0].get('active', {}) if len(sessions) == 1 else {},
             'capabilities': {'windows': any(s.get('observable') for s in sessions)},
             'observed_at': time.time(), 'completeness': 'partial' if warnings or not complete else 'complete',
             '_warnings': list(dict.fromkeys(warnings))}
    return apply_sessions(value)
