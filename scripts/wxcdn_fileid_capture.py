"""LLDB helper used by wechatd to capture WeChat's next CDN request.

The released wechatd binary references this helper but did not package it.  We
observe HttpWithCronet's public C++ boundary, retaining request fields by its
`this` pointer until StartRequest.  No UI input or message mutation happens in
this script.
"""

import base64
import json
import os
import re
import threading
from urllib.parse import urlsplit

import lldb


_requests = {}
_capture_path = None
_detach_after_capture = False
_lock = threading.Lock()
_UPLOAD_PATH = re.compile(
    r"(?:uploadappattach|uploadvideo|uploadmsgimg|cdn[^/]*upload|upload[^/]*file)",
    re.IGNORECASE,
)


def _u64(data, offset):
    return int.from_bytes(data[offset : offset + 8], "little")


def _read(process, address, size):
    error = lldb.SBError()
    data = process.ReadMemory(address, size, error)
    return data if error.Success() else b""


def _std_string_bytes(frame, register_name):
    """Decode the 24-byte libc++ string layout shipped with this WeChat."""
    process = frame.GetThread().GetProcess()
    address = frame.FindRegister(register_name).GetValueAsUnsigned()
    raw = _read(process, address, 24)
    if len(raw) != 24:
        return b""

    # libc++'s alternate long layout is pointer, size, capacity/long-bit.
    pointer, size, capacity = _u64(raw, 0), _u64(raw, 8), _u64(raw, 16)
    if pointer > 0x10000 and size < 64 * 1024 * 1024 and capacity >= size:
        value = _read(process, pointer, size)
        if len(value) == size:
            return value

    # Its short layout stores 23 inline bytes and the length in the final byte.
    size = raw[23] & 0x7F
    if size <= 23:
        return raw[:size]
    return b""


def _std_string(frame, register_name):
    return _std_string_bytes(frame, register_name).decode("utf-8", "replace")


def _state(frame):
    key = frame.FindRegister("x0").GetValueAsUnsigned()
    with _lock:
        return _requests.setdefault(
            key,
            {"method": "", "url": "", "headers": {}, "body": b"", "file_path": ""},
        )


def _set_url(frame, _bp, _dict):
    _state(frame)["url"] = _std_string(frame, "x1")
    return False


def _set_method(frame, _bp, _dict):
    _state(frame)["method"] = _std_string(frame, "x1")
    return False


def _add_header(frame, _bp, _dict):
    _state(frame)["headers"][_std_string(frame, "x1")] = _std_string(frame, "x2")
    return False


def _set_body(frame, _bp, _dict):
    _state(frame)["body"] = _std_string_bytes(frame, "x1")
    return False


def _set_upload_form(frame, _bp, _dict):
    state = _state(frame)
    state["upload_prefix"] = _std_string(frame, "x1")
    state["upload_suffix"] = _std_string(frame, "x2")
    return False


def _set_upload_path(frame, _bp, _dict):
    _state(frame)["file_path"] = _std_string(frame, "x1")
    return False


def _start_request(frame, _bp, _dict):
    global _detach_after_capture
    key = frame.FindRegister("x0").GetValueAsUnsigned()
    with _lock:
        state = dict(_requests.pop(key, {}))
    url = state.get("url", "")
    parsed = urlsplit(url)
    body = state.get("body", b"")
    if (
        not parsed.hostname
        or not body
        or not _capture_path
        or not _UPLOAD_PATH.search(parsed.path)
    ):
        return False

    record = {
        "host": parsed.netloc,
        "path": parsed.path + (("?" + parsed.query) if parsed.query else ""),
        "method": state.get("method") or "POST",
        "headers": state.get("headers", {}),
        "body_b64": base64.b64encode(body).decode("ascii"),
        "transport": "HttpWithCronet",
        "url": url,
    }
    with open(_capture_path, "a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, separators=(",", ":")) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    _detach_after_capture = True
    return False


_SYMBOLS = (
    ("_ZN14HttpWithCronet6SetURLERKNSt3__112basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEE", _set_url),
    ("_ZN14HttpWithCronet9SetMethodERKNSt3__112basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEE", _set_method),
    ("_ZN14HttpWithCronet9AddHeaderERKNSt3__112basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEES8_", _add_header),
    ("_ZN14HttpWithCronet11SetBodyDataERKNSt3__112basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEE", _set_body),
    ("_ZN14HttpWithCronet17SetUploadFormDataERKNSt3__112basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEES8_", _set_upload_form),
    ("_ZN14HttpWithCronet17SetUploadFilePathERKNSt3__112basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEE", _set_upload_path),
    ("_ZN14HttpWithCronet12StartRequestEv", _start_request),
)


def _install(debugger, command, result, _dict):
    global _capture_path
    _capture_path = command.strip() or os.environ.get("WECHAT_CDN_CAPTURE_PATH", "")
    if not _capture_path:
        result.SetError("capture path required")
        return
    target = debugger.GetSelectedTarget()
    installed = 0
    for symbol, callback in _SYMBOLS:
        breakpoint = target.BreakpointCreateByName(symbol)
        if breakpoint.GetNumLocations() == 0:
            continue
        breakpoint.SetScriptCallbackFunction(__name__ + "." + callback.__name__)
        installed += 1
    if installed != len(_SYMBOLS):
        result.SetError("not all HttpWithCronet capture breakpoints resolved")
        return
    result.AppendMessage("cdn capture breakpoints ready")


def _auto_detach(_debugger, _command, result, _dict):
    # wechatd owns the LLDB child and terminates it after capture/timeout.  The
    # command is retained for compatibility with its generated command file.
    result.AppendMessage("cdn capture auto-detach armed")


def __lldb_init_module(debugger, _dict):
    debugger.HandleCommand(
        f"command script add -f {__name__}._install cdn-capture-bps"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}._auto_detach cdn-capture-auto-detach"
    )
