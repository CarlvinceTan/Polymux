"""Driver context remains usable without native inventory, with ambient URL redaction."""
import sys
import time
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import control
import surfaces
from browser import redact


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.config = {'devices': {'device': {'kind': 'local', 'platform': 'linux', 'user_active': True}},
                       'providers': {'any-driver': ['collector']}}
        self.row = {'app_id': 'browser', 'kind': 'browser-tab', 'instance_id': 'birth', 'tab_id': 'target',
                    'window_id': 'window', 'identity_namespace': 'protocol', 'identity': 'exact',
                    'human_active': False, 'capabilities': {'observe': True, 'background_actions': True},
                    'url': 'https://user:pass@example.invalid/?access_token=secret&q=query#private'}

    def snapshot(self, age=0):
        payload = {'schema_version': 1, 'observed_at': time.time() - age, 'surfaces': [self.row]}
        with mock.patch.object(control, 'collect_device', return_value=control.StateResult(None, 'native unavailable')), \
             mock.patch.object(control, 'command_json', return_value=payload):
            return control.device_snapshot('device', self.config)

    def test_external_provider_survives_native_inventory_failure(self):
        state = self.snapshot()
        self.assertEqual(state['completeness'], 'partial')
        self.assertTrue(state['user_active'])
        request = {**self.row, 'device_id': 'device'}
        with mock.patch.object(surfaces, 'load_config', return_value=self.config), \
             mock.patch.object(control, 'device_snapshot', return_value=state):
            self.assertEqual(surfaces.resolve(request)['tab_id'], 'target')

    def test_failed_native_collector_cannot_bypass_provider_attention(self):
        self.row['human_active'] = 'unknown'
        with mock.patch.object(surfaces, 'load_config', return_value=self.config), \
             mock.patch.object(control, 'device_snapshot', return_value=self.snapshot()):
            with self.assertRaisesRegex(ValueError, 'human_attention_unknown'):
                surfaces.resolve({**self.row, 'device_id': 'device'})

    def test_stale_provider_does_not_restore_capabilities(self):
        state = self.snapshot(age=10)
        self.assertEqual(state['completeness'], 'unavailable')
        self.assertEqual(state['surfaces'], [])

    def test_external_urls_are_redacted_after_merging(self):
        url = self.snapshot()['surfaces'][0]['url']
        for sensitive in ('secret', 'user:pass', 'private'):
            self.assertNotIn(sensitive, url)
        self.assertIn('q=query', url)

    def test_nested_ambient_urls_and_nonweb_schemes(self):
        result = redact.ambient({'browsers': [{'url': self.row['url']}], 'surfaces': [{'URL': 'file:///private/document'}]})
        self.assertNotIn('secret', result['browsers'][0]['url'])
        self.assertEqual(result['surfaces'][0]['URL'], 'file:[redacted]')
