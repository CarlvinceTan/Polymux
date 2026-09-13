"""Describe the OS default browser and inventory its exact tabs."""

from __future__ import annotations

import argparse
import concurrent.futures
import ctypes
import hashlib
import json
import os
import platform
import shlex
import shutil
import socket
import subprocess
import sys
from pathlib import Path


PACKAGE_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = PACKAGE_DIR.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from browser import default_browser


def emit(status: str, code: int = 0, **fields: object) -> None:
    print(json.dumps({"status": status, **fields}, sort_keys=True))
    raise SystemExit(code)


def unix_process(pid: int) -> dict:
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "pid=,ppid=,command="],
        capture_output=True,
        text=True,
        check=False, timeout=3,
    )
    if result.returncode or not result.stdout.strip():
        raise ValueError(f"process {pid} is unavailable")
    parts = result.stdout.strip().split(None, 2)
    if len(parts) < 2:
        raise ValueError(f"process {pid} identity is incomplete")
    if platform.system() == "Darwin":
        buffer = ctypes.create_string_buffer(4096)
        length = ctypes.CDLL("/usr/lib/libproc.dylib").proc_pidpath(pid, buffer, len(buffer))
        executable = os.fsdecode(buffer.value) if length > 0 else ""
    else:
        try:
            executable = os.readlink(f"/proc/{pid}/exe")
        except OSError:
            executable = parts[2].split(None, 1)[0] if len(parts) == 3 else ""
    return {
        "pid": int(parts[0]),
        "ppid": int(parts[1]),
        "executable": executable,
        "arguments": parts[2] if len(parts) == 3 else "",
    }


def windows_process(pid: int) -> dict:
    script = (
        "$p=Get-CimInstance Win32_Process -Filter \"ProcessId=%d\";"
        "if($null-eq$p){exit 2};"
        "$p|Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine|ConvertTo-Json -Compress"
    ) % pid
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        check=False, timeout=3,
    )
    if result.returncode:
        raise ValueError(f"process {pid} is unavailable")
    value = json.loads(result.stdout)
    return {
        "pid": int(value["ProcessId"]),
        "ppid": int(value["ParentProcessId"]),
        "executable": value.get("ExecutablePath") or "",
        "arguments": value.get("CommandLine") or "",
    }


def process(pid: int) -> dict:
    return windows_process(pid) if platform.system() == "Windows" else unix_process(pid)


def browser_process(executable: str) -> dict:
    if platform.system() == "Windows":
        powershell = shutil.which("powershell.exe") or shutil.which("powershell")
        if not powershell:
            raise ValueError("cannot inspect running browser processes")
        script = (
            "$target=[IO.Path]::GetFullPath($args[0]);"
            "$matches=@(Get-CimInstance Win32_Process|Where-Object {"
            "$_.ExecutablePath -and $_.CommandLine -notlike '*--type=*' -and "
            "[IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target}|"
            "Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine);"
            "ConvertTo-Json -Compress -InputObject $matches"
        )
        result = subprocess.run(
            [powershell, "-NoProfile", "-NonInteractive", "-Command", script, executable],
            capture_output=True, text=True, check=False, timeout=3,
        )
        if result.returncode:
            raise ValueError("cannot inspect running browser processes")
        try:
            values = json.loads(result.stdout or "[]")
        except json.JSONDecodeError as exc:
            raise ValueError("cannot inspect running browser processes") from exc
        if isinstance(values, dict):
            values = [values]
        matches = [
            {
                "pid": int(value["ProcessId"]),
                "ppid": int(value["ParentProcessId"]),
                "executable": value.get("ExecutablePath") or "",
                "arguments": value.get("CommandLine") or "",
            }
            for value in values if isinstance(value, dict) and value.get("ProcessId")
        ]
        if not matches:
            raise ValueError("default browser is not running")
        if len(matches) != 1:
            raise ValueError("default browser process is ambiguous")
        return matches[0]
    result = subprocess.run(
        ["ps", "-axo", "pid=,command="], capture_output=True, text=True, check=False, timeout=3
    )
    if result.returncode:
        raise ValueError("cannot inspect running browser processes")
    matches: list[dict] = []
    expected = str(Path(executable).resolve())
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 1)
        if len(fields) != 2 or "--type=" in fields[1] or Path(executable).name not in fields[1]:
            continue
        try:
            candidate = process(int(fields[0]))
        except (OSError, ValueError):
            continue
        if candidate["executable"] and str(Path(candidate["executable"]).resolve()) == expected:
            matches.append(candidate)
    if not matches:
        raise ValueError("default browser is not running")
    if len(matches) != 1:
        raise ValueError("default browser process is ambiguous")
    return matches[0]


def command_user_data_dir(arguments: str) -> Path | None:
    try:
        if platform.system() == "Windows":
            shell = ctypes.windll.shell32
            shell.CommandLineToArgvW.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_int)]
            shell.CommandLineToArgvW.restype = ctypes.POINTER(ctypes.c_wchar_p)
            count = ctypes.c_int()
            pointer = shell.CommandLineToArgvW(arguments, ctypes.byref(count))
            if not pointer:
                raise ValueError
            try:
                values = [pointer[index] for index in range(count.value)]
            finally:
                ctypes.windll.kernel32.LocalFree(pointer)
        else:
            values = shlex.split(arguments)
    except ValueError as exc:
        raise ValueError("cannot parse default browser process arguments") from exc
    for index, value in enumerate(values):
        if value.startswith("--user-data-dir="):
            return Path(value.split("=", 1)[1]).expanduser()
        if value == "--user-data-dir" and index + 1 < len(values):
            return Path(values[index + 1]).expanduser()
    return None


def default_user_data_dir(browser: dict[str, str]) -> Path:
    system = platform.system()
    if system == "Darwin":
        suffixes = {
            "com.google.Chrome": "Google/Chrome",
            "com.google.Chrome.canary": "Google/Chrome Canary",
            "com.microsoft.edgemac": "Microsoft Edge",
            "com.brave.Browser": "BraveSoftware/Brave-Browser",
            "org.chromium.Chromium": "Chromium",
        }
        suffix = suffixes.get(browser["native_app_id"], browser["native_app_id"])
        return Path.home() / "Library" / "Application Support" / suffix
    executable = browser["path"].replace("\\", "/").rsplit("/", 1)[-1].lower()
    if system == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        suffixes = {
            "chrome.exe": "Google/Chrome/User Data",
            "chrome_proxy.exe": "Google/Chrome/User Data",
            "msedge.exe": "Microsoft/Edge/User Data",
            "brave.exe": "BraveSoftware/Brave-Browser/User Data",
            "chromium.exe": "Chromium/User Data",
        }
        if local and executable in suffixes:
            return Path(local) / Path(suffixes[executable])
    if system == "Linux":
        configuration = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
        suffixes = {
            "google-chrome": "google-chrome",
            "google-chrome-stable": "google-chrome",
            "chromium": "chromium",
            "chromium-browser": "chromium",
            "microsoft-edge": "microsoft-edge",
            "microsoft-edge-stable": "microsoft-edge",
            "brave-browser": "BraveSoftware/Brave-Browser",
        }
        if executable in suffixes:
            return configuration / suffixes[executable]
    raise ValueError("cannot derive this browser's user-data directory on this platform")


def devtools_endpoint(browser: dict[str, str], browser_process: dict) -> tuple[Path, int, str]:
    user_data_dir = command_user_data_dir(browser_process.get("arguments", ""))
    if user_data_dir is None:
        user_data_dir = default_user_data_dir(browser)
    port_file = user_data_dir / "DevToolsActivePort"
    try:
        lines = port_file.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise ValueError("default browser has no available DevTools endpoint") from exc
    if len(lines) < 2 or not lines[0].isdigit() or not lines[1].startswith("/devtools/browser/"):
        raise ValueError("default browser DevTools endpoint is invalid")
    port = int(lines[0])
    if not 1 <= port <= 65535:
        raise ValueError("default browser DevTools port is invalid")
    verify_listener(port, browser_process["pid"])
    return user_data_dir, port, lines[1]


def verify_listener(port: int, pid: int) -> None:
    if platform.system() == "Windows":
        powershell = shutil.which("powershell.exe") or shutil.which("powershell")
        if not powershell:
            raise ValueError("cannot verify the default browser DevTools listener")
        script = (
            "$items=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$args[0]) "
            "-ErrorAction SilentlyContinue|Select-Object OwningProcess,LocalAddress);"
            "ConvertTo-Json -Compress -InputObject $items"
        )
        listener = subprocess.run(
            [powershell, "-NoProfile", "-NonInteractive", "-Command", script, str(port)],
            capture_output=True, text=True, check=False, timeout=3,
        )
        try:
            connections = json.loads(listener.stdout or "[]") if not listener.returncode else []
        except json.JSONDecodeError:
            connections = []
        if isinstance(connections, dict):
            connections = [connections]
        owned = [
            item for item in connections
            if isinstance(item, dict) and int(item.get("OwningProcess", -1)) == pid
        ]
        if not owned:
            raise ValueError("DevTools endpoint does not belong to the default browser")
        if any(item.get("LocalAddress") not in {"127.0.0.1", "::1"} for item in owned):
            raise ValueError("default browser DevTools endpoint is not loopback-only")
    else:
        lsof = shutil.which("lsof")
        if not lsof:
            raise ValueError("cannot verify the default browser DevTools listener")
        listener = subprocess.run(
            [
                lsof, "-nP", "-a", "-p", str(pid),
                f"-iTCP:{port}", "-sTCP:LISTEN", "-Fpn",
            ],
            capture_output=True, text=True, check=False, timeout=3,
        )
        listener_pids = {
            int(line[1:]) for line in listener.stdout.splitlines()
            if line.startswith("p") and line[1:].isdigit()
        }
        listener_names = [
            line[1:] for line in listener.stdout.splitlines() if line.startswith("n")
        ]
        if pid not in listener_pids or not listener_names:
            raise ValueError("DevTools endpoint does not belong to the default browser")
        loopback_prefixes = ("127.0.0.1:", "[::1]:", "localhost:")
        if any(not name.startswith(loopback_prefixes) for name in listener_names):
            raise ValueError("default browser DevTools endpoint is not loopback-only")


def read_exact(stream: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = stream.recv(remaining)
        if not chunk:
            raise ValueError("DevTools WebSocket closed unexpectedly")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def websocket_messages(port: int, path: str, requests: list[dict]) -> dict[int, dict]:
    from transport import WebSocket
    with WebSocket(f"ws://127.0.0.1:{port}{path}") as connection:
        return connection.batch(requests)


def browser_tabs(port: int, websocket_path: str) -> list[dict]:
    """List open pages directly through the verified DevTools endpoint.

    Control stays agnostic about which driver performs page operations;
    inventory only reports the exact live targets so the agent can resolve
    stable identity before choosing its own connector.
    """
    responses = websocket_messages(
        port, websocket_path, [{"id": 1, "method": "Target.getTargets", "params": {}}]
    )
    targets = responses.get(1, {}).get("result", {}).get("targetInfos")
    if not isinstance(targets, list):
        raise ValueError("DevTools tab inventory returned no target list")
    tabs: list[dict] = []
    for target in targets:
        if not isinstance(target, dict) or target.get("type") != "page":
            continue
        target_id = target.get("targetId")
        if not isinstance(target_id, str) or not target_id:
            raise ValueError("DevTools returned a tab without a stable target ID")
        tabs.append({
            "targetId": target_id,
            "title": target.get("title") if isinstance(target.get("title"), str) else "",
            "url": target.get("url") if isinstance(target.get("url"), str) else "",
        })
    return tabs


def target_attention(port: int, target_id: str) -> dict[str, bool | str]:
    """Read selection/focus state from one exact CDP page target."""
    if not target_id or any(character not in "0123456789abcdefABCDEF" for character in target_id):
        return {"selected": "unknown", "focused": "unknown"}
    request = {
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {
            "expression": (
                '({selected:document.visibilityState==="visible",'
                "focused:document.hasFocus()})"
            ),
            "returnByValue": True,
        },
    }
    try:
        response = websocket_messages(port, f"/devtools/page/{target_id}", [request])[1]
        value = response.get("result", {}).get("result", {}).get("value", {})
    except (KeyError, OSError, ValueError, json.JSONDecodeError):
        return {"selected": "unknown", "focused": "unknown"}
    selected = value.get("selected")
    focused = value.get("focused")
    return {
        "selected": selected if isinstance(selected, bool) else "unknown",
        "focused": focused if isinstance(focused, bool) else "unknown",
    }


def attention_for_tabs(port: int, tabs: list[dict]) -> dict[str, dict[str, bool | str]]:
    """Read exact target attention concurrently so inventory latency is bounded."""
    target_ids = [tab["targetId"] for tab in tabs]
    if not target_ids:
        return {}
    workers = min(16, len(target_ids))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        values = executor.map(lambda target_id: target_attention(port, target_id), target_ids)
        return dict(zip(target_ids, values))


def browser_foreground(browser_pid: int) -> bool | str:
    try:
        from attention import browser_attention
        from desktop import local_native
        return browser_attention(local_native(), browser_pid)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        return "unknown"


def default_browser_process() -> tuple[dict[str, str], dict]:
    browser = default_browser()
    process = browser_process(browser["path"])
    return browser, process


def default_tabs() -> dict:
    browser, browser_process, user_data_dir, port, websocket_path = runtime_browser()
    tabs = browser_tabs(port, websocket_path)
    valid_tabs = [
        tab for tab in tabs
        if isinstance(tab, dict) and isinstance(tab.get("targetId"), str)
    ]
    if len(valid_tabs) != len(tabs):
        raise ValueError("DevTools returned a tab without a stable target ID")
    requests = [
        {
            "id": index,
            "method": "Browser.getWindowForTarget",
            "params": {"targetId": tab.get("targetId")},
        }
        for index, tab in enumerate(valid_tabs, 1)
    ]
    windows = websocket_messages(port, websocket_path, requests) if requests else {}
    attention = attention_for_tabs(port, valid_tabs)
    foreground = browser_foreground(browser_process["pid"])
    inventory: list[dict] = []
    for request, tab in zip(requests, valid_tabs):
        response = windows.get(request["id"], {})
        window_id = response.get("result", {}).get("windowId")
        if not isinstance(window_id, int):
            raise ValueError("DevTools did not provide a canonical window for every tab")
        target_attention_state = attention.get(
            tab["targetId"], {"selected": "unknown", "focused": "unknown"}
        )
        selected = target_attention_state["selected"]
        focused = target_attention_state["focused"]
        if foreground is False:
            focused = False
            if selected is False:
                selected = "unknown"
        elif foreground == "unknown" and focused is True:
            focused = "unknown"
        if foreground == "unknown" and selected is False:
            selected = "unknown"
        inventory.append({
            "tab_id": tab["targetId"],
            "window_id": str(window_id),
            "title": tab.get("title") or "",
            "url": tab.get("url") if isinstance(tab.get("url"), str) else "",
            "selected": selected,
            "focused": focused,
        })
    return {
        "app_id": app_id_for(browser, user_data_dir),
        "browser_pid": browser_process["pid"],
        "browser_foreground": foreground,
        "path": browser["path"],
        "tabs": inventory,
    }


def foreground_pid() -> int:
    system = platform.system()
    if system == "Darwin":
        script = ('ObjC.import("AppKit"); '
                  'ObjC.unwrap($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier)')
        command = ["/usr/bin/osascript", "-l", "JavaScript", "-e", script]
    elif system == "Windows":
        powershell = shutil.which("powershell.exe") or shutil.which("powershell")
        if not powershell:
            raise ValueError("cannot determine whether the browser is in use")
        script = ('Add-Type @\'\nusing System; using System.Runtime.InteropServices; public class F {'
                  '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); '
                  '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);}\n\'@;'
                  '$p=0;[F]::GetWindowThreadProcessId([F]::GetForegroundWindow(),[ref]$p)|Out-Null;$p')
        command = [powershell, "-NoProfile", "-NonInteractive", "-Command", script]
    elif system == "Linux":
        xdotool = shutil.which("xdotool")
        if not xdotool:
            raise ValueError("cannot prove that the browser is not in use")
        command = [xdotool, "getactivewindow", "getwindowpid"]
    else:
        raise ValueError("foreground application detection is unsupported")
    result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=3)
    if result.returncode or not result.stdout.strip().isdigit():
        raise ValueError("cannot prove that the browser is not in use")
    return int(result.stdout.strip())


def runtime_browser() -> tuple[dict, dict, Path, int, str]:
    browser, browser_process = default_browser_process()
    user_data_dir, port, websocket_path = devtools_endpoint(browser, browser_process)
    return browser, browser_process, user_data_dir, port, websocket_path


def cdp_calls(port: int, websocket_path: str, calls: list[tuple[str, dict]]) -> list[dict]:
    requests = [
        {"id": index, "method": method, "params": params}
        for index, (method, params) in enumerate(calls, 1)
    ]
    responses = websocket_messages(port, websocket_path, requests)
    values: list[dict] = []
    for request in requests:
        response = responses.get(request["id"], {})
        if "error" in response:
            message = response.get("error", {}).get("message") or "DevTools command failed"
            raise ValueError(str(message))
        result = response.get("result")
        if not isinstance(result, dict):
            raise ValueError("DevTools command returned no result")
        values.append(result)
    return values


def app_id_for(browser: dict[str, str], user_data_dir: Path) -> str:
    instance_hash = hashlib.sha256(str(user_data_dir.resolve()).encode("utf-8")).hexdigest()[:12]
    return f"{browser['native_app_id']}:{instance_hash}"


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("default")
    commands.add_parser("tabs")
    args = parser.parse_args(arguments)
    try:
        if args.command == "tabs":
            from config import load_config
            from control import device_snapshot
            from browser.context import capabilities
            configuration = load_config()
            device = next(k for k, v in configuration['devices'].items() if v['kind'] == 'local')
            browser = default_browser()
            snapshot = device_snapshot(device, configuration)
            report = capabilities(browser, snapshot)
            rows = [s for s in snapshot.get('surfaces', []) if s.get('app_id') == browser['native_app_id'] and s.get('kind') == 'browser-tab']
            status = report.pop('status')
            if status == 'unavailable':
                emit(status, 3, surfaces=rows, **report)
            else:
                emit(status, surfaces=rows, **report)
        if args.command == "default":
            emit("default", **default_browser())
    except (OSError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired) as exc:
        emit(f"blocked_browser_{args.command}", 3, reason=str(exc))
    return 0


if __name__ == "__main__":
    sys.exit(main())
