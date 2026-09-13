"""Observation-only native tab fallback; accessibility handles are never tab IDs."""
import subprocess
from browser.context import candidates


def attach(value, read):
    """Collect in the native desktop session, retaining data on protocol timeout."""
    apps = candidates(value.get('apps', {}))
    if not apps:
        return value
    try:
        reports = read(apps).get('apps', [])
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        reports = []
        failure = 'native accessibility timed out' if isinstance(exc, subprocess.TimeoutExpired) else str(exc)[:180]
    else:
        failure = 'native accessibility did not expose this browser instance'
    from desktop import generation
    for app in apps:
        report = next((r for r in reports if r.get('app_id') == app['app_id'] and
                       r.get('instance_id') == app['instance_id']), None)
        rows, windows = [], []
        try:
            if generation(app['pid']) != app['instance_id']:
                raise ValueError('browser process changed during accessibility collection')
            known = {str(w['window_id']) for w in app.get('windows', [])}
            for window in (report or {}).get('windows', []):
                # Never associate accessible windows through titles or list position.
                if window.get('window_identity') != 'metadata_only' and str(window.get('window_id')) not in known:
                    continue
                windows.append(window)
                for tab in window.get('tabs', []):
                    row = {'kind': 'browser-tab', 'app_id': app['app_id'],
                        'instance_id': app['instance_id'], 'session_id': app.get('session_id'),
                        'title': tab.get('title', ''), 'title_source': 'accessibility_label',
                        'url_status': 'unavailable', 'selected': tab.get('selected'),
                        'identity': 'metadata_only', 'provider': 'native_accessibility',
                        'human_active': 'unknown',
                        'capabilities': {'observe': True, 'background_actions': False}}
                    if tab.get('url_status') == 'available' and isinstance(tab.get('url'), str):
                        from browser.redact import url
                        row['url'] = url(tab['url'])
                        row['url_status'] = 'available'
                    if window.get('window_identity') == 'metadata_only':
                        row['window_title'] = window.get('window_title', '')
                    else:
                        row['window_id'] = str(window['window_id'])
                    rows.append(row)
        except (OSError, ValueError) as exc:
            rows, windows = [], []
            failure = str(exc)
        coverage = {'status': 'partial' if rows else 'unavailable',
                    'scope': 'accessible_browser_chrome', 'count': len(rows),
                    'reason': 'Accessibility exposes tab labels; URLs and hidden tabs may be unavailable.' if rows else '; '.join(w.get('reason', '') for w in windows) or failure,
                    'windows': [{'window_id': w.get('window_id'), 'window_title': w.get('window_title'), 'count': len(w.get('tabs', [])),
                                 'reason': w.get('reason', '')} for w in windows]}
        app['native_tab_inventory'] = coverage
        value.setdefault('surfaces', []).extend(rows)
    return value


def retain_inventory(value):
    """Summarize native observations when protocol enrichment cannot finish."""
    browsers = []
    for app in value.get('apps', {}).values():
        coverage = app.get('native_tab_inventory')
        if coverage is None:
            continue
        browsers.append({'app_id': app['app_id'], 'instance_id': app['instance_id'],
                         'name': app['name'], 'session_id': app.get('session_id'),
                         'status': 'metadata_only' if coverage.get('count', 0) else 'unavailable',
                         'tab_inventory': {**coverage, 'whole_browser_complete': False},
                         'tab_inventories': [{**coverage, 'source': 'native_accessibility'}]})
    if browsers:
        value['browsers'] = browsers
        value['tab_inventory'] = {
            'status': 'partial' if any(b['status'] == 'metadata_only' for b in browsers) else 'unavailable',
            'scope': 'detected_browser_processes', 'whole_browser_complete': False,
            'reason': 'Native accessibility retained; browser protocol enrichment did not finish.'}
    return value
