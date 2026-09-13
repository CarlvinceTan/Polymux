"""Native tab fallback must preserve labels, scope, and process identity."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from browser import accessibility, context, engine_for
import desktop

APP = {'app_id': 'browser', 'instance_id': '42:birth', 'pid': 42, 'path': '/example/browser',
       'name': 'Browser', 'session_id': 's', 'windows': [{'window_id': '10'}]}


class AccessibilityTests(unittest.TestCase):
    def collect(self, report=None, generation='42:birth', read=None):
        value = {'apps': {'b': dict(APP)}, 'surfaces': []}
        if report is None:
            report = {**APP, 'windows': [{'window_id': '10', 'tabs': [
                {'title': 'Same', 'selected': True}, {'title': 'Same', 'selected': False}]}]}
        with mock.patch.object(accessibility, 'candidates', return_value=list(value['apps'].values())), \
             mock.patch.object(desktop, 'generation', return_value=generation):
            return accessibility.attach(value, read or (lambda apps: {'apps': [report]}))

    def test_titles_are_retained_without_inventing_urls_or_ids(self):
        value = self.collect()
        self.assertEqual(len(value['surfaces']), 2)
        for row in value['surfaces']:
            self.assertNotIn('url', row)
            self.assertNotIn('tab_id', row)
            self.assertEqual(row['url_status'], 'unavailable')
            self.assertEqual(row['identity'], 'metadata_only')
            self.assertFalse(row['capabilities']['background_actions'])
        self.assertEqual(value['apps']['b']['native_tab_inventory']['status'], 'partial')

    def test_restart_discards_metadata(self):
        value = self.collect(generation='42:new')
        self.assertEqual(value['surfaces'], [])
        self.assertEqual(value['apps']['b']['native_tab_inventory']['status'], 'unavailable')

    def test_wrong_instance_or_window_cannot_supply_tabs(self):
        for report in [{**APP, 'instance_id': 'other'},
                       {**APP, 'windows': [{'window_id': '99', 'tabs': [{'title': 'Wrong'}]}]}]:
            self.assertEqual(self.collect(report)['surfaces'], [])

    def test_inaccessible_collector_explains_gap(self):
        def read(apps):
            raise ValueError('permission unavailable')
        value = self.collect(read=read)
        self.assertIn('permission unavailable', value['apps']['b']['native_tab_inventory']['reason'])

    def test_accessible_window_without_native_id_remains_metadata(self):
        report = {**APP, 'windows': [{'window_identity': 'metadata_only', 'window_title': 'Browser',
                                    'tabs': [{'title': 'A'}]}]}
        row = self.collect(report)['surfaces'][0]
        self.assertNotIn('window_id', row)
        self.assertEqual(row['window_title'], 'Browser')

    def test_protocol_failure_preserves_native_coverage(self):
        report = self.collect()['apps']['b']['native_tab_inventory']
        merged = context.merge_inventory({'status': 'unavailable', 'native_tab_inventory': report}, None, [])
        self.assertEqual(merged['status'], 'metadata_only')
        self.assertEqual(merged['tab_inventory']['status'], 'partial')
        self.assertEqual(merged['tab_inventories'][0]['source'], 'native_accessibility')

    def test_unavailable_is_not_partial(self):
        merged = context.merge_inventory({'native_tab_inventory': {'status': 'unavailable'}}, None, [])
        self.assertEqual(merged['tab_inventory']['status'], 'unavailable')

    def test_partial_native_coverage_survives_protocol_timeout(self):
        value = self.collect()
        accessibility.retain_inventory(value)
        self.assertEqual(value['tab_inventory']['status'], 'partial')
        self.assertEqual(value['browsers'][0]['tab_inventories'][0]['count'], 2)
        self.assertEqual(len(value['surfaces']), 2)

    def test_reported_selected_url_is_redacted(self):
        report = {**APP, 'windows': [{'window_id': '10', 'tabs': [{'title': 'A',
            'url': 'https://example.invalid/?token=secret#private', 'url_status': 'available'}]}]}
        row = self.collect(report)['surfaces'][0]
        self.assertEqual(row['url_status'], 'available')
        self.assertNotIn('secret', row['url'])
        self.assertNotIn('private', row['url'])

    def test_linux_reads_all_accessible_windows_and_skips_web_documents(self):
        from types import SimpleNamespace as NS
        from linux import tabs
        roles = NS(FRAME=1, WINDOW=2, DOCUMENT_WEB=3, DOCUMENT_FRAME=4,
                   DOCUMENT_TEXT=5, EMBEDDED=6, PAGE_TAB=7)
        class Node:
            def __init__(self, role=0, name='', children=()):
                self.role, self.name, self.children = role, name, children
            def get_role(self): return self.role
            def get_name(self): return self.name
            def get_child_count(self): return len(self.children)
            def get_child_at_index(self, index): return self.children[index]
            def get_process_id(self): return 42
            def get_state_set(self): return NS(contains=lambda state: False)
        document = Node(roles.DOCUMENT_WEB, children=[Node(roles.PAGE_TAB, 'Web page widget')])
        application = Node(children=[Node(roles.FRAME, 'First', [Node(roles.PAGE_TAB, 'A'), document]),
                                     Node(roles.FRAME, 'Second', [Node(roles.PAGE_TAB, 'B')])])
        api = NS(Role=roles, StateType=NS(SELECTED=1), set_timeout=lambda *args: None,
                 get_desktop=lambda index: Node(children=[application]))
        with mock.patch.dict(sys.modules, {'gi': NS(require_version=lambda *args: None),
                                          'gi.repository': NS(Atspi=api)}):
            report = tabs.read([APP])['apps'][0]
        self.assertEqual([w['window_title'] for w in report['windows']], ['First', 'Second'])
        self.assertEqual([t['title'] for w in report['windows'] for t in w['tabs']], ['A', 'B'])

    def test_accessibility_and_protocol_views_are_marked_as_alternatives(self):
        value = self.collect()
        browser = {**APP, 'surfaces': [{'kind': 'browser-tab', 'tab_id': 'protocol-id'}],
                   'tab_inventory': {'status': 'complete'}}
        with mock.patch.object(context, 'default_browser', return_value={}), \
             mock.patch.object(context, 'candidates', return_value=[APP]), \
             mock.patch.object(context, 'collect_browser', return_value=browser):
            context.enrich(value)
        native = [r for r in value['surfaces'] if r.get('provider') == 'native_accessibility']
        self.assertTrue(all(r.get('alternative_inventory') for r in native))
        self.assertEqual(len(native), 2)

    def test_macos_gecko_uses_accessibility_without_applescript_consent(self):
        from macos import tabs
        expected = {'schema': 'accessibility', 'windows': []}
        with mock.patch('browser.engine_for', return_value='gecko'), \
             mock.patch.object(tabs, 'accessibility', return_value=expected) as read:
            self.assertEqual(tabs.collect(APP), expected)
        read.assert_called_once_with(APP)

    def test_macos_accessibility_preserves_selection_without_inventing_identity(self):
        from macos import tabs
        metadata = {'schema': 'accessibility', 'source': 'native_accessibility',
                    'windows': [{'window_id': '10', 'tabs': [
                        {'title': 'A', 'selected': True, 'url_status': 'unavailable'},
                        {'title': 'B', 'selected': False, 'url_status': 'available', 'url': 'https://example.invalid'}]}]}
        rows = tabs.surfaces(metadata, APP, False)
        self.assertEqual([r['selected'] for r in rows], [True, False])
        self.assertNotIn('url', rows[0])
        self.assertEqual(rows[1]['url'], 'https://example.invalid')
        self.assertTrue(all(r['identity'] == 'metadata_only' and 'tab_id' not in r for r in rows))

    def test_macos_reports_accessibility_source_and_partial_coverage(self):
        metadata = {'source': 'native_accessibility',
                    'tab_inventory': {'status': 'partial', 'scope': 'accessible_browser_chrome', 'count': 1}}
        value = context.merge_inventory({'status': 'unavailable', 'metadata': metadata}, metadata,
                                        [{'identity': 'metadata_only'}])
        self.assertEqual(value['status'], 'metadata_only')
        self.assertEqual(value['tab_inventories'][0]['source'], 'native_accessibility')
        self.assertEqual(value['tab_inventory']['status'], 'partial')

    def test_windows_collector_does_not_change_execution_policy_or_select_tabs(self):
        from windows import tabs
        with mock.patch.object(tabs, 'attach', side_effect=lambda value, read: read([APP])), \
             mock.patch.object(tabs, 'command_json', return_value={'apps': []}) as call:
            tabs.collect({})
        command = call.call_args.args[0]
        self.assertNotIn('-ExecutionPolicy', command)
        script = command[-1]
        for operation in ('.Select(', '.SetFocus(', '.Invoke(', '.SetValue('):
            self.assertNotIn(operation, script)

    def test_versioned_browser_markers_and_bounded_detection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); exe = root / 'renamed.exe'; exe.touch()
            version = root / '128.0.12.4'; version.mkdir(); (version / 'icudtl.dat').touch()
            with mock.patch.object(Path, 'rglob', side_effect=AssertionError('unbounded traversal')):
                self.assertEqual(engine_for(str(exe), 'unknown'), 'chromium')
                (version / 'icudtl.dat').unlink()
                self.assertEqual(engine_for(str(exe), 'unknown'), 'unknown')


if __name__ == '__main__':
    unittest.main()
