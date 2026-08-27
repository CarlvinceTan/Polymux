"""One-shot LLDB tracer for locating WeChat's outbound protobuf compressor."""

import os

import lldb


SENTINEL = os.environ.get("POLYMUX_WECHAT_TRACE_SENTINEL", "").encode()
OUTPUT = os.environ.get("POLYMUX_WECHAT_TRACE_OUTPUT", "/tmp/polymux-wechat-compress.log")


def _capture(frame, _location, _dict):
    try:
        process = frame.GetThread().GetProcess()
        source = frame.FindRegister("x2").GetValueAsUnsigned()
        length = frame.FindRegister("x3").GetValueAsUnsigned()
        if not source or not 0 < length <= 1024 * 1024:
            return False
        error = lldb.SBError()
        body = bytes(process.ReadMemory(source, length, error))
        if error.Fail() or (SENTINEL and SENTINEL not in body):
            return False
        lines = [f"source=0x{source:x} length={length}", f"body_hex={body.hex()}"]
        thread = frame.GetThread()
        for index in range(min(thread.GetNumFrames(), 32)):
            item = thread.GetFrameAtIndex(index)
            module = item.GetModule()
            section = module.FindSection("__TEXT") if module.IsValid() else None
            base = section.GetLoadAddress(process.GetTarget()) if section and section.IsValid() else 0
            pc = item.GetPC()
            lines.append(
                f"#{index} module={module.GetFileSpec().GetFilename()} pc=0x{pc:x} rva=0x{pc-base:x}"
            )
        with open(OUTPUT, "w", encoding="utf-8") as stream:
            stream.write("\n".join(lines) + "\n")
        for breakpoint in process.GetTarget().breakpoint_iter():
            breakpoint.SetEnabled(False)
    except Exception as error:
        with open(OUTPUT, "w", encoding="utf-8") as stream:
            stream.write(f"error={error!r}\n")
    return False


def install(debugger):
    target = debugger.GetSelectedTarget()
    breakpoint = target.BreakpointCreateByName("compress")
    if breakpoint.GetNumLocations() == 0:
        breakpoint = target.BreakpointCreateByName("_compress")
    breakpoint.SetScriptCallbackFunction(__name__ + "._capture")
    breakpoint.SetAutoContinue(True)
    print(f"compress trace ready locations={breakpoint.GetNumLocations()}", flush=True)


def __lldb_init_module(debugger, _dict):
    debugger.HandleCommand(f"command script add -f {__name__}.install polymux-compress-trace")
