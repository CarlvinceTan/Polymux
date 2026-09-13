"""Driver-neutral browser contracts and authoritative human-attention checks."""
import time
import unittest
from unittest import mock
from browser.inventory import cdp_inventory, bidi_inventory
import surfaces

APP = {'native_app_id':'browser'}


class InventoryTests(unittest.TestCase):
    def cdp(self, visibility, foreground=True, broken_window=False):
        def call(method, params):
            if method == 'Target.getTargets':
                return {'targetInfos':[{'type':'page','targetId':'a','title':'Page','url':'https://example.test/a?b=1#c'},
                                       {'type':'worker','targetId':'worker'}]}
            if broken_window: raise ValueError('closed window')
            return {'windowId':7}
        page = mock.Mock(return_value={'result':{'value':visibility}})
        return cdp_inventory(call, page, APP, 'birth', foreground), page

    def test_omnibox_focus_still_protects_visible_tab(self):
        value, page = self.cdp('visible')
        self.assertIs(value['surfaces'][0]['human_active'], True)
        self.assertNotIn('hasFocus', page.call_args.args[2]['expression'])

    def test_background_tab_in_foreground_browser_can_be_leased(self):
        self.assertIs(self.cdp('hidden')[0]['surfaces'][0]['human_active'], False)

    def test_unknown_attention_stays_unknown(self):
        self.assertEqual(self.cdp(None)[0]['surfaces'][0]['human_active'], 'unknown')

    def test_background_browser_needs_no_page_evaluation(self):
        value, page = self.cdp('visible', False)
        self.assertIs(value['surfaces'][0]['human_active'], False)
        page.assert_not_called()

    def test_missing_window_does_not_discard_identified_tabs(self):
        value, _ = self.cdp('hidden', broken_window=True)
        self.assertEqual(len(value['surfaces']), 1)
        self.assertIsNone(value['surfaces'][0]['window_id'])
        self.assertEqual(value['surfaces'][0]['url'], 'https://example.test/a?b=1#c')

    def bidi(self, active, visibility, foreground='unknown'):
        calls=[]
        def call(method, params):
            calls.append(method)
            if method == 'browsingContext.getTree':
                return {'contexts':[{'context':'context-uuid','clientWindow':'window-uuid','url':'https://example.test'}]}
            if method == 'browser.getClientWindows':
                return {'clientWindows':[{'clientWindow':'window-uuid','active':active}]}
            return {'result':{'type':'object','value':[['title',{'type':'string','value':'Firefox page'}],
                                                     ['visibility',{'type':'string','value':visibility}]]}}
        return bidi_inventory(call, APP, 'birth', foreground), calls

    def test_bidi_reads_existing_session_without_creating_one(self):
        result,calls=self.bidi(True,'hidden')
        self.assertEqual(result['surfaces'][0]['title'],'Firefox page')
        self.assertIs(result['surfaces'][0]['human_active'],False)
        self.assertNotIn('session.new',calls)
        self.assertNotIn('browsingContext.activate',calls)

    def test_bidi_active_window_with_visible_tab_is_protected(self):
        self.assertIs(self.bidi(True,'visible')[0]['surfaces'][0]['human_active'],True)

    def test_bidi_background_window_allows_metadata_context(self):
        self.assertIs(self.bidi(False,'visible')[0]['surfaces'][0]['human_active'],False)

    def test_bidi_unknown_visibility_is_not_idle(self):
        self.assertEqual(self.bidi(True,None)[0]['surfaces'][0]['human_active'],'unknown')


class AttentionTests(unittest.TestCase):
    def setUp(self):
        self.request={'device_id':'d','app_id':'app','kind':'window','window_id':'1','instance_id':None}
        self.row={'app_id':'app','kind':'window','window_id':'1','instance_id':'birth','identity':'exact','human_active':False,'capabilities':{'background_actions':True}}
        self.config={'devices':{'d':{'kind':'local','platform':'linux','user_active':True}}}

    def resolve(self, admission=True, age=0):
        with mock.patch.object(surfaces,'load_config',return_value=self.config), \
             mock.patch.object(surfaces,'command_json',return_value={'observed_at':time.time()-age,'surfaces':[self.row]}):
            return surfaces.resolve(self.request, admission=admission)

    def test_background_surface_is_admitted(self):
        self.assertEqual(self.resolve()['instance_id'],'birth')

    def test_current_human_surface_is_denied(self):
        self.row['human_active']=True
        with self.assertRaisesRegex(ValueError,'human_active'): self.resolve()

    def test_unknown_human_surface_is_denied(self):
        self.row['human_active']='unknown'
        with self.assertRaisesRegex(ValueError,'human_attention_unknown'): self.resolve()

    def test_human_use_during_existing_lease_is_allowed(self):
        self.row['human_active']=True
        self.assertIs(self.resolve(admission=False)['human_active'],True)

    def test_stale_state_cannot_authorize(self):
        with self.assertRaisesRegex(ValueError,'fresh authoritative'): self.resolve(age=20)

    def test_metadata_ids_are_not_lockable(self):
        self.row['identity']='metadata_only'
        with self.assertRaisesRegex(ValueError,'exact live identity'): self.resolve()

    def test_agent_owned_has_no_attention_gate(self):
        self.config['devices']['d']['user_active']=False
        self.row['human_active']='unknown'
        self.assertEqual(self.resolve()['identity'],'exact')

    def test_contradictory_native_attention_cannot_allow_admission(self):
        import desktop
        snapshot = {'surfaces': [dict(self.row)], 'active': {'window_id': '1'}, 'apps': {}}
        with mock.patch.object(desktop, 'local_native', return_value=snapshot):
            state = desktop.collect(False)
        self.assertEqual(state['surfaces'][0]['human_active'], 'unknown')

    def test_narrow_edit_check_ignores_unrelated_human_edits(self):
        result=surfaces.check_preconditions({'email':'old'}, {'email':'old','phone':'human edit'})
        self.assertEqual(result['status'],'ready')
        result=surfaces.check_preconditions({'email':'old'}, {'email':'human edit','phone':'old'})
        self.assertEqual(list(result['conflicts']),['email'])
