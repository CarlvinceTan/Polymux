"""Win32 inventory without UI Automation permission requests or activation."""
import ctypes
from ctypes import wintypes as W
import os
import subprocess
import time


def process_info(pid):
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
    kernel.OpenProcess.restype = W.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [W.HANDLE, W.DWORD, W.LPWSTR, ctypes.POINTER(W.DWORD)]
    kernel.GetProcessTimes.argtypes = [W.HANDLE] + [ctypes.POINTER(W.FILETIME)] * 4
    kernel.CloseHandle.argtypes = [W.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        raise ValueError('process identity unavailable')
    try:
        path = ctypes.create_unicode_buffer(32768)
        length = W.DWORD(len(path))
        times = [W.FILETIME() for _ in range(4)]
        if not kernel.QueryFullProcessImageNameW(handle, 0, path, ctypes.byref(length)) or not kernel.GetProcessTimes(handle, *[ctypes.byref(t) for t in times]):
            raise ValueError('process identity unavailable')
        birth = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
        return {'pid': pid, 'app_id': path.value.casefold(), 'path': path.value,
                'instance_id': f'{pid}:{birth}', 'name': os.path.basename(path.value)}
    finally:
        kernel.CloseHandle(handle)


def collect_current():
    from windows.sessions import current_session
    session_id = f"wts:{current_session()}"
    user = ctypes.WinDLL('user32', use_last_error=True)
    user.GetForegroundWindow.restype = W.HWND
    user.GetWindowThreadProcessId.argtypes = [W.HWND, ctypes.POINTER(W.DWORD)]
    user.IsWindowVisible.argtypes = [W.HWND]
    user.GetWindowTextLengthW.argtypes = [W.HWND]
    user.GetWindowTextW.argtypes = [W.HWND, W.LPWSTR, ctypes.c_int]
    user.IsIconic.argtypes = [W.HWND]
    front = user.GetForegroundWindow()
    callback_type = ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
    user.EnumWindows.argtypes = [callback_type, W.LPARAM]
    apps, surfaces, warnings = {}, [], []
    def visit(hwnd, unused):
        if not user.IsWindowVisible(hwnd):
            return True
        pid = W.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        try:
            info = {**process_info(pid.value), 'session_id': session_id}
        except (OSError, ValueError):
            warnings.append('a window process could not be identified')
            return True
        app = apps.setdefault(info['app_id'] + ':' + info['instance_id'], {**info, 'windows': []})
        title = ctypes.create_unicode_buffer(user.GetWindowTextLengthW(hwnd) + 1)
        user.GetWindowTextW(hwnd, title, len(title))
        window = {'window_id': str(hwnd), 'title': title.value, 'onscreen': not bool(user.IsIconic(hwnd))}
        app['windows'].append(window)
        surfaces.append({**info, **window, 'kind': 'window', 'provider': 'win32', 'identity': 'exact',
            'human_active': hwnd == front if front else 'unknown',
            'capabilities': {'observe': True, 'background_actions': True}})
        return True
    user.EnumWindows(callback_type(visit), 0)
    if not front:
        warnings.append('no foreground window in this process session/desktop; attention is unknown')
    value = {'collector_session_id': session_id, 'apps': apps, 'surfaces': surfaces, 'active': {'window_id': str(front) if front else None},
            'observed_at': time.time(), 'capabilities': {'windows': True, 'focused_window': bool(front)},
            'completeness': 'partial' if warnings else 'complete', '_warnings': warnings[:1]}

    from windows.tabs import collect as collect_tabs
    return collect_tabs(value)


def collect():
    from windows.sessions import discover, current_session
    from attention import apply_sessions
    from concurrent.futures import ThreadPoolExecutor
    sessions, complete = discover()
    own = current_session()
    if own and not any(s['session_id'] == f'wts:{own}' for s in sessions):
        sessions.append({'session_id': f'wts:{own}', 'presence': 'unknown', 'state': 'unknown'})
        complete = False
    def read(session):
        ident = int(session['session_id'].split(':')[1])
        try:
            if ident == own:
                value = collect_current()
            else:
                from windows.session_probe import collect_session
                value = collect_session(ident)
                for surface in value.get('surfaces', []):
                    surface['capabilities']['background_actions'] = False
            session['active'] = value.get('active', {})
            session['observable'] = True
            return value
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            session['observable'] = False
            return {'_warnings': [str(exc)], 'surfaces': [], 'apps': {}}
    with ThreadPoolExecutor(max_workers=max(1, min(8, len(sessions)))) as pool:
        parts = list(pool.map(read, sessions))
    latest, latest_complete = discover()
    initial = {s['session_id']: (s.get('state'), s.get('transport')) for s in sessions}
    final = {s['session_id']: (s.get('state'), s.get('transport')) for s in latest}
    if initial != final or not latest_complete:
        # A reconnect while collecting must not reuse disconnected-session proof.
        complete = False
        for session in sessions:
            session['presence'] = 'unknown'
        for part in parts:
            for surface in part.get('surfaces', []):
                surface['human_active'] = 'unknown'
        for session in latest:
            if session['session_id'] not in initial:
                sessions.append({**session, 'observable': False})
    warnings = [w for p in parts for w in p.get('_warnings', [])]
    value = {'sessions': sessions, 'session_inventory_complete': complete,
        'apps': {k:v for p in parts for k,v in p.get('apps', {}).items()},
        'surfaces': [s for p in parts for s in p.get('surfaces', [])],
        'active': sessions[0].get('active', {}) if len(sessions) == 1 else {},
        'observed_at': time.time(), 'capabilities': {'windows': any(s.get('observable') for s in sessions)},
        'completeness': 'partial' if warnings or not complete else 'complete', '_warnings': warnings}
    return apply_sessions(value)
