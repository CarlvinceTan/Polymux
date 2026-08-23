#!/usr/bin/env python3
"""Native messaging host: persists the browser's tab snapshot for Polymux.

Chrome launches this process and frames each JSON message with a 4-byte
little-endian length prefix. Every snapshot received is written atomically to
~/Library/Application Support/polymux-tab-context/tabs.json, where the Polymux
browser-use skill reads it (scripts/tab_context.py).
"""

from __future__ import annotations

import json
import os
import struct
import sys
from pathlib import Path

CACHE_DIR = Path.home() / "Library" / "Application Support" / "polymux-tab-context"
CACHE_PATH = CACHE_DIR / "tabs.json"
MAX_MESSAGE_BYTES = 4 * 1024 * 1024


def read_message() -> dict | None:
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    if length == 0 or length > MAX_MESSAGE_BYTES:
        return None
    body = sys.stdin.buffer.read(length)
    if len(body) < length:
        return None
    try:
        value = json.loads(body.decode("utf-8"))
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def send_message(value: dict) -> None:
    body = json.dumps(value).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(body)))
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()


def write_snapshot(snapshot: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    temporary = CACHE_PATH.with_name(f".tabs.json.tmp-{os.getpid()}")
    temporary.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, CACHE_PATH)


def main() -> int:
    while True:
        message = read_message()
        if message is None:
            return 0
        if "tabs" in message and isinstance(message.get("tabs"), list):
            try:
                write_snapshot(message)
                send_message({"ok": True, "tab_count": len(message["tabs"])})
            except OSError as error:
                send_message({"ok": False, "error": str(error)})
        else:
            send_message({"ok": False, "error": "snapshot must contain a tabs list"})


if __name__ == "__main__":
    sys.exit(main())
