"""Admission across destination sessions, remote collectors and human reconnects."""
import copy
import sys
import time
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import attention
import config
import control
import peer
import desktop
import subprocess
import surfaces
from linux import sessions as linux
from windows import sessions as windows
from windows import state as windows_state
from linux import state as linux_state


def state(presence='possible', active=True, complete=True):
    return {'observed_at': time.time(), 'sessions': [{'session_id': 's:1', 'presence': presence}],
            'session_inventory_complete': complete,
            'surfaces': [{'session_id': 's:1', 'pid': 10, 'kind': 'window', 'provider': 'native',
                          'app_id': 'example.app', 'instance_id': '10:birth', 'identity': 'exact',
                          'window_id': '50', 'human_active': active, 'capabilities': {'background_actions': True}}]}


class AttentionTests(unittest.TestCase):
    def test_connected_session_protects_focused_surface(self):
        value = attention.apply_sessions(state())
        self.assertIs(value['human_active'], True)
        self.assertIs(value['surfaces'][0]['human_active'], True)

    def test_confirmed_absence_allows_even_stale_foreground(self):
        value = attention.apply_sessions(state('absent'))
        self.assertIs(value['human_active'], False)
        self.assertIs(value['surfaces'][0]['human_active'], False)

    def test_empty_collector_is_not_absence(self):
        value = attention.apply_sessions({'sessions': [], 'session_inventory_complete': False})
        self.assertEqual(value['human_active'], 'unknown')

    def test_complete_empty_session_enumeration_can_prove_absence(self):
        self.assertIs(attention.apply_sessions({'sessions': [], 'session_inventory_complete': True})['human_active'], False)

    def test_multiple_connected_sessions_are_independent(self):
        value = state('absent')
        value['sessions'].append({'session_id': 's:2', 'presence': 'possible'})
        value['surfaces'].append({**value['surfaces'][0], 'session_id': 's:2', 'pid': 20})
        result = attention.apply_sessions(value)
        self.assertIs(result['human_active'], True)
        self.assertEqual([s['human_active'] for s in result['surfaces']], [False, True])
        self.assertIs(attention.browser_attention(result, 10), False)
        self.assertIs(attention.browser_attention(result, 20), True)

    def test_different_hosts_never_share_attention(self):
        first = attention.apply_sessions(state())
        second = attention.apply_sessions(state('absent'))
        self.assertIs(first['human_active'], True)
        self.assertIs(second['human_active'], False)

    def test_unmapped_or_ambiguous_session_does_not_admit_surface(self):
        for rows in [[], [{'session_id': 's:1', 'presence': 'absent'}] * 2]:
            value = state(active=False); value['sessions'] = rows
            self.assertEqual(attention.apply_sessions(value)['surfaces'][0]['human_active'], 'unknown')

    def test_unknown_browser_and_stale_inventory_are_unknown(self):
        value = state(active=False)
        self.assertEqual(attention.browser_attention(value, 20), 'unknown')
        value['observed_at'] -= 10
        self.assertEqual(attention.browser_attention(value, 10), 'unknown')

    def test_missing_surface_attention_is_not_false(self):
        value = state(); value['surfaces'][0].pop('human_active')
        self.assertEqual(attention.browser_attention(value, 10), 'unknown')

    def test_linux_idle_and_locked_never_prove_absence(self):
        row = linux.parse_session('Id=5\nUser=1000\nClass=user\nType=x11\nIdleHint=yes\nLockedHint=yes\nState=active')
        self.assertEqual(row['presence'], 'possible')
        self.assertTrue(row['idle']); self.assertTrue(row['locked'])

    def test_linux_ssh_session_does_not_masquerade_as_gui(self):
        self.assertIsNone(linux.parse_session('Id=5\nUser=1000\nClass=user\nType=tty'))

    def test_rdp_reconnect_changes_admission_signal(self):
        self.assertEqual(windows.session_row(1, 4, 2)['presence'], 'absent')
        self.assertEqual(windows.session_row(1, 0, 2)['presence'], 'possible')

    def test_disconnected_console_or_unknown_transport_not_absent(self):
        for protocol in [None, 0]:
            self.assertEqual(windows.session_row(1, 4, protocol)['presence'], 'unknown')

    def test_wts_transition_is_conservative(self):
        for status in [1, 2, 3]:
            self.assertEqual(windows.session_row(1, status, 2)['presence'], 'possible')

    def test_reconnect_during_collection_invalidates_absence_proof(self):
        old = windows.session_row(1, 4, 2); new = windows.session_row(1, 0, 2)
        value = state(active=False); value['surfaces'][0]['session_id'] = 'wts:1'
        with mock.patch.object(windows, 'current_session', return_value=0), \
             mock.patch.object(windows, 'discover', side_effect=[([old], True), ([new], True)]), \
             mock.patch('windows.session_probe.collect_session', return_value=value):
            result = windows_state.collect()
        self.assertEqual(result['human_active'], 'unknown')
        self.assertEqual(result['surfaces'][0]['human_active'], 'unknown')

    def test_service_observes_multiple_sessions_without_claiming_action_route(self):
        records = [windows.session_row(1, 0, 0), windows.session_row(2, 0, 2)]
        def probe(ident):
            value = state(); value['surfaces'][0]['session_id'] = f'wts:{ident}'
            return value
        with mock.patch.object(windows, 'current_session', return_value=0), \
             mock.patch.object(windows, 'discover', side_effect=[(copy.deepcopy(records), True), (copy.deepcopy(records), True)]), \
             mock.patch('windows.session_probe.collect_session', side_effect=probe):
            result = windows_state.collect()
        self.assertEqual(len(result['sessions']), 2)
        self.assertTrue(all(s['human_active'] for s in result['surfaces']))
        self.assertFalse(any(s['capabilities']['background_actions'] for s in result['surfaces']))

    def test_x11_known_empty_foreground_differs_from_missing_property(self):
        from desktop import generation
        for root, expected in [('_NET_CLIENT_LIST(WINDOW): window id # 0x30\n_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0', False),
                               ('_NET_CLIENT_LIST(WINDOW): window id # 0x30', 'unknown')]:
            with mock.patch.object(linux_state, 'run', side_effect=[root, '_NET_WM_PID(CARDINAL) = 10\n_NET_WM_NAME(UTF8_STRING) = "Window"']), \
                 mock.patch.object(linux_state.shutil, 'which', return_value='/usr/bin/xprop'), \
                 mock.patch.object(linux_state.os, 'readlink', return_value='/usr/bin/example'), \
                 mock.patch('desktop.generation', return_value='10:birth'):
                value = linux_state.collect_current({'DISPLAY': ':1'})
            self.assertEqual(value['surfaces'][0]['human_active'], expected)

    def test_policy_is_configuration_not_current_activity(self):
        self.assertEqual(config.coordination_policy({})['session_mode'], 'shared')
        self.assertEqual(config.coordination_policy({'user_active': False})['session_mode'], 'unattended')
        self.assertTrue(config.coordination_policy({'user_active': False})['lease_required'])

    def test_normalization_keeps_session_metadata_and_overrides_spoofed_policy(self):
        raw = state(); raw['coordination'] = {'human_attention_required': False}
        value = control.normalize_state(raw, {'id': 'example', 'kind': 'local', 'platform': 'linux'})
        self.assertEqual(value['sessions'], raw['sessions'])
        self.assertTrue(value['coordination']['human_attention_required'])

    def test_restricted_peer_rejects_shell_or_extra_arguments(self):
        self.assertEqual(peer.dispatch('control-state'), ['control.py', 'collect-local'])
        self.assertEqual(peer.dispatch('control-lock'), ['lock.py', 'serve'])
        for command in ['', 'sh', 'control-state; id', 'control-lock --help']:
            with self.assertRaises(ValueError): peer.dispatch(command)

    def test_slow_browser_enrichment_preserves_native_attention(self):
        value = state()
        with mock.patch.object(desktop, 'local_native', return_value=value), \
             mock.patch.object(desktop.platform, 'system', return_value='Windows'), \
             mock.patch.object(desktop, 'command_json', side_effect=subprocess.TimeoutExpired('collector', 1)):
            result = desktop.collect()
        self.assertEqual(result['sessions'], value['sessions'])
        self.assertEqual(len(result['surfaces']), 1)
        self.assertEqual(result['completeness'], 'partial')

    def test_bounded_json_input_preserves_unicode(self):
        from transport import command_json
        payload = {'title': 'Example \u200b \u4e16\u754c'}
        result = command_json([sys.executable, '-c', 'import sys,json; print(json.dumps(json.load(sys.stdin)))'],
                              2, input_value=payload)
        self.assertEqual(result, payload)


class AdmissionTests(unittest.TestCase):
    request = {'device_id': 'example', 'kind': 'window', 'app_id': 'example.app', 'window_id': '50'}

    def resolve(self, snapshot, shared=True, admission=True, request=None):
        cfg = {'devices': {'example': {'kind': 'local', 'platform': 'linux', 'user_active': shared}}}
        with mock.patch.object(surfaces, 'load_config', return_value=cfg), \
             mock.patch.object(surfaces, 'command_json', return_value=snapshot), \
             mock.patch.object(control, 'device_snapshot', return_value=snapshot):
            return surfaces.resolve(request or self.request, admission=admission)

    def test_shared_confirmed_absence_admits(self):
        result = self.resolve(attention.apply_sessions(state('absent')))
        self.assertIs(result['human_active'], False)

    def test_shared_present_and_unknown_reject_new_acquisition(self):
        for active in [True, 'unknown']:
            with self.assertRaisesRegex(ValueError, 'human_'):
                self.resolve(state(active=active))

    def test_existing_lease_does_not_recheck_attention(self):
        self.assertIs(self.resolve(state(), admission=False)['human_active'], True)

    def test_unattended_still_requires_exact_identity_and_background_route(self):
        self.assertIs(self.resolve(state(), shared=False)['human_active'], True)
        snapshot = state(); snapshot['surfaces'][0]['identity'] = 'metadata_only'
        with self.assertRaisesRegex(ValueError, 'exact live identity'):
            self.resolve(snapshot, shared=False)
        snapshot = state(); snapshot['surfaces'][0]['capabilities']['background_actions'] = False
        with self.assertRaisesRegex(ValueError, 'background action route'):
            self.resolve(snapshot, shared=False, admission=False)

    def test_device_lock_needs_all_sessions_absent(self):
        request = {**self.request, 'kind': 'device'}
        self.assertIs(self.resolve(attention.apply_sessions(state('absent')), request=request)['human_active'], False)
        with self.assertRaisesRegex(ValueError, 'human_active'):
            self.resolve(attention.apply_sessions(state()), request=request)

    def test_unattended_device_does_not_need_attention_collector(self):
        result = self.resolve({}, shared=False, request={**self.request, 'kind': 'device'})
        self.assertTrue(result['coordination']['lease_required'])
        self.assertIs(result['human_active'], False)


if __name__ == '__main__':
    unittest.main()
