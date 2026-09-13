"""Real socket framing and subprocess bounds, including troublesome failures."""
import base64
import hashlib
import json
import socket
import struct
import subprocess
import sys
import threading
import time
import unittest
from transport import WebSocket, command_json


class TransportTests(unittest.TestCase):
    def server(self, respond):
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen()
        self.addCleanup(listener.close)
        port=listener.getsockname()[1]
        errors=[]
        def run():
            try:
                conn,_=listener.accept()
                with conn:
                    conn.settimeout(2)
                    respond(conn)
            except (OSError, ValueError) as exc:
                errors.append(str(exc))
        thread=threading.Thread(target=run,daemon=True);thread.start()
        self.addCleanup(lambda: thread.join(timeout=2))
        return f'ws://127.0.0.1:{port}/session'

    def handshake(self, conn, suffix=b''):
        raw=b''
        while b'\r\n\r\n' not in raw: raw+=conn.recv(1024)
        key=next(line.split(b': ',1)[1] for line in raw.split(b'\r\n') if line.startswith(b'Sec-WebSocket-Key:'))
        accept=base64.b64encode(hashlib.sha1(key+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
        conn.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+b'\r\n\r\n'+suffix)

    def test_eof_during_handshake_terminates(self):
        url=self.server(lambda conn: None)
        with self.assertRaises((ValueError, OSError)):
            WebSocket(url,timeout=.3)

    def test_fragmentation_ping_and_handshake_coalescing(self):
        def respond(conn):
            self.handshake(conn,b'\x01\x05{"id"'+b'\x89\x01x'+b'\x80\x10:1,"result":{}}')
            time.sleep(.1)
        # Construct frame length independently to exercise buffering exactly.
        def respond(conn):
            first=b'{"id"';last=b':1,"result":{}}'
            self.handshake(conn,bytes([1,len(first)])+first+b'\x89\x01x'+bytes([128,len(last)])+last)
            time.sleep(.1)
        with WebSocket(self.server(respond),timeout=1) as ws:
            self.assertEqual(ws.call('example'),{})

    def test_oversized_frame_is_rejected_before_reading_body(self):
        def respond(conn):
            self.handshake(conn,b'\x81\x7f'+struct.pack('!Q',10**12))
            time.sleep(.1)
        with WebSocket(self.server(respond),timeout=1) as ws:
            with self.assertRaisesRegex(ValueError,'too large'): ws.call('example')

    def test_irrelevant_events_cannot_extend_global_deadline(self):
        def respond(conn):
            self.handshake(conn)
            for _ in range(50):
                conn.sendall(b'\x81\x02{}');time.sleep(.02)
        started=time.monotonic()
        with WebSocket(self.server(respond),timeout=.15) as ws:
            with self.assertRaises((TimeoutError,OSError)): ws.call('never-responds')
        self.assertLess(time.monotonic()-started,.8)

    def test_external_endpoint_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'loopback'): WebSocket('ws://example.com/session')

    def test_subprocess_valid_json(self):
        self.assertEqual(command_json([sys.executable,'-c','print(\'{"apps": {}}\')']),{'apps':{}})

    def test_subprocess_timeout(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            command_json([sys.executable,'-c','import time; time.sleep(5)'],.1)

    def test_output_flood_is_bounded(self):
        with self.assertRaisesRegex(ValueError,'2 MiB'):
            command_json([sys.executable,'-c','import sys; sys.stdout.write("x"*3000000)'])
