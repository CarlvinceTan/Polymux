"""Lease races, attention admission, migration, fencing and tab topology."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
SPEC = importlib.util.spec_from_file_location('lock_test', ROOT/'scripts/lock.py')


def load():
    module = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(module)
    return module


class LockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.lock = load()
        self.lock.INSTANCE_DIR = Path(self.temp.name)
        self.lock.REGISTRY = Path(self.temp.name)/'locks.sqlite3'
        self.lock.LEGACY_REGISTRY = Path(self.temp.name)/'legacy.sqlite3'
        self.lock.device_config = lambda _: {'kind': 'local', 'user_active': True}
        self.live = {'instance_id': 'process:birth', 'identity_namespace': 'cdp', 'human_active': False}
        self.lock.resolve = mock.Mock(side_effect=lambda request, **_: {**request, **self.live, 'observed_at': time.time()})

    def call(self, action, token=None, *, tab='t1', window='w1', kind='browser-tab', extra=()):
        args = [action, '--device', 'device', '--app-id', 'browser', '--kind', kind, '--window-id', window]
        if kind == 'browser-tab': args += ['--tab-id', tab]
        if action == 'acquire': args += ['--owner', 'agent']
        if token: args += ['--token', token]
        with mock.patch.object(sys, 'argv', ['lock.py', *args, *extra]), contextlib.redirect_stdout(io.StringIO()) as out:
            code = self.lock.main()
        return code, json.loads(out.getvalue())

    def edit(self, change):
        with contextlib.closing(self.lock.open_registry()) as db:
            with db:
                data = self.lock.load_registry(db)
                change(data)
                self.lock.save_registry(db, data)

    def test_default_authority_is_outside_installation(self):
        self.assertNotEqual(load().REGISTRY.parent, ROOT/'instance')

    def test_two_agents_same_tab_only_one_owner(self):
        self.assertEqual(self.call('acquire')[0], 0)
        self.assertEqual(self.call('acquire')[1]['status'], 'blocked_held')

    def test_different_tabs_share_window(self):
        self.assertEqual(self.call('acquire')[0], 0)
        self.assertEqual(self.call('acquire', tab='t2')[0], 0)

    def test_tab_movement_does_not_create_another_lease(self):
        self.call('acquire')
        self.assertEqual(self.call('acquire', window='w2')[1]['status'], 'blocked_held')

    def test_owner_can_follow_moved_tab(self):
        token = self.call('acquire')[1]['token']
        code, value = self.call('begin', token, window='w2')
        self.assertEqual(code, 0)
        self.assertEqual(value['lock']['window_id'], 'w2')

    def test_owner_renewal_does_not_consult_attention(self):
        token = self.call('acquire')[1]['token']
        self.lock.resolve.side_effect = ValueError('human_active')
        self.assertEqual(self.call('renew', token)[0], 0)
        self.assertEqual(self.call('validate', token)[0], 0)
        self.assertEqual(self.lock.resolve.call_count, 1)

    def test_admission_failure_creates_no_lease(self):
        self.lock.resolve.side_effect = ValueError('human_active')
        self.assertEqual(self.call('acquire')[0], 2)
        self.lock.resolve.side_effect = lambda request, **_: {**request, **self.live, 'observed_at': time.time()}
        self.assertEqual(self.call('status')[1]['status'], 'free')

    def test_begin_does_not_reapply_admission(self):
        token = self.call('acquire')[1]['token']
        self.live['human_active'] = True
        self.assertEqual(self.call('begin', token)[0], 0)
        self.assertFalse(self.lock.resolve.call_args.kwargs['admission'])

    def test_background_browser_window_scope_conflicts(self):
        self.call('acquire')
        self.assertEqual(self.call('acquire', kind='browser-window')[0], 3)

    def test_native_window_cannot_bypass_browser_tab_lease(self):
        self.call('acquire')
        self.assertEqual(self.call('acquire', kind='window', window='native123')[0], 3)

    def test_different_protocol_ids_fail_closed(self):
        self.call('acquire')
        self.live['identity_namespace'] = 'bidi'
        self.assertEqual(self.call('acquire', tab='unmapped-context')[0], 3)

    def test_broad_status_sees_tab_conflict(self):
        self.call('acquire')
        self.assertEqual(self.call('status', kind='browser-window')[1]['status'], 'held')

    def test_expired_token_does_not_revive(self):
        first = self.call('acquire')[1]
        self.edit(lambda data: [v.update(expires_at=0) for v in data['locks'].values()])
        second = self.call('acquire')[1]
        self.assertGreater(second['lock']['fence'], first['lock']['fence'])
        self.assertEqual(self.call('renew', first['token'])[0], 4)

    def test_action_detects_browser_restart(self):
        token = self.call('acquire')[1]['token']
        self.live['instance_id'] = 'process:new-birth'
        self.assertEqual(self.call('begin', token)[1]['reason'], 'surface_instance_changed')

    def test_macos_birth_alias_cannot_bypass_an_uncertain_operation(self):
        for first, second in [('42:bsd:100:123456', '42:100.123456'),
                              ('42:100.123456', '42:bsd:100:123456')]:
            self.live['instance_id'] = first
            token = self.call('acquire')[1]['token']
            operation = self.call('begin', token)[1]['lock']['operation']
            self.call('finish', token, extra=['--operation', operation, '--outcome', 'unknown'])
            self.edit(lambda data: [value.update(expires_at=0) for value in data['locks'].values()])
            self.live['instance_id'] = second
            self.assertEqual(self.call('acquire', tab='another', window='another')[1]['status'], 'blocked_held')
            self.assertEqual(self.call('begin', token)[1]['reason'], 'expired_operation_requires_reconciliation')
            self.call('finish', token, extra=['--operation', operation, '--outcome', 'not-applied'])
            self.assertEqual(self.call('status')[1]['status'], 'free')

    def test_different_kernel_births_still_distinguish_process_replacement(self):
        self.live['instance_id'] = '42:bsd:100:123456'
        token = self.call('acquire')[1]['token']
        self.live['instance_id'] = '42:bsd:200:123456'
        self.assertEqual(self.call('begin', token)[1]['reason'], 'surface_instance_changed')
        self.assertEqual(self.call('acquire')[0], 0)

    def test_in_flight_action_cannot_be_duplicated_or_released(self):
        token = self.call('acquire')[1]['token']
        self.call('begin', token)
        self.assertEqual(self.call('begin', token)[1]['status'], 'blocked_in_flight')
        self.assertEqual(self.call('release', token)[1]['status'], 'blocked_in_flight')

    def test_abandoned_action_blocks_takeover_after_expiry(self):
        token = self.call('acquire')[1]['token']
        op = self.call('begin', token)[1]['lock']['operation']
        self.edit(lambda data: [v.update(expires_at=0) for v in data['locks'].values()])
        self.assertEqual(self.call('acquire')[1]['status'], 'blocked_held')
        self.assertEqual(self.call('finish', token, extra=['--operation', op, '--outcome', 'verified'])[0], 0)
        self.assertEqual(self.call('acquire')[0], 0)

    def test_unknown_outcome_requires_reconciliation(self):
        token = self.call('acquire')[1]['token']
        op = self.call('begin', token)[1]['lock']['operation']
        self.assertEqual(self.call('finish', token, extra=['--operation', op, '--outcome', 'unknown'])[1]['status'], 'quarantined')
        self.assertEqual(self.call('begin', token)[0], 3)
        self.assertEqual(self.call('finish', token, extra=['--operation', op, '--outcome', 'not-applied'])[0], 0)
        self.assertEqual(self.call('release', token)[0], 0)

    def test_agent_owned_devices_still_coordinate(self):
        self.lock.device_config = lambda _: {'kind': 'local', 'user_active': False}
        self.assertEqual(self.call('acquire')[0], 0)
        self.assertEqual(self.call('acquire')[0], 3)

    def test_unsafe_token_prefix_cannot_become_an_option(self):
        token = self.call('acquire')[1]['token']
        with mock.patch.object(self.lock.secrets, 'token_urlsafe', return_value='-leading-dash'):
            op = self.call('begin', token)[1]['lock']['operation']
        self.assertTrue(op.startswith('op_'))
        self.assertEqual(self.call('finish', token, extra=['--operation', op, '--outcome', 'verified'])[0], 0)

    def test_rpc_sends_arguments_as_json_not_remote_shell_text(self):
        route = ['ssh', 'authority', 'python3', '/control/lock.py', 'serve']
        self.lock.device_config = lambda _: {'kind': 'remote', 'lock_command': route}
        response = mock.Mock(returncode=0, stdout='{"status":"free"}')
        with mock.patch.object(self.lock.subprocess, 'run', return_value=response) as run:
            self.call('status', tab='value with spaces; $(unsafe)')
        self.assertEqual(run.call_args.args[0], route)
        self.assertIn('value with spaces; $(unsafe)', json.loads(run.call_args.kwargs['input'])['arguments'])

    def test_application_scope_keeps_its_resource_identity(self):
        token = self.call('acquire', kind='app', window='*')[1]['token']
        operation = self.call('begin', token, kind='app', window='*')[1]['lock']['operation']
        self.assertEqual(self.call('finish', token, kind='app', window='*', extra=['--operation', operation, '--outcome', 'verified'])[0], 0)
        self.assertEqual(self.call('release', token, kind='app', window='*')[0], 0)

    def test_remote_without_authority_is_blocked(self):
        self.lock.device_config = lambda _: {'kind': 'remote', 'user_active': False}
        self.assertEqual(self.call('acquire')[0], 2)

    def test_legacy_migration_preserves_held_resources_and_disables_old_writer(self):
        with contextlib.closing(sqlite3.connect(self.lock.LEGACY_REGISTRY, isolation_level=None)) as db:
            db.execute('CREATE TABLE registry(id INTEGER PRIMARY KEY,payload TEXT)')
            db.execute('INSERT INTO registry VALUES(1,?)', (json.dumps({'version':3,'locks':{'old':{
                'device_id':'device','app_id':'browser','kind':'browser-tab','tab_id':'t1','window_id':'w1',
                'expires_at':time.time()+100,'token_hash':'hash'}}}),))
        self.assertEqual(self.call('acquire', window='moved')[0], 3)
        with contextlib.closing(sqlite3.connect(self.lock.LEGACY_REGISTRY, isolation_level=None)) as db:
            marker=json.loads(db.execute('SELECT payload FROM registry').fetchone()[0])
        self.assertEqual(marker['forward_to'], str(self.lock.REGISTRY))
        self.assertNotEqual(marker['version'], 3)

    def test_eight_processes_share_one_authority(self):
        script = '''import sys,time,json
from pathlib import Path
sys.path.insert(0,sys.argv[1]);sys.path.insert(0,sys.argv[4]);import lock
lock.device_config=lambda _: {'kind':'local','user_active':False}
lock.resolve=lambda r,**kw: {**r,'instance_id':'birth','identity_namespace':'cdp','human_active':False,'observed_at':time.time()}
sys.argv=['lock.py','acquire','--device','d','--app-id','b','--kind','browser-tab','--tab-id','t','--owner',sys.argv[3]]
raise SystemExit(lock.main())'''
        copies = []
        for name in ('copy-a', 'copy-b'):
            directory = Path(self.temp.name)/name/'scripts'
            directory.mkdir(parents=True)
            (directory/'lock.py').write_text((ROOT/'scripts/lock.py').read_text())
            copies.append(directory)
        def run(i):
            return subprocess.run([sys.executable,'-B','-c',script,str(ROOT/'scripts'),self.temp.name,str(i),str(copies[i % 2])],
                capture_output=True,text=True,timeout=10,
                env={**os.environ, 'CONTROL_RUNTIME_DIR': str(Path(self.temp.name)/'shared')})
        with ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(run,range(8)))
        self.assertEqual(sorted(r.returncode for r in results), [0]+[3]*7, [r.stdout+r.stderr for r in results])
