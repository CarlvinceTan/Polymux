"""Native tab metadata and authoritative Chromium Apple Events tab identities."""
from collections import Counter
from pathlib import Path
import plistlib
import subprocess
from transport import command_json
import xml.etree.ElementTree as ET

SCRIPT = Path(__file__).with_suffix('.js')


def schema(executable):
    """Inspect the installed scripting contract, not a browser brand allowlist."""
    bundle = next((p for p in Path(executable).parents if p.suffix == '.app'), None)
    if bundle is None:
        raise ValueError('browser scripting bundle unavailable')
    with (bundle / 'Contents/Info.plist').open('rb') as handle:
        definition = plistlib.load(handle).get('OSAScriptingDefinition')
    if not isinstance(definition, str) or Path(definition).name != definition:
        raise ValueError('browser tab scripting unavailable')
    try:
        root = ET.parse(bundle / 'Contents/Resources' / definition)
    except ET.ParseError as exc:
        raise ValueError('invalid browser scripting definition') from exc
    for tab in root.findall('.//class[@name="tab"]'):
        properties = {p.get('name'): p for p in tab.findall('property')}
        if {'id', 'title', 'URL'} <= properties.keys():
            identity = properties['id']
            cocoa = identity.find('cocoa')
            if identity.get('access') == 'r' and cocoa is not None and cocoa.get('key') == 'uniqueID':
                return 'chromium'
        if {'name', 'URL', 'index'} <= properties.keys():
            return 'safari'
    raise ValueError('browser does not expose a supported native tab scripting contract')


def surfaces(metadata, app, foreground='unknown'):
    """Never infer identity from title, URL, list index, or an AX handle hash."""
    rows = []
    windows = metadata.get('windows', [])
    identifiers = Counter(str(t.get('tab_id', '')) for w in windows for t in w.get('tabs', []))
    for window in windows:
        for tab in window.get('tabs', []):
            ident = str(tab.get('tab_id', ''))
            exact = (metadata.get('schema') == 'chromium' and ident.isascii() and ident.isdigit()
                     and int(ident) > 0 and identifiers[ident] == 1)
            row = {'kind': 'browser-tab', 'app_id': app['app_id'], 'instance_id': app['instance_id'],
                   'window_id': str(window['window_id']), 'title': tab.get('title', ''), 'url': tab.get('url', ''),
                   'identity': 'exact' if exact else 'metadata_only',
                   'provider': 'applescript' if exact else 'native_metadata', 'session_id': app.get('session_id'),
                   'human_active': False if foreground is False else 'unknown',
                   'capabilities': {'observe': True, 'background_actions': False}}
            if metadata.get('source') == 'native_accessibility':
                row.update(provider='native_accessibility', title_source='accessibility_label',
                           selected=tab.get('selected'), url_status=tab.get('url_status', 'unavailable'))
                if not tab.get('url'):
                    row.pop('url', None)
            if exact:
                row.update(tab_id=ident, identity_namespace='applescript')
                # Selected tabs in any foreground-browser window are protected
                # conservatively; native and scripting window IDs are not aliases.
                if foreground is True:
                    row['human_active'] = False if tab.get('selected') is False else True if tab.get('selected') is True else 'unknown'
            rows.append(row)
    return rows


def collect(app):
    """Use the actual native scripting contract, with existing consent only."""
    import re
    from browser import engine_for
    if engine_for(app.get('path', ''), app['app_id']) == 'gecko':
        return accessibility(app)
    ident = app['app_id']
    if app.get('metadata_allowed') is not True or not re.fullmatch(r'[A-Za-z0-9.-]+', ident):
        return None
    from macos import helper
    if helper.enabled():
        try:
            return helper.json_call('metadata', browser=ident, timeout=3)
        except (OSError, ValueError, subprocess.SubprocessError):
            return None
    try:
        contract = schema(app.get('path', ''))
        return command_json(['/usr/bin/osascript', '-l', 'JavaScript', str(SCRIPT), ident, contract], 1.5)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def accessibility(app):
    """Use exact native window references; no scripting consent or debug session."""
    from concurrent.futures import ThreadPoolExecutor
    import sys
    from macos import helper
    from macos.compile import compile_source
    root = Path(__file__).resolve().parent
    if helper.enabled():
        command = [sys.executable, str(root / 'helper.py'), 'window', '--']
    else:
        command = [str(compile_source(root / 'window.swift', parse_as_library=True))]
    def read(window):
        ident = str(window['window_id'])
        try:
            return command_json([*command, 'tabs', '--pid', str(app['pid']), '--window-id', ident], 1.5)
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            return {'window_id': ident, 'tabs': [], 'reason': 'native accessibility timed out' if isinstance(exc, subprocess.TimeoutExpired) else str(exc)[:180]}
    with ThreadPoolExecutor(max_workers=4) as pool:
        windows = list(pool.map(read, app.get('windows', [])))
    count = sum(len(w.get('tabs', [])) for w in windows)
    return {'schema': 'accessibility', 'source': 'native_accessibility', 'windows': windows,
            'tab_inventory': {'status': 'partial' if count else 'unavailable',
                'scope': 'accessible_browser_chrome', 'count': count,
                'windows': [{'window_id': w['window_id'], 'count': len(w.get('tabs', [])),
                             'reason': w.get('reason', '')} for w in windows]}}
