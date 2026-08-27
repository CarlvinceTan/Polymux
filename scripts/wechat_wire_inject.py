"""Inject a typed WeChat payload at the authenticated protobuf compressor.

The caller arms one exact sentinel in a JSON file.  Only the matching outbound
message is rewritten; all unrelated compression calls auto-continue unchanged.
"""

import base64
import json
import os
import time

import lldb


ARM_PATH = os.environ.get("POLYMUX_WECHAT_WIRE_ARM", "")
STATUS_PATH = os.environ.get("POLYMUX_WECHAT_WIRE_STATUS", "")


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


def rewrite_message(raw, sentinel, message_type, content):
    outer = _fields(raw)
    changed = False
    rewritten = []
    for number, wire, value in outer:
        if number != 2 or wire != 2 or sentinel not in value:
            rewritten.append((number, wire, value))
            continue
        inner = []
        for child_number, child_wire, child_value in _fields(value):
            if child_number == 2 and child_wire == 2:
                child_value = content
                changed = True
            elif child_number == 3 and child_wire == 0:
                child_value = message_type
            inner.append((child_number, child_wire, child_value))
        rewritten.append((number, wire, _encode(inner)))
    return _encode(rewritten) if changed else None


def _status(value):
    if not STATUS_PATH:
        return
    temporary = STATUS_PATH + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(value, stream, separators=(",", ":"))
    os.replace(temporary, STATUS_PATH)


def _consume_arm():
    if not ARM_PATH:
        return
    temporary = ARM_PATH + ".consume"
    with open(temporary, "w", encoding="utf-8") as stream:
        stream.write("")
    os.replace(temporary, ARM_PATH)


def _capture(frame, _location, _dict):
    try:
        with open(ARM_PATH, encoding="utf-8") as stream:
            arm = json.load(stream)
        if int(arm["expiryNs"]) < time.time_ns():
            return False
        sentinel = arm["sentinel"].encode("utf-8")
        content = base64.b64decode(arm["contentBase64"], validate=True)
        message_type = int(arm["messageType"])
        if not 0 < message_type < 10000 or not content:
            return False

        process = frame.GetThread().GetProcess()
        source = frame.FindRegister("x2").GetValueAsUnsigned()
        old_length = frame.FindRegister("x3").GetValueAsUnsigned()
        if not source or not 0 < old_length <= 1024 * 1024:
            return False
        error = lldb.SBError()
        raw = bytes(process.ReadMemory(source, old_length, error))
        if error.Fail() or sentinel not in raw:
            return False
        rewritten = rewrite_message(raw, sentinel, message_type, content)
        if rewritten is None:
            return False
        if len(rewritten) > old_length:
            _status({"ok": False, "reason": "replacement exceeds armed placeholder"})
            return False
        process.WriteMemory(source, rewritten + b"\x00" * (old_length - len(rewritten)), error)
        if error.Fail():
            _status({"ok": False, "reason": str(error)})
            return False
        if not frame.FindRegister("x3").SetValueFromCString(hex(len(rewritten)), error):
            _status({"ok": False, "reason": "failed to update protobuf length"})
            return False
        _consume_arm()
        _status({"ok": True, "messageType": message_type, "length": len(rewritten)})
    except FileNotFoundError:
        pass
    except Exception as error:
        _status({"ok": False, "reason": repr(error)})
    return False


def install(debugger):
    target = debugger.GetSelectedTarget()
    breakpoint = target.BreakpointCreateByName("compress")
    if breakpoint.GetNumLocations() == 0:
        breakpoint = target.BreakpointCreateByName("_compress")
    breakpoint.SetScriptCallbackFunction(__name__ + "._capture")
    breakpoint.SetAutoContinue(True)
    if breakpoint.GetNumLocations() == 0:
        raise RuntimeError("WeChat compressor breakpoint did not resolve")
    print(f"wire injector ready locations={breakpoint.GetNumLocations()}", flush=True)


def __lldb_init_module(debugger, _dict):
    debugger.HandleCommand(f"command script add -f {__name__}.install polymux-wire-inject")
