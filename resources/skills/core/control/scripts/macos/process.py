"""Read app identity and attention through system APIs without a compiler."""
import ctypes


class BSDInfo(ctypes.Structure):
    """Public proc_bsdinfo layout from sys/proc_info.h; no target memory reads."""
    _fields_ = [(name, ctypes.c_uint32) for name in (
        'flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid',
        'ruid', 'rgid', 'svuid', 'svgid', 'reserved')]
    _fields_ += [('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32)]
    _fields_ += [(name, ctypes.c_uint32) for name in ('nfiles', 'pgid', 'jobc', 'tdev', 'tpgid')]
    _fields_ += [('nice', ctypes.c_int32), ('seconds', ctypes.c_uint64), ('micros', ctypes.c_uint64)]


def kernel_birth(pid):
    if not isinstance(pid, int) or pid <= 0:
        raise ValueError('application process identity unavailable')
    library = ctypes.CDLL('/usr/lib/libproc.dylib')
    library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    library.proc_pidinfo.restype = ctypes.c_int
    info = BSDInfo()
    size = ctypes.sizeof(info)
    if (library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), size) != size or
            info.pid != pid or not info.seconds or info.micros >= 1_000_000):
        raise ValueError('application process identity unavailable')
    return f'{pid}:bsd:{info.seconds}:{info.micros}'


class AppKit:
    """Small read-only Objective-C bridge; no PyObjC or developer toolchain needed."""
    def __init__(self):
        self.appkit = ctypes.CDLL('/System/Library/Frameworks/AppKit.framework/AppKit')
        self.objc = ctypes.CDLL('/usr/lib/libobjc.A.dylib')
        self.objc.objc_getClass.argtypes = [ctypes.c_char_p]
        self.objc.objc_getClass.restype = ctypes.c_void_p
        self.objc.sel_registerName.argtypes = [ctypes.c_char_p]
        self.objc.sel_registerName.restype = ctypes.c_void_p
        self.objc.objc_autoreleasePoolPush.restype = ctypes.c_void_p
        self.objc.objc_autoreleasePoolPop.argtypes = [ctypes.c_void_p]
        self.pool = self.objc.objc_autoreleasePoolPush()

    def send(self, target, selector, result=ctypes.c_void_p, args=(), types=()):
        call = ctypes.CFUNCTYPE(result, ctypes.c_void_p, ctypes.c_void_p, *types)(('objc_msgSend', self.objc))
        return call(target, self.objc.sel_registerName(selector.encode()), *args)

    def cls(self, name):
        return self.objc.objc_getClass(name.encode())

    def close(self):
        self.objc.objc_autoreleasePoolPop(self.pool)


def application_birth(pid):
    kit = AppKit()
    try:
        app = kit.send(kit.cls('NSRunningApplication'), 'runningApplicationWithProcessIdentifier:', args=(pid,), types=(ctypes.c_int,))
        if not app:
            raise ValueError('application launch identity unavailable')
        date = kit.send(app, 'launchDate') if app else None
        if not date:
            return kernel_birth(pid)
        return f"{pid}:{kit.send(date, 'timeIntervalSince1970', ctypes.c_double)}"
    finally:
        kit.close()


def foreground_app_id():
    kit = AppKit()
    try:
        workspace = kit.send(kit.cls('NSWorkspace'), 'sharedWorkspace')
        app = kit.send(workspace, 'frontmostApplication')
        ident = kit.send(app, 'bundleIdentifier') if app else None
        value = kit.send(ident, 'UTF8String', ctypes.c_char_p) if ident else None
        return value.decode() if value else None
    finally:
        kit.close()
