import json
import io
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from contextlib import ExitStack, redirect_stdout, redirect_stderr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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
        with patch.object(connectors.subprocess, 'run') as vault, patch.object(connectors.NOTION_HTTP, 'open') as network:
            for path in ['/v1/comments', '/v1/comments/abc', '/v1/%63omments', '/v1/pages/../comments']:
                for method in ['GET', 'POST', 'PATCH', 'DELETE']:
                    with self.assertRaises(ValueError): connectors.notion(method, path, {})
            with self.assertRaises(ValueError): connectors.invoke('notion_comment', {})
            self.assertTrue(vault.call_count == 0, 'Rejected operation accessed vault'); network.assert_not_called()

    def reject_writes(self, resource):
        paths = ['/v1/'+resource, '/v1/'+resource+'/'+'a'*32]
        if resource == 'blocks': paths.append(paths[-1]+'/children')
        with patch.object(connectors.subprocess, 'run') as vault, patch.object(connectors.NOTION_HTTP, 'open') as network:
            for path in paths:
                for method in ['POST', 'PATCH', 'DELETE']:
                    with self.subTest(path=path, method=method):
                        with self.assertRaises(ValueError):
                            connectors.invoke('notion_api', {'method':method, 'path':path, 'body':{}})
            self.assertTrue(vault.call_count == 0, 'Rejected operation accessed vault')
            network.assert_not_called()

    def test_notion_rejects_page_write(self):
        self.reject_writes('pages')

    def test_notion_rejects_database_write(self):
        self.reject_writes('databases')

    def test_notion_rejects_block_write(self):
        self.reject_writes('blocks')

    def test_redirect_keeps_token_private_local_server(self):
        token = 'local-test-credential'
        received = []
        authorized = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                if self.server.redirect:
                    authorized.append(self.headers.get('Authorization') == 'Bearer '+token)
                    self.send_response(self.server.status)
                    self.send_header('Location', self.server.redirect)
                else:
                    received.append(self.headers.get('Authorization'))
                    self.send_response(200)
                self.end_headers()
            do_POST = do_GET
        with ExitStack() as stack:
            servers = []
            for _ in range(2):
                server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                servers.append(server)
                server.redirect = None
                stack.callback(server.server_close)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                stack.callback(thread.join)
                stack.callback(server.shutdown)
            origin, destination = servers
            origin.redirect = 'http://127.0.0.1:'+str(destination.server_port)+'/target'
            directory = stack.enter_context(tempfile.TemporaryDirectory())
            vault = Path(directory)/'vault'
            vault.write_text("#!/bin/sh\nprintf '%s\\n' '"+json.dumps({'password':token})+"'\n")
            vault.chmod(0o700)
            original = connectors.NOTION_ORIGIN
            connectors.NOTION_ORIGIN = 'http://127.0.0.1:'+str(origin.server_port)
            stack.callback(setattr, connectors, 'NOTION_ORIGIN', original)
            output = io.StringIO()
            previous_env = {name:os.environ.get(name) for name in ['PATH', 'no_proxy']}
            def restore_env():
                for name, value in previous_env.items():
                    if value is None: os.environ.pop(name, None)
                    else: os.environ[name] = value
            stack.callback(restore_env)
            os.environ['PATH'] = directory
            os.environ['no_proxy'] = '127.0.0.1'
            with redirect_stdout(output), redirect_stderr(output):
                for status in [301, 302, 303, 307, 308]:
                    origin.status = status
                    for method, path in [('GET', '/v1/pages/'+'a'*32), ('POST', '/v1/search')]:
                        result = connectors.notion(method, path, {} if method == 'POST' else None)
                        self.assertFalse(result['available'])
                        self.assertTrue(token not in json.dumps(result))
            self.assertTrue(token not in output.getvalue())
            self.assertEqual(len(authorized), 10)
            self.assertTrue(all(authorized))
            self.assertTrue(not received, 'Redirect destination received a request')

    def test_notion_credential_is_private(self):
        from subprocess import CompletedProcess
        from unittest.mock import MagicMock
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"text":"private-test-value"}'
        with patch.object(connectors.subprocess, 'run', return_value=CompletedProcess([], 0, '{"password":"private-test-value"}', '')) as vault, patch.object(connectors.NOTION_HTTP, 'open', return_value=response) as network:
            result = connectors.notion('GET', '/v1/pages/'+'a'*32)
            self.assertTrue(result['available'])
            self.assertTrue('private-test-value' not in json.dumps(result))
            self.assertTrue(network.call_args.args[0].get_header('Authorization') == 'Bearer private-test-value')
            self.assertEqual(vault.call_args.args[0][1:3], ['get', 'Notion - Polymux integration token'])

    def test_notion_allows_only_read_operations(self):
        from unittest.mock import MagicMock
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"results":[]}'
        credential = subprocess.CompletedProcess([], 0, '{"password":"test-value"}', '')
        with patch.object(connectors.subprocess, 'run', return_value=credential) as vault, patch.object(connectors.NOTION_HTTP, 'open', return_value=response) as network:
            for method, path in [('GET', '/v1/pages/'+'a'*32), ('GET', '/v1/databases/'+'a'*32), ('GET', '/v1/blocks/'+'a'*32+'/children'), ('POST', '/v1/databases/'+'a'*32+'/query'), ('POST', '/v1/search')]:
                with self.subTest(method=method, path=path):
                    self.assertTrue(connectors.notion(method, path, {})['available'])
            self.assertEqual(vault.call_count, 5)
            self.assertEqual(network.call_count, 5)
            for resource in ['pages', 'blocks']:
                with self.assertRaises(ValueError):
                    connectors.notion('POST', '/v1/'+resource+'/'+'a'*32+'/query', {})
            self.assertEqual(vault.call_count, 5)
            self.assertEqual(network.call_count, 5)
        methods = connectors.TOOLS['notion_api'][1]['method']['enum']
        self.assertEqual(methods, ['GET', 'POST'])

    def test_notion_denies_delete_and_external_paths(self):
        with patch.object(connectors.subprocess, 'run') as vault:
            for method, path in [('DELETE','/v1/pages/'+'a'*32), ('POST','https://example.com'), ('GET','/v1/users'), ('POST','/v1/blocks/'+'a'*32+'/children')]:
                with self.assertRaises(ValueError): connectors.notion(method, path)
            self.assertTrue(vault.call_count == 0, 'Rejected operation accessed vault')

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
            with patch.object(connectors.NOTION_HTTP,'open') as network:
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
        for provider in ['opencode','cursor-agent']:
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
            if request['model']!='local/cursor-agent':raise ValueError('provider_unavailable')
            return ('ok',[])
        with patch.object(model_bridge,'infer_once',side_effect=run), patch.object(model_bridge,'audit_event') as log, patch.object(model_bridge.time,'sleep') as sleep:
            request={'model':'local/opencode','messages':[]}
            self.assertEqual(model_bridge.infer(request),('ok',[]))
            self.assertEqual(seen,['local/opencode']*3+['local/cursor-agent'])
            self.assertEqual([c.args[0] for c in sleep.call_args_list],[1,2])
            self.assertEqual(request['_answered_provider'],'cursor-agent')
            self.assertEqual(log.call_args.args[0]['provider'],'cursor-agent')

    def test_invalid_tool_retries_then_fails_over(self):
        seen=[]
        def run(request):
            seen.append(request['model'])
            if request['model']=='local/opencode':raise ValueError('invalid_tool')
            return ('ok',[])
        with patch.object(model_bridge,'infer_once',side_effect=run), patch.object(model_bridge,'audit_event'), patch.object(model_bridge.time,'sleep'):
            self.assertEqual(model_bridge.infer({'model':'local/opencode'}),('ok',[]))
            self.assertEqual(seen,['local/opencode']*3+['local/cursor-agent'])

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
            self.assertEqual(run.call_count,6)

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
