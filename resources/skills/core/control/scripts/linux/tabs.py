"""Read existing AT-SPI browser chrome in the destination's desktop session."""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def read(apps):
    import gi
    gi.require_version('Atspi', '2.0')
    from gi.repository import Atspi
    # The caller supplies an existing session bus; never enable accessibility.
    Atspi.set_timeout(200, 500)
    desktop = Atspi.get_desktop(0)
    reports = []
    for index in range(desktop.get_child_count()):
        application = desktop.get_child_at_index(index)
        app = next((a for a in apps if a['pid'] == application.get_process_id()), None)
        if app is None:
            continue
        windows = []
        for i in range(application.get_child_count()):
            window = application.get_child_at_index(i)
            if window.get_role() not in (Atspi.Role.FRAME, Atspi.Role.WINDOW):
                continue
            tabs, queue, visited = [], [window], 0
            while queue and visited < 1000:
                node = queue.pop(); visited += 1
                role = node.get_role()
                # Do not collect web-page tabs or inspect page/form content.
                if role in (Atspi.Role.DOCUMENT_WEB, Atspi.Role.DOCUMENT_FRAME,
                            Atspi.Role.DOCUMENT_TEXT, Atspi.Role.EMBEDDED):
                    continue
                if role == Atspi.Role.PAGE_TAB:
                    tabs.append({'title': node.get_name(),
                                 'selected': node.get_state_set().contains(Atspi.StateType.SELECTED)})
                    continue
                for child in range(min(node.get_child_count(), 1000 - visited - len(queue))):
                    queue.append(node.get_child_at_index(child))
            windows.append({'window_identity': 'metadata_only', 'window_title': window.get_name(),
                            'tabs': tabs, 'reason': 'AT-SPI labels only; URLs and hidden tabs are unavailable'})
        reports.append({'app_id': app['app_id'], 'instance_id': app['instance_id'], 'windows': windows})
    return {'apps': reports}


def collect(value, env):
    from browser.accessibility import attach
    import subprocess
    def query(apps):
        # No guessed bus address or implicit dbus-launch. The session resolver has
        # already verified these environment keys against the destination session.
        if not env.get('DBUS_SESSION_BUS_ADDRESS'):
            raise ValueError('desktop session has no observable accessibility bus')
        command = [sys.executable, '-B', str(Path(__file__).resolve())]
        output = subprocess.run(command, input=json.dumps({'apps': apps}), env=env,
                                capture_output=True, text=True, timeout=1.5, check=True)
        return json.loads(output.stdout)
    return attach(value, query)


if __name__ == '__main__':
    try:
        print(json.dumps(read(json.load(sys.stdin)['apps'])))
    except ImportError:
        raise SystemExit('AT-SPI Python bindings are unavailable')
