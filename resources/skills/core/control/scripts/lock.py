"""Shared leases with acquisition-only attention checks and action fencing."""
from __future__ import annotations
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import sys
import time
from config import coordination_policy, device_config, device_requires_lock
from storage import runtime_dir
from surfaces import resolve

SKILL_ROOT = Path(__file__).resolve().parents[1]
INSTANCE_DIR = runtime_dir()
REGISTRY = INSTANCE_DIR / 'locks.sqlite3'
LEGACY_REGISTRY = SKILL_ROOT / 'instance/locks.sqlite3'
VERSION = 4


def resource_key(device_id, app_id, window_id, kind, tab_id=None, instance_id='', namespace=''):
    # Moving a tab changes topology, never ownership.
    target = tab_id if kind == 'browser-tab' else '*' if kind in {'device', 'app'} else window_id
    return hashlib.sha256(json.dumps([device_id, app_id, instance_id, namespace, kind, target]).encode()).hexdigest()


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def public_lock(lock):
    return {k:v for k,v in lock.items() if k != 'token_hash'}


def load_registry(connection):
    data = json.loads(connection.execute('SELECT payload FROM registry WHERE id=1').fetchone()[0])
    if data.get('version') != VERSION or not isinstance(data.get('locks'), dict):
        raise ValueError('unsupported lock registry; mixed Control versions must not operate concurrently')
    for held in data['locks'].values():
        if 'authority_device_id' not in held:
            held['authority_device_id'] = '@local' if device_config(held['device_id'])['kind'] == 'local' else held['device_id']
    return data


def save_registry(connection, data):
    connection.execute('UPDATE registry SET payload=? WHERE id=1', (json.dumps(data, sort_keys=True),))


def open_registry():
    INSTANCE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    connection = sqlite3.connect(REGISTRY, timeout=5, isolation_level=None)
    try:
        connection.execute('PRAGMA busy_timeout=5000')
        connection.execute('CREATE TABLE IF NOT EXISTS registry (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)')
        connection.execute('INSERT OR IGNORE INTO registry VALUES(1,?)', (json.dumps({'version': VERSION, 'locks': {}, 'fence': 0}),))
        connection.execute('BEGIN IMMEDIATE')
        if LEGACY_REGISTRY.exists() and LEGACY_REGISTRY.resolve() != Path(REGISTRY).resolve():
            # Lock both registries during transfer. The old version then fails closed on
            # the forwarding marker, instead of continuing as a second lock authority.
            with contextlib.closing(sqlite3.connect(LEGACY_REGISTRY, timeout=5)) as old:
                old.execute('BEGIN IMMEDIATE')
                row = old.execute('SELECT payload FROM registry WHERE id=1').fetchone()
                legacy = json.loads(row[0]) if row else {}
                if legacy.get('version') == 3:
                    data = load_registry(connection)
                    for key, held in legacy.get('locks', {}).items():
                        if active(held, time.time()):
                            origin = hashlib.sha256(str(LEGACY_REGISTRY.resolve()).encode()).hexdigest()[:16]
                            data['locks']['legacy:' + origin + ':' + key] = {**held, 'legacy': True,
                                'authority_device_id': '@local' if device_config(held['device_id'])['kind'] == 'local' else held['device_id']}
                    save_registry(connection, data)
                    connection.commit()
                    old.execute('UPDATE registry SET payload=? WHERE id=1', (json.dumps({'version': VERSION, 'forward_to': str(REGISTRY), 'locks': {}}),))
                    old.commit()
                    connection.execute('BEGIN IMMEDIATE')
                else:
                    if legacy.get('forward_to') and Path(legacy['forward_to']).resolve() != Path(REGISTRY).resolve():
                        raise ValueError('installation is already bound to a different lock authority')
                    old.rollback()
        if os.name != 'nt':
            Path(REGISTRY).chmod(0o600)
        return connection
    except Exception:
        connection.close()
        raise


def output(status, **fields):
    print(json.dumps({'status': status, **fields}, sort_keys=True))


def active(lock, now):
    # An abandoned action is quarantined, never silently reassigned on expiry.
    return bool(lock.get('operation')) or float(lock.get('expires_at', 0)) > now


def conflicts(requested, held):
    if requested.get('authority_device_id', requested['device_id']) != held.get('authority_device_id', held.get('device_id')):
        return False
    if held.get('legacy'):
        return True
    if 'device' in {requested['kind'], held.get('kind')}:
        return True
    if requested['app_id'] != held.get('app_id'):
        return False
    if held.get('legacy'):
        return True
    if requested.get('instance_id') and held.get('instance_id') and requested['instance_id'] != held['instance_id']:
        first = requested['instance_id'].split(':')
        second = held['instance_id'].split(':')
        first_bsd = len(first) == 4 and first[1] == 'bsd'
        second_bsd = len(second) == 4 and second[1] == 'bsd'
        if first[0].isdigit() and first[0] == second[0] and first_bsd != second_bsd:
            # A launch date may appear/disappear for a still-running macOS app.
            # Without an authoritative alias, both identities exclude the whole
            # application. In-flight/unknown operations still survive TTL expiry.
            return True
        return False
    if requested['kind'] != 'browser-tab' or held.get('kind') != 'browser-tab':
        # Native/browser window IDs are not interchangeable. Broader browser/native
        # operations conservatively exclude the instance until an exact bridge exists.
        if requested['kind'] == held.get('kind') == 'window':
            return requested['window_id'] == held.get('window_id')
        return True
    if requested.get('identity_namespace') != held.get('identity_namespace'):
        return True  # Unverified aliases from different protocols must not race.
    return requested.get('tab_id') == held.get('tab_id')


def add_resource_arguments(parser):
    parser.add_argument('--device', required=True)
    parser.add_argument('--app-id', required=True)
    parser.add_argument('--window-id', default='*')
    parser.add_argument('--kind', choices=['device', 'app', 'window', 'browser-window', 'browser-tab'], required=True)
    parser.add_argument('--tab-id')
    parser.add_argument('--instance-id')


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ['acquire', 'validate', 'renew', 'release', 'status', 'begin', 'finish']:
        child = commands.add_parser(name)
        add_resource_arguments(child)
        if name == 'acquire':
            child.add_argument('--owner', required=True)
        if name in {'acquire', 'renew', 'begin'}:
            child.add_argument('--ttl-seconds', type=int, default=900)
        if name not in {'acquire', 'status'}:
            child.add_argument('--token', required=True)
        if name == 'finish':
            child.add_argument('--operation', required=True)
            child.add_argument('--outcome', choices=['verified', 'not-applied', 'unknown'], required=True)
    required = commands.add_parser('required')
    required.add_argument('--device', required=True)
    commands.add_parser('list')
    return parser


def request_for(args):
    return {'device_id': args.device, 'app_id': args.app_id, 'window_id': args.window_id,
            'kind': args.kind, 'tab_id': args.tab_id, 'instance_id': args.instance_id}


def owns(request, held):
    return (request.get('authority_device_id', request['device_id']) == held.get('authority_device_id', held.get('device_id')) and request['app_id'] == held.get('app_id')
            and request['kind'] == held.get('kind') and
            (request.get('tab_id') == held.get('tab_id') if request['kind'] == 'browser-tab'
             else request['window_id'] == held.get('window_id')))


def execute(args, raw_arguments=None, forwarded=False):
    if args.command != 'list':
        device = device_config(args.device)
        route = device.get('lock_command')
        if route:
            if forwarded:
                raise ValueError('lock authority forwarding loop')
            from control import resolve_command
            result = subprocess.run(resolve_command(route), input=json.dumps({'arguments': raw_arguments or sys.argv[1:]}),
                                    capture_output=True, text=True, timeout=15)
            print(result.stdout.strip())
            return result.returncode
        # A remote device must explicitly route all clients to its single authority.
        local_guest = device['kind'] == 'vm' and device_config(device['host'])['kind'] == 'local'
        if device['kind'] != 'local' and not local_guest and not forwarded:
            raise ValueError('non-local device requires lock_command pointing to its shared authority')
        if args.command == 'required':
            output('required', device=args.device, coordination=coordination_policy(device))
            return 0
        if args.kind == 'browser-tab' and not args.tab_id:
            raise ValueError('browser_tab_requires_tab_id')
        if args.kind != 'browser-tab' and args.tab_id:
            raise ValueError('only browser-tab accepts tab_id')
        if args.kind in {'window', 'browser-window'} and args.window_id == '*':
            raise ValueError('exact window_id is required')
    if hasattr(args, 'ttl_seconds') and not 30 <= args.ttl_seconds <= 3600:
        raise ValueError('ttl_seconds_must_be_30_to_3600')
    request = request_for(args) if args.command != 'list' else None
    if request:
        request['authority_device_id'] = '@local' if device['kind'] == 'local' else args.device
    live = None
    if args.command in {'acquire', 'begin'}:
        live = resolve(request, admission=args.command == 'acquire')
    with contextlib.closing(open_registry()) as connection:
        with connection:
            data = load_registry(connection)
            now = time.time()
            # Retain fenced operations even after expiry; they need explicit reconciliation.
            data['locks'] = {k:v for k,v in data['locks'].items() if active(v, now)}
            locks = data['locks']
            result, code = {'status': 'ok'}, 0
            if args.command == 'list':
                result.update(authority=str(REGISTRY), locks={k:public_lock(v) for k,v in locks.items()})
            elif args.command == 'acquire':
                if time.time() - live.get('observed_at', 0) > 5:
                    raise ValueError('surface state aged before acquisition; retry live resolution')
                requested = {**request, 'coordination': coordination_policy(device), **{k: live.get(k) for k in ['instance_id', 'identity_namespace', 'window_id']}}
                held = next(((k,v) for k,v in locks.items() if conflicts(requested, v)), None)
                if held:
                    result, code = {'status': 'blocked_held', 'held_resource': held[0], 'lock': public_lock(held[1])}, 3
                else:
                    key = resource_key(request['authority_device_id'], args.app_id, requested['window_id'], args.kind, args.tab_id,
                                       requested['instance_id'], requested.get('identity_namespace'))
                    token = 'lock_' + secrets.token_urlsafe(24)
                    data['fence'] = data.get('fence', 0) + 1
                    current = {**requested, 'owner': args.owner, 'token_hash': token_hash(token),
                        'acquired_at': now, 'renewed_at': now, 'expires_at': now+args.ttl_seconds, 'fence': data['fence']}
                    locks[key] = current
                    result = {'status': 'acquired', 'resource': key, 'token': token, 'lock': public_lock(current)}
            elif args.command == 'status':
                held = [(k,v) for k,v in locks.items() if conflicts(request, v)]
                result = {'status': 'held' if held else 'free', 'locks': [public_lock(v) for k,v in held]}
            else:
                matches = [(k,v) for k,v in locks.items() if owns(request, v) and
                           secrets.compare_digest(v.get('token_hash',''), token_hash(args.token))]
                if len(matches) != 1:
                    result, code = {'status': 'invalid', 'reason': 'missing_expired_or_token_mismatch'}, 4
                else:
                    key, current = matches[0]
                    if args.command in {'validate', 'renew', 'begin'} and current['expires_at'] <= now:
                        result, code = {'status': 'invalid', 'reason': 'expired_operation_requires_reconciliation'}, 4
                    elif args.command == 'release':
                        if current.get('operation'):
                            result, code = {'status': 'blocked_in_flight', 'operation': current['operation']}, 3
                        else:
                            del locks[key]
                            result = {'status': 'released', 'resource': key}
                    elif args.command == 'finish':
                        if current.get('operation') != args.operation:
                            result, code = {'status': 'invalid', 'reason': 'operation_mismatch'}, 4
                        elif args.outcome == 'unknown':
                            current['uncertain'] = True
                            result = {'status': 'quarantined', 'operation': args.operation}
                        else:
                            current.pop('operation', None)
                            current.pop('uncertain', None)
                            result = {'status': 'finished', 'outcome': args.outcome}
                    elif args.command == 'begin' and current.get('operation'):
                        result, code = {'status': 'blocked_in_flight', 'operation': current['operation']}, 3
                    elif args.command == 'begin' and (current.get('legacy') or live['instance_id'] != current.get('instance_id')
                            or live.get('identity_namespace') != current.get('identity_namespace')):
                        result, code = {'status': 'invalid', 'reason': 'surface_instance_changed'}, 4
                    else:
                        if args.command in {'renew', 'begin'}:
                            current['renewed_at'] = now
                            current['expires_at'] = now + args.ttl_seconds
                        if args.command == 'begin':
                            if args.kind == 'browser-tab':
                                current['window_id'] = live.get('window_id')
                            current['operation'] = 'op_' + secrets.token_urlsafe(18)
                        result = {'status': {'validate':'valid', 'renew':'renewed', 'begin':'ready'}[args.command],
                                  'resource': key, 'lock': public_lock(current)}
            save_registry(connection, data)
        # Never announce acquisition until the transaction has committed.
        output(**result)
        return code


def main():
    try:
        arguments = sys.argv[1:]
        forwarded = arguments == ['serve']
        if forwarded:
            raw = sys.stdin.read(65537)
            if len(raw) > 65536:
                raise ValueError('lock RPC request is too large')
            arguments = json.loads(raw).get('arguments')
            if not isinstance(arguments, list) or not all(isinstance(v, str) for v in arguments) or 'serve' in arguments:
                raise ValueError('invalid lock RPC arguments')
        return execute(build_parser().parse_args(arguments), arguments, forwarded)
    except (OSError, ValueError, RuntimeError, sqlite3.Error, subprocess.SubprocessError) as exc:
        output('blocked', reason=str(exc))
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
