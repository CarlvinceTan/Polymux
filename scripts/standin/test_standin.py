import json
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import cli_env
import connectors
import model_bridge

class SafetyTests(unittest.TestCase):
    def test_unknown_connector_cannot_send(self):
        with self.assertRaises(ValueError):connectors.invoke('mail_send',{})
        with self.assertRaises(ValueError):connectors.invoke('matrix_send',{})

    def test_notion_comments_denied(self):
        with patch.object(connectors.subprocess, 'run') as vault, patch.object(connectors.urllib.request, 'urlopen') as network:
            for path in ['/v1/comments', '/v1/comments/abc', '/v1/%63omments', '/v1/pages/../comments']:
                for method in ['GET', 'POST', 'PATCH', 'DELETE']:
                    with self.assertRaises(ValueError): connectors.notion(method, path, {})
            with self.assertRaises(ValueError): connectors.invoke('notion_comment', {})
            vault.assert_not_called(); network.assert_not_called()

    def test_notion_credential_is_private(self):
        from subprocess import CompletedProcess
        from unittest.mock import MagicMock
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"text":"private-test-value"}'
        with patch.object(connectors.subprocess, 'run', return_value=CompletedProcess([], 0, '{"password":"private-test-value"}', '')) as vault, patch.object(connectors.urllib.request, 'urlopen', return_value=response) as network:
            result = connectors.notion('GET', '/v1/pages/'+'a'*32)
            self.assertTrue(result['available'])
            self.assertNotIn('private-test-value', json.dumps(result))
            self.assertEqual(network.call_args.args[0].get_header('Authorization'), 'Bearer private-test-value')
            self.assertEqual(vault.call_args.args[0][1:3], ['get', 'Notion - Polymux integration token'])

    def test_notion_denies_delete_and_external_paths(self):
        with patch.object(connectors.subprocess, 'run') as vault:
            for method, path in [('DELETE','/v1/pages/'+'a'*32), ('POST','https://example.com'), ('GET','/v1/users'), ('POST','/v1/blocks/'+'a'*32+'/children')]:
                with self.assertRaises(ValueError): connectors.notion(method, path)
            vault.assert_not_called()

    def test_argument_cannot_inject_cli_option(self):
        with self.assertRaises(ValueError):connectors.invoke('mail_read',{'id':'--seen'})

    def test_bridge_streams_tool_calls(self):
        body=json.dumps({'stream':True,'messages':[]}).encode()
        handler=model_bridge.Handler.__new__(model_bridge.Handler)
        handler.path='/v1/chat/completions'
        handler.headers={'Content-Length':str(len(body))}
        handler.rfile=io.BytesIO(body)
        handler.wfile=io.BytesIO()
        call={'id':'call_test','type':'function','function':{'name':'recall_memory','arguments':'{}'}}
        with patch.object(model_bridge,'infer',return_value=('',[call])), patch.object(handler,'send_response') as status, patch.object(handler,'send_header') as header, patch.object(handler,'end_headers') as end:
            handler.do_POST()
        status.assert_called_once_with(200)
        self.assertEqual(header.call_count,2)
        header.assert_any_call('Content-Type','text/event-stream')
        header.assert_any_call('Cache-Control','no-cache')
        end.assert_called_once_with()
        text=handler.wfile.getvalue().decode()
        packets=[json.loads(l[6:]) for l in text.splitlines() if l.startswith('data: {')]
        self.assertEqual(packets[0]['choices'][0]['delta']['tool_calls'][0]['index'],0)
        self.assertEqual(packets[1]['choices'][0]['finish_reason'],'tool_calls')
        self.assertIn('data: [DONE]',text)

    def test_bridge_rejects_unsupported_provider(self):
        with self.assertRaisesRegex(ValueError,'unsupported_provider'):model_bridge.infer({'model':'untrusted','messages':[]})

class EnvironmentTests(unittest.TestCase):
    def test_desktop_cli_lookup(self):
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory)
            binary=home/'.local/bin/standin-test-cli'
            binary.parent.mkdir(parents=True)
            binary.write_text('#!/bin/sh\nprintf found')
            binary.chmod(0o700)
            with patch.object(cli_env.Path,'home',return_value=home), patch.dict(os.environ,{'PATH':'/usr/bin:/bin:/usr/sbin:/sbin'}):
                result=connectors.command(['standin-test-cli'])
            self.assertTrue(result['available'])
            self.assertEqual(result['result'],'found')

    def test_custom_path_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'PATH':directory}):
            self.assertEqual(cli_env.environment()['PATH'].split(os.pathsep)[0],directory)

    def test_missing_connector_is_unavailable(self):
        with patch.object(connectors.subprocess,'run',side_effect=FileNotFoundError('private diagnostic')):
            self.assertFalse(connectors.command(['hub','rooms'])['available'])
            with patch.object(connectors.urllib.request,'urlopen') as network:
                result=connectors.notion('GET','/v1/pages/'+'a'*32)
                self.assertEqual(result,{'available':False,'message':'Notion credential unavailable.'})
                network.assert_not_called()

    def test_vault_uses_cli_environment(self):
        env={'PATH':'test-bin'}
        with patch.object(connectors,'environment',return_value=env), patch.object(connectors.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'','')) as vault:
            self.assertFalse(connectors.notion('GET','/v1/pages/'+'a'*32)['available'])
            self.assertEqual(vault.call_args.kwargs['env'],env)

    def test_providers_use_cli_environment(self):
        reply=json.dumps({'content':'ok','tool_calls':[]})
        for provider in ['opencode','cursor-agent','codex']:
            with self.subTest(provider=provider), tempfile.TemporaryDirectory() as directory:
                env={'PATH':'test-bin'}
                stdout=json.dumps({'result':reply}) if provider=='cursor-agent' else json.dumps({'type':'item.completed','item':{'type':'agent_message','text':reply}})
                with patch.object(model_bridge,'WORK',Path(directory)/'workspace'), patch.object(model_bridge,'environment',return_value=env), patch.object(model_bridge,'provider_run',return_value=subprocess.CompletedProcess([],0,stdout,'')) as run, patch.object(model_bridge,'opencode',return_value=reply) as opencode:
                    self.assertEqual(model_bridge.infer_once({'model':provider}),('ok',[]))
                    runner=opencode if provider=='opencode' else run
                    self.assertEqual(runner.call_args.args[1]['PATH'],'test-bin')

class RetryTests(unittest.TestCase):
    def test_backoff_then_ordered_failover(self):
        seen=[]
        def run(request):
            seen.append(request['model'])
            if request['model']!='local/codex':raise ValueError('provider_unavailable')
            return ('ok',[])
        with patch.object(model_bridge,'infer_once',side_effect=run), patch.object(model_bridge,'audit_event') as log, patch.object(model_bridge.time,'sleep') as sleep:
            request={'model':'local/opencode','messages':[]}
            self.assertEqual(model_bridge.infer(request),('ok',[]))
            self.assertEqual(seen,['local/opencode']*3+['local/cursor-agent']*3+['local/codex'])
            self.assertEqual([c.args[0] for c in sleep.call_args_list],[1,2,1,2])
            self.assertEqual(request['_answered_provider'],'codex')
            self.assertEqual(log.call_args.args[0]['provider'],'codex')

    def test_transient_recovers_without_failover(self):
        with patch.object(model_bridge,'infer_once',side_effect=[ValueError('provider_timeout'),('ok',[])]) as run, patch.object(model_bridge,'audit_event'), patch.object(model_bridge.time,'sleep'):
            self.assertEqual(model_bridge.infer({'model':'local/opencode'}),('ok',[]))
            self.assertEqual(run.call_count,2)

    def test_safety_failure_is_not_retried(self):
        for reason in ['credential_input','credential_output','native_tool_rejected','request_size']:
            with patch.object(model_bridge,'infer_once',side_effect=ValueError(reason)) as run, patch.object(model_bridge,'audit_event'), patch.object(model_bridge.time,'sleep') as sleep:
                with self.assertRaisesRegex(ValueError,reason):model_bridge.infer({'model':'local/opencode'})
                self.assertEqual(run.call_count,1);sleep.assert_not_called()

    def test_exhaustion_is_bounded(self):
        with patch.object(model_bridge,'infer_once',side_effect=ValueError('provider_error')) as run, patch.object(model_bridge,'audit_event'), patch.object(model_bridge.time,'sleep'):
            with self.assertRaisesRegex(ValueError,'provider_unavailable'):model_bridge.infer({'model':'local/opencode'})
            self.assertEqual(run.call_count,9)

    def test_missing_cli_can_fail_over(self):
        with patch.object(model_bridge,'infer_once',side_effect=[FileNotFoundError('missing')]*3+[('ok',[])]) as run, patch.object(model_bridge,'audit_event'), patch.object(model_bridge.time,'sleep'):
            request={'model':'local/opencode'}
            self.assertEqual(model_bridge.infer(request),('ok',[]))
            self.assertEqual(request['_answered_provider'],'cursor-agent')

    def test_context_keeps_system_and_current_tool_chain(self):
        messages=[{'role':'system','content':'policy'}]+[{'role':'user','content':'old'*20000},{'role':'assistant','content':'old'*20000}]*5
        current=[{'role':'user','content':'current memory and question'},{'role':'assistant','tool_calls':[{'id':'call'}]},{'role':'tool','tool_call_id':'call','content':'result'}]
        with patch.object(model_bridge,'audit_event'):
            result=model_bridge.bounded_request({'messages':messages+current})
        self.assertEqual(result['messages'][0],messages[0])
        self.assertEqual(result['messages'][-3:],current)
        self.assertLess(len(json.dumps(result).encode()),100000)

if __name__=='__main__':unittest.main()
