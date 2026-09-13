"""Native tab inventory, coverage, and driver-independent lease identities."""
import json
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import desktop
import control
import lock
import surfaces
from macos import tabs
from browser import setup
from browser import runtime
from browser import context

APP = {'app_id': 'browser', 'instance_id': '42:birth', 'path': '/example/browser', 'pid': 42,
       'name': 'Browser', 'session_id': 'session', 'browser_candidate': True}


def metadata(schema='chromium'):
    return {'schema': schema, 'windows': [{'window_id': '10', 'tabs': [
        {'tab_id': '1', 'title': 'Duplicate', 'url': 'https://example.invalid', 'selected': True},
        {'tab_id': '2', 'title': 'Duplicate', 'url': 'https://example.invalid', 'selected': False}]}],
        'tab_inventory': {'status': 'complete', 'scope': 'scriptable_open_windows', 'count': 2}}


class NativeTabsTests(unittest.TestCase):
    def test_native_chromium_ids_need_no_debug_protocol(self):
        rows = tabs.surfaces(metadata(), APP, True)
        self.assertEqual([r['tab_id'] for r in rows], ['1', '2'])
        self.assertEqual([r['human_active'] for r in rows], [True, False])
        self.assertEqual(rows[0]['identity_namespace'], 'applescript')
        self.assertFalse(rows[0]['capabilities']['background_actions'])
        self.assertFalse(lock.conflicts({**rows[0], 'device_id': 'd'}, {**rows[1], 'device_id': 'd'}))

    def test_safari_never_uses_an_index_or_pid_as_tab_identity(self):
        rows = tabs.surfaces(metadata('safari'), APP, False)
        self.assertTrue(all(r['identity'] == 'metadata_only' and 'tab_id' not in r for r in rows))

    def test_duplicate_and_invalid_ids_are_not_exact(self):
        for ident in ['1', '0', 'undefined', '-1', 'title', '١']:
            value = metadata(); value['windows'][0]['tabs'][1]['tab_id'] = ident
            row = tabs.surfaces(value, APP, False)[1]
            self.assertEqual(row['identity'], 'metadata_only', ident)

    def test_unknown_attention_is_not_inferred_from_unselected(self):
        self.assertEqual(tabs.surfaces(metadata(), APP)[1]['human_active'], 'unknown')

    def test_native_tab_move_preserves_resource_key(self):
        def key(row):
            return lock.resource_key('d', row['app_id'], row['window_id'], row['kind'], row['tab_id'],
                                     row['instance_id'], row['identity_namespace'])
        first = tabs.surfaces(metadata(), APP, False)[1]
        self.assertEqual(key(first), key({**first, 'window_id': 'other'}))
        self.assertNotEqual(key(first), key({**first, 'instance_id': '42:restarted'}))

    def test_native_and_cdp_ids_cannot_create_competing_owners(self):
        row = {**tabs.surfaces(metadata(), APP, False)[0], 'device_id': 'd'}
        self.assertTrue(lock.conflicts(row, {**row, 'identity_namespace': 'cdp', 'tab_id': 'unmapped'}))

    def test_background_native_tab_admits_but_requires_an_action_driver(self):
        cfg = {'devices': {'d': {'kind': 'local', 'platform': 'macos', 'user_active': True}}}
        rows = tabs.surfaces(metadata(), APP, True)
        snapshot = {'observed_at': time.time(), 'surfaces': rows}
        with mock.patch.object(surfaces, 'load_config', return_value=cfg), \
             mock.patch.object(control, 'device_snapshot', return_value=snapshot):
            self.assertEqual(surfaces.resolve({**rows[1], 'device_id': 'd'})['tab_id'], '2')
            with self.assertRaisesRegex(ValueError, 'human_active'):
                surfaces.resolve({**rows[0], 'device_id': 'd'})
            with self.assertRaisesRegex(ValueError, 'background action route'):
                surfaces.resolve({**rows[1], 'device_id': 'd'}, admission=False)

    def test_schema_is_detected_from_installed_dictionary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'Renamed Browser.app/Contents'
            (root / 'Resources').mkdir(parents=True)
            with (root / 'Info.plist').open('wb') as out:
                plistlib.dump({'OSAScriptingDefinition': 'browser.sdef'}, out)
            xml = '<dictionary><suite><class name="tab">{}</class></suite></dictionary>'
            file = root / 'Resources/browser.sdef'
            file.write_text(xml.format('<property name="id" access="r"><cocoa key="uniqueID"/></property><property name="title"/><property name="URL"/>'))
            self.assertEqual(tabs.schema(root / 'MacOS/browser'), 'chromium')
            file.write_text(xml.format('<property name="name"/><property name="URL"/><property name="index"/>'))
            self.assertEqual(tabs.schema(root / 'MacOS/browser'), 'safari')
            file.write_text(xml.format('<property name="title"/>'))
            with self.assertRaisesRegex(ValueError, 'does not expose'):
                tabs.schema(root / 'MacOS/browser')
            file.write_text('malformed')
            with self.assertRaisesRegex(ValueError, 'invalid browser'):
                tabs.schema(root / 'MacOS/browser')

    def enrich(self, protocol=None, generation='42:birth'):
        value = {'apps': {'browser': APP}, 'surfaces': [], 'active': {'app_id': 'other'}}
        with mock.patch.object(desktop.platform, 'system', return_value='Darwin'), \
             mock.patch.object(context, 'engine_for', return_value='chromium'), \
             mock.patch.object(context, 'default_browser', return_value={}), \
             mock.patch.object(context, 'metadata', return_value=metadata()), \
             mock.patch.object(desktop, 'generation', return_value=generation), \
             mock.patch.object(context, 'command_json', side_effect=ValueError('no CDP') if protocol is None else None, return_value=protocol):
            return desktop.enrich(value)

    def test_protocol_failure_preserves_complete_native_interface(self):
        result = self.enrich()
        self.assertEqual(len(result['surfaces']), 2)
        self.assertEqual(result['browsers'][0]['status'], 'inventoried')
        self.assertEqual(result['browsers'][0]['tab_inventories'][0]['status'], 'complete')
        self.assertFalse(result['tab_inventory']['whole_browser_complete'])

    def test_partial_protocol_cannot_discard_native_tabs(self):
        result = self.enrich({'surfaces': [{'kind': 'browser-tab', 'tab_id': 'cdp-id'}], 'protocol': 'cdp',
                             'tab_inventory': {'status': 'partial', 'scope': 'cdp_connection'}})
        self.assertEqual(len(result['surfaces']), 3)
        self.assertEqual(sum(r.get('alternative_inventory') is True for r in result['surfaces']), 2)
        self.assertEqual(len(result['browsers'][0]['tab_inventories']), 2)
        self.assertEqual(result['browsers'][0]['tab_inventory']['status'], 'partial')

    def test_restart_during_native_read_discards_stale_identity(self):
        result = self.enrich(generation='42:new-birth')
        self.assertEqual(result['surfaces'], [])
        self.assertEqual(result['browsers'][0]['tab_inventory']['status'], 'unavailable')

    def test_exact_tabs_are_not_proof_of_complete_coverage(self):
        report = setup.capabilities({'native_app_id': APP['app_id']}, {'surfaces': tabs.surfaces(metadata(), APP)})
        self.assertFalse(report['tab_inventory']['whole_browser_complete'])
        self.assertFalse(report['locking']['requires_cdp_or_bidi'])

    def test_native_application_scope_available_without_any_tab_provider(self):
        row = {**APP, 'kind': 'window', 'window_id': 'native', 'identity': 'exact'}
        report = setup.capabilities({'native_app_id': APP['app_id']}, {'surfaces': [row]})
        self.assertTrue(report['locking']['application_scope_available'])
        self.assertFalse(report['locking']['exact_tab_identity_available'])

    def test_normalization_preserves_coverage(self):
        raw = {'tab_inventory': {'status': 'partial', 'scope': 'detected_browser_processes'}}
        value = control.normalize_state(raw, {'id': 'd', 'kind': 'local'})
        self.assertEqual(value['tab_inventory'], raw['tab_inventory'])

    def test_tabs_command_uses_native_and_external_routes_without_cdp(self):
        import config
        rows = tabs.surfaces(metadata('safari'), APP)
        cfg = {'devices': {'d': {'kind': 'local'}}}
        with mock.patch.object(config, 'load_config', return_value=cfg), \
             mock.patch.object(control, 'device_snapshot', return_value={'surfaces': rows}), \
             mock.patch.object(runtime, 'default_browser', return_value={'native_app_id': 'browser'}), \
             mock.patch.object(runtime, 'emit') as emit:
            self.assertEqual(runtime.main(['tabs']), 0)
        self.assertEqual(emit.call_args.args, ('metadata_only',))
        self.assertEqual(emit.call_args.kwargs['surfaces'], rows)

    def test_application_fallback_uses_native_identity_and_blocks_human_use(self):
        cfg = {'devices': {'d': {'kind': 'local', 'platform': 'macos', 'user_active': True}}}
        native = {**APP, 'kind': 'window', 'window_id': '10', 'identity': 'exact', 'provider': 'macos',
                  'human_active': False, 'capabilities': {'background_actions': True}}
        snapshot = {'observed_at': time.time(), 'surfaces': [native, *tabs.surfaces(metadata('safari'), APP)]}
        request = {**APP, 'device_id': 'd', 'kind': 'app', 'window_id': '*'}
        with mock.patch.object(surfaces, 'load_config', return_value=cfg), \
             mock.patch.object(control, 'device_snapshot', return_value=snapshot):
            row = surfaces.resolve(request)
            self.assertEqual(row['kind'], 'app')
            self.assertNotIn('tab_id', row)
            self.assertTrue(lock.conflicts(row, {**tabs.surfaces(metadata(), APP)[1], 'device_id': 'd'}))
            native['human_active'] = True
            with self.assertRaisesRegex(ValueError, 'human_'):
                surfaces.resolve(request)


class ScriptTests(unittest.TestCase):
    def test_actual_shared_script_with_browser_contracts_and_races(self):
        fixture = r'''
function tests() {
    function app(mode, changing, broken, selected) {
        var rounds = 0;
        var list = function () { return [{}, {}]; };
        list.id = function () { rounds++; return changing && rounds > 1 ? [1, 3] : [1, 2]; };
        Object.defineProperty(list, mode === "chromium" ? "title" : "name", {value: function () { return ["Same", "Same"]; }});
        list.url = function () { if (broken) throw Error("closed"); return ["https://one.invalid", "https://two.invalid"]; };
        var windows = function () {};
        windows.id = function () { return [10]; };
        windows.byId = function () { return {tabs: list, activeTab: {id: function () { return selected === undefined ? 1 : selected; }}}; };
        return {windows: windows};
    }
    return {
        chromium: collectTabs(app("chromium"), "chromium"),
        safari: collectTabs(app("safari"), "safari"),
        moved: collectTabs(app("chromium", true), "chromium"),
        broken: collectTabs(app("chromium", false, true), "chromium"),
        unknown_selection: collectTabs(app("chromium", false, false, 999), "chromium")
    };
}
'''
        code = tabs.SCRIPT.read_text() + fixture
        node = shutil.which('node')
        if node:
            command = [node, '-e', code + '\nconsole.log(JSON.stringify(tests()));']
        elif platform.system() == 'Darwin':
            command = ['/usr/bin/osascript', '-l', 'JavaScript', '-e', code + '\nfunction run(){return JSON.stringify(tests());}']
        else:
            self.skipTest('JavaScript engine unavailable; native script executes only on macOS')
        result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=5)
        values = json.loads(result.stdout)
        self.assertEqual(values['chromium']['windows'][0]['tabs'][1]['tab_id'], '2')
        self.assertEqual(values['safari']['windows'][0]['tabs'][1]['title'], 'Same')
        self.assertNotIn('tab_id', values['safari']['windows'][0]['tabs'][1])
        self.assertEqual(values['moved']['tab_inventory']['status'], 'partial')
        self.assertNotIn('tab_id', values['moved']['windows'][0]['tabs'][0])
        self.assertEqual(values['broken']['tab_inventory']['status'], 'partial')
        self.assertEqual(len(values['broken']['windows'][0]['tabs']), 2)
        self.assertEqual(values['unknown_selection']['windows'][0]['tabs'][1]['selected'], 'unknown')
