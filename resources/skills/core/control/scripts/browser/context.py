"""Combine native and protocol browser context without choosing an action driver."""
from concurrent.futures import ThreadPoolExecutor
import platform
import subprocess

from browser import default_browser, engine_for
from macos.tabs import collect as metadata, schema, surfaces
from transport import command_json

READ_ERRORS = (OSError, ValueError, subprocess.SubprocessError)


def candidates(apps):
    """Discover known engines or installed native scripting contracts."""
    result = []
    for app in apps.values():
        if not app.get('path'):
            continue
        if platform.system() == 'Darwin' and app.get('browser_candidate') is not True:
            continue
        native_contract = False
        if platform.system() == 'Darwin':
            try:
                schema(app['path'])
                native_contract = True
            except (OSError, ValueError):
                pass
        if native_contract or engine_for(app['path'], app['app_id']) in {'chromium', 'gecko', 'webkit'}:
            result.append(app)
    return result


def collect_browser(app, native_state):
    """Read one browser under the existing bounded, concurrent collector budget."""
    from browser.inventory import inventory_command
    result = {key: app[key] for key in ('app_id', 'instance_id', 'name')}
    result['session_id'] = app.get('session_id')
    if app.get('native_tab_inventory'):
        result['native_tab_inventory'] = app['native_tab_inventory']
    with ThreadPoolExecutor(max_workers=2) as readers:
        native_job = readers.submit(metadata, app) if platform.system() == 'Darwin' else None
        protocol_job = readers.submit(command_json, inventory_command(app), 2.5)
        native = native_job.result() if native_job else None
        if native is not None:
            result['metadata'] = native
        try:
            result.update(protocol_job.result())
        except READ_ERRORS as exc:
            result.update(status='metadata_only' if native is not None else 'unavailable', reason=str(exc)[:180])
    native_rows = []
    if native is not None:
        try:
            from desktop import generation
            from attention import browser_attention
            if generation(app['pid']) != app['instance_id']:
                raise ValueError('browser instance changed during native tab collection')
            native_rows = surfaces(native, app, browser_attention(native_state, app['pid']))
        except READ_ERRORS:
            result.pop('metadata', None)
            result.setdefault('_warnings', []).append('native browser identity could not be revalidated')
    return merge_inventory(result, native, native_rows)


def merge_inventory(result, native, native_rows):
    """Preserve alternative views without inventing aliases or distinct-tab counts."""
    reports = []
    if result.get('tab_inventory'):
        reports.append({**result['tab_inventory'], 'source': result.get('protocol', 'protocol')})
    if result.get('native_tab_inventory'):
        reports.append({**result.pop('native_tab_inventory'), 'source': 'native_accessibility'})
    if native_rows or result.get('metadata') is not None:
        coverage = native.get('tab_inventory', {'status': 'unknown', 'scope': 'scriptable_open_windows'})
        reports.append({**coverage, 'source': native.get('source', 'applescript')})
        if result.get('surfaces'):
            for row in native_rows:
                row['alternative_inventory'] = True
        result.setdefault('surfaces', []).extend(native_rows)
        if native_rows and not any(row['identity'] == 'exact' for row in native_rows):
            result['status'] = 'metadata_only'
        if any(row['identity'] == 'exact' for row in native_rows):
            result['status'] = 'inventoried'
    if any(r.get('count', 0) > 0 for r in reports) and result.get('status') == 'unavailable':
        result['status'] = 'metadata_only'
    if result.get('status') == 'metadata_only' and any(r.get('count', 0) > 0 for r in reports):
        if result.get('reason'):
            result['protocol_reason'] = result['reason']
        result['reason'] = 'Native tab metadata retrieved; see interface coverage for missing fields.'
    complete = reports and all(report.get('status') == 'complete' for report in reports)
    result['tab_inventories'] = reports
    result['tab_inventory'] = {
        'status': 'complete' if complete else 'partial' if any(r.get('status') in {'complete', 'partial'} for r in reports) else 'unavailable',
        'scope': 'available_interfaces', 'whole_browser_complete': False,
        'reason': 'Coverage applies only to the listed interfaces; inaccessible profiles, private contexts and inactive tab groups are not assumed present.',
    }
    return result


def enrich(value):
    """Add browser views to an existing native snapshot, preserving native evidence."""
    try:
        value['default_browser'] = default_browser()
    except READ_ERRORS as exc:
        value['default_browser'] = {'status': 'unavailable', 'reason': str(exc)[:200]}
    apps = candidates(value.get('apps', {}))
    with ThreadPoolExecutor(max_workers=max(1, min(8, len(apps)))) as pool:
        value['browsers'] = list(pool.map(lambda app: collect_browser(app, value), apps))
    for browser in value['browsers']:
        if browser.get('surfaces'):
            # Precollected accessibility and a protocol can describe the same
            # tabs. Keep both views without pretending their identities alias.
            for row in value['surfaces']:
                if (row.get('provider') == 'native_accessibility' and
                    row.get('app_id') == browser.get('app_id') and
                    row.get('instance_id') == browser.get('instance_id')):
                    row['alternative_inventory'] = True
        for surface in browser.get('surfaces', []):
            if browser.get('session_id'):
                surface['session_id'] = browser['session_id']
        value['surfaces'].extend(browser.get('surfaces', []))
    inventories = [browser['tab_inventory'] for browser in value['browsers']]
    available = any(inventory['status'] != 'unavailable' for inventory in inventories)
    value['tab_inventory'] = {
        'status': 'partial' if available else 'unavailable' if inventories else 'unknown',
        'scope': 'detected_browser_processes', 'whole_browser_complete': False,
        'reason': 'Per-browser interface coverage is reported separately; no global complete tab list is asserted.',
    }
    if apps:
        value['completeness'] = 'partial'
    value['surfaces'].sort(key=lambda surface: (
        surface.get('human_active') is not True, surface.get('kind') != 'browser-tab',
        surface.get('onscreen') is not True, surface.get('app_id', ''), surface.get('window_id') or ''))
    return value


def capabilities(browser, snapshot):
    """Report observed capabilities, never infer readiness from engine or installed tools."""
    app_id = browser['native_app_id'] if browser else None
    rows = [s for s in snapshot.get('surfaces', []) if app_id and s.get('app_id') == app_id]
    tabs = [s for s in rows if s.get('kind') == 'browser-tab']
    exact = [s for s in tabs if s.get('identity') == 'exact' and s.get('instance_id') and s.get('tab_id')]
    windows = [s for s in rows if s.get('kind') == 'window']
    browsers = [b for b in snapshot.get('browsers', []) if b.get('app_id') == app_id]
    reports = [b.get('tab_inventory', {}) for b in browsers]
    whole_complete = bool(reports) and all(r.get('whole_browser_complete') is True for r in reports)
    coverage = {'status': 'complete' if whole_complete else 'partial' if tabs else 'unknown',
                'whole_browser_complete': whole_complete,
                'instances': [{'instance_id': b.get('instance_id'), 'coverage': b.get('tab_inventory', {}),
                               'interfaces': b.get('tab_inventories', [])} for b in browsers],
                'reason': 'Tab records alone do not prove a complete inventory. Counts may include alternative provider views.'}
    status = 'available' if exact else 'metadata_only' if tabs else 'window_only' if windows else 'unavailable'
    return {
        'status': status,
        'capabilities': {
            'native_windows': len(windows), 'tab_metadata': len(tabs), 'exact_tabs': len(exact),
            'tabs_with_attention': sum(type(s.get('human_active')) is bool for s in exact),
            'tabs_with_background_route': sum(s.get('capabilities', {}).get('background_actions') is True for s in exact),
        },
        'providers': sorted({s['provider'] for s in rows if isinstance(s.get('provider'), str)}),
        'tab_inventory': coverage,
        'locking': {'exact_tab_identity_available': bool(exact),
                    'application_scope_available': any(w.get('identity') == 'exact' and w.get('instance_id') for w in windows),
                    'requires_cdp_or_bidi': False,
                    'rule': 'Use a proven tab identity when available; otherwise use an exact application lease. Admission, background dispatch and shared fencing still apply.'},
        'collector_warning_count': len(snapshot.get('_warnings', [])),
        'meaning': {
            'available': 'Exact tab identities observed; each action still needs live admission and a supported background driver.',
            'metadata_only': 'Tab context is available; these metadata records cannot identify a tab for locking.',
            'window_only': 'Native window context is available; no tab route was observed.',
            'unavailable': 'No context route observed for this browser. It may be closed or its interfaces unavailable.',
        }[status],
    }
