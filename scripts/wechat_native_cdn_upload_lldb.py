"""Upload one video with WeChat's exact-build native CDN client through LLDB."""

import hashlib
import json
import os
import struct
import time

import lldb


ARM_PATH = os.environ.get("POLYMUX_WECHAT_CDN_ARM", "")
STATUS_PATH = os.environ.get("POLYMUX_WECHAT_CDN_STATUS", "")
WECHAT_DYLIB = "/Applications/WeChat.app/Contents/Resources/wechat.dylib"
START_UPLOAD_OFFSET = 0x4EAF908
START_UPLOAD_WRAPPER_OFFSET = 0x4E6D714
COMPLETE_OFFSET = 0x3ABAB20
_STATE = {}


def _atomic_json(path, value):
    temporary = f"{path}.{os.getpid()}.tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
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


def _read(process, address, size):
    if not address or not 0 < size <= 4 * 1024 * 1024:
        return b""
    error = lldb.SBError()
    value = process.ReadMemory(address, size, error)
    return bytes(value) if error.Success() and value is not None else b""


def _write(process, address, value):
    error = lldb.SBError()
    written = process.WriteMemory(address, value, error)
    if error.Fail() or written != len(value):
        raise RuntimeError(f"target write failed: {error}")


def _allocate(process, value):
    size = value if isinstance(value, int) else len(value)
    error = lldb.SBError()
    address = process.AllocateMemory(
        size, lldb.ePermissionsReadable | lldb.ePermissionsWritable, error
    )
    if error.Fail() or not address or address == lldb.LLDB_INVALID_ADDRESS:
        raise RuntimeError(f"target allocation failed: {error}")
    if not isinstance(value, int):
        _write(process, address, value)
    return address


def _allocate_executable(process, value):
    error = lldb.SBError()
    address = process.AllocateMemory(
        len(value),
        lldb.ePermissionsReadable
        | lldb.ePermissionsWritable
        | lldb.ePermissionsExecutable,
        error,
    )
    if error.Fail() or not address or address == lldb.LLDB_INVALID_ADDRESS:
        raise RuntimeError(f"target executable allocation failed: {error}")
    _write(process, address, value)
    return address


def _module_base(target):
    for module in target.module_iter():
        spec = module.GetFileSpec()
        full_path = getattr(spec, "fullpath", None) or os.path.join(
            spec.GetDirectory() or "", spec.GetFilename() or ""
        )
        if full_path == WECHAT_DYLIB:
            return module.GetObjectFileHeaderAddress().GetLoadAddress(target)
    raise RuntimeError("WeChat resources dylib is not loaded")


def _register(frame, name):
    value = frame.FindRegister(name)
    if not value.IsValid():
        raise RuntimeError(f"register {name} is unavailable")
    return value.GetValueAsUnsigned()


def _cstring(process, address, limit=4096):
    raw = _read(process, address, limit)
    return raw.split(b"\0", 1)[0].decode("utf-8", "strict") if raw else ""


def _std_string(process, address):
    raw = _read(process, address, 24)
    if len(raw) != 24:
        return ""
    pointer, length, capacity = struct.unpack("<QQQ", raw)
    if length > 4095:
        return ""
    if capacity & (1 << 63):
        return _read(process, pointer, length).decode("utf-8", "strict")
    # Current WeChat normally uses the pointer form here, but tolerate libc++
    # short strings while inspecting a completion result.
    short_length = raw[23]
    if short_length <= 22:
        return raw[:short_length].decode("utf-8", "strict")
    return ""


def _patch_pointer_string(process, payload, offset, value):
    encoded = value.encode("utf-8")
    address = _allocate(process, encoded + b"\0")
    struct.pack_into("<QQQ", payload, offset, address, len(encoded), (1 << 63) | (len(encoded) + 1))


def _load_arm():
    with open(ARM_PATH, encoding="utf-8") as stream:
        raw = json.load(stream)
    if int(raw["expiryNs"]) < time.time_ns():
        raise ValueError("arm file expired")
    recipient = str(raw["recipient"])
    if os.environ.get("POLYMUX_WECHAT_TEST_ONLY_FILEHELPER") == "1" and recipient != "filehelper":
        raise ValueError("live WeChat testing is restricted to filehelper")
    path = os.path.realpath(str(raw["videoPath"]))
    with open(path, "rb") as stream:
        digest = hashlib.md5(stream.read()).hexdigest()
    if digest != str(raw["videoMd5"]).lower():
        raise ValueError("video md5 does not match the arm file")
    template = bytes.fromhex(str(raw["payloadHex"]))
    if len(template) < 0x2F8:
        raise ValueError("captured upload payload is too short")
    return raw, recipient, path, digest, bytearray(template)


def _complete(frame, _location, _dict):
    try:
        process = frame.GetThread().GetProcess()
        result = _register(frame, "x2")
        file_id = _std_string(process, result + 0x20)
        if file_id != _STATE.get("file_id"):
            return False
        strings = {hex(offset): _std_string(process, result + offset) for offset in range(0x20, 0x139, 0x18)}
        cdn_key = strings.get("0x60", "")
        md5_key = strings.get("0x90", "")
        aes_candidates = [strings.get("0xa8", ""), strings.get("0x78", "")]
        aes_key = next((value for value in aes_candidates if len(value) == 32), "")
        video_id = strings.get("0xf0", "")
        if not cdn_key or not aes_key or not md5_key or not video_id:
            raise RuntimeError(f"video completion omitted CDN metadata: {strings}")
        detach_error = process.Detach()
        if detach_error.Fail():
            raise RuntimeError(f"video upload detach failed: {detach_error}")
        _finish({"ok": True, "detached": True, "fileId": file_id, "cdnKey": cdn_key, "aesKey": aes_key, "md5Key": md5_key, "videoId": video_id})
    except Exception as error:
        _finish({"ok": False, "reason": f"video completion failed: {error}"})
    return False


def _completion_at(process, address):
    try:
        if _std_string(process, address + 0x20) != _STATE.get("file_id"):
            return None
        strings = {
            hex(offset): _std_string(process, address + offset)
            for offset in range(0x20, 0x139, 0x18)
        }
        cdn_key = strings.get("0x60", "")
        md5_key = strings.get("0x90", "")
        aes_key = next(
            (
                value
                for value in (strings.get("0xa8", ""), strings.get("0x78", ""))
                if len(value) == 32
            ),
            "",
        )
        video_id = strings.get("0xf0", "")
        if not cdn_key or not aes_key or not md5_key or not video_id:
            return None
        return {
            "fileId": _STATE["file_id"],
            "cdnKey": cdn_key,
            "aesKey": aes_key,
            "md5Key": md5_key,
            "videoId": video_id,
        }
    except Exception:
        return None


def _native_callback(frame, _location, _dict):
    try:
        process = frame.GetThread().GetProcess()
        _STATE["callback_count"] = _STATE.get("callback_count", 0) + 1
        registers = {
            name: _register(frame, name)
            for name in (
                "x0",
                "x1",
                "x2",
                "x3",
                "x4",
                "x5",
                "x6",
                "x7",
                "lr",
            )
        }
        print(
            "polymux native CDN callback "
            + str(_STATE["callback_count"])
            + " "
            + " ".join(f"{name}={value:#x}" for name, value in registers.items())
        )
        for value in registers.values():
            if value < 0x100000000 or value >= 0x800000000000:
                continue
            for delta in range(0, 0x81, 8):
                completion = _completion_at(process, value + delta)
                if not completion:
                    continue
                detach_error = process.Detach()
                if detach_error.Fail():
                    raise RuntimeError(f"video upload detach failed: {detach_error}")
                _finish({"ok": True, "detached": True, **completion})
                return False
    except Exception as error:
        _finish({"ok": False, "reason": f"native callback failed: {error}"})
    return False


def _capture_start(frame, _location, _dict):
    try:
        process = frame.GetThread().GetProcess()
        controller = _register(frame, "x0")
        payload_address = _register(frame, "x1")
        payload = _read(process, payload_address, 0x300)
        if len(payload) != 0x300:
            raise RuntimeError("native upload payload capture was incomplete")
        recipient = payload[0x68:0x80].split(b"\0", 1)[0].decode(
            "utf-8", "replace"
        )
        if (
            os.environ.get("POLYMUX_WECHAT_TEST_ONLY_FILEHELPER") == "1"
            and recipient != "filehelper"
        ):
            return False
        detach_error = process.Detach()
        if detach_error.Fail():
            raise RuntimeError(f"warmup capture detach failed: {detach_error}")
        _finish({"ok": True, "detached": True, "recipient": recipient, "uploadController": hex(controller), "payloadHex": payload.hex()})
    except Exception as error:
        _finish({"ok": False, "reason": f"warmup capture failed: {error}"})
    return False


def capture_warmup(debugger, _command, result, _dict):
    try:
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while arming warmup capture")
        module_base = _module_base(target)
        _STATE.clear()
        breakpoint = target.BreakpointCreateByAddress(module_base + START_UPLOAD_OFFSET)
        breakpoint.SetScriptCallbackFunction(__name__ + "._capture_start")
        if breakpoint.GetNumLocations() == 0:
            raise RuntimeError("warmup breakpoint did not resolve")
        result.AppendMessage("native CDN warmup capture ready")
    except Exception as error:
        _finish({"ok": False, "reason": f"warmup setup failed: {error}"})
        result.SetError(str(error))


def cleanup_native(_debugger, _command, result, _dict):
    result.AppendMessage("native CDN upload cleanup complete")


def upload_video(debugger, _command, result, _dict):
    try:
        arm, recipient, video_path, digest, payload = _load_arm()
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise RuntimeError("WeChat must be stopped while arming the CDN upload")
        module_base = _module_base(target)
        file_id = str(arm["fileId"])
        _STATE.clear()
        _STATE["file_id"] = file_id
        # The first two fields are per-upload callback objects. Reusing the
        # natural upload's objects after that job ends can crash the CDN worker.
        # Supply tiny no-op virtual objects instead and observe their callback
        # entrypoint to collect the completion result.
        # Hardened WeChat does not permit a new executable mapping. Reuse the
        # exact wrapper's otherwise ordinary ARM64 `ret` instruction as the
        # no-op callback target and observe it with a scoped breakpoint.
        callback_stub = module_base + START_UPLOAD_WRAPPER_OFFSET + 0x108
        callback_vtable = _allocate(
            process, struct.pack("<Q", callback_stub) * 32
        )
        callback_object = struct.pack("<Q", callback_vtable) + b"\0" * 16
        callback_one = _allocate(process, callback_object)
        callback_two = _allocate(process, callback_object)
        _STATE["callback_one"] = callback_one
        _STATE["callback_two"] = callback_two
        _STATE["callback_stub"] = callback_stub
        struct.pack_into("<QQ", payload, 0x00, callback_one, callback_two)
        # These inactive template fields held process-local pointers in the
        # natural upload we captured. They must never cross a WeChat restart.
        for offset in (0x1E0, 0x298):
            struct.pack_into("<Q", payload, offset, 0)
        _patch_pointer_string(process, payload, 0x48, file_id)
        inline = recipient.encode("utf-8")
        if len(inline) > 15:
            raise ValueError("CDN recipient is too long for the exact-build profile")
        payload[0x68:0x80] = b"\0" * 24
        payload[0x68:0x68 + len(inline)] = inline
        payload[0x7F] = len(inline)
        struct.pack_into("<I", payload, 0x9C, 4)
        _patch_pointer_string(process, payload, 0xA8, digest)
        for offset in (0xE8, 0x118, 0x148):
            _patch_pointer_string(process, payload, offset, video_path)
        struct.pack_into("<I", payload, 0x1BC, 1)
        _patch_pointer_string(process, payload, 0x200, str(arm["aesKey"]))
        payload_address = _allocate(process, payload)
        callback_breakpoint = target.BreakpointCreateByAddress(callback_stub)
        callback_breakpoint.SetScriptCallbackFunction(
            __name__ + "._native_callback"
        )
        if callback_breakpoint.GetNumLocations() == 0:
            raise RuntimeError("video callback breakpoint did not resolve")
        breakpoint = target.BreakpointCreateByAddress(module_base + COMPLETE_OFFSET)
        breakpoint.SetScriptCallbackFunction(__name__ + "._complete")
        if breakpoint.GetNumLocations() == 0:
            raise RuntimeError("video completion breakpoint did not resolve")
        frame = process.GetSelectedThread().GetFrameAtIndex(0)
        options = lldb.SBExpressionOptions()
        options.SetIgnoreBreakpoints(True)
        options.SetTryAllThreads(False)
        options.SetStopOthers(True)
        options.SetUnwindOnError(True)
        options.SetTimeoutInMicroSeconds(5_000_000)
        # Call Mars' public StartC2CUpload wrapper. It resolves the live
        # per-process CDN manager itself, so a payload template captured from
        # the same exact WeChat build is portable across WeChat restarts.
        expression = f"((long long (*)(void *)){module_base + START_UPLOAD_WRAPPER_OFFSET:#x})((void *){payload_address:#x})"
        value = frame.EvaluateExpression(expression, options)
        if value.GetError().Fail():
            raise RuntimeError(f"native video upload start failed: {value.GetError()}")
        result.AppendMessage(f"native CDN video upload ready file_id={file_id} result={value.GetValueAsSigned()}")
    except Exception as error:
        _finish({"ok": False, "reason": f"native CDN upload setup failed: {error}"})
        result.SetError(str(error))


def __lldb_init_module(debugger, _dict):
    debugger.HandleCommand(f"command script add -f {__name__}.upload_video polymux-native-cdn-video")
    debugger.HandleCommand(f"command script add -f {__name__}.capture_warmup polymux-native-cdn-capture")
    debugger.HandleCommand(f"command script add -f {__name__}.cleanup_native polymux-native-cleanup")
