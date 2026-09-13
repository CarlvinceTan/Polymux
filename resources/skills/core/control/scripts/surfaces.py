"""Authoritative acquisition/action resolution, independent of agent and page driver."""
import sys
import time
from pathlib import Path
from config import coordination_policy, device_config, load_config
from transport import command_json

ROOT = Path(__file__).resolve().parent


def resolve(request, *, admission=True):
    config = load_config()
    device = device_config(request['device_id'], config)
    policy = coordination_policy(device)
    kind = request['kind']
    if kind == 'device' and not policy['human_attention_required']:
        return {**request, 'instance_id': request['device_id'], 'identity_namespace': 'device',
                'identity': 'exact', 'human_active': False, 'observed_at': time.time(), 'coordination': policy}
    if device['kind'] == 'local' and kind == 'window' and not device.get('state_command') and not config.get('providers'):
        snapshot = command_json([sys.executable, str(ROOT / 'desktop.py'), '--native'], 5)
    else:
        from control import device_snapshot
        snapshot = device_snapshot(request['device_id'], config, 5)
    observed = snapshot.get('observed_at')
    if not isinstance(observed, (int, float)) or not 0 <= time.time() - observed < 5:
        raise ValueError('fresh authoritative surface state is unavailable')
    if kind == 'device':
        active_state = snapshot.get('active')
        attention = snapshot.get('human_active', active_state.get('human_active', 'unknown') if isinstance(active_state, dict) else 'unknown')
        result = {**request, 'instance_id': request['device_id'], 'identity_namespace': 'device',
                  'identity': 'exact', 'human_active': attention, 'observed_at': observed}
    else:
        matches = [s for s in snapshot.get('surfaces', []) if s.get('app_id') == request['app_id']
            and (s.get('tab_id') == request.get('tab_id') and s.get('kind') == 'browser-tab'
                 if kind == 'browser-tab' else s.get('window_id') == request['window_id'])]
        if kind in {'browser-window', 'app'}:
            matches = [s for s in snapshot.get('surfaces', []) if s.get('app_id') == request['app_id']
                       and (kind == 'app' or s.get('window_id') == request['window_id'])]
        if kind == 'app':
            native = [s for s in matches if s.get('kind') == 'window' and s.get('identity') == 'exact']
            matches = native or [s for s in matches if s.get('identity') == 'exact']
        identities = {(m.get('instance_id'), m.get('identity_namespace', m.get('provider')), m.get('tab_id')) for m in matches}
        if not matches or (kind not in {'browser-window', 'app'} and len(identities) != 1):
            raise ValueError('surface missing or ambiguous; refresh its exact identity')
        if any(s.get('identity') != 'exact' or not s.get('instance_id') for s in matches):
            raise ValueError('provider cannot prove exact live identity')
        if len({s['instance_id'] for s in matches}) != 1:
            raise ValueError('application instance is ambiguous')
        freshest = max(matches, key=lambda m: m.get('observed_at', observed))
        result = {**freshest, 'kind': kind, 'device_id': request['device_id']}
        result['human_active'] = (False if all(s.get('human_active') is False for s in matches) else
                                  True if any(s.get('human_active') is True for s in matches) else 'unknown')
        if kind in {'browser-window', 'app'}:
            result.pop('tab_id', None)
            result['human_active'] = False if all(s.get('human_active') is False for s in matches) else 'unknown'
        if request.get('instance_id') and request['instance_id'] != result['instance_id']:
            raise ValueError('application instance changed')
        if kind != 'browser-tab' and result.get('window_id') != request.get('window_id') and kind != 'app':
            raise ValueError('window identity changed')
        if kind == 'app':
            result['window_id'] = request['window_id']
        result.setdefault('observed_at', observed)
    if not admission and kind != 'device' and result.get('capabilities', {}).get('background_actions') is not True:
        raise ValueError('provider does not expose a background action route')
    # Only acquisition consults human attention. Renewal and existing ownership do not.
    if admission and policy['human_attention_required'] and result.get('human_active') is not False:
        raise ValueError('human_active' if result.get('human_active') is True else 'human_attention_unknown')
    result['coordination'] = policy
    return result


def check_preconditions(expected, actual):
    """Small optimistic concurrency check; unrelated human changes do not conflict."""
    conflicts = {key: {'expected': value, 'actual': actual.get(key)}
                 for key, value in expected.items() if key not in actual or actual[key] != value}
    return {'status': 'conflict' if conflicts else 'ready', 'conflicts': conflicts}
