"""Record native scrolling after replay reaches all 700 events; no builds or tests."""
import base64
import glob
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import time

pid, window = map(int, sys.argv[1:])
proof = Path(__file__).parent
cache = glob.glob('.build/release-data/**/cache.sqlite', recursive=True)[0]
while True:
    with sqlite3.connect('file:' + cache + '?mode=ro', uri=True) as db:
        count = db.execute('select count(*) from events where thread_id="t-long"').fetchone()[0]
    if count == 700: break
    print('Replay events:', count, flush=True)
    time.sleep(5)
command = ['xcrun', 'xctrace', 'record', '--template', 'Animation Hitches',
           '--device', '1CDF3801-4E9E-50FA-9008-C1B4AC849C21', '--all-processes',
           '--time-limit', '20s', '--no-prompt', '--output', '.build/scroll-all.trace']
log = open(proof / 'scroll-all-command.txt', 'w')
log.write(' '.join(command) + '\n'); log.flush()
record = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
while 'Ctrl-C to stop' not in (proof / 'scroll-all-command.txt').read_text():
    if record.poll() is not None: raise SystemExit('Collector exited before recording')
    time.sleep(0.2)
print('Recording scrolling', flush=True)
for index in range(24):
    target = dict(pid=pid, window_id=window, session='df2-scroll')
    state = json.loads(subprocess.check_output(['cua-driver', 'get_window_state', json.dumps(
        dict(target, include_accessibility_tree=False))]))
    if index == 0:
        (proof / 'scroll-all-before.png').write_bytes(base64.b64decode(state['screenshot_png_b64']))
    action = dict(target, x=700, y=550, direction='down' if index < 12 else 'up',
                  by='page', amount=10, delivery_mode='foreground')
    result = subprocess.run(['cua-driver', 'scroll', json.dumps(action)], capture_output=True, text=True)
    log.write(f'Action {index}: {result.stdout}\n'); log.flush()
    if result.returncode: raise SystemExit(result.stdout)
state = json.loads(subprocess.check_output(['cua-driver', 'get_window_state', json.dumps(
    dict(target, include_accessibility_tree=False))]))
(proof / 'scroll-all-after.png').write_bytes(base64.b64decode(state['screenshot_png_b64']))
record.wait()
raise SystemExit(record.returncode)
