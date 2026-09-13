"""Bounded JSON command and RFC 6455 transport; no browser lifecycle operations."""
import base64
import hashlib
import json
import os
import socket
import struct
import subprocess
import threading
import time
from urllib.parse import urlsplit

MAX_BYTES = 2 * 1024 * 1024


def command_json(command, timeout=5, *, input_value=None):
    if not command or not all(isinstance(x, str) and x for x in command):
        raise ValueError("command must be a non-empty argument array")
    encoded = json.dumps(input_value).encode('utf-8') if input_value is not None else None
    if encoded is not None and len(encoded) > MAX_BYTES:
        raise ValueError('collector input exceeded 2 MiB')
    child = subprocess.Popen(command, stdin=subprocess.PIPE if encoded is not None else subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE)
    if encoded is not None:
        def send():
            try:
                child.stdin.write(encoded)
                child.stdin.close()
            except OSError:
                pass
        threading.Thread(target=send, daemon=True).start()
    chunks = [bytearray(), bytearray()]
    overflow = threading.Event()
    def drain(stream, index):
        try:
            while True:
                part = stream.read(16384)
                if not part:
                    break
                if len(chunks[index]) + len(part) > MAX_BYTES:
                    overflow.set()
                    child.kill()
                    break
                chunks[index].extend(part)
        finally:
            stream.close()
    threads = [threading.Thread(target=drain, args=(stream, i), daemon=True)
               for i, stream in enumerate((child.stdout, child.stderr))]
    for thread in threads:
        thread.start()
    try:
        child.wait(timeout=timeout)
    finally:
        if child.poll() is None:
            child.kill()
        child.wait()
        # A grandchild may retain a pipe; do not let it hold up collection.
        for thread in threads:
            thread.join(timeout=0.1)
    if overflow.is_set():
        raise ValueError("collector output exceeded 2 MiB")
    if any(thread.is_alive() for thread in threads):
        raise ValueError("collector left an output pipe open")
    if child.returncode:
        try:
            failed = json.loads(chunks[0])
            if isinstance(failed, dict) and failed.get('reason'):
                raise ValueError(str(failed['reason'])[:300])
        except json.JSONDecodeError:
            pass
        raise ValueError(chunks[1].decode(errors="replace")[:300] or f"collector exit {child.returncode}")
    value = json.loads(chunks[0])
    if not isinstance(value, dict):
        raise ValueError("collector JSON must be an object")
    return value


class WebSocket:
    """Loopback-only client with one deadline, framing limits and ping handling."""
    def __init__(self, url, timeout=4):
        parsed = urlsplit(url)
        if parsed.scheme != "ws" or parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
            raise ValueError("WebSocket must use a loopback ws endpoint")
        if parsed.username or parsed.password or parsed.fragment:
            raise ValueError("invalid WebSocket endpoint")
        self.deadline = time.monotonic() + timeout
        self.stream = socket.create_connection((parsed.hostname, parsed.port or 80), timeout=timeout)
        self.buffer = bytearray()
        self.counter = 0
        self.closed = False
        key = base64.b64encode(os.urandom(16)).decode()
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        if any(ord(c) < 33 or ord(c) > 126 for c in path):
            self.close()
            raise ValueError("invalid WebSocket path")
        request = (f"GET {path} HTTP/1.1\r\nHost: {parsed.netloc}\r\n"
                   f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                   "Sec-WebSocket-Version: 13\r\n\r\n")
        try:
            self.stream.sendall(request.encode("ascii"))
            while b"\r\n\r\n" not in self.buffer:
                self._receive()
                if len(self.buffer) > 65536:
                    raise ValueError("WebSocket handshake too large")
            header, rest = bytes(self.buffer).split(b"\r\n\r\n", 1)
            self.buffer = bytearray(rest)
            lines = header.decode("ascii").split("\r\n")
            fields = dict((k.strip().lower(), v.strip()) for k,v in
                          (line.split(":",1) for line in lines[1:]))
            expected = base64.b64encode(hashlib.sha1((key +
                "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            if (lines[0].split()[1] != "101" or fields.get("sec-websocket-accept") != expected
                    or fields.get("upgrade", "").lower() != "websocket"):
                raise ValueError("WebSocket handshake rejected")
        except Exception:
            self.close()
            raise

    def _receive(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("WebSocket deadline exceeded")
        self.stream.settimeout(remaining)
        chunk = self.stream.recv(16384)
        if not chunk:
            raise ValueError("WebSocket closed unexpectedly")
        self.buffer.extend(chunk)

    def read(self, size):
        while len(self.buffer) < size:
            self._receive()
        result = bytes(self.buffer[:size])
        del self.buffer[:size]
        return result

    def send(self, payload, opcode=1):
        if len(payload) > MAX_BYTES:
            raise ValueError("WebSocket request too large")
        self.stream.settimeout(max(0.001, self.deadline - time.monotonic()))
        length = len(payload)
        header = bytes((0x80 | opcode, 0x80 | length)) if length < 126 else (
            bytes((0x80 | opcode, 0xFE)) + struct.pack("!H", length) if length < 65536 else
            bytes((0x80 | opcode, 0xFF)) + struct.pack("!Q", length))
        mask = os.urandom(4)
        self.stream.sendall(header + mask + bytes(c ^ mask[i % 4] for i,c in enumerate(payload)))

    def receive(self):
        data = bytearray()
        started = False
        while True:
            first, second = self.read(2)
            opcode, final = first & 15, bool(first & 128)
            if first & 112 or second & 128:
                raise ValueError("invalid server WebSocket frame")
            length = second & 127
            if length == 126:
                length = struct.unpack("!H", self.read(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self.read(8))[0]
            if length + len(data) > MAX_BYTES:
                raise ValueError("WebSocket message too large")
            if opcode >= 8 and (not final or length > 125):
                raise ValueError("invalid WebSocket control frame")
            payload = self.read(length)
            if opcode == 8:
                raise ValueError("WebSocket closed")
            if opcode == 9:
                self.send(payload, 10)
                continue
            if opcode == 10:
                continue
            if opcode not in {0, 1} or (opcode == 0) != started:
                raise ValueError("invalid WebSocket continuation")
            started = True
            data.extend(payload)
            if final:
                return json.loads(data)

    def batch(self, requests):
        pending = {item["id"] for item in requests}
        for request in requests:
            self.send(json.dumps(request, separators=(",", ":")).encode())
        results = {}
        while pending:
            message = self.receive()
            if not isinstance(message, dict):
                raise ValueError("WebSocket message must be an object")
            ident = message.get("id")
            if ident in pending:
                results[ident] = message
                pending.remove(ident)
        return results

    def call(self, method, params=None):
        self.counter += 1
        reply = self.batch([{"id": self.counter, "method": method, "params": params or {}}])[self.counter]
        if "error" in reply:
            raise ValueError(f"{method}: {reply.get('message') or reply['error']}")
        if not isinstance(reply.get("result"), dict):
            raise ValueError(f"{method}: missing result")
        return reply["result"]

    def close(self):
        if not self.closed:
            self.closed = True
            self.stream.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
