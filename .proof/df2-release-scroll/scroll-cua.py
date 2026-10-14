"""Time a native scroll of the staged t-long thread for the Release FrameLog run.

The fixture makes t-long the newest thread, so the app opens it by itself; this
script waits until its newest page reached the app's local cache, normalizes to
the top of the transcript, then scrolls 12 pages toward newer messages and 12
pages back through the cua-driver CLI (real wheel events, no XCTest in the app's
process). Writes scroll-window.json with the epoch window around the burst plus
every action, and before/after screenshots.
"""
import json
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SESSION = f"pr39-scroll-{int(time.time())}"


def cua(*args):
    return json.loads(subprocess.check_output(["cua-driver", *args], text=True))


def cua_soft(*args):
    proc = subprocess.run(["cua-driver", *args], capture_output=True, text=True)
    try:
        return json.loads(proc.stdout)
    except ValueError:
        return dict(code="unparsed", output=proc.stdout[:200], rc=proc.returncode)


def window_for(pid, timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for entry in cua("list_windows", "{}")["windows"]:
            if entry["pid"] == pid and entry["is_on_screen"]:
                return entry["window_id"]
        time.sleep(1)
    raise SystemExit(f"no on-screen window for pid {pid} after {timeout}s")


def loaded_thread(thread, timeout):
    """The transcript syncs progressively; wait until the newest page is up."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        for db in (HERE.parent.parent / ".build/release-scroll-data").glob("*/cache.sqlite"):
            try:
                con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
                events = con.execute("select count(*) from events where thread_id=?", (thread,)).fetchone()[0]
                messages = con.execute("select count(*) from messages where thread_id=?", (thread,)).fetchone()[0]
                con.close()
                if events >= 250 and messages >= 40:
                    return events, messages
            except sqlite3.Error:
                pass
        time.sleep(2)
    raise SystemExit(f"{thread} did not load its newest page in {timeout}s")


def context(pid, window):
    """Register the window screenshot the coordinate wheel path anchors on."""
    cua("get_window_state", json.dumps(
        dict(pid=pid, window_id=window, session=SESSION, include_accessibility_tree=False,
             screenshot_out_file=str(HERE / "scroll-context.png"))))


def wheel(pid, window, direction):
    call = dict(pid=pid, window_id=window, session=SESSION, x=700, y=550,
                direction=direction, by="page", amount=10, delivery_mode="foreground")
    for _ in range(2):
        result = cua_soft("scroll", json.dumps(call))
        if not result.get("code"):
            return
        context(pid, window)
    raise SystemExit(f"scroll {direction} refused twice: {result}")


def shot(pid, window, name):
    cua("get_window_state", json.dumps(
        dict(pid=pid, window_id=window, session=SESSION, display_only=True,
             include_accessibility_tree=False, screenshot_out_file=str(HERE / name))))


def main():
    pid = int(sys.argv[1])
    cua("start_session", json.dumps(dict(session=SESSION)))
    window = window_for(pid)
    print("loaded:", loaded_thread("t-long", 180))
    time.sleep(3)
    context(pid, window)
    for _ in range(6):   # normalize to the top of the transcript, outside the window
        wheel(pid, window, "up")
    shot(pid, window, "scroll-before.png")
    actions = []
    start = time.time()
    for index in range(24):
        direction = "down" if index < 12 else "up"
        wheel(pid, window, direction)
        actions.append(dict(index=index, direction=direction, at=round(time.time(), 3)))
    end = time.time()
    shot(pid, window, "scroll-after.png")
    (HERE / "scroll-window.json").write_text(json.dumps(
        dict(pid=pid, window_id=window, t0=start, t1=end,
             seconds=round(end - start, 3), actions=actions), indent=2, sort_keys=True) + "\n")
    print(f"scrolled {len(actions)} actions in {end - start:.1f}s")


main()
