"""Native read-only inventory. Unsupported attention is unknown, never idle."""
import argparse
import json
import platform
import subprocess
import sys
import time
from pathlib import Path
from transport import command_json
# Preserve import entry points while their implementations live with their owners.
from macos.tabs import collect as metadata
from browser.context import enrich

ROOT = Path(__file__).resolve().parent


def generation(pid):
    """Process birth, not PID alone, distinguishes browser restarts."""
    if platform.system() == 'Linux':
        raw = Path(f'/proc/{pid}/stat').read_text()
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        return f"{pid}:{boot}:{raw[raw.rfind(')')+2:].split()[19]}"
    if platform.system() == 'Darwin':
        from macos.process import application_birth
        return application_birth(pid)
    from windows.state import process_info
    return process_info(pid)['instance_id']


def local_native():
    system = platform.system()
    if system == 'Darwin':
        from macos import helper
        if helper.enabled():
            value = helper.json_call('native', timeout=4)
            value['permission_owner'] = 'Control Skill'
            return value
        from macos.compile import compile_source
        binary = compile_source(ROOT / 'macos/state.swift')
        return command_json([str(binary)], 3)
    if system == 'Windows':
        from windows.state import collect
        return collect()
    if system == 'Linux':
        from linux.state import collect
        return collect()
    raise ValueError('native inventory unavailable on this platform')



def collect(include_browsers=True):
    started = time.monotonic()
    try:
        value = local_native()
    except (OSError, ValueError, subprocess.SubprocessError, RuntimeError) as exc:
        value = {'apps': {}, 'surfaces': [], 'active': {}, 'capabilities': {'windows': False},
                 '_warnings': [str(exc)[:300]], 'completeness': 'unavailable'}
    if platform.system() == 'Darwin' and not value.get('active', {}).get('app_id'):
        from macos.process import foreground_app_id
        value.setdefault('active', {})['app_id'] = foreground_app_id()
    active = value.get('active', {})
    if isinstance(active, dict) and active.get('window_id'):
        for row in value.get('surfaces', []):
            if row.get('kind') == 'window' and row.get('window_id') == active['window_id'] and row.get('human_active') is False:
                # A contradictory native attention signal must never admit a writer.
                row['human_active'] = 'unknown'
                value.setdefault('_warnings', []).append('inconsistent native attention; admission blocked')
    value.setdefault('observed_at', time.time())
    value.setdefault('completeness', 'complete')
    if include_browsers:
        remaining = max(.1, 3.2 - (time.monotonic() - started))
        try:
            return command_json([sys.executable, str(Path(__file__).resolve()), '--enrich'], remaining, input_value=value)
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            value.setdefault('_warnings', []).append('browser enrichment unavailable; native context retained')
            value['completeness'] = 'partial'
            # Accessibility was read in the actual desktop session. A later
            # protocol timeout must not erase those observations or their scope.
            from browser.accessibility import retain_inventory
            retain_inventory(value)
            value.setdefault('tab_inventory', {'status': 'unavailable', 'scope': 'detected_browser_processes',
                                      'reason': 'browser enrichment did not finish within the ambient budget'})
    return value


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', action='store_true')
    parser.add_argument('--enrich', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    value = enrich(json.load(sys.stdin)) if args.enrich else collect(not args.native)
    print(json.dumps(value, ensure_ascii=True))
