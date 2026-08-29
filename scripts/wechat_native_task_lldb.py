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
import struct
import time

import lldb


ARM_PATH = os.environ.get("POLYMUX_WECHAT_WIRE_ARM", "")
STATUS_PATH = os.environ.get("POLYMUX_WECHAT_WIRE_STATUS", "")
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

_STATE = {}


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
        return address
    raise RuntimeError("WeChat resources dylib is not loaded")


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


def _make_message(process, task_id, command_id, cgi, cgi_length, ret_one):
    fake_vtable = _allocate(process, 64 * 8)
    _write(process, fake_vtable, struct.pack("<Q", ret_one) * 64)

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
    current_root = _read_pointer(process, root)
    if current_root != wrapper:
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


def send_native(debugger, _command, result, _dict):
    try:
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
        f"command script add -f {__name__}.send_native polymux-native-send"
    )
    debugger.HandleCommand(
        f"command script add -f {__name__}.cleanup_native polymux-native-cleanup"
    )
