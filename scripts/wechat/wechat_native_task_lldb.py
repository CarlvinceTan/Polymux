"""Send one profiled WeChat Mars task through LLDB.

The caller supplies a CGI, command id, and complete protobuf request in a
short-lived arm file. This module allocates one native Mars task, substitutes a
tiny request encoder only for that task id, and keeps its response wrapper
installed until ``Buf2Resp`` receives the matching acknowledgement. All
unrelated requests auto-continue unchanged.
"""

import base64
import json
import os
import re
import stat
import struct
import time

import lldb


ARM_PATH = os.environ.get("POLYMUX_WECHAT_WIRE_ARM", "")
STATUS_PATH = os.environ.get("POLYMUX_WECHAT_WIRE_STATUS", "")
PRIME_DYLIB_PATH = os.environ.get("POLYMUX_WECHAT_PRIME_DYLIB", "")
PRIME_STATUS_PATH = os.environ.get("POLYMUX_WECHAT_PRIME_STATUS", "")
MODEL_ARM_PATH = os.environ.get("POLYMUX_WECHAT_MODEL_ARM", "")
MODEL_STATUS_PATH = os.environ.get("POLYMUX_WECHAT_MODEL_STATUS", "")
WINDOW_GUARD_DURATION = int(
    os.environ.get("POLYMUX_WECHAT_WINDOW_GUARD_DURATION", "0") or "0"
)
INTERNAL_KEY_CODE = int(os.environ.get("POLYMUX_WECHAT_KEY_CODE", "0") or "0")
INTERNAL_KEY_FLAGS = int(os.environ.get("POLYMUX_WECHAT_KEY_FLAGS", "0") or "0")
INTERNAL_KEY_REPEAT = int(os.environ.get("POLYMUX_WECHAT_KEY_REPEAT", "1") or "1")
INTERNAL_SCROLL_DELTA = int(os.environ.get("POLYMUX_WECHAT_SCROLL_DELTA", "0") or "0")
WECHAT_DYLIB = "/Applications/WeChat.app/Contents/Resources/wechat.dylib"

START_TASK_OFFSET = 0x4D2ABE4
START_TASK_WITH_MANAGER_OFFSET = 0x4D34C8C
START_RETURN_GADGET_OFFSET = 0x4D2ABE0
REQ2BUF_INSERT_OFFSET = 0x3AFC954
REQ2BUF_CALL_OFFSET = 0x3AFC9D4
REQ2BUF_AFTER_CALL_OFFSET = 0x3AFC9DC
MAP_ERASE_FOUND_OFFSET = 0x3AFE228
MAP_ERASE_SKIP_OFFSET = 0x3AFE294
AUTOBUFFER_WRITE_OFFSET = 0x3B239E4
APP_ENCODE_OFFSET = 0x50D6FD4
RUN_ON_START_TASK_OFFSET = 0x50DB494
RUN_ON_START_AUTH_OFFSET = 0x50DB708
RUN_ON_START_LONGLINK_OFFSET = 0x50DB744
RUN_ON_START_REQ2BUF_OFFSET = 0x50DBF04
BUF2RESP_OFFSET = 0x3B225C8
RET_ONE_STUB_OFFSET = 0x430C4
RET_ZERO_STUB_OFFSET = 0x430BC
# Private Qt ABI differs between WeChat builds. Every value below is selected
# from the loaded image's exact UUID before any address is used. New builds add
# one entry here; never reuse another build's numbers.
_WECHAT_BUILD_PROFILES = {
    "C6F8C0A6-BB7C-3DF1-B3AC-CAD6A1A1461F": {
        "chat_input_view_qt_metacast": 0xB4DB8,
        "chat_input_field_qt_metacast": 0xB4320,
        "message_view_qt_metacast": 0xB5B08,
        "chat_input_view_send": 0x6F7ABC,
        "send_via_field_signal": False,
        "chat_input_view_field": 0x208,
        "chat_input_view_recipient": 0x2C0,
        "message_view_model": 0x200,
        "data_const_offset": 0x8AB8000,
        "data_const_size": 0x428000,
        "text_offset": 0x15000,
        "text_size": 0x6D8AD9F,
        "session_list_call": 0x89461C,
        "session_list_model_offset": 0x1A8,
        "session_list_argument_offset": 0x190,
        "session_cell_static_metacall": 0xB8E1C,
        "session_cell_recipient_offset": 0x148,
        "rename_group_call": 0x344FA54,
    },
    "CDB81058-0FAC-3518-95F5-C0CC7860F9B5": {
        "chat_input_view_qt_metacast": 0x13924C,
        "chat_input_field_qt_metacast": 0x13898C,
        "message_view_qt_metacast": None,
        # Function entry, not the stack allocation at entry + 0x1c.
        "chat_input_view_send": 0x87BC3C,
        "send_via_field_signal": True,
        "chat_input_view_field": 0x200,
        "chat_input_view_recipient": 0x258,
        "message_view_model": None,
        "data_const_offset": 0x7000000,
        "data_const_size": 0x2A20000,
        "text_offset": 0x17000,
        "text_size": 0x6C98000,
        # The session list walker, its static metacall and the group rename
        # wrapper were only ever derived for the C6F8C0A6 build. None here
        # makes those routes fail closed instead of calling 4.1.11 addresses
        # inside a 4.1.13 process.
        "session_list_call": None,
        "session_list_model_offset": None,
        "session_list_argument_offset": None,
        "session_cell_static_metacall": None,
        "session_cell_recipient_offset": None,
        "rename_group_call": None,
    },
}
CHAT_INPUT_VIEW_QT_METACAST_OFFSET = 0xB4DB8
CHAT_INPUT_FIELD_QT_METACAST_OFFSET = 0xB4320
MESSAGE_VIEW_QT_METACAST_OFFSET = 0xB5B08
CHAT_INPUT_VIEW_SEND_OFFSET = 0x6F7ABC
CHAT_INPUT_VIEW_SEND_VIA_FIELD_SIGNAL = False
CHAT_INPUT_VIEW_FIELD_OFFSET = 0x208
CHAT_INPUT_VIEW_RECIPIENT_OFFSET = 0x2C0
MESSAGE_VIEW_MODEL_OFFSET = 0x200
WECHAT_DATA_CONST_OFFSET = 0x8AB8000
WECHAT_DATA_CONST_SIZE = 0x428000
WECHAT_TEXT_OFFSET = 0x15000
WECHAT_TEXT_SIZE = 0x6D8AD9F
SESSION_LIST_CALL_OFFSET = 0x89461C
SESSION_LIST_MODEL_OFFSET = 0x1A8
SESSION_LIST_ARGUMENT_OFFSET = 0x190
SESSION_CELL_STATIC_METACALL_OFFSET = 0xB8E1C
SESSION_CELL_RECIPIENT_OFFSET = 0x148
RENAME_GROUP_CALL_OFFSET = 0x344FA54


def _select_wechat_build(module):
    global CHAT_INPUT_VIEW_QT_METACAST_OFFSET
    global CHAT_INPUT_FIELD_QT_METACAST_OFFSET
    global MESSAGE_VIEW_QT_METACAST_OFFSET
    global CHAT_INPUT_VIEW_SEND_OFFSET
    global CHAT_INPUT_VIEW_SEND_VIA_FIELD_SIGNAL
    global CHAT_INPUT_VIEW_FIELD_OFFSET
    global CHAT_INPUT_VIEW_RECIPIENT_OFFSET
    global MESSAGE_VIEW_MODEL_OFFSET
    global WECHAT_DATA_CONST_OFFSET
    global WECHAT_DATA_CONST_SIZE
    global WECHAT_TEXT_OFFSET
    global WECHAT_TEXT_SIZE
    global SESSION_LIST_CALL_OFFSET
    global SESSION_LIST_MODEL_OFFSET
    global SESSION_LIST_ARGUMENT_OFFSET
    global SESSION_CELL_STATIC_METACALL_OFFSET
    global SESSION_CELL_RECIPIENT_OFFSET
    global RENAME_GROUP_CALL_OFFSET
    try:
        identifier = (module.GetUUIDString() or "").strip().upper()
    except Exception:
        identifier = ""
    if identifier not in _WECHAT_BUILD_PROFILES:
        return
    profile = _WECHAT_BUILD_PROFILES[identifier]
    CHAT_INPUT_VIEW_QT_METACAST_OFFSET = profile["chat_input_view_qt_metacast"]
    CHAT_INPUT_FIELD_QT_METACAST_OFFSET = profile["chat_input_field_qt_metacast"]
    MESSAGE_VIEW_QT_METACAST_OFFSET = profile["message_view_qt_metacast"]
    CHAT_INPUT_VIEW_SEND_OFFSET = profile["chat_input_view_send"]
    CHAT_INPUT_VIEW_SEND_VIA_FIELD_SIGNAL = profile["send_via_field_signal"]
    CHAT_INPUT_VIEW_FIELD_OFFSET = profile["chat_input_view_field"]
    CHAT_INPUT_VIEW_RECIPIENT_OFFSET = profile["chat_input_view_recipient"]
    MESSAGE_VIEW_MODEL_OFFSET = profile["message_view_model"]
    WECHAT_DATA_CONST_OFFSET = profile["data_const_offset"]
    WECHAT_DATA_CONST_SIZE = profile["data_const_size"]
    WECHAT_TEXT_OFFSET = profile["text_offset"]
    WECHAT_TEXT_SIZE = profile["text_size"]
    # The session list walker and the group rename wrapper are separate private
    # Qt entry points from the composer ones. A build that has not had them
    # derived records None, so these routes refuse instead of calling another
    # build's address inside this process.
    SESSION_LIST_CALL_OFFSET = profile.get("session_list_call")
    SESSION_LIST_MODEL_OFFSET = profile.get("session_list_model_offset")
    SESSION_LIST_ARGUMENT_OFFSET = profile.get("session_list_argument_offset")
    SESSION_CELL_STATIC_METACALL_OFFSET = profile.get("session_cell_static_metacall")
    SESSION_CELL_RECIPIENT_OFFSET = profile.get("session_cell_recipient_offset")
    RENAME_GROUP_CALL_OFFSET = profile.get("rename_group_call")


def _require_offsets(names):
    missing = [name for name in names if globals()[name] is None]
    if missing:
        raise RuntimeError(
            "This WeChat build has no derived " + ", ".join(missing)
            + "; Polymux will not reuse another build's native addresses.")
    return [globals()[name] for name in names]


_SESSION_LIST_OFFSETS = (
    "SESSION_LIST_CALL_OFFSET",
    "SESSION_LIST_MODEL_OFFSET",
    "SESSION_LIST_ARGUMENT_OFFSET",
)
_SESSION_CELL_OFFSETS = (
    "SESSION_CELL_STATIC_METACALL_OFFSET",
    "SESSION_CELL_RECIPIENT_OFFSET",
)

_STATE = {}
_NAV_TRACE = {}
_SESSION_TRACE = {}


def _trace(value):
    if not STATUS_PATH or _STATE.get("trace_count", 0) >= 40:
        return
    _STATE["trace_count"] = _STATE.get("trace_count", 0) + 1
    with open(STATUS_PATH + ".trace", "a", encoding="utf-8") as stream:
        stream.write(json.dumps(value, separators=(",", ":")) + "\n")


def _atomic_json(path, value):
    temporary = f"{path}.{os.getpid()}.tmp"
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
        0o600,
    )
    try:
        os.fchmod(descriptor, 0o600)
        os.write(descriptor, json.dumps(value, separators=(",", ":")).encode())
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.replace(temporary, path)


def _finish(value):
    if _STATE.get("finished"):
        return
    _STATE["finished"] = True
    if STATUS_PATH:
        _atomic_json(STATUS_PATH, value)


def _evaluate_objc(frame, expression, timeout_seconds=8):
    options = lldb.SBExpressionOptions()
    options.SetLanguage(lldb.eLanguageTypeObjC_plus_plus)
    options.SetTimeoutInMicroSeconds(timeout_seconds * 1_000_000)
    value = frame.EvaluateExpression(expression, options)
    error = value.GetError()
    if error.Fail():
        raise RuntimeError(error.GetCString() or "native expression failed")
    return value.GetValueAsSigned()


def schedule_native_window_guard(debugger, _command, result, _dict):
    payload = {"scheduled": False, "reason": "native_window_guard_failed"}
    try:
        if not PRIME_DYLIB_PATH or not os.path.isfile(PRIME_DYLIB_PATH):
            raise RuntimeError("the bundled WeChat primer library is unavailable")
        if not PRIME_STATUS_PATH:
            raise RuntimeError("the WeChat window guard status path is unavailable")
        if not 1000 <= WINDOW_GUARD_DURATION <= 120000:
            raise RuntimeError("the WeChat window guard duration is invalid")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while scheduling its window guard")
        thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                thread = candidate
                break
        frame = thread.GetFrameAtIndex(0)
        library = json.dumps(PRIME_DYLIB_PATH)
        status = json.dumps(PRIME_STATUS_PATH)
        code = _evaluate_objc(
            frame,
            "@import Darwin; "
            f"void *pmxHandle=dlopen({library},2); "
            "int (*pmxGuard)(const char *,unsigned int)="
            "(int (*)(const char *,unsigned int))"
            "dlsym(pmxHandle,\"polymux_schedule_wechat_window_guard\"); "
            f"pmxGuard ? pmxGuard({status},{WINDOW_GUARD_DURATION}U) : -99",
        )
        reasons = {
            -99: "window_guard_library_load_failed",
            -2: "window_guard_duration_invalid",
            -1: "window_guard_status_path_invalid",
        }
        payload = {
            "scheduled": code == 1,
            "code": code,
            "reason": "" if code == 1 else reasons.get(code, "native_window_guard_failed"),
        }
    except Exception as error:
        payload = {"scheduled": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def send_native_return(debugger, _command, result, _dict):
    payload = {"scheduled": False, "reason": "native_return_failed"}
    try:
        if not PRIME_DYLIB_PATH or not os.path.isfile(PRIME_DYLIB_PATH):
            raise RuntimeError("the bundled WeChat primer library is unavailable")
        if not PRIME_STATUS_PATH:
            raise RuntimeError("the WeChat return status path is unavailable")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while scheduling Return")
        thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                thread = candidate
                break
        frame = thread.GetFrameAtIndex(0)
        library = json.dumps(PRIME_DYLIB_PATH)
        status = json.dumps(PRIME_STATUS_PATH)
        code = _evaluate_objc(
            frame,
            "@import Darwin; "
            f"void *pmxHandle=dlopen({library},2); "
            "int (*pmxReturn)(const char *)="
            "(int (*)(const char *))"
            "dlsym(pmxHandle,\"polymux_send_wechat_return\"); "
            f"pmxReturn ? pmxReturn({status}) : -99",
        )
        if code != 1:
            raise RuntimeError("WeChat internal Return could not be scheduled")
        payload = {"scheduled": True, "reason": ""}
    except Exception as error:
        payload = {"scheduled": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def finish_native_window_guard(debugger, _command, result, _dict):
    payload = {"finished": False, "reason": "native_window_guard_finish_failed"}
    try:
        if not PRIME_DYLIB_PATH or not os.path.isfile(PRIME_DYLIB_PATH):
            raise RuntimeError("the bundled WeChat primer library is unavailable")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while finishing its window guard")
        thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                thread = candidate
                break
        frame = thread.GetFrameAtIndex(0)
        library = json.dumps(PRIME_DYLIB_PATH)
        code = _evaluate_objc(
            frame,
            "@import Darwin; "
            f"void *pmxHandle=dlopen({library},2); "
            "int (*pmxFinish)(void)=(int (*)(void))"
            'dlsym(pmxHandle,"polymux_finish_wechat_window_guard"); '
            "pmxFinish ? pmxFinish() : -99",
        )
        if code != 1:
            raise RuntimeError("WeChat window guard could not be finished")
        payload = {"finished": True, "reason": ""}
    except Exception as error:
        payload = {"finished": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def send_native_attachment_events(debugger, _command, result, _dict):
    payload = {"scheduled": False, "reason": "native_attachment_events_failed"}
    try:
        if not PRIME_DYLIB_PATH or not os.path.isfile(PRIME_DYLIB_PATH):
            raise RuntimeError("the bundled WeChat primer library is unavailable")
        if not PRIME_STATUS_PATH:
            raise RuntimeError("the WeChat attachment status path is unavailable")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while scheduling attachment events")
        thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                thread = candidate
                break
        frame = thread.GetFrameAtIndex(0)
        library = json.dumps(PRIME_DYLIB_PATH)
        status = json.dumps(PRIME_STATUS_PATH)
        code = _evaluate_objc(
            frame,
            "@import Darwin; "
            f"void *pmxHandle=dlopen({library},2); "
            "int (*pmxAttachment)(const char *,unsigned int)="
            "(int (*)(const char *,unsigned int))"
            'dlsym(pmxHandle,"polymux_send_wechat_attachment_events"); '
            f"pmxAttachment ? pmxAttachment({status},1500U) : -99",
        )
        if code != 1:
            raise RuntimeError("WeChat internal attachment events could not be scheduled")
        payload = {"scheduled": True, "reason": ""}
    except Exception as error:
        payload = {"scheduled": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def send_native_key(debugger, _command, result, _dict):
    payload = {"scheduled": False, "reason": "native_key_failed"}
    try:
        if not PRIME_DYLIB_PATH or not os.path.isfile(PRIME_DYLIB_PATH):
            raise RuntimeError("the bundled WeChat primer library is unavailable")
        if not PRIME_STATUS_PATH:
            raise RuntimeError("the WeChat key status path is unavailable")
        if (
            not 0 < INTERNAL_KEY_CODE <= 0xFFFF
            or not 0 <= INTERNAL_KEY_FLAGS <= 0xFFFFFFFFFFFFFFFF
            or not 1 <= INTERNAL_KEY_REPEAT <= 32
        ):
            raise RuntimeError("the WeChat internal key is invalid")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while scheduling an internal key")
        thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                thread = candidate
                break
        frame = thread.GetFrameAtIndex(0)
        library = json.dumps(PRIME_DYLIB_PATH)
        status = json.dumps(PRIME_STATUS_PATH)
        code = _evaluate_objc(
            frame,
            "@import Darwin; "
            f"void *pmxHandle=dlopen({library},2); "
            "int (*pmxKey)(const char *,unsigned int,unsigned long long,unsigned int)="
            "(int (*)(const char *,unsigned int,unsigned long long,unsigned int))"
            'dlsym(pmxHandle,"polymux_send_wechat_key"); '
            f"pmxKey ? pmxKey({status},{INTERNAL_KEY_CODE}U,{INTERNAL_KEY_FLAGS}ULL,"
            f"{INTERNAL_KEY_REPEAT}U) : -99",
        )
        if code != 1:
            raise RuntimeError("WeChat internal key could not be scheduled")
        payload = {"scheduled": True, "reason": ""}
    except Exception as error:
        payload = {"scheduled": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def scroll_native_sessions(debugger, _command, result, _dict):
    payload = {"scheduled": False, "reason": "native_scroll_failed"}
    try:
        if not PRIME_DYLIB_PATH or not os.path.isfile(PRIME_DYLIB_PATH):
            raise RuntimeError("the bundled WeChat primer library is unavailable")
        if not PRIME_STATUS_PATH:
            raise RuntimeError("the WeChat scroll status path is unavailable")
        if not -200 <= INTERNAL_SCROLL_DELTA <= 200 or INTERNAL_SCROLL_DELTA == 0:
            raise RuntimeError("the WeChat scroll delta is invalid")
        if not 1 <= INTERNAL_KEY_REPEAT <= 64:
            raise RuntimeError("the WeChat scroll repeat count is invalid")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while scheduling internal scroll")
        thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                thread = candidate
                break
        frame = thread.GetFrameAtIndex(0)
        library = json.dumps(PRIME_DYLIB_PATH)
        status = json.dumps(PRIME_STATUS_PATH)
        code = _evaluate_objc(
            frame,
            "@import Darwin; "
            f"void *pmxHandle=dlopen({library},2); "
            "int (*pmxScroll)(const char *,int,unsigned int)="
            "(int (*)(const char *,int,unsigned int))"
            'dlsym(pmxHandle,"polymux_scroll_wechat_sessions"); '
            f"pmxScroll ? pmxScroll({status},{INTERNAL_SCROLL_DELTA},{INTERNAL_KEY_REPEAT}U) : -99",
        )
        if code != 1:
            raise RuntimeError("WeChat internal scroll could not be scheduled")
        payload = {"scheduled": True, "reason": ""}
    except Exception as error:
        payload = {"scheduled": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def _load_request():
    with open(ARM_PATH, encoding="utf-8") as stream:
        raw = json.load(stream)
    if int(raw["expiryNs"]) < time.time_ns():
        raise ValueError("arm file expired")
    recipient = str(raw["recipient"])
    user_id = str(raw.get("userId", "")).strip()
    if (
        os.environ.get("POLYMUX_WECHAT_TEST_ONLY_FILEHELPER") == "1"
        and recipient != "filehelper"
    ):
        raise ValueError("live WeChat testing is restricted to filehelper")
    request = base64.b64decode(raw["requestBase64"], validate=True)
    if not request or len(request) > 1024 * 1024:
        raise ValueError("native request length is out of range")
    cgi = str(raw["cgi"])
    command_id = int(raw["commandId"])
    if (
        not cgi.startswith("/cgi-bin/")
        or len(cgi.encode("utf-8")) > 255
        or not 0 < command_id <= 0xFFFFFFFF
    ):
        raise ValueError("native task CGI or command id is out of range")
    if not user_id or len(user_id.encode("utf-8")) > 255 or "\x00" in user_id:
        raise ValueError("native task WeChat account id is out of range")
    task_id = int(raw.get("taskId", 0))
    if task_id and not 0 < task_id <= 0xFFFFFFFF:
        raise ValueError("native task id is out of range")
    return request, cgi, command_id, task_id, user_id


def _module_base(target):
    for module in target.module_iter():
        file_spec = module.GetFileSpec()
        full_path = getattr(file_spec, "fullpath", None)
        if not full_path:
            directory = file_spec.GetDirectory() or ""
            filename = file_spec.GetFilename() or ""
            full_path = os.path.join(directory, filename)
        if full_path != WECHAT_DYLIB:
            continue
        address = module.GetObjectFileHeaderAddress().GetLoadAddress(target)
        if address in (None, lldb.LLDB_INVALID_ADDRESS):
            break
        _select_wechat_build(module)
        return address
    raise RuntimeError("WeChat resources dylib is not loaded")


def _find_memory_pattern(process, start, end, pattern, maximum=64):
    matches = []
    cursor = start
    overlap = max(0, len(pattern) - 1)
    while cursor < end and len(matches) < maximum:
        size = min(4 * 1024 * 1024, end - cursor)
        data = _read_memory(process, cursor, size)
        if not data:
            break
        offset = 0
        while len(matches) < maximum:
            found = data.find(pattern, offset)
            if found < 0:
                break
            matches.append(cursor + found)
            offset = found + 1
        if len(data) < size:
            break
        cursor += max(1, size - overlap)
    return matches


def _locate_qobject_instances(target, process, metacast_offset):
    vtable = _qobject_vtable(target, process, metacast_offset)
    return vtable, _locate_vtable_instances(process, vtable)


def _qobject_vtable(target, process, metacast_offset):
    module_base = _module_base(target)
    metacast = module_base + metacast_offset
    metacast_hits = _find_memory_pattern(
        process,
        module_base + WECHAT_DATA_CONST_OFFSET,
        module_base + WECHAT_DATA_CONST_OFFSET + WECHAT_DATA_CONST_SIZE,
        struct.pack("<Q", metacast),
        maximum=4,
    )
    if len(metacast_hits) != 1:
        raise RuntimeError(
            "expected one QObject vtable, found "
            f"{len(metacast_hits)} at "
            + ",".join(f"0x{address:x}" for address in metacast_hits)
        )
    # Qt places metaObject immediately before qt_metacast in the primary
    # QObject vtable. A live QObject begins with the address of that first
    # virtual entry.
    return metacast_hits[0] - 8


def _locate_vtable_instances(
    process, vtable, maximum_region_size=4 * 1024 * 1024
):
    needle = struct.pack("<Q", vtable)
    objects = []
    regions = process.GetMemoryRegions()
    for index in range(regions.GetSize()):
        region = lldb.SBMemoryRegionInfo()
        if not regions.GetMemoryRegionAtIndex(index, region):
            continue
        if (
            not region.IsMapped()
            or not region.IsReadable()
            or not region.IsWritable()
        ):
            continue
        start = region.GetRegionBase()
        end = region.GetRegionEnd()
        if start <= vtable < end:
            continue
        # Qt widgets are small heap allocations. Avoid stacks, graphics
        # surfaces, dispatch arenas, and other huge writable mappings: reading
        # all of them made the first model send take many seconds.
        if end - start > maximum_region_size:
            continue
        for address in _find_memory_pattern(
            process, start, end, needle, maximum=max(1, 16 - len(objects))
        ):
            if address % 8 == 0:
                objects.append(address)
        if len(objects) >= 16:
            break
    return objects


def _model_cache_path(process):
    return f"/tmp/polymux-wechat-model-cache-{process.GetProcessID()}.json"


def _cached_model_views(process, module_base, view_vtable, field_vtable):
    cache_path = _model_cache_path(process)
    try:
        details = os.lstat(cache_path)
        if (
            not stat.S_ISREG(details.st_mode)
            or details.st_uid != os.getuid()
            or details.st_mode & 0o777 != 0o600
        ):
            return []
        with open(cache_path, "r", encoding="utf-8") as stream:
            cached = json.load(stream)
        if (
            cached.get("moduleBase") != module_base
            or cached.get("viewVtable") != view_vtable
            or cached.get("fieldVtable") != field_vtable
        ):
            return []
        return [
            address for address in cached.get("views", [])
            if isinstance(address, int) and address > 0
        ]
    except (OSError, ValueError, TypeError):
        return []


def _save_model_views(process, module_base, view_vtable, field_vtable, views):
    _atomic_json(
        _model_cache_path(process),
        {
            "moduleBase": module_base,
            "viewVtable": view_vtable,
            "fieldVtable": field_vtable,
            "views": views,
        },
    )


def _chat_model_pairs(process, views, view_vtable, field_vtable):
    pairs = []
    for view in views:
        observed_view = _read_memory(process, view, 8)
        if (
            len(observed_view) != 8
            or struct.unpack("<Q", observed_view)[0] != view_vtable
        ):
            continue
        field_raw = _read_memory(
            process, view + CHAT_INPUT_VIEW_FIELD_OFFSET, 8
        )
        if len(field_raw) != 8:
            continue
        field = struct.unpack("<Q", field_raw)[0]
        observed_field = _read_memory(process, field, 8)
        if (
            len(observed_field) != 8
            or struct.unpack("<Q", observed_field)[0] != field_vtable
        ):
            continue
        observed_recipient, raw_recipient = _read_short_string(
            process, view + CHAT_INPUT_VIEW_RECIPIENT_OFFSET
        )
        if observed_recipient is not None:
            pairs.append((view, field, observed_recipient, raw_recipient))
    return pairs


def _available_chat_models(target, process):
    module_base = _module_base(target)
    view_vtable = _qobject_vtable(
        target, process, CHAT_INPUT_VIEW_QT_METACAST_OFFSET
    )
    field_vtable = _qobject_vtable(
        target, process, CHAT_INPUT_FIELD_QT_METACAST_OFFSET
    )
    views = _cached_model_views(
        process, module_base, view_vtable, field_vtable
    )
    pairs = _chat_model_pairs(
        process, views, view_vtable, field_vtable
    )
    cache_hit = bool(pairs)
    if not pairs:
        # Start at Cocoa's existing Qt windows. A post-login process can have
        # gigabytes of writable media mappings; scanning its entire heap for
        # a widget address held the main thread stopped until the caller timed
        # out. This route only reads the exact window objects and QObject tree.
        views = _cocoa_chat_model_views(process, view_vtable)
        pairs = _chat_model_pairs(
            process, views, view_vtable, field_vtable
        )
        if pairs:
            _save_model_views(
                process, module_base, view_vtable, field_vtable,
                [pair[0] for pair in pairs],
            )
    return module_base, view_vtable, field_vtable, pairs, cache_hit


def _cocoa_chat_model_views(process, view_vtable):
    threads = [process.GetThreadAtIndex(i) for i in range(process.GetNumThreads())
               if process.GetThreadAtIndex(i).GetQueueName() == "com.apple.main-thread"]
    if len(threads) != 1:
        raise RuntimeError("WeChat main thread is unavailable")
    frame = threads[0].GetFrameAtIndex(0)
    allocation = _evaluate_objc(frame,
        "@import Cocoa; @import Darwin; "
        "unsigned long long *pmxPlatforms=(unsigned long long *)calloc(33,8); "
        "for (NSWindow *pmxWindow in (NSArray *)[NSApp windows]) { "
        "id pmxView=[pmxWindow contentView]; SEL pmxSelector=NSSelectorFromString(@\"platformWindow\"); "
        "if (pmxPlatforms[0]<32 && (BOOL)[pmxView respondsToSelector:pmxSelector]) { "
        "void *(*pmxGetter)(id,SEL)=(void *(*)(id,SEL))[pmxView methodForSelector:pmxSelector]; "
        "pmxPlatforms[++pmxPlatforms[0]]=(unsigned long long)pmxGetter(pmxView,pmxSelector); }} "
        "(unsigned long long)pmxPlatforms")
    if not allocation:
        raise RuntimeError("WeChat Cocoa window directory is unavailable")
    try:
        raw = _read_memory(process, allocation, 33 * 8)
    finally:
        _evaluate_objc(frame, f"@import Darwin; free((void *){allocation}ULL); 1")
    if len(raw) != 33 * 8:
        raise RuntimeError("WeChat Cocoa window directory is unreadable")
    values = struct.unpack("<33Q", raw)
    if values[0] > 32:
        raise RuntimeError("WeChat Cocoa window directory is invalid")
    meta_cache = {}
    def class_name(address):
        if address < 0x100000000 or address % 8:
            return None
        try:
            vtable = _read_pointer(process, address)
            if vtable not in meta_cache:
                chain = _static_qmetaobject_chain(process, vtable)
                meta_cache[vtable] = chain[0]["class"] if chain else None
            return meta_cache[vtable]
        except Exception:
            return None
    roots = set()
    for platform in values[1:1 + values[0]]:
        # QPlatformSurface keeps a QSurface pointer; QWindow's QObject base
        # precedes that subobject. Validate the actual metadata after following
        # either pointer form instead of treating an unchecked offset as Qt.
        raw = _read_memory(process, platform, 64)
        if len(raw) != 64:
            continue
        for pointer in struct.unpack("<8Q", raw):
            for candidate in (pointer, pointer - 16):
                if class_name(candidate) != "QWidgetWindow":
                    continue
                widget_window = _read_memory(process, candidate, 128)
                if len(widget_window) != 128:
                    continue
                for widget in struct.unpack("<16Q", widget_window):
                    name = class_name(widget)
                    if name and (name.startswith("mmui::") or name == "QWidget"):
                        roots.add(_qobject_root(process, widget))
    if not roots:
        raise RuntimeError("WeChat has no accessible Qt chat window yet")
    found = set()
    for root in roots:
        for address in _qobject_tree(process, root):
            if _read_pointer(process, address) == view_vtable:
                found.add(address)
    return sorted(found)


def _qmetaobject_chain_from_address(process, metaobject):
    chain = []
    seen = set()
    while metaobject and metaobject not in seen and len(chain) < 32:
        seen.add(metaobject)
        raw = _read_memory(process, metaobject, 48)
        if len(raw) != 48:
            raise RuntimeError("QObject metaobject is unreadable")
        (
            superdata,
            stringdata,
            metadata,
            static_metacall,
            _related_metaobjects,
            _extradata,
        ) = struct.unpack("<6Q", raw)
        header = _read_memory(process, metadata, 56)
        if len(header) != 56:
            raise RuntimeError("QObject metadata header is unreadable")
        values = struct.unpack("<14I", header)
        def read_string(index):
            descriptor_address = stringdata + index * 24
            descriptor = _read_memory(process, descriptor_address, 24)
            if len(descriptor) != 24:
                raise RuntimeError("QObject string descriptor is unreadable")
            length = struct.unpack_from("<I", descriptor, 4)[0]
            relative = struct.unpack_from("<q", descriptor, 16)[0]
            if length > 256:
                raise RuntimeError("QObject string is invalid")
            return _read_memory(
                process, descriptor_address + relative, length
            ).decode("utf-8", errors="replace")

        class_name = read_string(0)
        method_count = values[4]
        method_data = values[5]
        method_table = _read_memory(
            process, metadata + method_data * 4, method_count * 5 * 4
        )
        if len(method_table) != method_count * 5 * 4:
            raise RuntimeError("QObject method metadata is unreadable")
        methods = []
        for index in range(method_count):
            name_index, argument_count, parameters, _tag, flags = (
                struct.unpack_from("<5I", method_table, index * 20)
            )
            parameter_table = _read_memory(
                process,
                metadata + parameters * 4,
                (1 + argument_count * 2) * 4,
            )
            if len(parameter_table) != (1 + argument_count * 2) * 4:
                raise RuntimeError("QObject parameter metadata is unreadable")
            values_and_names = struct.unpack(
                f"<{1 + argument_count * 2}I", parameter_table
            )
            argument_types = []
            for type_value in values_and_names[1:1 + argument_count]:
                argument_types.append(
                    read_string(type_value & 0x7FFFFFFF)
                    if type_value & 0x80000000
                    else f"metatype:{type_value}"
                )
            argument_names = [
                read_string(name_value)
                for name_value in values_and_names[1 + argument_count:]
            ]
            methods.append(
                {
                    "name": read_string(name_index),
                    "argumentTypes": argument_types,
                    "argumentNames": argument_names,
                    "flags": flags,
                }
            )
        method_names = [method["name"] for method in methods]
        chain.append(
            {
                "class": class_name,
                "metaobject": f"0x{metaobject:x}",
                "staticMetacall": f"0x{static_metacall:x}",
                "methodCount": method_count,
                "signalCount": values[13],
                "methodNames": method_names,
                "methods": methods,
            }
        )
        metaobject = superdata
    return chain


def _qmetaobject_chain(process, frame, object_address):
    metaobject = _evaluate(
        frame,
        "(unsigned long long)((void *(*)(void *))"
        f"(*(void ***){object_address:#x})[0])((void *){object_address:#x})",
    )
    return _qmetaobject_chain_from_address(process, metaobject)


def _static_qmetaobject_chain(process, vtable):
    function = _read_pointer(process, vtable)
    code = _read_memory(process, function, 160)
    for offset in range(0, len(code) - 8, 4):
        instruction = struct.unpack_from("<I", code, offset)[0]
        if instruction & 0x9F000000 != 0x90000000:
            continue
        register = instruction & 31
        immediate = ((instruction >> 29) & 3) | (
            ((instruction >> 5) & 0x7FFFF) << 2
        )
        if immediate & (1 << 20):
            immediate -= 1 << 21
        page = ((function + offset) & ~0xFFF) + (immediate << 12)
        for delta in range(4, min(36, len(code) - offset), 4):
            addition = struct.unpack_from("<I", code, offset + delta)[0]
            if (
                addition & 0x7F000000 != 0x11000000
                or (addition >> 5) & 31 != register
            ):
                continue
            value = page + (
                ((addition >> 10) & 0xFFF)
                << (12 if (addition >> 22) & 1 else 0)
            )
            try:
                chain = _qmetaobject_chain_from_address(process, value)
                if chain:
                    return chain
            except Exception:
                continue
    return []


def _qobject_parent(process, object_address):
    private = _read_pointer(process, object_address + 8)
    return _read_pointer(process, private + 16) if private else 0


def _qobject_children(process, object_address):
    private = _read_pointer(process, object_address + 8)
    if not private:
        return []
    data = _read_pointer(process, private + 24)
    if not data:
        return []
    header = _read_memory(process, data, 16)
    if len(header) != 16:
        return []
    _reference_count, allocation, begin, end = struct.unpack("<4I", header)
    if begin > end or end > allocation or allocation > 16384 or end - begin > 2048:
        return []
    raw = _read_memory(process, data + 16 + begin * 8, (end - begin) * 8)
    if len(raw) != (end - begin) * 8:
        return []
    return [
        address for address in struct.unpack(f"<{end - begin}Q", raw)
        if address
    ]


def _qobject_root(process, object_address):
    current = object_address
    seen = set()
    while current and current not in seen and len(seen) < 64:
        seen.add(current)
        parent = _qobject_parent(process, current)
        if not parent:
            return current
        current = parent
    return object_address


def _qobject_tree(process, root, maximum=4096):
    queue = [root]
    seen = set()
    while queue and len(seen) < maximum:
        current = queue.pop(0)
        if not current or current in seen:
            continue
        seen.add(current)
        queue.extend(_qobject_children(process, current))
    return list(seen)


def _paste_method_index(process, frame, field):
    method_offset = 0
    for entry in reversed(_qmetaobject_chain(process, frame, field)):
        if entry["class"] == "QTextEdit":
            return method_offset + 22
        method_offset += entry["methodCount"]
    raise RuntimeError("WeChat paste method is unavailable")


def _send_method_index(process, frame, field):
    # 4.1.13's old mapped handler is an app-state callback, not composer
    # submit. Emit the field's actual Qt signal so its existing connection
    # performs the same SendActionType routing as the native composer.
    if not CHAT_INPUT_VIEW_SEND_VIA_FIELD_SIGNAL:
        return 0xFFFFFFFF
    method_offset = 0
    matches = []
    for entry in reversed(_qmetaobject_chain(process, frame, field)):
        if entry["class"] == "mmui::ChatInputField":
            for index, method in enumerate(entry["methods"]):
                if (method["name"] == "send"
                        and method["argumentTypes"] == ["SendActionType"]
                        and method["flags"] & 0x0C == 0x04):
                    matches.append(method_offset + index)
        method_offset += entry["methodCount"]
    if len(matches) != 1 or matches[0] > 512:
        raise RuntimeError("WeChat send signal is unavailable or ambiguous")
    return matches[0]


def _read_short_string(process, address):
    raw = _read_memory(process, address, 24)
    if len(raw) != 24:
        raise RuntimeError("WeChat recipient is unreadable")
    size = raw[23]
    if size & 0x80:
        return None, raw
    if size > 22 or b"\0" in raw[:size]:
        raise RuntimeError("WeChat recipient is invalid")
    return raw[:size].decode("utf-8"), raw


def _read_recipient_string(process, address):
    """Read this build's libc++ string, including long group usernames."""
    value, raw = _read_short_string(process, address)
    if value is not None:
        return value
    pointer, size, capacity = struct.unpack("<3Q", raw)
    capacity &= 0x7FFFFFFFFFFFFFFF
    if not pointer or not 0 < size <= 1024 or capacity <= size:
        raise RuntimeError("WeChat session username is invalid")
    content = _read_memory(process, pointer, size)
    if len(content) != size or b"\0" in content:
        raise RuntimeError("WeChat session username is unreadable")
    return content.decode("utf-8")


def mark_session_read(debugger, _command, result, _dict):
    """Invoke the exact session's native read-state slot, without selection."""
    payload = {"ok": False, "reason": "wechat_mark_read_failed"}
    try:
        request, recipient = _model_request()
        if request.get("kind") != "read":
            raise RuntimeError("WeChat read request has the wrong operation")
        unread = request.get("unread", False)
        if not isinstance(unread, bool):
            raise RuntimeError("WeChat unread state must be a boolean")
        method_name = "MarkSessionUnread" if unread else "MarkSessionRead"
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped for the native read operation")
        module_base, _, _, input_pairs, _ = _available_chat_models(target, process)
        main_threads = [process.GetThreadAtIndex(i)
                        for i in range(process.GetNumThreads())
                        if process.GetThreadAtIndex(i).GetQueueName() == "com.apple.main-thread"]
        if len(main_threads) != 1:
            raise RuntimeError("WeChat main thread is unavailable")
        frame = main_threads[0].GetFrameAtIndex(0)
        objects = set()
        for root in {_qobject_root(process, pair[0]) for pair in input_pairs}:
            objects.update(_qobject_tree(process, root))
        matches = {}
        session_call, session_model_offset, session_argument_offset = (
            _require_offsets(_SESSION_LIST_OFFSETS))
        static_metacall, recipient_offset = _require_offsets(_SESSION_CELL_OFFSETS)
        for address in objects:
            try:
                chain = _static_qmetaobject_chain(process, _read_pointer(process, address))
            except Exception:
                continue
            if not chain or chain[0]["class"] != "mmui::ChatSessionList":
                continue
            model = _read_pointer(process, address + session_model_offset)
            if not model:
                continue
            vector = _evaluate_objc(frame,
                "(unsigned long long)((void *(*)(void *,void *))"
                f"{module_base + session_call}ULL)((void *){model}ULL,"
                f"(void *){address + session_argument_offset}ULL)")
            bounds = _read_memory(process, vector, 16)
            if len(bounds) != 16:
                raise RuntimeError("WeChat session list is unreadable")
            begin, end = struct.unpack("<2Q", bounds)
            if end < begin or (end - begin) % 16 or end - begin > 16 * 65536:
                raise RuntimeError("WeChat session list bounds are invalid")
            for entry in range(begin, end, 16):
                item = _read_pointer(process, entry)
                if not item:
                    continue
                item_chain = _static_qmetaobject_chain(process, _read_pointer(process, item))
                if not item_chain or item_chain[0]["class"] != "mmui::ChatSessionCellViewModel":
                    continue
                if _read_recipient_string(process, item + recipient_offset) != recipient:
                    continue
                methods = item_chain[0]["methods"]
                slots = [i for i, method in enumerate(methods)
                         if method["name"] == method_name and not method["argumentTypes"]
                         and method["flags"] == 10]
                if len(slots) != 1:
                    raise RuntimeError("WeChat native mark-read slot is unavailable")
                call = int(item_chain[0]["staticMetacall"], 16)
                if call != module_base + static_metacall:
                    raise RuntimeError("WeChat session method profile changed")
                matches[item] = (call, slots[0])
        if len(matches) != 1:
            raise RuntimeError(f"expected one exact WeChat session, found {len(matches)}")
        item, (call, slot) = next(iter(matches.items()))
        if _read_recipient_string(process, item + recipient_offset) != recipient:
            raise RuntimeError("WeChat session changed before marking read")
        code = _evaluate_objc(frame,
            "({ void *pmxArgs[1]={0}; "
            f"((void (*)(void *,int,int,void **)){call}ULL)"
            f"((void *){item}ULL,0,{slot},pmxArgs); 1; }})")
        if code != 1:
            raise RuntimeError("WeChat mark-read slot did not return")
        payload = {"ok": True, "submitted": True, "unread": unread}
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    if MODEL_STATUS_PATH:
        _atomic_json(MODEL_STATUS_PATH, payload)
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def _model_request():
    if not MODEL_ARM_PATH or not MODEL_STATUS_PATH:
        raise RuntimeError("WeChat model request paths are unavailable")
    details = os.lstat(MODEL_ARM_PATH)
    if (
        not stat.S_ISREG(details.st_mode)
        or details.st_uid != os.getuid()
        or details.st_mode & 0o777 != 0o600
        or time.time() - details.st_mtime > 60
    ):
        raise RuntimeError("WeChat model request is invalid")
    with open(MODEL_ARM_PATH, "r", encoding="utf-8") as stream:
        request = json.load(stream)
    recipient = request.get("recipient")
    if (
        not isinstance(recipient, str)
        or not recipient
        or "\0" in recipient
        or len(recipient.encode("utf-8")) > (1024 if request.get("kind") in ("read", "rename-group") else 22)
    ):
        raise RuntimeError("WeChat model recipient is invalid")
    return request, recipient


def rename_group(debugger, _command, result, _dict):
    payload = {"ok": False, "reason": "wechat_group_rename_failed"}
    allocations = []
    process = None
    try:
        request, recipient = _model_request()
        name = request.get("name")
        if request.get("kind") != "rename-group" or not re.fullmatch(r"[1-9]\d{0,30}@chatroom", recipient):
            raise RuntimeError("WeChat group recipient is invalid")
        if not isinstance(name, str) or not name.strip() or len(name.encode("utf-8")) > 1024 or re.search(r"[\x00-\x1f\x7f]", name):
            raise RuntimeError("WeChat group name is invalid")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while submitting a group rename")
        main = [process.GetThreadAtIndex(i) for i in range(process.GetNumThreads())
                if process.GetThreadAtIndex(i).GetQueueName() == "com.apple.main-thread"]
        if len(main) != 1:
            raise RuntimeError("WeChat's main thread is unavailable")
        module_base = _module_base(target)

        def native_string(value):
            encoded = value.encode("utf-8")
            address = _allocate(process, 24 + len(encoded) + 1)
            allocations.append(address)
            # Exact-build libc++ ABI: inline bytes + length at byte 23; long
            # strings have pointer, byte length and capacity with the top bit
            # set. ModifyChatRoomName copies both const inputs into its owned
            # closure before returning, including Unicode and long names.
            header = (encoded.ljust(23, b"\0") + bytes([len(encoded)])) if len(encoded) <= 22 else struct.pack(
                "<QQQ", address + 24, len(encoded), (len(encoded) + 1) | (1 << 63))
            _write(process, address, header + encoded + b"\0")
            return address

        chat_string, name_string = native_string(recipient), native_string(name)
        # Profile 4.1.11/269136 (hash checked before attaching): both real UI
        # setters at 0x3A78FC / 0x3BF278 pass (service, recipient, name).
        # The wrapper never reads its service argument; it obtains the dispatch
        # context globally and queues an owned native operation. Only the build
        # it was derived from may call it.
        rename_call, = _require_offsets(("RENAME_GROUP_CALL_OFFSET",))
        code = _evaluate_objc(main[0].GetFrameAtIndex(0),
            "({ "
            f"((void (*)(void *,const void *,const void *)){module_base + rename_call}ULL)"
            f"((void *)0,(const void *){chat_string}ULL,(const void *){name_string}ULL); 1; }})")
        if code != 1:
            raise RuntimeError("WeChat's group rename did not return")
        payload = {"ok": True, "submitted": True}
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    finally:
        if process and process.IsValid() and process.GetState() == lldb.eStateStopped:
            for address in allocations:
                process.DeallocateMemory(address)
    if MODEL_STATUS_PATH:
        _atomic_json(MODEL_STATUS_PATH, payload)
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def send_model_paste(debugger, _command, result, _dict):
    payload = {"scheduled": False, "reason": "wechat_model_send_failed"}
    try:
        if not PRIME_DYLIB_PATH or not os.path.isfile(PRIME_DYLIB_PATH):
            raise RuntimeError("the bundled WeChat primer library is unavailable")
        _request, recipient = _model_request()
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while sending through its model")
        module_base, view_vtable, field_vtable, pairs, _cache_hit = (
            _available_chat_models(target, process)
        )
        exact = [pair for pair in pairs if pair[2] == recipient]
        blank = [pair for pair in pairs if pair[2] == ""]
        # Resolve a candidate model here; the resident helper still requires
        # its current recipient to match before touching the pasteboard or
        # submitting. An empty or different recipient is never overwritten.
        candidates = exact if len(exact) == 1 else blank
        if len(candidates) != 1 and len(pairs) == 1:
            candidates = pairs
        if len(candidates) != 1:
            raise RuntimeError("no unique WeChat chat model is available")
        view, field, observed_recipient, _original_recipient = candidates[0]

        thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                thread = candidate
                break
        frame = thread.GetFrameAtIndex(0)
        paste_method_index = _paste_method_index(process, frame, field)
        send_method_index = _send_method_index(process, frame, field)

        library = json.dumps(PRIME_DYLIB_PATH)
        status = json.dumps(MODEL_STATUS_PATH)
        request_path = json.dumps(MODEL_ARM_PATH)
        module_base = _module_base(target)
        code = _evaluate_objc(
            frame,
            "@import Darwin; "
            f"void *pmxHandle=dlopen({library},2); "
            "int (*pmxConfigure)(unsigned long long,unsigned long long,"
            "unsigned long long,unsigned int,unsigned long long,"
            "unsigned long long,unsigned int,unsigned int)=(int (*)(unsigned long long,"
            "unsigned long long,unsigned long long,unsigned int,"
            "unsigned long long,unsigned long long,unsigned int,unsigned int))"
            "dlsym(pmxHandle,\"polymux_configure_wechat_model\"); "
            "int (*pmxSend)(const char *,const char *,unsigned long long,"
            "unsigned long long,unsigned long long,unsigned int)="
            "(int (*)(const char *,const char *,unsigned long long,"
            "unsigned long long,unsigned long long,unsigned int))"
            "dlsym(pmxHandle,\"polymux_send_wechat_model_paste\"); "
            f"int pmxConfigured=pmxConfigure ? pmxConfigure({field}ULL,"
            f"{view}ULL,{module_base + CHAT_INPUT_VIEW_SEND_OFFSET}ULL,"
            f"{paste_method_index}U,{field_vtable}ULL,{view_vtable}ULL,"
            f"{CHAT_INPUT_VIEW_RECIPIENT_OFFSET}U,"
            f"{send_method_index}U) : -99; "
            f"pmxConfigured == 1 && pmxSend ? pmxSend({status},{request_path},"
            f"{field}ULL,{view}ULL,{module_base + CHAT_INPUT_VIEW_SEND_OFFSET}ULL,"
            f"{paste_method_index}U) : pmxConfigured",
            timeout_seconds=30,
        )
        if code != 1:
            raise RuntimeError(f"WeChat model send returned {code}")
        payload = {
            "scheduled": True,
            "reason": "",
            "usedExistingRecipient": observed_recipient == recipient,
        }
    except Exception as error:
        payload = {"scheduled": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def schedule_service_text(debugger, _command, result, _dict):
    """Queue the owned message-service helper, then let the host detach.

    No selected composer or message memory is reused. The helper checks the
    loaded build, current account, expiring private request, and duplicate ID
    on the main queue before invoking Desktop's send service.
    """
    payload = {"scheduled": False, "reason": "wechat_native_service_unavailable"}
    submission_uncertain = False
    try:
        library = os.environ.get("POLYMUX_WECHAT_SERVICE_DYLIB", "")
        if not os.path.isfile(library):
            raise RuntimeError("the bundled WeChat message library is unavailable")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while scheduling its message")
        _module_base(target)
        threads = [thread for thread in process.threads
                   if thread.GetQueueName() == "com.apple.main-thread"]
        if len(threads) != 1:
            raise RuntimeError("WeChat main thread is unavailable")
        # Evaluation can queue the main-thread action and then time out before
        # returning its value. Only a definite helper refusal proves no send.
        submission_uncertain = True
        code = _evaluate_objc(
            threads[0].GetFrameAtIndex(0),
            "@import Darwin; "
            f"void *pmxHandle=dlopen({json.dumps(library)},2); "
            "int (*pmxSend)(const char *,const char *)="
            "(int (*)(const char *,const char *))"
            "dlsym(pmxHandle,\"polymux_send_wechat_service_text\"); "
            f"pmxSend ? pmxSend({json.dumps(MODEL_STATUS_PATH)},"
            f"{json.dumps(MODEL_ARM_PATH)}) : -1",
            timeout_seconds=5,
        )
        if code == -1:
            submission_uncertain = False
        if code != 1:
            raise RuntimeError(f"WeChat message scheduler returned {code}")
        payload = {"scheduled": True}
    except Exception as error:
        payload = {"scheduled": False, "reason": str(error)}
        if submission_uncertain:
            payload["deliveryUnconfirmed"] = True
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def prepare_model_service(debugger, _command, result, _dict):
    payload = {"prepared": False, "reason": "wechat_model_prepare_failed"}
    try:
        if not PRIME_DYLIB_PATH or not os.path.isfile(PRIME_DYLIB_PATH):
            raise RuntimeError("the bundled WeChat primer library is unavailable")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while preparing its model")
        module_base, view_vtable, field_vtable, pairs, cache_hit = (
            _available_chat_models(target, process)
        )
        # Preparing the resident channel does not mutate the model or its
        # current recipient.  A freshly relaunched WeChat commonly restores
        # the last chat, so requiring an empty composer here needlessly sends
        # the operation through the debugger/daemon fallback (which is the
        # path most likely to raise WeChat).  Prefer the empty model when it
        # is unambiguous; otherwise a single live model is equally safe and
        # the actual send still requires a matching existing recipient.
        blank = [pair for pair in pairs if pair[2] == ""]
        candidates = blank if len(blank) == 1 else pairs
        if len(candidates) != 1:
            raise RuntimeError("no unique WeChat chat model is available")
        view, field, _recipient, _raw_recipient = candidates[0]
        thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                thread = candidate
                break
        frame = thread.GetFrameAtIndex(0)
        paste_method_index = _paste_method_index(process, frame, field)
        send_method_index = _send_method_index(process, frame, field)
        library = json.dumps(PRIME_DYLIB_PATH)
        code = _evaluate_objc(
            frame,
            "@import Darwin; "
            f"void *pmxHandle=dlopen({library},2); "
            "int (*pmxConfigure)(unsigned long long,unsigned long long,"
            "unsigned long long,unsigned int,unsigned long long,"
            "unsigned long long,unsigned int,unsigned int)=(int (*)(unsigned long long,"
            "unsigned long long,unsigned long long,unsigned int,"
            "unsigned long long,unsigned long long,unsigned int,unsigned int))"
            "dlsym(pmxHandle,\"polymux_configure_wechat_model\"); "
            f"pmxConfigure ? pmxConfigure({field}ULL,{view}ULL,"
            f"{module_base + CHAT_INPUT_VIEW_SEND_OFFSET}ULL,"
            f"{paste_method_index}U,{field_vtable}ULL,{view_vtable}ULL,"
            f"{CHAT_INPUT_VIEW_RECIPIENT_OFFSET}U,"
            f"{send_method_index}U) : -99",
            timeout_seconds=30,
        )
        if code != 1:
            raise RuntimeError(f"WeChat model preparation returned {code}")
        payload = {"prepared": True, "cacheHit": cache_hit, "reason": ""}
    except Exception as error:
        payload = {"prepared": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def inspect_chat_input_views(debugger, _command, result, _dict):
    payload = {"ok": False, "reason": "chat_input_view_scan_failed"}
    try:
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while locating chat inputs")
        _module, view_vtable, field_vtable, pairs, cache_hit = (
            _available_chat_models(target, process)
        )
        fields = [pair[1] for pair in pairs]
        frame = process.GetSelectedThread().GetFrameAtIndex(0)
        field_chain = (
            _qmetaobject_chain(process, frame, fields[0])
            if fields
            else []
        )
        paste_method_index = (
            _paste_method_index(process, frame, fields[0])
            if fields else None
        )
        payload = {
            "ok": bool(pairs),
            "cacheHit": cache_hit,
            "viewVtable": f"0x{view_vtable:x}",
            "views": [f"0x{pair[0]:x}" for pair in pairs],
            "recipients": [pair[2] for pair in pairs],
            "fieldVtable": f"0x{field_vtable:x}",
            "fields": [f"0x{address:x}" for address in fields],
            "fieldChain": field_chain,
            "pasteMethodIndex": paste_method_index,
            "reason": "" if pairs else "chat_input_objects_unavailable",
        }
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def inspect_message_views(debugger, _command, result, _dict):
    payload = {"ok": False, "reason": "message_view_scan_failed"}
    try:
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while locating message views")
        module_base = _module_base(target)
        metacast = module_base + MESSAGE_VIEW_QT_METACAST_OFFSET
        metacast_hits = _find_memory_pattern(
            process,
            module_base + WECHAT_DATA_CONST_OFFSET,
            module_base + WECHAT_DATA_CONST_OFFSET + WECHAT_DATA_CONST_SIZE,
            struct.pack("<Q", metacast),
            maximum=8,
        )
        frame = process.GetSelectedThread().GetFrameAtIndex(0)
        _input_module, _input_vtable, _field_vtable, input_pairs, _cache = (
            _available_chat_models(target, process)
        )
        roots = sorted({_qobject_root(process, pair[0]) for pair in input_pairs})
        tree_objects = []
        for root in roots:
            tree_objects.extend(_qobject_tree(process, root))
        tree_objects = list(dict.fromkeys(tree_objects))
        representatives = {}
        for address in tree_objects:
            try:
                representatives.setdefault(_read_pointer(process, address), address)
            except Exception:
                continue
        message_vtables = {}
        interesting_objects = []
        primary_classes = {}
        for vtable, representative in representatives.items():
            try:
                chain = _static_qmetaobject_chain(process, vtable)
            except Exception:
                continue
            if any(entry["class"] == "mmui::MessageView" for entry in chain):
                message_vtables[vtable] = chain
            primary = chain[0] if chain else {}
            primary_classes[vtable] = primary.get("class", "")
            searchable = " ".join(
                [str(primary.get("class", ""))]
                + [str(name) for name in primary.get("methodNames", [])]
            ).lower()
            if any(
                keyword in searchable
                for keyword in ("session", "message", "chat", "conversation")
            ):
                interesting_objects.append(
                    {
                        "object": f"0x{representative:x}",
                        "vtable": f"0x{vtable:x}",
                        "class": primary.get("class", ""),
                        "metaobject": primary.get("metaobject", "0x0"),
                        "staticMetacall": primary.get("staticMetacall", "0x0"),
                        "methodNames": primary.get("methodNames", []),
                        "methods": primary.get("methods", []),
                    }
                )
        session_cells = [
            address for address in tree_objects
            if primary_classes.get(_read_pointer(process, address))
            in ("mmui::ChatSessionCell", "mmui::BrandSessionCell")
        ]
        filehelper_cells = []
        for cell in session_cells:
            raw = _read_memory(process, cell, 0x600)
            direct = [
                offset for offset in range(len(raw))
                if raw.startswith(b"filehelper", offset)
            ]
            pointer_hits = []
            for offset in range(0, min(len(raw), 0x400) - 7, 8):
                pointer = struct.unpack_from("<Q", raw, offset)[0]
                if pointer < 0x100000000 or pointer >= 0x800000000000:
                    continue
                pointed = _read_memory(process, pointer, 0x600)
                found = pointed.find(b"filehelper")
                if found >= 0:
                    pointer_hits.append(
                        {
                            "fieldOffset": f"0x{offset:x}",
                            "pointer": f"0x{pointer:x}",
                            "needleOffset": f"0x{found:x}",
                        }
                    )
            if direct or pointer_hits:
                filehelper_cells.append(
                    {
                        "cell": f"0x{cell:x}",
                        "directOffsets": [f"0x{offset:x}" for offset in direct],
                        "pointerHits": pointer_hits,
                    }
                )
        entries = []
        candidates = []
        for metacast_hit in metacast_hits:
            view_vtable = metacast_hit - 8
            tree_views = [
                address for address in tree_objects
                if _read_pointer(process, address) == view_vtable
            ]
            views = tree_views
            candidates.append(
                {
                    "viewVtable": f"0x{view_vtable:x}",
                    "viewCount": len(views),
                    "views": [f"0x{view:x}" for view in views],
                }
            )
        for view in tree_objects:
            view_vtable = _read_pointer(process, view)
            if view_vtable not in message_vtables:
                continue
            try:
                model = _read_pointer(process, view + MESSAGE_VIEW_MODEL_OFFSET)
                model_vtable = _read_pointer(process, model)
                entries.append(
                    {
                        "view": f"0x{view:x}",
                        "viewVtable": f"0x{view_vtable:x}",
                        "viewChain": message_vtables[view_vtable],
                        "model": f"0x{model:x}",
                        "modelVtable": f"0x{model_vtable:x}",
                    }
                )
            except Exception:
                continue
        payload = {
            "ok": bool(entries),
            "roots": [f"0x{root:x}" for root in roots],
            "treeObjectCount": len(tree_objects),
            "uniqueVtableCount": len(representatives),
            "messageVtables": [f"0x{vtable:x}" for vtable in message_vtables],
            "interestingObjects": interesting_objects,
            "sessionCellCount": len(session_cells),
            "filehelperCells": filehelper_cells,
            "candidates": candidates,
            "entries": entries,
            "reason": "" if entries else "message_view_objects_unavailable",
        }
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def inspect_message_id(debugger, command, result, _dict):
    payload = {"ok": False, "reason": "message_id_scan_failed"}
    try:
        value = int(command.strip(), 0)
        if not 0 < value <= 0xFFFFFFFFFFFFFFFF:
            raise RuntimeError("message id is out of range")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while locating a message id")
        varint = bytearray()
        remaining = value
        while remaining >= 0x80:
            varint.append((remaining & 0x7F) | 0x80)
            remaining >>= 7
        varint.append(remaining)
        needles = [
            ("uint64", struct.pack("<Q", value)),
            ("decimal", str(value).encode("ascii")),
            ("varint", bytes(varint)),
        ]
        hits = []
        regions = process.GetMemoryRegions()
        for index in range(regions.GetSize()):
            region = lldb.SBMemoryRegionInfo()
            if not regions.GetMemoryRegionAtIndex(index, region):
                continue
            if (
                not region.IsMapped()
                or not region.IsReadable()
                or not region.IsWritable()
            ):
                continue
            start = region.GetRegionBase()
            end = region.GetRegionEnd()
            if end - start > 4 * 1024 * 1024:
                continue
            for encoding, needle in needles:
                for address in _find_memory_pattern(
                    process, start, end, needle, maximum=max(1, 64 - len(hits))
                ):
                    context_start = max(start, address - 0x200)
                    context_end = min(end, address + 0x208)
                    context = _read_memory(
                        process, context_start, context_end - context_start
                    )
                    hits.append(
                        {
                            "address": f"0x{address:x}",
                            "encoding": encoding,
                            "regionStart": f"0x{start:x}",
                            "regionEnd": f"0x{end:x}",
                            "contextStart": f"0x{context_start:x}",
                            "contextBase64": base64.b64encode(context).decode("ascii"),
                        }
                    )
                    if len(hits) >= 64:
                        break
                if len(hits) >= 64:
                    break
            if len(hits) >= 64:
                break
        payload = {
            "ok": bool(hits),
            "messageId": str(value),
            "hits": hits,
            "reason": "" if hits else "message_id_not_resident",
        }
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def inspect_direct_branches(debugger, command, result, _dict):
    payload = {"ok": False, "reason": "direct_branch_scan_failed"}
    try:
        offsets = [int(value, 0) for value in command.split()]
        if not offsets or any(
            value < WECHAT_TEXT_OFFSET
            or value >= WECHAT_TEXT_OFFSET + WECHAT_TEXT_SIZE
            for value in offsets
        ):
            raise RuntimeError("supply one or more WeChat __text offsets")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while scanning branches")
        module_base = _module_base(target)
        wanted = {module_base + offset: offset for offset in offsets}
        start = module_base + WECHAT_TEXT_OFFSET
        end = start + WECHAT_TEXT_SIZE
        hits = []
        cursor = start
        while cursor < end:
            size = min(4 * 1024 * 1024, end - cursor)
            data = _read_memory(process, cursor, size)
            if not data:
                raise RuntimeError(f"WeChat __text became unreadable at {cursor:#x}")
            for byte_offset in range(0, len(data) - 3, 4):
                instruction = struct.unpack_from("<I", data, byte_offset)[0]
                operation = instruction & 0xFC000000
                if operation not in (0x14000000, 0x94000000):
                    continue
                immediate = instruction & 0x03FFFFFF
                if immediate & 0x02000000:
                    immediate -= 0x04000000
                address = cursor + byte_offset
                destination = address + immediate * 4
                if destination not in wanted:
                    continue
                hits.append(
                    {
                        "address": f"0x{address:x}",
                        "offset": f"0x{address - module_base:x}",
                        "kind": "bl" if operation == 0x94000000 else "b",
                        "target": f"0x{wanted[destination]:x}",
                    }
                )
            cursor += len(data)
        payload = {
            "ok": True,
            "moduleBase": f"0x{module_base:x}",
            "hits": hits,
            "reason": "",
        }
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def inspect_static_data_references(debugger, command, result, _dict):
    payload = {"ok": False, "reason": "static_data_reference_scan_failed"}
    try:
        offsets = [int(value, 0) for value in command.split()]
        if not offsets:
            raise RuntimeError("supply one or more WeChat data offsets")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while scanning data references")
        module_base = _module_base(target)
        wanted = {module_base + offset: offset for offset in offsets}
        start = module_base + WECHAT_TEXT_OFFSET
        end = start + WECHAT_TEXT_SIZE
        hits = []
        cursor = start
        trailing = b""
        while cursor < end:
            size = min(4 * 1024 * 1024, end - cursor)
            chunk = _read_memory(process, cursor, size)
            if not chunk:
                raise RuntimeError(f"WeChat __text became unreadable at {cursor:#x}")
            data = trailing + chunk
            data_start = cursor - len(trailing)
            for byte_offset in range(0, len(data) - 24, 4):
                instruction = struct.unpack_from("<I", data, byte_offset)[0]
                if instruction & 0x9F000000 != 0x90000000:
                    continue
                register = instruction & 31
                immediate = ((instruction >> 29) & 3) | (
                    ((instruction >> 5) & 0x7FFFF) << 2
                )
                if immediate & (1 << 20):
                    immediate -= 1 << 21
                address = data_start + byte_offset
                page = (address & ~0xFFF) + (immediate << 12)
                for delta in range(4, 25, 4):
                    following = struct.unpack_from(
                        "<I", data, byte_offset + delta
                    )[0]
                    # ADD Xd, Xn, #imm12{, LSL #12}
                    if (
                        following & 0x7F000000 == 0x11000000
                        and (following >> 5) & 31 == register
                    ):
                        resolved = page + (
                            ((following >> 10) & 0xFFF)
                            << (12 if (following >> 22) & 1 else 0)
                        )
                        if resolved in wanted:
                            hits.append(
                                {
                                    "address": f"0x{address:x}",
                                    "offset": f"0x{address - module_base:x}",
                                    "resolved": f"0x{resolved:x}",
                                    "targetOffset": f"0x{wanted[resolved]:x}",
                                    "delta": delta,
                                }
                            )
            trailing = data[-24:]
            cursor += len(chunk)
        payload = {
            "ok": True,
            "moduleBase": f"0x{module_base:x}",
            "hits": hits,
            "reason": "",
        }
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def inspect_session_model(debugger, _command, result, _dict):
    payload = {"ok": False, "reason": "session_model_scan_failed"}
    try:
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while locating session data")
        module_base, _view_vtable, _field_vtable, input_pairs, _cache = (
            _available_chat_models(target, process)
        )
        roots = sorted({_qobject_root(process, pair[0]) for pair in input_pairs})
        tree_objects = []
        for root in roots:
            tree_objects.extend(_qobject_tree(process, root))
        tree_objects = list(dict.fromkeys(tree_objects))
        session_lists = []
        for address in tree_objects:
            try:
                chain = _static_qmetaobject_chain(
                    process, _read_pointer(process, address)
                )
            except Exception:
                continue
            if chain and chain[0]["class"] == "mmui::ChatSessionList":
                session_lists.append(address)
        main_thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                main_thread = candidate
                break
        frame = main_thread.GetFrameAtIndex(0)
        session_call, session_model_offset, session_argument_offset = (
            _require_offsets(_SESSION_LIST_OFFSETS))
        _, recipient_offset = _require_offsets(_SESSION_CELL_OFFSETS)
        lists = []
        for session_list in session_lists:
            backing_model = _read_pointer(process, session_list + session_model_offset)
            if not backing_model:
                continue
            vector = _evaluate_objc(
                frame,
                "(unsigned long long)((void *(*)(void *,void *))"
                f"{module_base + session_call}ULL)((void *){backing_model}ULL,"
                f"(void *){session_list + session_argument_offset}ULL)",
            )
            bounds = _read_memory(process, vector, 16)
            if len(bounds) != 16:
                raise RuntimeError("chat session vector is unreadable")
            begin, end = struct.unpack("<2Q", bounds)
            if end < begin or (end - begin) % 16 or end - begin > 4096:
                raise RuntimeError("chat session vector bounds are invalid")
            entries = []
            for row, entry_address in enumerate(range(begin, end, 16)):
                raw = _read_memory(process, entry_address, 16)
                if len(raw) != 16:
                    raise RuntimeError("chat session entry is unreadable")
                item, owner = struct.unpack("<2Q", raw)
                username = None
                if item:
                    try:
                        username, _raw_username = _read_short_string(
                            process, item + recipient_offset
                        )
                    except Exception:
                        username = None
                entries.append(
                    {
                        "row": row,
                        "item": f"0x{item:x}",
                        "owner": f"0x{owner:x}",
                        "username": username,
                    }
                )
            lists.append(
                {
                    "sessionList": f"0x{session_list:x}",
                    "backingModel": f"0x{backing_model:x}",
                    "vector": f"0x{vector:x}",
                    "entries": entries,
                }
            )
        payload = {
            "ok": bool(lists),
            "lists": lists,
            "reason": "" if lists else "chat_session_model_unavailable",
        }
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def inspect_filehelper_chat_state(debugger, _command, result, _dict):
    payload = {"ok": False, "reason": "filehelper_chat_state_unavailable"}
    try:
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while checking File Transfer")
        _module, _view_vtable, _field_vtable, input_pairs, _cache = (
            _available_chat_models(target, process)
        )
        filehelper_pairs = [pair for pair in input_pairs if pair[2] == "filehelper"]
        if len(filehelper_pairs) != 1:
            raise RuntimeError(
                f"expected one File Transfer composer, found {len(filehelper_pairs)}"
            )
        input_view = filehelper_pairs[0][0]
        root = _qobject_root(process, input_view)
        pages = []
        message_views = []
        for address in _qobject_tree(process, root):
            try:
                chain = _static_qmetaobject_chain(
                    process, _read_pointer(process, address)
                )
            except Exception:
                continue
            primary = chain[0]["class"] if chain else ""
            if primary == "mmui::ChatMessagePage":
                session, _raw = _read_short_string(process, address + 0x1D0)
                pages.append(
                    {"page": f"0x{address:x}", "session": session}
                )
            elif primary == "mmui::MessageView":
                model = _read_pointer(process, address + MESSAGE_VIEW_MODEL_OFFSET)
                view_session, _raw = _read_short_string(process, address + 0x210)
                model_session = None
                vector = [0, 0, 0]
                connections = [0, 0]
                if model:
                    model_session, _raw = _read_short_string(process, model + 0x2B0)
                    vector_raw = _read_memory(process, model + 0x68, 24)
                    if len(vector_raw) == 24:
                        vector = list(struct.unpack("<3Q", vector_raw))
                    connections = [
                        _read_pointer(process, model + 0x318),
                        _read_pointer(process, model + 0x320),
                    ]
                begin, end, capacity = vector
                vector_count = None
                if begin <= end <= capacity and (end - begin) % 8 == 0:
                    vector_count = (end - begin) // 8
                message_views.append(
                    {
                        "view": f"0x{address:x}",
                        "viewSession": view_session,
                        "model": f"0x{model:x}",
                        "modelSession": model_session,
                        "vector": [f"0x{value:x}" for value in vector],
                        "vectorCount": vector_count,
                        "connections": [
                            f"0x{value:x}" for value in connections
                        ],
                    }
                )
        payload = {
            "ok": bool(pages) and bool(message_views),
            "inputView": f"0x{input_view:x}",
            "recipient": "filehelper",
            "pages": pages,
            "messageViews": message_views,
            "reason": "" if pages and message_views else "chat_page_or_model_missing",
        }
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def inspect_filehelper_message_widget(debugger, command, result, _dict):
    payload = {"ok": False, "reason": "filehelper_message_widget_unavailable"}
    try:
        message_id = int(command.strip(), 0)
        if not 0 < message_id <= 0xFFFFFFFFFFFFFFFF:
            raise RuntimeError("supply a valid server message id")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while checking the message widget")
        _module, _view_vtable, _field_vtable, input_pairs, _cache = (
            _available_chat_models(target, process)
        )
        filehelper_pairs = [pair for pair in input_pairs if pair[2] == "filehelper"]
        if len(filehelper_pairs) != 1:
            raise RuntimeError(
                f"expected one File Transfer composer, found {len(filehelper_pairs)}"
            )
        root = _qobject_root(process, filehelper_pairs[0][0])
        tree = _qobject_tree(process, root)
        message_objects = []
        for address in tree:
            try:
                chain = _static_qmetaobject_chain(
                    process, _read_pointer(process, address)
                )
            except Exception:
                continue
            if not chain or chain[0]["class"] != "mmui::MessageView":
                continue
            model = _read_pointer(process, address + MESSAGE_VIEW_MODEL_OFFSET)
            if not model:
                continue
            vector_raw = _read_memory(process, model + 0x68, 24)
            if len(vector_raw) != 24:
                continue
            begin, end, capacity = struct.unpack("<3Q", vector_raw)
            if not begin <= end <= capacity or (end - begin) % 16:
                continue
            for entry in range(begin, end, 16):
                message = _read_pointer(process, entry)
                if not message:
                    continue
                raw = _read_memory(process, message, 0x400)
                if struct.pack("<Q", message_id) not in raw or b"filehelper" not in raw:
                    continue
                message_objects.append(message)
        message_objects = list(dict.fromkeys(message_objects))
        if len(message_objects) != 1:
            raise RuntimeError(
                f"expected one File Transfer message object, found {len(message_objects)}"
            )
        message = message_objects[0]
        message_pointer = struct.pack("<Q", message)
        message_pattern = struct.pack("<Q", message_id)
        widgets = []
        for address in tree:
            try:
                chain = _static_qmetaobject_chain(
                    process, _read_pointer(process, address)
                )
            except Exception:
                continue
            if not chain:
                continue
            primary = chain[0]
            class_name = primary["class"]
            if "Chat" not in class_name or not any(
                marker in class_name for marker in ("Item", "Bubble")
            ):
                continue
            raw = _read_memory(process, address, 0x800)
            message_offsets = []
            server_id_offsets = []
            cursor = 0
            while True:
                cursor = raw.find(message_pointer, cursor)
                if cursor < 0:
                    break
                message_offsets.append(f"0x{cursor:x}")
                cursor += 1
            cursor = 0
            while True:
                cursor = raw.find(message_pattern, cursor)
                if cursor < 0:
                    break
                server_id_offsets.append(f"0x{cursor:x}")
                cursor += 1
            if not message_offsets and not server_id_offsets:
                continue
            ancestors = []
            parent = _qobject_parent(process, address)
            seen_parents = set()
            while parent and parent not in seen_parents and len(ancestors) < 12:
                seen_parents.add(parent)
                try:
                    parent_chain = _static_qmetaobject_chain(
                        process, _read_pointer(process, parent)
                    )
                except Exception:
                    parent_chain = []
                parent_primary = parent_chain[0] if parent_chain else {}
                ancestors.append(
                    {
                        "object": f"0x{parent:x}",
                        "class": parent_primary.get("class", ""),
                        "methodNames": parent_primary.get("methodNames", []),
                    }
                )
                parent = _qobject_parent(process, parent)
            widgets.append(
                {
                    "object": f"0x{address:x}",
                    "class": class_name,
                    "messageOffsets": message_offsets,
                    "serverIdOffsets": server_id_offsets,
                    "methodNames": primary.get("methodNames", []),
                    "classChain": [
                        {
                            "class": entry.get("class", ""),
                            "staticMetacall": entry.get("staticMetacall", "0x0"),
                            "methodNames": entry.get("methodNames", []),
                            "methods": entry.get("methods", []),
                        }
                        for entry in chain
                    ],
                    "ancestors": ancestors,
                }
            )
        payload = {
            "ok": bool(widgets),
            "messageId": str(message_id),
            "message": f"0x{message:x}",
            "widgets": widgets,
            "reason": "" if widgets else "message_widget_not_linked",
        }
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def inspect_allocation(debugger, command, result, _dict):
    payload = {"ok": False, "reason": "allocation_scan_failed"}
    try:
        address = int(command.strip(), 0)
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while locating an allocation")
        main_thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                main_thread = candidate
                break
        frame = main_thread.GetFrameAtIndex(0)
        allocation = _evaluate_objc(
            frame,
            "@import Darwin; ({ unsigned long long pmxHit="
            f"{address}ULL,pmxBase=pmxHit&~15ULL,pmxFound=0; "
            "for(unsigned int pmxI=0;pmxI<0x4000;pmxI++,pmxBase-=16){ "
            "unsigned long long pmxSize=malloc_size((void *)pmxBase); "
            "if(pmxSize&&pmxBase<=pmxHit&&pmxBase+pmxSize>pmxHit){"
            "pmxFound=pmxBase;break;} } pmxFound; })",
            timeout_seconds=30,
        )
        if not allocation:
            raise RuntimeError("containing malloc allocation was not found")
        size = _evaluate_objc(
            frame,
            "@import Darwin; (unsigned long long)malloc_size("
            f"(void *){allocation}ULL)",
        )
        if not size or size > 1024 * 1024:
            raise RuntimeError(f"containing malloc allocation size is invalid: {size}")
        raw = _read_memory(process, allocation, size)
        if len(raw) != size:
            raise RuntimeError("containing malloc allocation is unreadable")
        payload = {
            "ok": True,
            "address": f"0x{address:x}",
            "allocation": f"0x{allocation:x}",
            "size": size,
            "offset": f"0x{address - allocation:x}",
            "dataBase64": base64.b64encode(raw).decode("ascii"),
            "reason": "",
        }
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def inspect_pointer_references(debugger, command, result, _dict):
    payload = {"ok": False, "reason": "pointer_reference_scan_failed"}
    try:
        addresses = [int(value, 0) for value in command.split()]
        if not addresses:
            raise RuntimeError("supply one or more target addresses")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while locating references")
        needles = [(address, struct.pack("<Q", address)) for address in addresses]
        hits = []
        regions = process.GetMemoryRegions()
        for index in range(regions.GetSize()):
            region = lldb.SBMemoryRegionInfo()
            if not regions.GetMemoryRegionAtIndex(index, region):
                continue
            if (
                not region.IsMapped()
                or not region.IsReadable()
                or not region.IsWritable()
            ):
                continue
            start = region.GetRegionBase()
            end = region.GetRegionEnd()
            if end - start > 4 * 1024 * 1024:
                continue
            for pointed, needle in needles:
                for address in _find_memory_pattern(
                    process, start, end, needle,
                    maximum=max(1, 128 - len(hits)),
                ):
                    context_start = max(start, address - 0x80)
                    context_end = min(end, address + 0x88)
                    context = _read_memory(
                        process, context_start, context_end - context_start
                    )
                    hits.append(
                        {
                            "address": f"0x{address:x}",
                            "pointsTo": f"0x{pointed:x}",
                            "contextStart": f"0x{context_start:x}",
                            "contextBase64": base64.b64encode(context).decode("ascii"),
                        }
                    )
                    if len(hits) >= 128:
                        break
                if len(hits) >= 128:
                    break
            if len(hits) >= 128:
                break
        payload = {
            "ok": bool(hits),
            "targets": [f"0x{address:x}" for address in addresses],
            "hits": hits,
            "reason": "" if hits else "pointer_references_not_found",
        }
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def inspect_message_model_links(debugger, command, result, _dict):
    payload = {"ok": False, "reason": "message_model_link_scan_failed"}
    try:
        message_id = int(command.strip(), 0)
        if not 0 < message_id <= 0xFFFFFFFFFFFFFFFF:
            raise RuntimeError("supply one positive WeChat message id")
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while tracing message data")
        _module, _view_vtable, _field_vtable, input_pairs, _cache = (
            _available_chat_models(target, process)
        )
        filehelper_roots = {
            _qobject_root(process, pair[0])
            for pair in input_pairs
            if pair[2] == "filehelper"
        }
        module_base = _module_base(target)
        metacast = module_base + MESSAGE_VIEW_QT_METACAST_OFFSET
        metacast_hits = _find_memory_pattern(
            process,
            module_base + WECHAT_DATA_CONST_OFFSET,
            module_base + WECHAT_DATA_CONST_OFFSET + WECHAT_DATA_CONST_SIZE,
            struct.pack("<Q", metacast),
            maximum=8,
        )
        message_candidates = []
        for hit in metacast_hits:
            candidate_vtable = hit - 8
            for candidate_view in _locate_vtable_instances(
                process, candidate_vtable
            ):
                message_candidates.append(
                    (candidate_vtable, candidate_view)
                )
        models = []
        for message_vtable, view in message_candidates:
            if _qobject_root(process, view) not in filehelper_roots:
                continue
            model = _read_pointer(process, view + MESSAGE_VIEW_MODEL_OFFSET)
            if model:
                models.append((message_vtable, view, model))
        if not models:
            raise RuntimeError("the File Transfer message model is unavailable")

        message_pattern = struct.pack("<Q", message_id)
        resident_hits = []
        regions = process.GetMemoryRegions()
        for index in range(regions.GetSize()):
            region = lldb.SBMemoryRegionInfo()
            if not regions.GetMemoryRegionAtIndex(index, region):
                continue
            if (
                not region.IsMapped()
                or not region.IsReadable()
                or not region.IsWritable()
            ):
                continue
            start = region.GetRegionBase()
            end = region.GetRegionEnd()
            if end - start > 4 * 1024 * 1024:
                continue
            resident_hits.extend(
                _find_memory_pattern(
                    process, start, end, message_pattern,
                    maximum=max(1, 32 - len(resident_hits)),
                )
            )
            if len(resident_hits) >= 32:
                break
        resident_pointers = [
            (hit, struct.pack("<Q", hit)) for hit in resident_hits
        ]

        def pointer_words(data):
            values = []
            for offset in range(0, len(data) - 7, 8):
                value = struct.unpack_from("<Q", data, offset)[0]
                if 0x100000000 <= value < 0x800000000000 and value % 8 == 0:
                    values.append((offset, value))
            return values

        def matches(data):
            found = []
            offset = data.find(message_pattern)
            if offset >= 0:
                found.append({"kind": "message_id", "offset": f"0x{offset:x}"})
            offset = data.find(b"filehelper")
            if offset >= 0:
                found.append({"kind": "filehelper", "offset": f"0x{offset:x}"})
            for pointed, pattern in resident_pointers:
                offset = data.find(pattern)
                if offset >= 0:
                    found.append(
                        {
                            "kind": "resident_hit_pointer",
                            "offset": f"0x{offset:x}",
                            "pointsTo": f"0x{pointed:x}",
                        }
                    )
            return found

        links = []
        inspected_children = set()
        for message_vtable, view, model in models:
            model_base = model
            for delta in range(0, 0x101, 8):
                candidate = model - delta
                observed = _read_memory(process, candidate, 8)
                if len(observed) == 8 and struct.unpack("<Q", observed)[0] == message_vtable:
                    model_base = candidate
                    break
            model_data = _read_memory(process, model_base, 0x600)
            for model_offset, value in pointer_words(model_data):
                direct = _read_memory(process, value, 0x1000)
                direct_matches = matches(direct)
                if direct_matches:
                    links.append(
                        {
                            "view": f"0x{view:x}",
                            "model": f"0x{model:x}",
                            "modelField": f"0x{model_offset:x}",
                            "object": f"0x{value:x}",
                            "matches": direct_matches,
                        }
                    )
                for child_offset, child in pointer_words(direct[:0x400]):
                    key = (value, child)
                    if key in inspected_children or len(inspected_children) >= 2048:
                        continue
                    inspected_children.add(key)
                    child_data = _read_memory(process, child, 0x1000)
                    child_matches = matches(child_data)
                    if child_matches:
                        links.append(
                            {
                                "view": f"0x{view:x}",
                                "model": f"0x{model:x}",
                                "modelField": f"0x{model_offset:x}",
                                "object": f"0x{value:x}",
                                "childField": f"0x{child_offset:x}",
                                "child": f"0x{child:x}",
                                "matches": child_matches,
                            }
                        )
        payload = {
            "ok": bool(links),
            "messageId": str(message_id),
            "residentHits": [f"0x{hit:x}" for hit in resident_hits],
            "links": links,
            "reason": "" if links else "message_model_links_not_found",
        }
    except Exception as error:
        payload = {"ok": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def _navigate_trace_stage(frame, _location, _dict):
    if not _NAV_TRACE.get("active"):
        return False
    _NAV_TRACE.setdefault("events", []).append(
        {
            "pc": f"0x{_register_value(frame, 'pc'):x}",
            "x0": f"0x{_register_value(frame, 'x0'):x}",
            "x1": f"0x{_register_value(frame, 'x1'):x}",
            "x2": f"0x{_register_value(frame, 'x2'):x}",
            "x3": f"0x{_register_value(frame, 'x3'):x}",
        }
    )
    return False


def _navigate_skip_null_connection(frame, _location, _dict):
    if not _NAV_TRACE.get("active"):
        return False
    process = frame.GetThread().GetProcess()
    model = _register_value(frame, "x19")
    if model != _NAV_TRACE.get("model"):
        return False
    if _read_pointer(process, model + 0x320):
        return False
    _NAV_TRACE.setdefault("events", []).append(
        {
            "pc": f"0x{_register_value(frame, 'pc'):x}",
            "action": "skip_null_navigation_connection",
            "model": f"0x{model:x}",
        }
    )
    _set_register(frame, "pc", _NAV_TRACE["moduleBase"] + 0x7B9C5C)
    return False


def _navigate_trace_return(frame, _location, _dict):
    if not _NAV_TRACE.get("active"):
        return False
    process = frame.GetThread().GetProcess()
    _NAV_TRACE["returned"] = True
    _restore_registers(frame, _NAV_TRACE["savedRegisters"])
    allocation = _NAV_TRACE.pop("allocation", 0)
    if allocation:
        process.DeallocateMemory(allocation)
    _NAV_TRACE["active"] = False
    return True


def trace_navigate_start(debugger, command, result, _dict):
    payload = {"started": False, "reason": "navigate_trace_start_failed"}
    try:
        parts = command.split()
        if len(parts) != 2:
            raise RuntimeError("supply a MessageView address and server message id")
        view = int(parts[0], 0)
        message_id = int(parts[1], 0)
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped before tracing navigation")
        if _NAV_TRACE.get("active"):
            raise RuntimeError("a navigation trace is already active")
        thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                thread = candidate
                break
        frame = thread.GetFrameAtIndex(0)
        module_base = _module_base(target)
        identifier = _allocate(process, 32)
        raw = bytearray(32)
        struct.pack_into("<Q", raw, 0, message_id)
        _write(process, identifier, raw)
        _NAV_TRACE.clear()
        _NAV_TRACE.update(
            {
                "active": True,
                "returned": False,
                "events": [],
                "threadId": thread.GetThreadID(),
                "savedRegisters": _save_registers(frame),
                "allocation": identifier,
                "moduleBase": module_base,
                "model": _read_pointer(process, view + MESSAGE_VIEW_MODEL_OFFSET),
            }
        )
        return_address = module_base + RET_ZERO_STUB_OFFSET
        navigate_address = module_base + 0x7220AC
        _install_breakpoint(target, return_address, "_navigate_trace_return")
        _install_breakpoint(target, navigate_address + 0x80, "_navigate_trace_stage")
        _install_breakpoint(target, module_base + 0x7B56B8, "_navigate_trace_stage")
        _install_breakpoint(
            target, module_base + 0x7B9C4C,
            "_navigate_skip_null_connection",
        )
        _set_register(frame, "x0", view)
        _set_register(frame, "x1", identifier)
        _set_register(frame, "x2", 1)
        _set_register(frame, "x30", return_address)
        _set_register(frame, "pc", navigate_address)
        payload = {
            "started": True,
            "threadId": thread.GetThreadID(),
            "identifier": f"0x{identifier:x}",
            "reason": "",
        }
    except Exception as error:
        payload = {"started": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def trace_navigate_cleanup(debugger, _command, result, _dict):
    payload = {"restored": False, "reason": "navigate_trace_cleanup_failed"}
    try:
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while restoring navigation")
        if _NAV_TRACE.get("active"):
            thread_id = _NAV_TRACE["threadId"]
            restored = False
            for index in range(process.GetNumThreads()):
                thread = process.GetThreadAtIndex(index)
                if thread.GetThreadID() != thread_id:
                    continue
                _restore_registers(
                    thread.GetFrameAtIndex(0), _NAV_TRACE["savedRegisters"]
                )
                restored = True
                break
            if not restored:
                raise RuntimeError("the traced main thread is unavailable")
            allocation = _NAV_TRACE.pop("allocation", 0)
            if allocation:
                process.DeallocateMemory(allocation)
            _NAV_TRACE["active"] = False
        payload = {
            "restored": True,
            "returned": bool(_NAV_TRACE.get("returned")),
            "events": _NAV_TRACE.get("events", []),
            "reason": "",
        }
    except Exception as error:
        payload = {"restored": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def _session_trace_assignment(frame, _location, _dict):
    if not _SESSION_TRACE.get("active"):
        return False
    process = frame.GetThread().GetProcess()
    source = _register_value(frame, "x1")
    try:
        value, _raw = _read_short_string(process, source)
    except Exception:
        value = None
    if value == "filehelper":
        _SESSION_TRACE.setdefault("events", []).append(
            {
                "destination": f"0x{_register_value(frame, 'x0'):x}",
                "source": f"0x{source:x}",
                "returnAddress": f"0x{_register_value(frame, 'x30'):x}",
            }
        )
    return False


def _session_trace_return(frame, _location, _dict):
    if not _SESSION_TRACE.get("active"):
        return False
    process = frame.GetThread().GetProcess()
    _SESSION_TRACE["returned"] = True
    _restore_registers(frame, _SESSION_TRACE["savedRegisters"])
    allocation = _SESSION_TRACE.pop("allocation", 0)
    if allocation:
        process.DeallocateMemory(allocation)
    _SESSION_TRACE["active"] = False
    return True


def trace_selected_session_start(debugger, command, result, _dict):
    payload = {"started": False, "reason": "session_trace_start_failed"}
    try:
        chat_master = int(command.strip(), 0)
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped before tracing selection")
        if _SESSION_TRACE.get("active"):
            raise RuntimeError("a session trace is already active")
        thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                thread = candidate
                break
        frame = thread.GetFrameAtIndex(0)
        module_base = _module_base(target)
        username = _allocate(process, 24)
        raw = bytearray(24)
        raw[:10] = b"filehelper"
        raw[23] = 10
        _write(process, username, raw)
        _SESSION_TRACE.clear()
        _SESSION_TRACE.update(
            {
                "active": True,
                "returned": False,
                "events": [],
                "threadId": thread.GetThreadID(),
                "savedRegisters": _save_registers(frame),
                "allocation": username,
            }
        )
        return_address = module_base + RET_ZERO_STUB_OFFSET
        _install_breakpoint(target, return_address, "_session_trace_return")
        _install_breakpoint(
            target, module_base + 0x63E2D04, "_session_trace_assignment"
        )
        _set_register(frame, "x0", chat_master)
        _set_register(frame, "x1", username)
        _set_register(frame, "x30", return_address)
        _set_register(frame, "pc", module_base + 0xB7D24)
        payload = {
            "started": True,
            "threadId": thread.GetThreadID(),
            "username": f"0x{username:x}",
            "reason": "",
        }
    except Exception as error:
        payload = {"started": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def trace_selected_session_cleanup(debugger, _command, result, _dict):
    payload = {"restored": False, "reason": "session_trace_cleanup_failed"}
    try:
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while restoring selection")
        if _SESSION_TRACE.get("active"):
            thread_id = _SESSION_TRACE["threadId"]
            restored = False
            for index in range(process.GetNumThreads()):
                thread = process.GetThreadAtIndex(index)
                if thread.GetThreadID() != thread_id:
                    continue
                _restore_registers(
                    thread.GetFrameAtIndex(0), _SESSION_TRACE["savedRegisters"]
                )
                restored = True
                break
            if not restored:
                raise RuntimeError("the traced main thread is unavailable")
            allocation = _SESSION_TRACE.pop("allocation", 0)
            if allocation:
                process.DeallocateMemory(allocation)
            _SESSION_TRACE["active"] = False
        payload = {
            "restored": True,
            "returned": bool(_SESSION_TRACE.get("returned")),
            "events": _SESSION_TRACE.get("events", []),
            "reason": "",
        }
    except Exception as error:
        payload = {"restored": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def select_filehelper_session(debugger, _command, result, _dict):
    payload = {"selected": False, "reason": "filehelper_session_select_failed"}
    try:
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while selecting File Transfer")
        module_base, _view_vtable, _field_vtable, input_pairs, _cache = (
            _available_chat_models(target, process)
        )
        roots = sorted({_qobject_root(process, pair[0]) for pair in input_pairs})
        tree_objects = []
        for root in roots:
            tree_objects.extend(_qobject_tree(process, root))
        tree_objects = list(dict.fromkeys(tree_objects))
        session_lists = []
        for address in tree_objects:
            try:
                chain = _static_qmetaobject_chain(
                    process, _read_pointer(process, address)
                )
            except Exception:
                continue
            if chain and chain[0]["class"] == "mmui::ChatSessionList":
                session_lists.append(address)
        main_thread = process.GetSelectedThread()
        for index in range(process.GetNumThreads()):
            candidate = process.GetThreadAtIndex(index)
            if candidate.GetQueueName() == "com.apple.main-thread":
                main_thread = candidate
                break
        frame = main_thread.GetFrameAtIndex(0)
        session_call, session_model_offset, session_argument_offset = (
            _require_offsets(_SESSION_LIST_OFFSETS))
        _, recipient_offset = _require_offsets(_SESSION_CELL_OFFSETS)
        matches = []
        for session_list in session_lists:
            backing_model = _read_pointer(process, session_list + session_model_offset)
            if not backing_model:
                continue
            vector = _evaluate_objc(
                frame,
                "(unsigned long long)((void *(*)(void *,void *))"
                f"{module_base + session_call}ULL)((void *){backing_model}ULL,"
                f"(void *){session_list + session_argument_offset}ULL)",
            )
            bounds = _read_memory(process, vector, 16)
            if len(bounds) != 16:
                continue
            begin, end = struct.unpack("<2Q", bounds)
            if end < begin or (end - begin) % 16 or end - begin > 4096:
                continue
            for row, entry_address in enumerate(range(begin, end, 16)):
                item = _read_pointer(process, entry_address)
                try:
                    username, _raw_username = _read_short_string(
                        process, item + recipient_offset
                    )
                except Exception:
                    continue
                if username == "filehelper":
                    matches.append((session_list, row, item))
        if len(matches) != 1:
            raise RuntimeError(
                f"expected one File Transfer model row, found {len(matches)}"
            )
        session_list, row, item = matches[0]
        code = _evaluate_objc(
            frame,
            "({ unsigned char pmxIndex[0x68]={0}; "
            f"*(int *)(pmxIndex+0x60)={row}; "
            f"((void (*)(void *,void *)){module_base + 0x86BB50}ULL)"
            f"((void *){session_list}ULL,pmxIndex); 1; }})",
            timeout_seconds=30,
        )
        if code != 1:
            raise RuntimeError("File Transfer activation slot was rejected")
        _module, _view_vtable, _field_vtable, observed_pairs, _cache = (
            _available_chat_models(target, process)
        )
        recipients = [pair[2] for pair in observed_pairs]
        if "filehelper" not in recipients:
            raise RuntimeError(
                "File Transfer activation did not update the native recipient"
            )
        payload = {
            "selected": True,
            "sessionList": f"0x{session_list:x}",
            "row": row,
            "item": f"0x{item:x}",
            "recipients": recipients,
            "reason": "",
        }
    except Exception as error:
        payload = {"selected": False, "reason": str(error)}
    result.AppendMessage(json.dumps(payload, separators=(",", ":")))


def _allocate(process, size):
    permissions = lldb.ePermissionsReadable | lldb.ePermissionsWritable
    error = lldb.SBError()
    address = process.AllocateMemory(size, permissions, error)
    if error.Fail() or address in (0, lldb.LLDB_INVALID_ADDRESS):
        raise RuntimeError(f"target allocation failed at {address:#x}: {error}")
    _STATE.setdefault("allocations", []).append(address)
    return address


def _write(process, address, value):
    error = lldb.SBError()
    written = process.WriteMemory(address, value, error)
    if error.Fail() or written != len(value):
        raise RuntimeError(f"target write failed: {error}")


def _read_memory(process, address, size):
    if not address or not 0 < size <= 4 * 1024 * 1024:
        return b""
    error = lldb.SBError()
    value = process.ReadMemory(address, size, error)
    return bytes(value) if error.Success() and value is not None else b""


def _read_pointer(process, address):
    error = lldb.SBError()
    raw = bytes(process.ReadMemory(address, 8, error))
    if error.Fail() or len(raw) != 8:
        raise RuntimeError(f"target pointer read failed: {error}")
    return struct.unpack("<Q", raw)[0]


def _find_map_node(process, root, task_id):
    node = root
    visited = set()
    while node and node not in visited and len(visited) < 256:
        visited.add(node)
        raw = _read_memory(process, node + 0x20, 4)
        if len(raw) != 4:
            raise RuntimeError("WeChat request map key is unreadable")
        key = struct.unpack("<I", raw)[0]
        if task_id == key:
            return node
        node = _read_pointer(process, node + (0x00 if task_id < key else 0x08))
    return 0


def _register(frame, name):
    register = frame.FindRegister(name)
    if not register.IsValid():
        raise RuntimeError(f"register {name} is unavailable")
    return register


def _register_value(frame, name):
    return _register(frame, name).GetValueAsUnsigned()


def _set_register(frame, name, value):
    error = lldb.SBError()
    if not _register(frame, name).SetValueFromCString(hex(value), error):
        raise RuntimeError(f"failed to set {name}: {error}")


def _save_registers(frame):
    names = [f"x{index}" for index in range(31)] + ["sp", "pc", "cpsr"]
    return {name: _register_value(frame, name) for name in names}


def _restore_registers(frame, values):
    for name, value in values.items():
        _set_register(frame, name, value)


def _evaluate(frame, expression, timeout_seconds=5):
    options = lldb.SBExpressionOptions()
    options.SetIgnoreBreakpoints(True)
    # The task must be started once on the selected stopped thread. LLDB's
    # all-thread fallback can otherwise retry a side-effecting expression on a
    # different WeChat thread after a timeout.
    options.SetTryAllThreads(False)
    options.SetStopOthers(True)
    options.SetUnwindOnError(True)
    options.SetTimeoutInMicroSeconds(timeout_seconds * 1_000_000)
    value = frame.EvaluateExpression(expression, options)
    error = value.GetError()
    if error.Fail():
        raise RuntimeError(f"target expression failed: {error}")
    return value.GetValueAsSigned()


def _install_breakpoint(target, address, callback):
    breakpoint = target.BreakpointCreateByAddress(address)
    breakpoint.SetScriptCallbackFunction(__name__ + "." + callback)
    if breakpoint.GetNumLocations() == 0:
        raise RuntimeError(f"native breakpoint did not resolve at {address:#x}")
    _STATE.setdefault("breakpoints", []).append(breakpoint.GetID())


def _cpp_string(process, value):
    encoded = value.encode("utf-8")
    if len(encoded) <= 22:
        result = bytearray(24)
        result[: len(encoded)] = encoded
        result[23] = len(encoded)
        return bytes(result)
    storage = _allocate(process, len(encoded) + 1)
    _write(process, storage, encoded + b"\x00")
    capacity = ((len(encoded) + 16) // 16) * 16
    return struct.pack(
        "<QQQ",
        storage,
        len(encoded),
        0x8000000000000000 | capacity,
    )


def _make_task(process, task_id, command_id, cgi_path, user_id):
    cgi_bytes = cgi_path.encode("utf-8") + b"\x00"
    cgi = _allocate(process, len(cgi_bytes))
    _write(process, cgi, cgi_bytes)

    # WeChat 4.1.11's Task copy constructor reads the final std::map sentinel
    # at +0x1A0, so the source object is 0x1A8 bytes rather than 0x1A0.
    task = bytearray(0x1A8)
    struct.pack_into("<I", task, 0x00, task_id)
    struct.pack_into("<I", task, 0x04, command_id)
    struct.pack_into("<I", task, 0x10, 3)
    struct.pack_into("<I", task, 0x14, 1)
    struct.pack_into("<Q", task, 0x18, cgi)
    struct.pack_into("<Q", task, 0x20, len(cgi_path.encode("utf-8")))
    struct.pack_into("<Q", task, 0x28, 0x8000000000000030)
    task[0x30:0x58] = bytes(
        [
            # This exact-account task already carries the linked wxid below.
            # Avoid Mars's UI-driven MakeSureAuth precheck, which otherwise
            # defers forever for a correctly signed-in background session.
            0x00, 0x00, 0x01, 0x01, 0x00, 0xAA, 0xAA, 0xAA,
            0x00, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0xAA, 0xAA, 0xAA,
            0xFF, 0xFF, 0xFF, 0xFF, 0xAA, 0xAA, 0xAA, 0xAA,
        ]
    )
    task[0x60:0x80] = bytes(
        [
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x64, 0x65, 0x66, 0x61, 0x75, 0x6C, 0x74, 0x2D,
            0x6C, 0x6F, 0x6E, 0x67, 0x6C, 0x69, 0x6E, 0x6B,
            0x00, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0x10,
        ]
    )
    struct.pack_into("<I", task, 0x60, command_id)
    task[0x98:0xB0] = _cpp_string(process, user_id)
    struct.pack_into("<I", task, 0x148, 1)
    struct.pack_into("<Q", task, 0x180, 3)

    task_address = _allocate(process, len(task))
    struct.pack_into("<Q", task, 0xB8, task_address + 0xC0)
    struct.pack_into("<Q", task, 0x190, task_address + 0x198)
    _write(process, task_address, task)
    return task_address, cgi


def _make_message(
    process, task_id, command_id, cgi, cgi_length, ret_one, ret_zero
):
    fake_vtable = _allocate(process, 64 * 8)
    vtable = bytearray(struct.pack("<Q", ret_one) * 64)
    # The response dispatcher calls vtable slot 6 and, when it returns true,
    # invokes a std::function stored at message + 0x98. The synthetic message
    # has no such application callback. Returning false from this one slot
    # keeps the already-captured Buf2Resp bytes while preventing WeChat from
    # throwing bad_function_call after the native task completes.
    struct.pack_into("<Q", vtable, 0x30, ret_zero)
    _write(process, fake_vtable, vtable)

    message = bytearray(0x100)
    struct.pack_into("<Q", message, 0x00, fake_vtable)
    struct.pack_into("<I", message, 0x08, task_id)
    struct.pack_into("<I", message, 0x0C, command_id)
    struct.pack_into("<Q", message, 0x10, 3)
    struct.pack_into("<Q", message, 0x18, cgi)
    struct.pack_into("<Q", message, 0x20, cgi_length)
    message_address = _allocate(process, len(message))
    _write(process, message_address, message)

    wrapper = bytearray(0x40)
    struct.pack_into("<Q", wrapper, 0x18, 1)
    struct.pack_into("<I", wrapper, 0x20, task_id)
    struct.pack_into("<Q", wrapper, 0x28, message_address)
    wrapper_address = _allocate(process, len(wrapper))
    _write(process, wrapper_address, wrapper)
    return wrapper_address


def _restore_map(process):
    if _STATE.get("map_restored"):
        return
    begin = _STATE.get("map_begin")
    root = _STATE.get("map_root")
    size = _STATE.get("map_size")
    wrapper = _STATE.get("wrapper")
    if not (begin and root and size and wrapper):
        return
    current_begin = _read_pointer(process, begin)
    current_root = _read_pointer(process, root)
    current_size = _read_pointer(process, size)
    if current_root != wrapper:
        # Some Mars commands remove the request entry before Buf2Resp through
        # a second exact-build erase path. Accept only the complete original
        # tree snapshot; an arbitrary replacement still fails closed.
        if (
            current_begin == _STATE["original_begin"]
            and current_root == _STATE["original_root"]
            and current_size == _STATE["original_size"]
        ):
            _STATE["map_restored"] = True
            _trace({"stage": "map_restore_native"})
            return
        raise RuntimeError("native task map no longer owns the injected entry")
    _write(process, begin, struct.pack("<Q", _STATE["original_begin"]))
    _write(process, root, struct.pack("<Q", _STATE["original_root"]))
    _write(process, size, struct.pack("<Q", _STATE["original_size"]))
    _STATE["map_restored"] = True
    _trace({"stage": "map_restore"})


def _restore_start_thread(process):
    if not _STATE.get("start_pending") or not _STATE.get("saved_registers"):
        return
    thread_id = _STATE.get("start_thread_id")
    for index in range(process.GetNumThreads()):
        thread = process.GetThreadAtIndex(index)
        if thread.GetThreadID() != thread_id:
            continue
        _restore_registers(thread.GetFrameAtIndex(0), _STATE["saved_registers"])
        _trace({"stage": "start_restore", "threadId": thread_id})
        return
    raise RuntimeError("native task originating thread is unavailable")


def _cleanup(process):
    _restore_map(process)
    _restore_start_thread(process)
    _STATE["start_pending"] = False


def _req2buf_insert(frame, _location, _dict):
    try:
        observed_task_id = _register_value(frame, "x1") & 0xFFFFFFFF
        _trace({"stage": "req2buf", "taskId": observed_task_id})
        if observed_task_id != _STATE.get("task_id"):
            return False
        process = frame.GetThread().GetProcess()
        manager = _register_value(frame, "x24")
        begin = manager + 0x58
        root = manager + 0x60
        size = manager + 0x68
        original_begin = _read_pointer(process, begin)
        original_root = _read_pointer(process, root)
        original_size = _read_pointer(process, size)
        existing = _find_map_node(process, original_root, observed_task_id)
        _trace(
            {
                "stage": "req2buf_map",
                "beginIsSentinel": original_begin == root,
                "empty": original_root == 0 and original_size == 0,
                "matchedExisting": existing != 0,
                "size": original_size,
            }
        )
        if existing:
            _STATE["active_node"] = existing
            _STATE["borrowed_node"] = True
            _STATE["inserted"] = True
            return False
        if original_root != 0 or original_size != 0 or original_begin != root:
            raise RuntimeError("WeChat request map is busy")

        wrapper = _STATE["wrapper"]
        # libc++'s tree node stores its parent sentinel at +0x10. Install a
        # complete one-node tree and intercept the matching erase so WeChat
        # never frees memory that LLDB allocated.
        _write(process, wrapper + 0x10, struct.pack("<Q", root))
        _STATE.update(
            {
                "map_begin": begin,
                "map_root": root,
                "map_size": size,
                "original_begin": original_begin,
                "original_root": original_root,
                "original_size": original_size,
                "map_restored": False,
                "active_node": wrapper,
                "borrowed_node": False,
            }
        )
        _write(process, begin, struct.pack("<Q", wrapper))
        _write(process, root, struct.pack("<Q", wrapper))
        _write(process, size, struct.pack("<Q", 1))
        _STATE["inserted"] = True
    except Exception as error:
        _STATE["failure"] = f"Req2Buf insert failed: {error}"
        _finish(
            {
                "ok": False,
                "reason": _STATE["failure"],
                "taskId": _STATE.get("task_id"),
            }
        )
    return False


def _map_erase_found(frame, _location, _dict):
    try:
        process = frame.GetThread().GetProcess()
        node = _register_value(frame, "x23")
        raw = _read_memory(process, node + 0x20, 4)
        if len(raw) != 4 or struct.unpack("<I", raw)[0] != _STATE.get("task_id"):
            return False
        if node != _STATE.get("active_node"):
            raise RuntimeError("WeChat selected an unexpected request map node")
        if _STATE.get("borrowed_node"):
            _trace({"stage": "map_erase_native", "taskId": _STATE.get("task_id")})
            return False
        message = _read_pointer(process, node + 0x28)
        if not message:
            raise RuntimeError("native request map message is missing")
        _restore_map(process)
        _set_register(frame, "x20", message)
        _set_register(frame, "pc", _STATE["map_erase_skip"])
        _trace({"stage": "map_erase_skip", "taskId": _STATE.get("task_id")})
    except Exception as error:
        _STATE["failure"] = f"native request map erase failed: {error}"
        try:
            process = frame.GetThread().GetProcess()
            _cleanup(process)
        except Exception:
            pass
        _finish(
            {
                "ok": False,
                "reason": _STATE["failure"],
                "taskId": _STATE.get("task_id"),
            }
        )
    return False


def _app_encode(frame, _location, _dict):
    try:
        process = frame.GetThread().GetProcess()
        task = _register_value(frame, "x1")
        error = lldb.SBError()
        raw = bytes(process.ReadMemory(task, 8, error)) if task else b""
        if error.Fail() or len(raw) != 8:
            return False
        task_id, command_id = struct.unpack("<II", raw)
        _trace(
            {
                "stage": "app_encode",
                "taskId": task_id,
                "commandId": command_id,
                "channelMode": _register_value(frame, "x2") & 0xFFFFFFFF,
            }
        )
    except Exception as error:
        _trace({"stage": "app_encode_error", "reason": str(error)})
    return False


def _run_on_start_task(frame, _location, _dict):
    try:
        process = frame.GetThread().GetProcess()
        profile = _register_value(frame, "x25")
        raw = _read_memory(process, profile + 0x10, 0x50)
        if len(raw) != 0x50:
            return False
        task_id, command_id = struct.unpack_from("<II", raw)
        if task_id != _STATE.get("task_id"):
            return False
        _trace(
            {
                "stage": "run_on_start_task",
                "taskId": task_id,
                "commandId": command_id,
                "sendOnly": raw[0x30],
                "needAuthed": raw[0x31],
                "limitFlow": raw[0x32],
                "limitFrequency": raw[0x33],
                "retryCount": struct.unpack_from("<i", raw, 0x40)[0],
                "totalTimeout": struct.unpack_from("<i", raw, 0x48)[0],
            }
        )
    except Exception as error:
        _trace({"stage": "run_on_start_task_error", "reason": str(error)})
    return False


def _run_on_start_auth(frame, _location, _dict):
    try:
        process = frame.GetThread().GetProcess()
        profile = _register_value(frame, "x25")
        task_id = struct.unpack("<I", _read_memory(process, profile + 0x10, 4))[0]
        if task_id == _STATE.get("task_id"):
            _trace(
                {
                    "stage": "run_on_start_auth",
                    "taskId": task_id,
                    "authenticated": bool(_register_value(frame, "x27") & 1),
                }
            )
    except Exception as error:
        _trace({"stage": "run_on_start_auth_error", "reason": str(error)})
    return False


def _run_on_start_longlink(frame, _location, _dict):
    try:
        process = frame.GetThread().GetProcess()
        profile = _register_value(frame, "x25")
        task_id = struct.unpack("<I", _read_memory(process, profile + 0x10, 4))[0]
        if task_id == _STATE.get("task_id"):
            _trace(
                {
                    "stage": "run_on_start_longlink",
                    "taskId": task_id,
                    "found": _register_value(frame, "x28") != 0,
                }
            )
    except Exception as error:
        _trace({"stage": "run_on_start_longlink_error", "reason": str(error)})
    return False


def _run_on_start_req2buf(frame, _location, _dict):
    try:
        process = frame.GetThread().GetProcess()
        profile = _register_value(frame, "x25")
        task_id = struct.unpack("<I", _read_memory(process, profile + 0x10, 4))[0]
        if task_id == _STATE.get("task_id"):
            _trace({"stage": "run_on_start_req2buf", "taskId": task_id})
    except Exception as error:
        _trace({"stage": "run_on_start_req2buf_error", "reason": str(error)})
    return False


def _start_return(frame, _location, _dict):
    if not _STATE.get("start_pending"):
        return False
    try:
        start_result = _register_value(frame, "x0")
        _trace({"stage": "start_return", "result": start_result})
        saved_registers = _STATE["saved_registers"]
        _STATE["start_pending"] = False
        _restore_registers(frame, saved_registers)
        if start_result == 0:
            _finish({"ok": False, "reason": "native MMStartTask rejected the task"})
    except Exception as error:
        _finish({"ok": False, "reason": f"native task return restore failed: {error}"})
    return False


def _req2buf_call(frame, _location, _dict):
    try:
        if _register_value(frame, "x20") & 0xFFFFFFFF != _STATE.get("task_id"):
            return False
        auto_buffer = _register_value(frame, "x1")
        expression = (
            f"((int (*)(void *, const void *, int)){_STATE['auto_buffer_write']:#x})"
            f"((void *){auto_buffer:#x}, (const void *){_STATE['protobuf']:#x}, "
            f"(int){_STATE['protobuf_length']})"
        )
        result = _evaluate(frame, expression)
        if result == 0:
            raise RuntimeError("AutoBuffer write returned zero")
        _STATE["wrote"] = True
    except Exception as error:
        _STATE["failure"] = f"protobuf write failed: {error}"
    try:
        _set_register(frame, "pc", _STATE["after_call"])
        if not (_STATE.get("inserted") is True and _STATE.get("wrote") is True):
            process = frame.GetThread().GetProcess()
            _cleanup(process)
            _finish(
                {
                    "ok": False,
                    "reason": _STATE.get(
                        "failure", "Req2Buf did not accept protobuf"
                    ),
                    "taskId": _STATE.get("task_id"),
                }
            )
    except Exception as error:
        _finish({"ok": False, "reason": f"Req2Buf cleanup failed: {error}"})
    return False


def _req2buf_after_call(frame, _location, _dict):
    try:
        if _register_value(frame, "x20") & 0xFFFFFFFF != _STATE.get("task_id"):
            return False
        if not (_STATE.get("inserted") is True and _STATE.get("wrote") is True):
            process = frame.GetThread().GetProcess()
            _cleanup(process)
            _finish(
                {
                    "ok": False,
                    "reason": _STATE.get(
                        "failure", "Req2Buf did not accept protobuf"
                    ),
                    "taskId": _STATE.get("task_id"),
                }
            )
    except Exception as error:
        _finish({"ok": False, "reason": f"Req2Buf cleanup failed: {error}"})
    return False


def _buf2resp(frame, _location, _dict):
    try:
        if _STATE.get("finished") or not _STATE.get("wrote"):
            return False
        process = frame.GetThread().GetProcess()
        stack_pointer = _register_value(frame, "sp")
        task_raw = _read_memory(process, stack_pointer + 0x140, 4)
        if len(task_raw) != 4:
            return False
        response_task_id = struct.unpack("<I", task_raw)[0]
        if response_task_id != _STATE.get("task_id"):
            return False
        response_size = _register_value(frame, "x0") & 0xFFFFFFFF
        response_pointer = _register_value(frame, "x20")
        response = _read_memory(process, response_pointer, response_size)
        if len(response) != response_size or not 0 < response_size <= 4 * 1024 * 1024:
            raise RuntimeError("native task response buffer is invalid")
        _cleanup(process)
        detach_error = process.Detach()
        if detach_error.Fail():
            raise RuntimeError(f"native task detach failed: {detach_error}")
        _finish(
            {
                "ok": True,
                "detached": True,
                "taskId": _STATE.get("task_id"),
                "commandId": _STATE.get("command_id"),
                "cgi": _STATE.get("cgi"),
                "responseBase64": base64.b64encode(response).decode("ascii"),
            }
        )
    except Exception as error:
        try:
            process = frame.GetThread().GetProcess()
            _cleanup(process)
        except Exception:
            pass
        _finish({"ok": False, "reason": f"Buf2Resp capture failed: {error}"})
    return False


def cleanup_native(debugger, _command, result, _dict):
    try:
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if process.IsValid():
            _cleanup(process)
        result.AppendMessage("native task cleanup complete")
    except Exception as error:
        result.SetError(str(error))


# Mars task hijack constants below are the 4.1.11 build 269136 addresses only.
# Every other build has different code, so refusing here is the last line of
# defence against executing one build's offsets inside another build.
_WIRE_TASK_BUILD_UUIDS = {"C6F8C0A6-BB7C-3DF1-B3AC-CAD6A1A1461F"}


def _require_wire_task_build(target):
    try:
        identifier = (target.FindModule(lldb.SBFileSpec(WECHAT_DYLIB)).GetUUIDString() or "").strip().upper()
    except Exception:
        identifier = ""
    if identifier not in _WIRE_TASK_BUILD_UUIDS:
        raise RuntimeError(
            "this WeChat build needs a Polymux update before using the native "
            "task sender"
        )
    return identifier


def send_native(debugger, _command, result, _dict):
    try:
        _require_wire_task_build(debugger.GetSelectedTarget())
        request, cgi_path, command_id, requested_task_id, user_id = _load_request()
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while arming the native task")
        frame = process.GetSelectedThread().GetFrameAtIndex(0)
        module_base = _module_base(target)

        _STATE.clear()
        _STATE["task_id"] = (
            requested_task_id
            if requested_task_id
            else (int(time.time() * 1000) & 0x0FFFFFFF) | 0x20000000
        )
        _STATE["auto_buffer_write"] = module_base + AUTOBUFFER_WRITE_OFFSET
        _STATE["command_id"] = command_id
        _STATE["cgi"] = cgi_path

        task, cgi = _make_task(
            process, _STATE["task_id"], command_id, cgi_path, user_id
        )
        _STATE["wrapper"] = _make_message(
            process,
            _STATE["task_id"],
            command_id,
            cgi,
            len(cgi_path.encode("utf-8")),
            module_base + RET_ONE_STUB_OFFSET,
            module_base + RET_ZERO_STUB_OFFSET,
        )
        _STATE["protobuf"] = _allocate(process, len(request))
        _STATE["protobuf_length"] = len(request)
        _STATE["after_call"] = module_base + REQ2BUF_AFTER_CALL_OFFSET
        _STATE["map_erase_skip"] = module_base + MAP_ERASE_SKIP_OFFSET
        _write(process, _STATE["protobuf"], request)

        _install_breakpoint(
            target,
            module_base + REQ2BUF_INSERT_OFFSET,
            "_req2buf_insert",
        )
        _install_breakpoint(
            target,
            module_base + REQ2BUF_CALL_OFFSET,
            "_req2buf_call",
        )
        _install_breakpoint(
            target,
            module_base + MAP_ERASE_FOUND_OFFSET,
            "_map_erase_found",
        )
        _install_breakpoint(
            target,
            module_base + APP_ENCODE_OFFSET,
            "_app_encode",
        )
        _install_breakpoint(
            target,
            module_base + RUN_ON_START_TASK_OFFSET,
            "_run_on_start_task",
        )
        _install_breakpoint(
            target,
            module_base + RUN_ON_START_AUTH_OFFSET,
            "_run_on_start_auth",
        )
        _install_breakpoint(
            target,
            module_base + RUN_ON_START_LONGLINK_OFFSET,
            "_run_on_start_longlink",
        )
        _install_breakpoint(
            target,
            module_base + RUN_ON_START_REQ2BUF_OFFSET,
            "_run_on_start_req2buf",
        )
        _install_breakpoint(
            target,
            module_base + START_RETURN_GADGET_OFFSET,
            "_start_return",
        )
        _install_breakpoint(
            target,
            module_base + BUF2RESP_OFFSET,
            "_buf2resp",
        )
        manager_text = os.environ.get("POLYMUX_WECHAT_MANAGER_POINTER", "").strip()
        # Expression evaluation preserves the stopped app thread's full
        # register state. The register-hijack mode remains available only for
        # exact-build diagnostics and restores that state on every cleanup.
        start_mode = os.environ.get("POLYMUX_WECHAT_START_MODE", "expression")
        if manager_text:
            manager = int(manager_text, 0)
            if not manager or not _read_pointer(process, manager + 0x18):
                raise RuntimeError("captured WeChat manager pointer is invalid")
            start_task = module_base + START_TASK_WITH_MANAGER_OFFSET
            start_expression = (
                f"((int (*)(void *, void *)){start_task:#x})"
                f"((void *){manager:#x}, (void *){task:#x})"
            )
        else:
            start_task = module_base + START_TASK_OFFSET
            start_expression = (
                f"((int (*)(void *)){start_task:#x})((void *){task:#x})"
            )
        if start_mode == "expression":
            _STATE["start_pending"] = False
            start_result = _evaluate(frame, start_expression)
            _trace({"stage": "start_expression", "result": start_result})
            if start_result == 0:
                raise RuntimeError("native MMStartTask rejected the task")
        elif start_mode == "registers":
            _STATE["saved_registers"] = _save_registers(frame)
            _STATE["start_thread_id"] = frame.GetThread().GetThreadID()
            _STATE["start_pending"] = True
            _set_register(frame, "x30", module_base + START_RETURN_GADGET_OFFSET)
            if manager_text:
                _set_register(frame, "x0", manager)
                _set_register(frame, "x1", task)
            else:
                _set_register(frame, "x0", task)
            _set_register(frame, "pc", start_task)
        else:
            raise RuntimeError(f"unsupported native start mode: {start_mode}")
        result.AppendMessage(
            "native task injector ready "
            f"task_id={_STATE['task_id']} start_mode={start_mode}"
        )
    except Exception as error:
        try:
            target = debugger.GetSelectedTarget()
            process = target.GetProcess()
            if process.IsValid():
                _restore_map(process)
        except Exception:
            pass
        _finish({"ok": False, "reason": f"native task setup failed: {error}"})
        result.SetError(str(error))


def __lldb_init_module(debugger, _dict):
    debugger.HandleCommand(
        f"command script add -f {__name__}.rename_group polymux-native-rename-group"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.mark_session_read polymux-native-mark-read"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.schedule_native_window_guard polymux-native-window-guard"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.send_native_return polymux-native-return"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.finish_native_window_guard "
        "polymux-native-window-guard-finish"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.send_native_attachment_events "
        "polymux-native-attachment-events"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.send_native_key polymux-native-key"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.scroll_native_sessions "
        "polymux-native-scroll"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.send_native polymux-native-send"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.cleanup_native polymux-native-cleanup"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.inspect_chat_input_views "
        "polymux-native-chat-input-views"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.inspect_message_views "
        "polymux-native-message-views"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.inspect_message_id "
        "polymux-native-message-id"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.inspect_direct_branches "
        "polymux-native-direct-branches"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.inspect_static_data_references "
        "polymux-native-static-data-references"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.inspect_session_model "
        "polymux-native-session-model"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.inspect_filehelper_chat_state "
        "polymux-native-filehelper-state"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.inspect_filehelper_message_widget "
        "polymux-native-filehelper-message-widget"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.inspect_allocation "
        "polymux-native-allocation"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.inspect_pointer_references "
        "polymux-native-references"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.inspect_message_model_links "
        "polymux-native-message-model-links"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.trace_navigate_start "
        "polymux-native-trace-navigate-start"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.trace_navigate_cleanup "
        "polymux-native-trace-navigate-cleanup"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.trace_selected_session_start "
        "polymux-native-trace-session-start"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.trace_selected_session_cleanup "
        "polymux-native-trace-session-cleanup"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.select_filehelper_session "
        "polymux-native-select-filehelper"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.send_model_paste "
        "polymux-native-model-send"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.prepare_model_service "
        "polymux-native-model-prepare"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.schedule_service_text "
        "polymux-native-service-text"
    )
