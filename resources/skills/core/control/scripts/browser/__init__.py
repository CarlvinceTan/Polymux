"""Shared installed-browser identity helpers for Control's browser package."""

from __future__ import annotations

import os
import platform
import plistlib
import re
import shlex
import shutil
import subprocess
import ctypes
from pathlib import Path



def macos_bundle(executable: str) -> Path | None:
    path = Path(executable)
    for index, part in enumerate(path.parts):
        if part.endswith(".app"):
            return Path(*path.parts[: index + 1])
    return None


def bundle_identity(bundle: Path) -> tuple[str, str]:
    plist = bundle / "Contents" / "Info.plist"
    try:
        with plist.open("rb") as handle:
            info = plistlib.load(handle)
    except (OSError, plistlib.InvalidFileException):
        return bundle.stem, bundle.stem
    return str(info.get("CFBundleIdentifier") or bundle.stem), str(
        info.get("CFBundleDisplayName") or info.get("CFBundleName") or bundle.stem
    )


def engine_for(executable: str, native_app_id: str) -> str:
    path = Path(executable)
    bundle = macos_bundle(executable)
    if bundle is None:
        path = path.resolve()
    root = bundle / "Contents" if bundle else path.parent
    if native_app_id.startswith("com.apple.Safari"):
        return "webkit"
    gecko_markers = [root / "Resources" / "omni.ja", root / "omni.ja", root / "xul.dll"]
    if any(marker.exists() for marker in gecko_markers):
        return "gecko"
    framework_dir = root / "Frameworks"
    chromium_framework = framework_dir.is_dir() and any(
        child.name.endswith(" Framework.framework") for child in framework_dir.iterdir()
    )
    chromium_markers = [root / "icudtl.dat", root / "chrome_100_percent.pak", root / "resources.pak"]
    if chromium_framework or any(marker.exists() for marker in chromium_markers):
        return "chromium"
    # Edge and Chrome on Windows keep runtime files in version subdirectories.
    # Never recursively scan arbitrary application directories (e.g. System32).
    if not bundle and root.is_dir():
        for child in root.iterdir():
            if re.fullmatch(r"[0-9]+(?:\.[0-9]+){2,3}", child.name):
                if any((child / marker).is_file() for marker in
                       ("icudtl.dat", "chrome_100_percent.pak", "resources.pak")):
                    return "chromium"
    if (root / "Frameworks/WebKit.framework").is_dir() or (root / "WebKit.framework").is_dir():
        return "webkit"
    return "unknown"


def installed_browser(executable: str) -> dict[str, str]:
    path = Path(executable)
    if not path.is_absolute():
        raise ValueError("browser must be an absolute executable path")
    if not path.is_file():
        raise ValueError(f"browser executable does not exist: {executable}")
    if not os.access(path, os.X_OK):
        raise ValueError(f"browser is not executable: {executable}")
    bundle = macos_bundle(executable) if platform.system() == "Darwin" else None
    native_app_id, name = (
        bundle_identity(bundle) if bundle else (str(path.resolve()), path.stem)
    )
    if platform.system() == "Windows":
        native_app_id = native_app_id.casefold()
    engine = engine_for(executable, native_app_id)
    return {
        "path": str(path.resolve()),
        "native_app_id": native_app_id,
        "name": name,
        "engine": engine,
    }


def macos_default_bundle_id() -> str:
    core = ctypes.CDLL(
        "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
    )
    services = ctypes.CDLL(
        "/System/Library/Frameworks/CoreServices.framework/CoreServices"
    )
    encoding = 0x08000100
    core.CFStringCreateWithCString.argtypes = [
        ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32
    ]
    core.CFStringCreateWithCString.restype = ctypes.c_void_p
    core.CFStringGetCString.argtypes = [
        ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32
    ]
    core.CFStringGetCString.restype = ctypes.c_bool
    core.CFRelease.argtypes = [ctypes.c_void_p]
    services.LSCopyDefaultHandlerForURLScheme.argtypes = [ctypes.c_void_p]
    services.LSCopyDefaultHandlerForURLScheme.restype = ctypes.c_void_p
    source = core.CFStringCreateWithCString(None, b"https", encoding)
    try:
        result = services.LSCopyDefaultHandlerForURLScheme(source)
    finally:
        core.CFRelease(source)
    if not result:
        raise ValueError("macOS has no default HTTPS browser")
    try:
        buffer = ctypes.create_string_buffer(1024)
        if not core.CFStringGetCString(result, buffer, len(buffer), encoding):
            raise ValueError("cannot read the macOS default browser identity")
        return buffer.value.decode()
    finally:
        core.CFRelease(result)


def macos_default_executable() -> str:
    bundle_id = macos_default_bundle_id()
    if not re.fullmatch(r"[A-Za-z0-9.-]+", bundle_id):
        raise ValueError("macOS returned an invalid default browser identity")
    result = subprocess.run(
        [
            "/usr/bin/osascript", "-e",
            f'POSIX path of (path to application id "{bundle_id}")',
        ],
        capture_output=True,
        text=True,
        check=False, timeout=3,
    )
    if result.returncode or not result.stdout.strip():
        raise ValueError(f"cannot locate macOS default browser {bundle_id!r}")
    bundle = Path(result.stdout.strip()).resolve()
    try:
        with (bundle / "Contents" / "Info.plist").open("rb") as handle:
            executable = plistlib.load(handle).get("CFBundleExecutable")
    except (OSError, plistlib.InvalidFileException) as exc:
        raise ValueError("cannot inspect the macOS default browser bundle") from exc
    if not isinstance(executable, str) or not executable:
        raise ValueError("macOS default browser has no bundle executable")
    return str(bundle / "Contents" / "MacOS" / executable)


def linux_default_executable() -> str:
    command = shutil.which("xdg-settings")
    if not command:
        raise ValueError("xdg-settings is required to derive the default browser")
    result = subprocess.run(
        [command, "get", "default-web-browser"],
        capture_output=True,
        text=True,
        check=False, timeout=3,
    )
    desktop_id = result.stdout.strip()
    if result.returncode or not desktop_id or Path(desktop_id).name != desktop_id:
        raise ValueError("Linux has no unambiguous default web browser")
    data_dirs = [Path.home() / ".local/share", Path("/usr/local/share"), Path("/usr/share")]
    if data_home := os.environ.get("XDG_DATA_HOME"):
        data_dirs[0] = Path(data_home)
    if system_dirs := os.environ.get("XDG_DATA_DIRS"):
        data_dirs[1:] = [Path(value) for value in system_dirs.split(":") if value]
    desktop = next(
        (root / "applications" / desktop_id for root in data_dirs
         if (root / "applications" / desktop_id).is_file()),
        None,
    )
    if desktop is None:
        raise ValueError(f"default browser desktop entry is unavailable: {desktop_id}")
    fields = dict(
        line.split("=", 1) for line in desktop.read_text(errors="replace").splitlines()
        if "=" in line and not line.startswith(("#", "["))
    )
    arguments = shlex.split(fields.get("Exec", ""))
    token = arguments[0] if arguments else ""
    executable = token if Path(token).is_absolute() else shutil.which(token)
    if not executable:
        raise ValueError(f"cannot resolve executable from {desktop_id}")
    return str(Path(executable).resolve())


def windows_default_executable() -> str:
    powershell = shutil.which("powershell.exe") or shutil.which("powershell")
    if not powershell:
        raise ValueError("PowerShell is required to derive the default browser")
    script = (
        "$p=(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\"
        "UrlAssociations\\https\\UserChoice').ProgId;"
        "$c=(Get-ItemProperty \"Registry::HKEY_CLASSES_ROOT\\$p\\shell\\open\\command\")."
        "'(default)';"
        "$m=[regex]::Match($c,'^\\s*\"?(.+?\\.exe)\"?(?:\\s|$)');"
        "if(-not $m.Success){exit 2};$m.Groups[1].Value"
    )
    result = subprocess.run(
        [powershell, "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        check=False, timeout=3,
    )
    executable = os.path.expandvars(result.stdout.strip())
    if result.returncode or not executable:
        raise ValueError("Windows has no resolvable default HTTPS browser")
    return executable


def default_browser(system: str | None = None) -> dict[str, str]:
    operating_system = system or platform.system()
    if operating_system == "Darwin":
        executable = macos_default_executable()
    elif operating_system == "Linux":
        executable = linux_default_executable()
    elif operating_system == "Windows":
        executable = windows_default_executable()
    else:
        raise ValueError(f"default browser discovery is unsupported on {operating_system}")
    try:
        return installed_browser(executable)
    except ValueError as exc:
        raise ValueError(f"OS default browser identity unavailable: {exc}") from exc
