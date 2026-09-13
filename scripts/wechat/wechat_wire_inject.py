"""Inject a typed WeChat payload after WeChat serializes Req2Buf.

The caller arms one exact sentinel in a JSON file.  Only the matching outbound
message is rewritten; all unrelated encoded requests auto-continue unchanged
and never touch the status protocol.

The hook is exact-build gated by the JavaScript caller. At this boundary the
calling frame owns an AutoBuffer containing the complete uncompressed
``newsendmsg`` protobuf, immediately after the task's native serializer returns.
"""

import base64
import json
import os
import time

try:
    import lldb
except ModuleNotFoundError:  # Pure protobuf tests run outside LLDB.
    lldb = None


ARM_PATH = os.environ.get("POLYMUX_WECHAT_WIRE_ARM", "")
STATUS_PATH = os.environ.get("POLYMUX_WECHAT_WIRE_STATUS", "")
MANAGER_CAPTURE_PATH = os.environ.get("POLYMUX_WECHAT_MANAGER_CAPTURE_PATH", "")
WECHAT_DYLIB = os.environ.get(
    "POLYMUX_WECHAT_DYLIB",
    "/Applications/WeChat.app/Contents/Resources/wechat.dylib",
)
REQ2BUF_AFTER_CALL_OFFSET = 0x3AFC9DC
START_TASK_ROUTER_OFFSETS = (0x5120FE8, 0x4D34C8C)


def _read_varint(data, offset):
    value = 0
    shift = 0
    while offset < len(data) and shift < 70:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7
    raise ValueError("invalid protobuf varint")


def _varint(value):
    output = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        output.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(output)


def _fields(data):
    output = []
    offset = 0
    while offset < len(data):
        tag, offset = _read_varint(data, offset)
        number, wire = tag >> 3, tag & 7
        if wire == 0:
            value, offset = _read_varint(data, offset)
        elif wire == 2:
            length, offset = _read_varint(data, offset)
            end = offset + length
            if end > len(data):
                raise ValueError("truncated protobuf field")
            value, offset = data[offset:end], end
        else:
            raise ValueError(f"unsupported protobuf wire type {wire}")
        output.append((number, wire, value))
    return output


def _encode(fields):
    output = bytearray()
    for number, wire, value in fields:
        output += _varint((number << 3) | wire)
        if wire == 0:
            output += _varint(value)
        else:
            output += _varint(len(value)) + value
    return bytes(output)


def _replace_base_string(value, replacement):
    fields = []
    original = None
    for number, wire, child in _fields(value):
        if number == 1 and wire == 2:
            if original is not None:
                raise ValueError("newsendmsg recipient is duplicated")
            original = child.decode("utf-8", errors="strict")
            child = replacement
        fields.append((number, wire, child))
    if original is None:
        raise ValueError("newsendmsg recipient is missing")
    return _encode(fields), original


def rewrite_message(raw, sentinel, recipient, message_type, content):
    """Swap the recipient, content, and type of the armed newsendmsg entry."""
    outer = _fields(raw)
    matched = 0
    original_recipient = None
    final_recipient = None
    rewritten = []
    for number, wire, value in outer:
        if number != 2 or wire != 2 or sentinel not in value:
            rewritten.append((number, wire, value))
            continue
        matched += 1
        if matched > 1:
            raise ValueError("sentinel matched multiple newsendmsg entries")
        saw_content = False
        saw_type = False
        inner = []
        for child_number, child_wire, child_value in _fields(value):
            if child_number == 1 and child_wire == 2:
                child_value, original_recipient = _replace_base_string(
                    child_value, recipient
                )
                final_recipient = recipient.decode("utf-8", errors="strict")
            elif child_number == 2 and child_wire == 2:
                if saw_content:
                    raise ValueError("newsendmsg content is duplicated")
                child_value = content
                saw_content = True
            elif child_number == 3 and child_wire == 0:
                if saw_type:
                    raise ValueError("newsendmsg type is duplicated")
                child_value = message_type
                saw_type = True
            inner.append((child_number, child_wire, child_value))
        if original_recipient is None or not saw_content or not saw_type:
            raise ValueError("newsendmsg entry is missing required fields")
        rewritten.append((number, wire, _encode(inner)))
    if matched == 0:
        return None
    return _encode(rewritten), original_recipient, final_recipient


def _status(value):
    if not STATUS_PATH:
        return
    temporary = STATUS_PATH + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(value, stream, separators=(",", ":"))
    os.replace(temporary, STATUS_PATH)


def _atomic_json(path, value):
    temporary = path + ".tmp"
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


def _consume_arm():
    if not ARM_PATH:
        return
    temporary = ARM_PATH + ".consume"
    with open(temporary, "w", encoding="utf-8") as stream:
        stream.write("")
    os.replace(temporary, ARM_PATH)


def _armed():
    """The armed request, or None when nothing is armed for this fire.

    A consumed or missing arm file is the ordinary idle state, not an error:
    the breakpoint stays installed for the whole session and most fires are
    unrelated traffic. Only a genuinely malformed arm file is reported, and
    only once, because it means the arming side wrote something it should not
    have and silence would hide that forever.
    """
    try:
        with open(ARM_PATH, encoding="utf-8") as stream:
            raw = stream.read()
    except FileNotFoundError:
        return None
    if not raw.strip():
        return None
    try:
        arm = json.loads(raw)
        if int(arm["expiryNs"]) < time.time_ns():
            _status({"ok": False, "reason": "arm file expired before rewrite"})
            _consume_arm()
            return None
        sentinel = arm["sentinel"]
        recipient = arm["recipient"]
        content = base64.b64decode(arm["contentBase64"], validate=True)
        message_type = int(arm["messageType"])
        if (
            not isinstance(sentinel, str)
            or not isinstance(recipient, str)
            or not recipient
            or not 0 < message_type < 10000
            or not content
        ):
            raise ValueError("arm file fields are out of range")
        if (
            os.environ.get("POLYMUX_WECHAT_TEST_ONLY_FILEHELPER") == "1"
            and recipient != "filehelper"
        ):
            raise ValueError("live WeChat testing is restricted to filehelper")
        return sentinel.encode("utf-8"), recipient.encode("utf-8"), content, message_type
    except Exception as error:
        _status({"ok": False, "reason": f"arm file is invalid: {error!r}"})
        _consume_arm()
        return None


def _suppress(process, source, length_register, old_length, error):
    """Neutralize the armed buffer so the raw placeholder can never be sent.

    Zeroing the compress length is enough on its own. If that register write
    fails, overwrite the buffer with zero bytes instead: teardown detaches the
    process (`process detach`), which resumes it, so pausing at the breakpoint
    is not a reliable fail-closed — only a benign in-memory payload is.
    """
    if length_register.SetValueFromCString("0", error):
        return
    process.WriteMemory(source, b"\x00" * old_length, error)


def _module_base(target):
    for module in target.module_iter():
        spec = module.GetFileSpec()
        full_path = getattr(spec, "fullpath", None)
        if not full_path:
            full_path = os.path.join(
                spec.GetDirectory() or "", spec.GetFilename() or ""
            )
        if full_path != WECHAT_DYLIB:
            continue
        address = module.GetObjectFileHeaderAddress().GetLoadAddress(target)
        if address not in (None, lldb.LLDB_INVALID_ADDRESS):
            return address
    raise RuntimeError("WeChat resources dylib is not loaded")


def _read_memory(process, address, size):
    if not address or not 0 < size <= 1024 * 1024:
        return b""
    error = lldb.SBError()
    data = process.ReadMemory(address, size, error)
    return bytes(data) if error.Success() and data is not None else b""


def _read_u64(process, address):
    raw = _read_memory(process, address, 8)
    return int.from_bytes(raw, "little") if len(raw) == 8 else 0


def _read_u32(process, address):
    raw = _read_memory(process, address, 4)
    return int.from_bytes(raw, "little") if len(raw) == 4 else 0


def _capture_manager(frame, _location, _dict):
    """Persist one real MMStartTask manager/payload pair for a later attach."""
    if not MANAGER_CAPTURE_PATH or os.path.exists(MANAGER_CAPTURE_PATH):
        return False
    try:
        process = frame.GetThread().GetProcess()
        manager = frame.FindRegister("x0").GetValueAsUnsigned()
        payload = frame.FindRegister("x1").GetValueAsUnsigned()
        if not manager or not payload:
            return False
        manager_bytes = _read_memory(process, manager, 0x40)
        if len(manager_bytes) != 0x40:
            return False
        task = _read_memory(process, payload, 0x1A0)
        if len(task) != 0x1A0:
            return False
        _atomic_json(
            MANAGER_CAPTURE_PATH,
            {
                "capturedAtNs": time.time_ns(),
                "manager": hex(manager),
                "payload": hex(payload),
                "taskId": int.from_bytes(task[0:4], "little"),
                "managerSlot18": hex(
                    int.from_bytes(manager_bytes[0x18:0x20], "little")
                ),
            },
        )
    except Exception:
        return False
    return False


def _suppress_req2buf(process, storage, source, old_length):
    error = lldb.SBError()
    process.WriteMemory(storage + 0xC, (0).to_bytes(4, "little"), error)
    if error.Fail():
        if source and old_length:
            process.WriteMemory(source, b"\x00" * old_length, error)


def _capture_req2buf_after(frame, _location, _dict):
    try:
        armed = _armed()
        if armed is None:
            return False
        sentinel, recipient, content, message_type = armed
        process = frame.GetThread().GetProcess()
        stack_pointer = frame.FindRegister("sp").GetValueAsUnsigned()
        auto_buffer = stack_pointer + 0x140
        storage = _read_u64(process, auto_buffer)
        source = _read_u64(process, storage)
        old_length = _read_u32(process, storage + 0xC)
        capacity = _read_u32(process, storage + 0x10)
        if not source or not 0 < old_length <= 1024 * 1024:
            return False
        raw = _read_memory(process, source, old_length)
        if sentinel not in raw:
            return False
        try:
            replacement = rewrite_message(
                raw, sentinel, recipient, message_type, content
            )
        except Exception as parse_error:
            _consume_arm()
            _suppress_req2buf(process, storage, source, old_length)
            _status(
                {
                    "ok": False,
                    "reason": f"unparsable Req2Buf protobuf: {parse_error!r}",
                }
            )
            return False
        if replacement is None:
            return False
        rewritten, original_recipient, final_recipient = replacement
        _consume_arm()
        if len(rewritten) > max(old_length, capacity):
            _suppress_req2buf(process, storage, source, old_length)
            _status(
                {
                    "ok": False,
                    "reason": "replacement exceeds armed Req2Buf capacity",
                }
            )
            return False
        error = lldb.SBError()
        process.WriteMemory(
            source,
            rewritten + b"\x00" * max(0, old_length - len(rewritten)),
            error,
        )
        if error.Fail():
            _suppress_req2buf(process, storage, source, old_length)
            _status({"ok": False, "reason": str(error)})
            return False
        process.WriteMemory(
            storage + 0xC, len(rewritten).to_bytes(4, "little"), error
        )
        if error.Fail():
            _suppress_req2buf(process, storage, source, old_length)
            _status({"ok": False, "reason": "failed to update Req2Buf length"})
            return False
        _status(
            {
                "ok": True,
                "messageType": message_type,
                "length": len(rewritten),
                "originalRecipient": original_recipient,
                "recipient": final_recipient,
            }
        )
    except Exception as error:
        _status({"ok": False, "reason": repr(error)})
    return False


def _capture(frame, _location, _dict):
    try:
        armed = _armed()
        if armed is None:
            return False
        sentinel, recipient, content, message_type = armed
        process = frame.GetThread().GetProcess()
        source = frame.FindRegister("x2").GetValueAsUnsigned()
        length_register = frame.FindRegister("x3")
        old_length = length_register.GetValueAsUnsigned()
        if not source or not 0 < old_length <= 1024 * 1024:
            return False
        error = lldb.SBError()
        raw = bytes(process.ReadMemory(source, old_length, error))
        if error.Fail() or sentinel not in raw:
            return False
        # Confirm this buffer is the armed newsendmsg before consuming the arm
        # or mutating memory. A sentinel-bearing compress that is not a
        # top-level newsendmsg entry (local persistence, a parallel CGI) is
        # left untouched so the real send still fires; a buffer that cannot be
        # parsed at all is suppressed rather than allowed to escape.
        try:
            replacement = rewrite_message(
                raw, sentinel, recipient, message_type, content
            )
        except Exception as parse_error:
            _consume_arm()
            _suppress(process, source, length_register, old_length, error)
            _status(
                {"ok": False, "reason": f"unparsable armed protobuf: {parse_error!r}"}
            )
            return False
        if replacement is None:
            # The sentinel is present but not in a newsendmsg entry. Leave the
            # arm live and stay silent so the real newsendmsg fire reports.
            return False
        rewritten, original_recipient, final_recipient = replacement
        # The buffer is the armed request: consume the arm and, from here, never
        # let the raw placeholder escape, whatever the remaining writes do.
        _consume_arm()
        if len(rewritten) > old_length:
            _suppress(process, source, length_register, old_length, error)
            _status({"ok": False, "reason": "replacement exceeds armed placeholder"})
            return False
        process.WriteMemory(source, rewritten + b"\x00" * (old_length - len(rewritten)), error)
        if error.Fail():
            _suppress(process, source, length_register, old_length, error)
            _status({"ok": False, "reason": str(error)})
            return False
        if not length_register.SetValueFromCString(hex(len(rewritten)), error):
            _suppress(process, source, length_register, old_length, error)
            _status({"ok": False, "reason": "failed to update protobuf length"})
            return False
        _status(
            {
                "ok": True,
                "messageType": message_type,
                "length": len(rewritten),
                "originalRecipient": original_recipient,
                "recipient": final_recipient,
            }
        )
    except Exception as error:
        _status({"ok": False, "reason": repr(error)})
    return False


def install(debugger, _command=None, _result=None, _dict=None):
    target = debugger.GetSelectedTarget()
    breakpoint = target.BreakpointCreateByAddress(
        _module_base(target) + REQ2BUF_AFTER_CALL_OFFSET
    )
    breakpoint.SetScriptCallbackFunction(__name__ + "._capture_req2buf_after")
    if breakpoint.GetNumLocations() == 0:
        raise RuntimeError("WeChat Req2Buf breakpoint did not resolve")
    manager_locations = 0
    if MANAGER_CAPTURE_PATH:
        module_base = _module_base(target)
        for offset in START_TASK_ROUTER_OFFSETS:
            manager_breakpoint = target.BreakpointCreateByAddress(
                module_base + offset
            )
            manager_breakpoint.SetScriptCallbackFunction(
                __name__ + "._capture_manager"
            )
            manager_locations += manager_breakpoint.GetNumLocations()
        if manager_locations == 0:
            raise RuntimeError("WeChat manager breakpoint did not resolve")
    print(
        "wire injector ready "
        f"locations={breakpoint.GetNumLocations()} "
        f"manager_locations={manager_locations}",
        flush=True,
    )


def __lldb_init_module(debugger, _dict):
    debugger.HandleCommand(f"command script add -f {__name__}.install polymux-wire-inject")
    install(debugger)
