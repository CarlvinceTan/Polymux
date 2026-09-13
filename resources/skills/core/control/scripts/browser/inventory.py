"""Common CDP/BiDi inventory, usable with any driver's existing protocol session."""
import argparse
import json
import platform
import subprocess
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from browser import default_browser, installed_browser
from browser import runtime
from desktop import generation
from transport import WebSocket


def inventory_command(app):
    return [sys.executable, str(Path(__file__).resolve()), '--browser', app['path'], '--pid', str(app['pid'])]


def surface(app, instance, protocol, tab_id, window_id, title, url, human_active):
    return {'kind': 'browser-tab', 'app_id': app['native_app_id'], 'instance_id': instance,
        'identity_namespace': protocol, 'provider': protocol, 'identity': 'exact',
        'tab_id': tab_id, 'window_id': str(window_id) if window_id is not None else None,
        'title': title, 'url': url, 'human_active': human_active,
        'capabilities': {'observe': True, 'background_actions': True}}


def cdp_inventory(call, page_call, app, instance, foreground):
    """No selection/activation. Omnibox focus is covered by OS foreground + visibility."""
    targets = call('Target.getTargets', {}).get('targetInfos')
    if not isinstance(targets, list):
        raise ValueError('CDP inventory missing targetInfos')
    surfaces, errors = [], []
    for target in targets:
        if target.get('type') != 'page':
            continue
        ident = target.get('targetId')
        if not isinstance(ident, str) or not ident:
            errors.append('page has no exact identity')
            continue
        try:
            window = call('Browser.getWindowForTarget', {'targetId': ident}).get('windowId')
        except (OSError, ValueError):
            window = None
        human = False if foreground is False else 'unknown'
        # When the browser is foreground, visible pages are conservatively active.
        # document.hasFocus() is deliberately not used: the omnibox can own focus.
        if foreground is True:
            try:
                result = page_call(ident, 'Runtime.evaluate', {'expression': 'document.visibilityState',
                    'returnByValue': True, 'throwOnSideEffect': True, 'timeout': 300})
                visibility = result.get('result', {}).get('value')
                if visibility == 'hidden':
                    human = False
                elif visibility == 'visible':
                    human = True
            except (OSError, ValueError):
                pass
        row = surface(app, instance, 'cdp', ident, window, target.get('title', ''), target.get('url', ''), human)
        surfaces.append(row)
    return {'surfaces': surfaces, 'completeness': 'partial' if errors else 'complete', '_warnings': errors,
            'tab_inventory': {'status': 'partial' if errors else 'complete', 'scope': 'cdp_connection',
                              'count': len(surfaces), 'whole_browser_complete': False}}


def remote_value(value):
    kind = value.get('type')
    if kind == 'object':
        return {key: remote_value(item) for key, item in value.get('value', []) if isinstance(key, str)}
    if kind in {'string', 'number', 'boolean'}:
        return value.get('value')
    return None


def bidi_inventory(call, app, instance, foreground='unknown'):
    """Use a driver's ALREADY ACTIVE session. Never creates/ends a session or browser."""
    contexts = call('browsingContext.getTree', {'maxDepth': 0}).get('contexts')
    if not isinstance(contexts, list):
        raise ValueError('BiDi inventory missing contexts')
    try:
        windows = call('browser.getClientWindows', {}).get('clientWindows', [])
    except (OSError, ValueError):
        windows = []
    activity = {w['clientWindow']: w.get('active') for w in windows if 'clientWindow' in w}
    surfaces, errors = [], []
    for context in contexts:
        ident = context.get('context')
        if not isinstance(ident, str) or not ident:
            errors.append('context has no exact identity')
            continue
        window = context.get('clientWindow')
        title, visibility = '', None
        try:
            result = call('script.evaluate', {'expression': '({title:document.title,visibility:document.visibilityState})',
                'target': {'context': ident, 'sandbox': 'control-observation'}, 'awaitPromise': False, 'resultOwnership': 'none'})
            value = remote_value(result.get('result', {}))
            if isinstance(value, dict):
                title, visibility = value.get('title', ''), value.get('visibility')
        except (OSError, ValueError):
            pass
        human = 'unknown'
        if foreground is False or activity.get(window) is False:
            human = False
        elif activity.get(window) is True or foreground is True:
            human = False if visibility == 'hidden' else True if visibility == 'visible' else 'unknown'
        surfaces.append(surface(app, instance, 'bidi', ident, window, title, context.get('url', ''), human))
    return {'surfaces': surfaces, 'completeness': 'partial' if errors else 'complete', '_warnings': errors,
            'tab_inventory': {'status': 'partial' if errors else 'complete', 'scope': 'bidi_session',
                              'count': len(surfaces), 'whole_browser_complete': False}}


def collect(browser=None, pid=None, endpoint=None, protocol=None):
    app = installed_browser(browser) if browser else default_browser()
    proc = runtime.process(pid) if pid else runtime.browser_process(app['path'])
    expected = str(Path(app['path']).resolve())
    actual = str(Path(proc['executable']).resolve())
    if (expected.casefold() if platform.system() == 'Windows' else expected) != (actual.casefold() if platform.system() == 'Windows' else actual):
        raise ValueError('browser process does not match executable')
    instance = generation(proc['pid'])
    foreground = runtime.browser_foreground(proc['pid'])
    protocol = protocol or ('cdp' if app['engine'] == 'chromium' else 'bidi' if app['engine'] == 'gecko' else None)
    if protocol not in {'cdp', 'bidi'}:
        raise ValueError('browser protocol unavailable; native metadata may still be available')
    if endpoint is None:
        if protocol != 'cdp':
            raise ValueError('an existing BiDi session or provider is required; normal Firefox is left unchanged')
        _, port, path = runtime.devtools_endpoint(app, proc)
        endpoint = f'ws://127.0.0.1:{port}{path}'
    else:
        from urllib.parse import urlsplit
        parts = urlsplit(endpoint)
        if parts.scheme != 'ws' or parts.hostname not in {'127.0.0.1', '::1', 'localhost'} or not parts.port:
            raise ValueError('only verified local protocol endpoints are supported')
        runtime.verify_listener(parts.port, proc['pid'])
        if protocol == 'bidi' and parts.path.rstrip('/') == '/session':
            raise ValueError('BiDi requires an existing session endpoint; state never sends session.new')
    with WebSocket(endpoint, timeout=2.5) as ws:
        if protocol == 'cdp':
            def page_call(ident, method, params):
                # Flattened session on the same connection works with CDP target types.
                attached = ws.call('Target.attachToTarget', {'targetId': ident, 'flatten': True})
                session = attached['sessionId']
                try:
                    def session_call(command, arguments):
                        ws.counter += 1
                        reply = ws.batch([{'id': ws.counter, 'sessionId': session, 'method': command, 'params': arguments}])[ws.counter]
                        if 'error' in reply:
                            raise ValueError(str(reply['error']))
                        return reply.get('result', {})
                    if method == 'Runtime.evaluate':
                        frame = session_call('Page.getFrameTree', {})['frameTree']['frame']['id']
                        context = session_call('Page.createIsolatedWorld', {'frameId': frame,
                            'worldName': 'control-observation', 'grantUniveralAccess': False})['executionContextId']
                        params = {**params, 'contextId': context}
                    ws.counter += 1
                    reply = ws.batch([{'id': ws.counter, 'sessionId': session, 'method': method, 'params': params}])[ws.counter]
                    if 'error' in reply:
                        raise ValueError(str(reply['error']))
                    return reply.get('result', {})
                finally:
                    ws.call('Target.detachFromTarget', {'sessionId': session})
            value = cdp_inventory(ws.call, page_call, app, instance, foreground)
        else:
            value = bidi_inventory(ws.call, app, instance, foreground)
    if generation(proc['pid']) != instance:
        raise ValueError('browser restarted during inventory')
    return {**value, 'status': 'inventoried', 'app_id': app['native_app_id'], 'instance_id': instance,
            'browser_pid': proc['pid'], 'protocol': protocol, 'observed_at': time.time()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser')
    parser.add_argument('--pid', type=int)
    parser.add_argument('--endpoint')
    parser.add_argument('--protocol', choices=['cdp', 'bidi'])
    args = parser.parse_args()
    try:
        print(json.dumps(collect(**vars(args)), ensure_ascii=True))
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(json.dumps({'status': 'unavailable', 'reason': str(exc)}))
        return 3

if __name__ == '__main__':
    raise SystemExit(main())
