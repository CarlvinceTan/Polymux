import json
import threading
import unittest
import urllib.request
from unittest.mock import patch
from http.server import ThreadingHTTPServer

import connectors
import model_bridge
import shadow

class SafetyTests(unittest.TestCase):
    def test_unknown_connector_cannot_send(self):
        with self.assertRaises(ValueError):connectors.invoke('mail_send',{})
        with self.assertRaises(ValueError):connectors.invoke('matrix_send',{})

    def test_argument_cannot_inject_cli_option(self):
        with self.assertRaises(ValueError):connectors.invoke('mail_read',{'id':'--seen'})

    def test_shadow_denies_send(self):
        with self.assertRaises(shadow.Denied):shadow.dispatch('SendEmail',{}, {})
        self.assertTrue(shadow.dispatch('WebSearch',{}, {})['fixture_miss'])

    def test_bridge_streams_tool_calls(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),model_bridge.Handler)
        thread=threading.Thread(target=server.serve_forever);thread.start()
        call={'id':'call_test','type':'function','function':{'name':'recall_memory','arguments':'{}'}}
        try:
            with patch.object(model_bridge,'infer',return_value=('',[call])):
                request=urllib.request.Request('http://127.0.0.1:'+str(server.server_port)+'/v1/chat/completions',data=json.dumps({'stream':True,'messages':[]}).encode())
                with urllib.request.urlopen(request) as response:text=response.read().decode()
            packets=[json.loads(l[6:]) for l in text.splitlines() if l.startswith('data: {')]
            self.assertEqual(packets[0]['choices'][0]['delta']['tool_calls'][0]['index'],0)
            self.assertEqual(packets[1]['choices'][0]['finish_reason'],'tool_calls')
            self.assertIn('data: [DONE]',text)
        finally:server.shutdown();thread.join();server.server_close()

    def test_bridge_rejects_unsupported_provider(self):
        with self.assertRaisesRegex(ValueError,'unsupported_provider'):model_bridge.infer({'model':'untrusted','messages':[]})

if __name__=='__main__':unittest.main()
