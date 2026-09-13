"""Fixed read-only probe in an existing Windows user session, with private pipe IPC.

Only a service already holding WTSQueryUserToken privileges can use this route.
No logon, task registration, credentials, UI activation, or inherited handles.
"""
import ctypes
from ctypes import wintypes as W
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid


def collect_session(ident, timeout=3.2):
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    adv = ctypes.WinDLL('advapi32', use_last_error=True)
    wts = ctypes.WinDLL('wtsapi32', use_last_error=True)
    userenv = ctypes.WinDLL('userenv', use_last_error=True)
    class SA(ctypes.Structure):
        _fields_ = [('length', W.DWORD), ('descriptor', ctypes.c_void_p), ('inherit', W.BOOL)]
    class STARTUP(ctypes.Structure):
        _fields_ = [('cb', W.DWORD), ('reserved', W.LPWSTR), ('desktop', W.LPWSTR), ('title', W.LPWSTR),
                    ('x', W.DWORD), ('y', W.DWORD), ('cx', W.DWORD), ('cy', W.DWORD),
                    ('charsx', W.DWORD), ('charsy', W.DWORD), ('fill', W.DWORD), ('flags', W.DWORD),
                    ('show', W.WORD), ('reserved2size', W.WORD), ('reserved2', ctypes.c_void_p),
                    ('input', W.HANDLE), ('output', W.HANDLE), ('error', W.HANDLE)]
    class PROCESS(ctypes.Structure):
        _fields_ = [('process', W.HANDLE), ('thread', W.HANDLE), ('pid', W.DWORD), ('tid', W.DWORD)]
    kernel.CloseHandle.argtypes = [W.HANDLE]
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.CreateNamedPipeW.argtypes = [W.LPCWSTR, W.DWORD, W.DWORD, W.DWORD, W.DWORD, W.DWORD, W.DWORD, ctypes.POINTER(SA)]
    kernel.CreateNamedPipeW.restype = W.HANDLE
    kernel.ConnectNamedPipe.argtypes = [W.HANDLE, ctypes.c_void_p]
    kernel.PeekNamedPipe.argtypes = [W.HANDLE, ctypes.c_void_p, W.DWORD, ctypes.c_void_p, ctypes.POINTER(W.DWORD), ctypes.c_void_p]
    kernel.ReadFile.argtypes = [W.HANDLE, ctypes.c_void_p, W.DWORD, ctypes.POINTER(W.DWORD), ctypes.c_void_p]
    kernel.WaitForSingleObject.argtypes = [W.HANDLE, W.DWORD]
    kernel.TerminateProcess.argtypes = [W.HANDLE, W.UINT]
    kernel.GetExitCodeProcess.argtypes = [W.HANDLE, ctypes.POINTER(W.DWORD)]
    wts.WTSQueryUserToken.argtypes = [W.ULONG, ctypes.POINTER(W.HANDLE)]
    adv.GetTokenInformation.argtypes = [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD, ctypes.POINTER(W.DWORD)]
    adv.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(W.LPWSTR)]
    adv.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [W.LPCWSTR, W.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
    adv.CreateProcessAsUserW.argtypes = [W.HANDLE, W.LPCWSTR, W.LPWSTR, ctypes.c_void_p, ctypes.c_void_p,
                                      W.BOOL, W.DWORD, ctypes.c_void_p, W.LPCWSTR, ctypes.POINTER(STARTUP), ctypes.POINTER(PROCESS)]
    userenv.CreateEnvironmentBlock.argtypes = [ctypes.POINTER(ctypes.c_void_p), W.HANDLE, W.BOOL]
    userenv.DestroyEnvironmentBlock.argtypes = [ctypes.c_void_p]
    token, descriptor, environment = W.HANDLE(), ctypes.c_void_p(), ctypes.c_void_p()
    sid_text, pipe, process = W.LPWSTR(), None, PROCESS()
    def require(ok, message):
        if not ok:
            raise OSError(ctypes.get_last_error(), message)
    try:
        require(wts.WTSQueryUserToken(ident, ctypes.byref(token)), 'session collection requires an existing privileged service')
        needed = W.DWORD()
        adv.GetTokenInformation(token, 1, None, 0, ctypes.byref(needed))
        data = ctypes.create_string_buffer(needed.value)
        require(adv.GetTokenInformation(token, 1, data, len(data), ctypes.byref(needed)), 'cannot identify session account')
        sid = ctypes.cast(data, ctypes.POINTER(ctypes.c_void_p)).contents.value
        require(adv.ConvertSidToStringSidW(sid, ctypes.byref(sid_text)), 'cannot identify session account')
        require(adv.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            f'D:P(A;;GA;;;SY)(A;;GRGW;;;{sid_text.value})', 1, ctypes.byref(descriptor), None), 'cannot secure observation pipe')
        security = SA(ctypes.sizeof(SA), descriptor, False)
        name = r'\\.\pipe\control-observe-' + uuid.uuid4().hex
        pipe = kernel.CreateNamedPipeW(name, 0x1 | 0x80000, 0x1 | 0x8, 1, 0, 65536, 0, ctypes.byref(security))
        require(pipe and pipe != ctypes.c_void_p(-1).value, 'cannot open observation pipe')
        kernel.ConnectNamedPipe(pipe, None)  # Nonblocking listener; never waits on human input.
        require(userenv.CreateEnvironmentBlock(ctypes.byref(environment), token, False), 'cannot read session environment')
        startup = STARTUP(); startup.cb = ctypes.sizeof(startup); startup.desktop = 'winsta0\\default'
        startup.flags = 1; startup.show = 0
        script = Path(__file__).resolve()
        command = ctypes.create_unicode_buffer(subprocess.list2cmdline([sys.executable, '-B', str(script), name, str(ident)]))
        require(adv.CreateProcessAsUserW(token, sys.executable, command, None, None, False,
            0x08000000 | 0x400, environment, str(script.parent.parent), ctypes.byref(startup), ctypes.byref(process)),
            'cannot start read-only session collector')
        deadline, output = time.monotonic() + timeout, bytearray()
        while time.monotonic() < deadline:
            available = W.DWORD()
            if kernel.PeekNamedPipe(pipe, None, 0, None, ctypes.byref(available), None) and available.value:
                chunk = ctypes.create_string_buffer(min(available.value, 65536)); got = W.DWORD()
                require(kernel.ReadFile(pipe, chunk, len(chunk), ctypes.byref(got), None), 'cannot read session observation')
                output.extend(chunk.raw[:got.value])
                if len(output) > 2 * 1024 * 1024:
                    raise ValueError('session observation too large')
                continue
            if kernel.WaitForSingleObject(process.process, 0) == 0:
                code = W.DWORD(); kernel.GetExitCodeProcess(process.process, ctypes.byref(code))
                if not output:
                    raise ValueError(f'session helper produced no observation (exit {code.value}); check installed source read access')
                value = json.loads(output)
                if value.get('collector_session_id') != f'wts:{ident}':
                    raise ValueError('session collector identity mismatch')
                return value
            time.sleep(.015)
        raise ValueError('session observation timed out')
    finally:
        if process.process:
            if kernel.WaitForSingleObject(process.process, 0) == 258:
                kernel.TerminateProcess(process.process, 1)  # Only our own bounded read-only child.
            kernel.CloseHandle(process.process)
        if process.thread: kernel.CloseHandle(process.thread)
        if pipe and pipe != ctypes.c_void_p(-1).value: kernel.CloseHandle(pipe)
        if environment: userenv.DestroyEnvironmentBlock(environment)
        if descriptor: kernel.LocalFree(descriptor)
        if sid_text: kernel.LocalFree(sid_text)
        if token: kernel.CloseHandle(token)


if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from windows.sessions import current_session
    from windows.state import collect_current
    if len(sys.argv) != 3 or not sys.argv[1].startswith(r'\\.\pipe\control-observe-'):
        raise SystemExit('invalid observation channel')
    if current_session() != int(sys.argv[2]):
        raise SystemExit('session changed')
    with open(sys.argv[1], 'wb', buffering=0) as output:
        data = json.dumps(collect_current(), ensure_ascii=False).encode('utf-8')
        while data:
            written = output.write(data)
            if not written: raise SystemExit('observation pipe closed')
            data = data[written:]
