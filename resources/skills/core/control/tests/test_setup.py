"""Clean-machine defaults and capability diagnosis without browser changes."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import config
from browser import setup


class BrowserSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'instance/control.json'
        patch = mock.patch.object(config, 'CONFIG', self.path)
        patch.start()
        self.addCleanup(patch.stop)
        self.browser = {'native_app_id': 'example.browser', 'engine': 'unknown'}
        self.row = {'app_id': 'example.browser', 'kind': 'browser-tab', 'identity': 'metadata_only',
                    'title': 'Private page title', 'url': 'https://example.invalid/', 'provider': 'native_metadata'}

    def run_check(self, command='check', rows=None, arguments=()):
        with mock.patch.object(setup, 'default_browser', return_value=self.browser), \
             mock.patch.object(setup, 'device_snapshot', return_value={'surfaces': rows if rows is not None else [self.row]}), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            code = setup.main([command, *arguments])
        return code, json.loads(output.getvalue())

    def test_first_use_needs_no_config_or_browser_integration(self):
        code, report = self.run_check('setup')
        self.assertEqual(code, 0)
        self.assertEqual(report['configuration'], 'built_in_local_defaults')
        self.assertFalse(self.path.parent.exists())
        self.assertEqual(report['automatic_changes'], [])
        self.assertIs(report['requires_extension'], False)

    def test_setup_and_check_are_identical_for_all_engines(self):
        for engine in ('chromium', 'gecko', 'webkit', 'unknown'):
            with self.subTest(engine=engine):
                self.browser['engine'] = engine
                self.assertEqual(self.run_check('setup'), self.run_check('check'))

    def test_metadata_is_useful_but_never_actionable_identity(self):
        _, report = self.run_check()
        self.assertEqual(report['status'], 'metadata_only')
        self.assertEqual(report['capabilities']['exact_tabs'], 0)
        self.assertEqual(report['capabilities']['tabs_with_background_route'], 0)
        self.assertNotIn('Private page title', json.dumps(report))
        self.assertNotIn('https://example.invalid', json.dumps(report))

    def test_exact_identity_attention_and_actions_are_separate(self):
        row = {**self.row, 'identity': 'exact', 'instance_id': 'birth', 'tab_id': 'target',
               'human_active': 'unknown', 'capabilities': {'background_actions': False}}
        _, report = self.run_check(rows=[row])
        self.assertEqual(report['status'], 'available')
        self.assertEqual(report['capabilities']['exact_tabs'], 1)
        self.assertEqual(report['capabilities']['tabs_with_attention'], 0)
        self.assertEqual(report['capabilities']['tabs_with_background_route'], 0)
        row.update(human_active=False, capabilities={'background_actions': True})
        _, report = self.run_check(rows=[row])
        self.assertEqual(report['capabilities']['tabs_with_attention'], 1)
        self.assertEqual(report['capabilities']['tabs_with_background_route'], 1)

    def test_no_tab_route_preserves_native_context(self):
        _, report = self.run_check(rows=[{**self.row, 'kind': 'window'}])
        self.assertEqual(report['status'], 'window_only')
        self.assertEqual(report['capabilities']['native_windows'], 1)

    def test_required_complete_inventory_cannot_pass_from_tab_count(self):
        code, report = self.run_check(arguments=('--require-complete',))
        self.assertEqual(code, 4)
        self.assertFalse(report['tab_inventory']['whole_browser_complete'])

    def test_unrelated_browser_does_not_count_as_default_access(self):
        code, report = self.run_check(rows=[{**self.row, 'app_id': 'another.browser'}])
        self.assertEqual(code, 2)
        self.assertEqual(report['status'], 'unavailable')

    def test_named_browser_uses_same_capability_contract(self):
        with mock.patch.object(setup, 'installed_browser', return_value=self.browser) as installed:
            self.assertEqual(self.run_check(arguments=('--browser', 'named-browser'))[0], 0)
        installed.assert_called_once_with('named-browser')

    def test_existing_config_is_preserved(self):
        config.initialize_local(False, path=self.path)
        before = self.path.read_bytes()
        _, report = self.run_check('setup')
        self.assertEqual(report['configuration'], 'instance/control.json')
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(report['automatic_changes'], [])

    def test_invalid_config_is_not_replaced_or_ignored(self):
        self.path.parent.mkdir()
        self.path.write_text('{')
        code, report = self.run_check('setup')
        self.assertEqual(code, 2)
        self.assertEqual(report['status'], 'unavailable')
        self.assertEqual(self.path.read_text(), '{')

    def test_missing_browser_reports_gap_without_repair(self):
        with mock.patch.object(setup, 'default_browser', side_effect=ValueError('not available')), \
             mock.patch.object(setup, 'device_snapshot', return_value={'surfaces': []}), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(setup.main(['setup']), 2)
        report = json.loads(output.getvalue())
        self.assertEqual(report['browser_reason'], 'not available')
        self.assertEqual(report['automatic_changes'], [])
        self.assertFalse(self.path.exists())

    def test_extension_and_browser_lifecycle_helpers_are_absent(self):
        from browser import runtime
        root = Path(__file__).resolve().parents[1]
        self.assertFalse((root / 'browser-extension').exists())
        for name in ('install.py', 'connector.py', 'channel.py', 'connected.py', 'action.py', 'build_extension.py', 'page.js'):
            self.assertFalse((root / 'scripts/browser' / name).exists(), name)
        for name in ('launch_for_control', 'recover_running_browser', 'graceful_quit', 'default_tabs_with_idle_recovery'):
            self.assertFalse(hasattr(runtime, name), name)
