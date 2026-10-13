#!/usr/bin/env python3
"""PR #42 UI-evidence proxy: forwards everything to the verify fixture server except
POST /threads, whose reply is controlled by a mode file so the real app can be captured
while a new chat is still in flight (stall) and after creation fails (fail).

usage: proxy.py <listen> <upstream> <control-dir>
control files: mode (pass|stall|fail), hold (seconds, default 6)
"""
import http.client
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN = sys.argv[1]
UPSTREAM_HOST, UPSTREAM_PORT = sys.argv[2].rsplit(":", 1)
CONTROL = sys.argv[3]
LOG_LOCK = threading.Lock()


def control(name, default):
    try:
        with open(os.path.join(CONTROL, name)) as f:
            return f.read().strip()
    except OSError:
        return default


def log(line):
    with LOG_LOCK:
        print(time.strftime("%H:%M:%S") + " " + line, flush=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        self.forward()

    def do_PUT(self):
        self.forward()

    def do_PATCH(self):
        self.forward()

    def do_DELETE(self):
        self.forward()

    def do_POST(self):
        kind = "pass"
        if self.path in ("/threads", "/agents") and not self.headers.get("Upgrade"):
            mode = control("mode", "pass")
            hold = float(control("hold", "6"))
            if mode == "stall":
                kind = "stall"
            elif mode == "fail":
                kind = "fail"
        if kind == "pass":
            self.forward()
            return
        started = time.monotonic()
        log(f"POST {self.path} {kind} hold={hold:.1f}s")
        # Drain the body first: an unread body would corrupt the next request on a reused connection.
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        deadline = started + (hold if kind == "stall" else 0.3)
        while time.monotonic() < deadline:
            time.sleep(0.1)
        body = b'{"code":"forced","message":"forced failure"}'
        self.send_response(500)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        log(f"POST {self.path} {kind} -> 500 after {time.monotonic() - started:.2f}s")

    def forward(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() != "host"}
        started = time.monotonic()
        conn = http.client.HTTPConnection(UPSTREAM_HOST, int(UPSTREAM_PORT), timeout=600)
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            response = conn.getresponse()
        except Exception as error:  # noqa: BLE001 - report and fail the exchange
            self.send_response(502)
            self.end_headers()
            log(f"{self.command} {self.path} -> 502 {error}")
            conn.close()
            return
        self.send_response(response.status)
        for key, value in response.getheaders():
            if key.lower() in ("transfer-encoding", "content-length", "connection"):
                continue
            self.send_header(key, value)
        self.send_header("Connection", "close")
        self.end_headers()
        sent = 0
        try:
            while True:
                chunk = response.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
                sent += len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        log(f"{self.command} {self.path} -> {response.status} {sent}B in {time.monotonic() - started:.2f}s")
        conn.close()


if __name__ == "__main__":
    server = ThreadingHTTPServer((LISTEN.split(":")[0], int(LISTEN.split(":")[1])), Handler)
    log(f"proxy on {LISTEN} -> {UPSTREAM_HOST}:{UPSTREAM_PORT} control={CONTROL}")
    server.serve_forever()
