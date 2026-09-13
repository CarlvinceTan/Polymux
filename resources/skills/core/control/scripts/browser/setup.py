"""Diagnose normal-browser capabilities. No installs, browser launches or configuration writes."""
import argparse
import json
import subprocess
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config
from browser import default_browser, installed_browser
from control import device_snapshot
from browser.context import capabilities



def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['check', 'setup'], nargs='?', default='check',
                        help='Both diagnose available access; a clean install uses automatic local defaults.')
    parser.add_argument('--browser', help='user-named browser executable; otherwise use the current OS default')
    parser.add_argument('--require-complete', action='store_true',
                        help='exit 4 unless a collector proves complete whole-browser tab coverage')
    args = parser.parse_args(arguments)
    report = {'schema_version': 1, 'automatic_changes': [], 'requires_extension': False}
    try:
        configuration = config.load_config()
        report['configuration'] = 'instance/control.json' if config.CONFIG.exists() else 'built_in_local_defaults'
        device = next(k for k, v in configuration['devices'].items() if v['kind'] == 'local')
        report['coordination'] = config.coordination_policy(configuration['devices'][device])
        browser = None
        try:
            browser = installed_browser(args.browser) if args.browser else default_browser()
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            report['browser_reason'] = str(exc)[:200]
        report['browser'] = browser
        # Reuse the common live collectors, including any external driver's provider.
        # No ambient cache, remote probes, page text, settings changes or permission prompts.
        report.update(capabilities(browser, device_snapshot(device, configuration)))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        report.update(status='unavailable', reason=str(exc)[:300])
    print(json.dumps(report, ensure_ascii=True))
    if args.require_complete and report.get('tab_inventory', {}).get('whole_browser_complete') is not True:
        return 4
    return 2 if report['status'] == 'unavailable' else 0


if __name__ == '__main__':
    raise SystemExit(main())
