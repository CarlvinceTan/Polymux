"""Named permission owner, explicit consent, and private one-shot IPC."""
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from macos import helper, tabs
import desktop


class NamedHelperTests(unittest.TestCase):
    def test_bundle_is_named_and_has_no_dock_icon(self):
        info = helper.info_plist()
        self.assertEqual(info['CFBundleName'], 'Control Skill')
        self.assertEqual(info['CFBundleDisplayName'], 'Control Skill')
        self.assertTrue(info['LSUIElement'])
        self.assertIn('browser tab', info['NSAppleEventsUsageDescription'])
        self.assertEqual(info['CFBundleIdentifier'], helper.BUNDLE_ID)

    def test_launch_uses_services_without_foreground_activation(self):
        command = helper.launch_command(Path('/private/request.json'))
        self.assertEqual(command[:4], ['/usr/bin/open', '-n', '-g', '-j'])
        self.assertEqual(command[-3:], ['--args', '--request', str(Path('/private/request.json'))])

    def test_activation_requires_actual_permission_and_does_not_prompt(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(helper, 'ACTIVATION', Path(tmp) / 'activation.json'), \
             mock.patch.object(helper, 'call', return_value={'accessibility': False}) as call:
            with self.assertRaisesRegex(ValueError, 'grant Accessibility'):
                helper.enable()
            call.assert_called_once_with('status')
            self.assertFalse(helper.ACTIVATION.exists())

    def test_activation_after_consent_is_shared_and_private(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(helper, 'ACTIVATION', Path(tmp) / 'activation.json'), \
             mock.patch.object(helper.platform, 'system', return_value='Darwin'), \
             mock.patch.object(helper, 'call', return_value={'accessibility': True}):
            self.assertFalse(helper.enabled())
            self.assertEqual(helper.enable()['status'], 'enabled')
            self.assertTrue(helper.enabled())
            if os.name != 'nt': self.assertEqual(helper.ACTIVATION.stat().st_mode & 0o777, 0o600)

    def test_existing_unactivated_install_does_not_change_collection(self):
        with mock.patch.object(helper.platform, 'system', return_value='Linux'):
            self.assertFalse(helper.enabled())

    def test_activation_file_corruption_never_selects_another_owner(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(helper, 'ACTIVATION', Path(tmp) / 'activation.json'), \
             mock.patch.object(helper.platform, 'system', return_value='Darwin'):
            helper.ACTIVATION.write_text('{')
            with self.assertRaises(ValueError): helper.enabled()

    def test_native_collection_uses_named_owner_when_enabled(self):
        with mock.patch.object(desktop.platform, 'system', return_value='Darwin'), \
             mock.patch.object(helper, 'enabled', return_value=True), \
             mock.patch.object(helper, 'json_call', return_value={'surfaces': []}) as call:
            self.assertEqual(desktop.local_native()['permission_owner'], 'Control Skill')
            call.assert_called_once_with('native', timeout=4)

    def test_browser_metadata_uses_same_permission_owner(self):
        with mock.patch.object(helper, 'enabled', return_value=True), \
             mock.patch.object(helper, 'json_call', return_value={'windows': []}) as call:
            self.assertEqual(desktop.metadata({'app_id': 'example.browser', 'metadata_allowed': True}), {'windows': []})
            call.assert_called_once_with('metadata', browser='example.browser', timeout=3)

    def test_denied_metadata_never_prompts_or_falls_back_to_another_owner(self):
        with mock.patch.object(helper, 'enabled', return_value=True), \
             mock.patch.object(helper, 'json_call', side_effect=ValueError('denied')), \
             mock.patch.object(tabs, 'command_json') as old:
            self.assertIsNone(desktop.metadata({'app_id': 'example.browser', 'metadata_allowed': True}))
            old.assert_not_called()

    def test_permission_denied_precheck_does_not_send_apple_events(self):
        with mock.patch.object(helper, 'json_call') as call:
            self.assertIsNone(desktop.metadata({'app_id': 'example.browser', 'metadata_allowed': False}))
            call.assert_not_called()

    def test_ambiguous_signing_publishers_do_not_select_an_arbitrary_key(self):
        values = '\n'.join(f'{number}) {str(number) * 40} "Developer ID Application: Example {number}"' for number in [1, 2])
        with mock.patch.object(helper.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=values)):
            self.assertEqual(helper.choose_identity(), '-')
        self.assertEqual(helper.choose_identity('explicit'), 'explicit')

    def test_single_publisher_identity_is_reused(self):
        with mock.patch.object(helper.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0,
                stdout='1) ' + 'A' * 40 + ' "Developer ID Application: Example"')):
            self.assertEqual(helper.choose_identity(), 'A' * 40)

    def test_install_is_not_available_on_other_platforms(self):
        with mock.patch.object(helper.platform, 'system', return_value='Windows'):
            with self.assertRaisesRegex(ValueError, 'only needed on macOS'): helper.install()

    def test_oversized_request_rejected_before_launch(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(helper, 'REQUESTS', Path(tmp)), \
             mock.patch.object(helper, 'verify'), mock.patch.object(helper.subprocess, 'run') as run:
            # POSIX ownership checks are independently covered by the live Mac run.
            if os.name != 'nt':
                with self.assertRaisesRegex(ValueError, 'too large'):
                    helper.call('window', arguments=['x' * 70000])
                run.assert_not_called()


if __name__ == '__main__': unittest.main()
