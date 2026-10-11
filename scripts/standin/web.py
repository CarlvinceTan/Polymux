#!/usr/bin/env python3
"""Small tailnet chat surface for hosts without the SwiftUI app."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import urllib.request
import urllib.error
from pathlib import Path

API='http://100.79.157.110:8787'
PAGE=Path(__file__).with_name('chat.html')

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        if self.path=='/':
            data=PAGE.read_bytes(); self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'")
            self.send_header('Content-Length',str(len(data)));self.end_headers(); self.wfile.write(data);return
        self.proxy()
    def do_POST(self):
        origin=self.headers.get('Origin')
        if origin and origin!='http://'+self.headers.get('Host',''):
            self.send_error(403);return
        self.proxy()
    def proxy(self):
        if not re.fullmatch(r'/api/(agents|threads|threads/[a-zA-Z0-9_-]+/(messages|stop)|agents/[a-zA-Z0-9_-]+/routines)(\?[^\s]*)?',self.path):self.send_error(404);return
        path=self.path[4:]
        if self.command=='POST' and not re.fullmatch(r'/threads/[a-zA-Z0-9_-]+/(messages|stop)',path):self.send_error(403);return
        size=int(self.headers.get('Content-Length','0'))
        if size>100000:self.send_error(413);return
        data=self.rfile.read(size) if self.command=='POST' else None
        req=urllib.request.Request(API+path,data=data,method=self.command,headers={'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req,timeout=30) as response:payload=response.read();status=response.status
        except urllib.error.HTTPError as e:payload=e.read();status=e.code
        except Exception:payload=json.dumps({'message':'Server unavailable. Retry shortly.'}).encode();status=503
        self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(payload)

if __name__=='__main__':ThreadingHTTPServer(('100.79.157.110',8788),Handler).serve_forever()
