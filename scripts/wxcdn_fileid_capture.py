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
_lock = threading.Lock()
_MAX_FILE_BODY = 64 * 1024 * 1024
_UPLOAD_PATH = re.compile(
    r"(?:uploadappattach|uploadvideo|uploadvoice|uploadmsgimg|cdn[^/]*upload|upload[^/]*file)",
    re.IGNORECASE,
)


def _u64(data, offset):
    return int.from_bytes(data[offset : offset + 8], "little")


def _read(process, address, size):
    error = lldb.SBError()
    data = process.ReadMemory(address, size, error)
    return data if error.Success() else b""


def _append_json(path, record):
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        os.write(
            descriptor,
            (json.dumps(record, separators=(",", ":")) + "\n").encode("utf-8"),
        )
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


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
    state["upload_prefix"] = _std_string_bytes(frame, "x1")
    state["upload_suffix"] = _std_string_bytes(frame, "x2")
    return False


def _set_upload_path(frame, _bp, _dict):
    _state(frame)["file_path"] = _std_string(frame, "x1")
    return False


def _materialize_upload_body(state):
    body = state.get("body", b"")
    if body:
        return body
    if os.environ.get("WECHAT_CDN_CAPTURE_ALLOW_FILE_PATH_ONLY") != "1":
        return b""
    file_path = state.get("file_path", "")
    if not file_path:
        return b""
    try:
        size = os.path.getsize(file_path)
        if not 0 <= size <= _MAX_FILE_BODY:
            return b""
        with open(file_path, "rb") as stream:
            file_bytes = stream.read(_MAX_FILE_BODY + 1)
    except OSError:
        return b""
    if len(file_bytes) != size:
        return b""
    return (
        state.get("upload_prefix", b"")
        + file_bytes
        + state.get("upload_suffix", b"")
    )


def _start_request(frame, _bp, _dict):
    process = frame.GetThread().GetProcess()
    key = frame.FindRegister("x0").GetValueAsUnsigned()
    with _lock:
        state = dict(_requests.pop(key, {}))
    url = state.get("url", "")
    parsed = urlsplit(url)
    body = _materialize_upload_body(state)
    file_path = state.get("file_path", "")
    upload_prefix = state.get("upload_prefix", b"")
    upload_suffix = state.get("upload_suffix", b"")
    allow_file_path_only = (
        os.environ.get("WECHAT_CDN_CAPTURE_ALLOW_FILE_PATH_ONLY") == "1"
    )
    has_upload_state = bool(
        file_path or upload_prefix or _UPLOAD_PATH.search(parsed.path)
    )
    if (
        not parsed.hostname
        or not _capture_path
        or not has_upload_state
        or (
            not body
            and not upload_prefix
            and not (allow_file_path_only and file_path)
        )
    ):
        return False

    record = {
        "host": parsed.netloc,
        "path": parsed.path + (("?" + parsed.query) if parsed.query else ""),
        "method": state.get("method") or "POST",
        "headers": state.get("headers", {}),
        "body_b64": base64.b64encode(body).decode("ascii"),
        "file_path": file_path,
        "upload_prefix_b64": base64.b64encode(upload_prefix).decode("ascii"),
        "upload_suffix_b64": base64.b64encode(upload_suffix).decode("ascii"),
        "transport": "HttpWithCronet",
        "url": url,
    }
    _append_json(_capture_path, record)
    # Detach while the target is already stopped in this callback. Killing an
    # LLDB process that is still attached can leave debugserver holding WeChat
    # stopped (or terminate the app when debugserver is reaped). A native
    # detach resumes WeChat first; the daemon may then reap the idle LLDB child
    # without owning the target anymore.
    process.Detach()
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
    # The daemon owns the LLDB child's outer timeout. Successful captures
    # detach natively in `_start_request`; this command remains for compatibility
    # with the command file generated by released wechatd builds.
    result.AppendMessage("cdn capture auto-detach armed")


def __lldb_init_module(debugger, _dict):
    debugger.HandleCommand(
        f"command script add -f {__name__}._install cdn-capture-bps"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}._auto_detach cdn-capture-auto-detach"
    )
