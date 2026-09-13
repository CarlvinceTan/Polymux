"""Read WTS console/RDP state. Service session zero is never human-absence evidence."""
import ctypes
from ctypes import wintypes as W


def current_session():
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    result = W.DWORD()
    if not kernel.ProcessIdToSessionId(kernel.GetCurrentProcessId(), ctypes.byref(result)):
        raise OSError(ctypes.get_last_error(), 'cannot identify process session')
    return result.value


def session_row(ident, state, protocol=None):
    states = {0: 'active', 1: 'connected', 2: 'connect-query', 3: 'shadow',
              4: 'disconnected', 5: 'idle', 6: 'listen', 7: 'reset', 8: 'down', 9: 'init'}
    # A disconnected RDP session cannot receive client input; console/unknown
    # transports stay conservative because another viewer may still be attached.
    presence = 'absent' if state in {6, 8} or (state == 4 and protocol == 2) else 'possible' if state in {0, 1, 2, 3} else 'unknown'
    return {'session_id': f'wts:{ident}', 'state': states.get(state, 'unknown'),
            'transport': {0: 'console', 2: 'rdp'}.get(protocol, 'unknown'), 'presence': presence}


def discover():
    api = ctypes.WinDLL('wtsapi32', use_last_error=True)
    class SESSION(ctypes.Structure):
        _fields_ = [('id', W.DWORD), ('station', W.LPWSTR), ('state', ctypes.c_int)]
    pointer = ctypes.POINTER(SESSION)()
    count = W.DWORD()
    api.WTSEnumerateSessionsW.argtypes = [W.HANDLE, W.DWORD, W.DWORD, ctypes.POINTER(ctypes.POINTER(SESSION)), ctypes.POINTER(W.DWORD)]
    api.WTSQuerySessionInformationW.argtypes = [W.HANDLE, W.DWORD, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(W.DWORD)]
    api.WTSFreeMemory.argtypes = [ctypes.c_void_p]
    if not api.WTSEnumerateSessionsW(None, 0, 1, ctypes.byref(pointer), ctypes.byref(count)):
        return [], False
    rows = []
    try:
        for i in range(count.value):
            item = pointer[i]
            if item.id == 0 or item.state == 6:
                continue  # Services and listeners are not user desktops.
            data, length = ctypes.c_void_p(), W.DWORD()
            protocol = None
            if api.WTSQuerySessionInformationW(None, item.id, 16, ctypes.byref(data), ctypes.byref(length)):
                try:
                    if length.value >= 2:
                        protocol = ctypes.cast(data, ctypes.POINTER(W.USHORT)).contents.value
                finally:
                    api.WTSFreeMemory(data)
            rows.append(session_row(item.id, item.state, protocol))
    finally:
        api.WTSFreeMemory(pointer)
    return rows, True
