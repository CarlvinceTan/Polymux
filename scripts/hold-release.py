#!/usr/bin/env python3
"""Validate, migrate and check lane hold release conditions."""
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

PATTERN = r"after:(pr|issue):([1-9][0-9]*) (merged|closed)( alert-only)?"


def condition(text):
    lines = re.findall(r"^release: (.*)$", text, re.M)
    match = re.fullmatch(PATTERN, lines[0]) if len(lines) == 1 else None
    if match and (match[1], match[3]) in (("pr", "merged"), ("issue", "closed")):
        return match
    return None


def alert(message, events):
    events.parent.mkdir(parents=True, exist_ok=True)
    with events.open("a") as stream:
        stream.write(json.dumps(dict(ts=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                    type="lane_hold", msg=message,
                                    notify=["Chief"], delivered=False)) + "\n")


def gh(*args):
    try:
        return subprocess.check_output(["gh", *args], text=True, stderr=subprocess.DEVNULL,
                                       timeout=20).strip()
    except (OSError, subprocess.SubprocessError):
        return "ERROR"


def live(root):
    for folder in (root / "units", root):
        for lock in folder.glob("*.lock"):
            if folder == root and not lock.name.startswith("run-lane"):
                continue
            if not lock.is_dir():
                continue
            try:
                pid = int((lock / "pid").read_text().strip())
                if pid <= 0:
                    return True
                os.kill(pid, 0)
                return True
            except ProcessLookupError:
                pass
            except (OSError, ValueError):
                return True
    return False


def scan(root, state, events):
    holds = sorted((root / "queue-hold").glob("*.task"))
    report, ready, cache = [], [], {}
    legacy = root / "queue-hold" / "RELEASE-WHEN.txt"
    notes = legacy.read_text() if legacy.exists() else ""
    for task in holds:
        text = task.read_text()
        match = condition(text)
        if not match and "release:" not in text:
            # Only migrate an unambiguous per-task line, or a single-task note.
            lines = [line for line in notes.splitlines() if task.name in line or task.stem in line]
            note = "\n".join(lines) if lines else notes if len(holds) == 1 else ""
            note = note.strip()
            expression = re.sub(r"^(?:" + re.escape(task.name) + "|" + re.escape(task.stem) + r"):?\s*", "", note)
            expression = re.sub(r"^(?:hold until|release when|until|after)\s+", "", expression, flags=re.I)
            ref = re.fullmatch(r"(?:after:)?(pr|issue)[: #]+([1-9][0-9]*)\s+(merged|closed)", expression, re.I)
            if ref:
                kind, number, status = ref.groups()
                release = f"release: after:{kind.lower()}:{number} {status.lower()}"
                if condition(release):
                    tmp = task.with_name("." + task.name + ".release")
                    tmp.write_text(text.rstrip() + "\n" + release + "\n")
                    result = subprocess.run(["bash", str(Path(__file__).with_name("queue-write.sh")),
                                             "--dir", str(task.parent), "--name", task.name,
                                             "--force", "--no-check", str(tmp)], stdout=subprocess.DEVNULL)
                    tmp.unlink()
                    if result.returncode == 0:
                        match = condition(release)
                        notes = notes.replace(note, f"{task.name}: {release[9:]}")
                        note_tmp = legacy.with_suffix(".tmp")
                        note_tmp.write_text(notes)
                        note_tmp.replace(legacy)
                        print(f"hold: migrated {task.name}: {release}")
        if not match:
            message = f"{task.name}: invalid or missing release condition; met=unknown"
            key = state / ("hold-invalid-" + task.name)
            if not key.exists():
                alert(message, events)
                key.touch()
            report.append(message)
            continue
        kind, number, status, only = match.groups()
        ref = (kind, number)
        if ref not in cache:
            cache[ref] = gh(kind, "view", number, "-R", "CarlvinceTan/polymux", "--json", "state", "-q", ".state")
        met = cache[ref] == status.upper()
        message = f"{task.name}: {match[0]}; met={str(met).lower()} ({cache[ref]})"
        report.append(message)
        if met and only:
            key = state / ("hold-met-" + task.name)
            if not key.exists():
                alert(message, events)
                key.touch()
                print("hold: alert-only " + message)
        elif met:
            ready.append(task)
    if report and not live(root):
        # Dispatch's 10-minute backstop and stall's 30-minute tick both report idle holds.
        key = state / "holds-idle"
        now = int(os.environ.get("LANE_GUARD_NOW", time.time()))
        if not key.exists() or now - int(key.read_text()) >= 1800:
            alert("No active lane lock; held tasks:\n" + "\n".join(report), events)
            key.write_text(str(now))
            print("hold: idle alert: " + "; ".join(report))
    else:
        (state / "holds-idle").unlink(missing_ok=True)
    if ready:
        # Priority field first, board order breaks ties.
        raw = gh("project", "item-list", "3", "--owner", "CarlvinceTan", "--limit", "1000", "--format", "json")
        try:
            items = json.loads(raw)["items"]
            items.sort(key=lambda item: str(item.get("priority", "Z")))
            order = {str(item["content"]["number"]): i for i, item in enumerate(items)
                     if item.get("content", {}).get("repository") == "CarlvinceTan/polymux"}
        except (ValueError, KeyError, TypeError):
            alert("Hold release waits: Project 3 priority lookup failed", events)
            return
        queue = root / "queue"
        queue.mkdir(exist_ok=True)
        for task in ready:
            issue = re.search(r"^issue: *#?([0-9]+)", task.read_text(), re.M)
            rank = order.get(issue[1] if issue else "", len(items))
            target = queue / f"{rank:04d}-hold-{task.name}"
            result = subprocess.run(["bash", str(Path(__file__).with_name("queue-write.sh")),
                                     "--mv", str(task), str(target)], stdout=subprocess.DEVNULL)
            if result.returncode == 0:
                target.touch()
                print(f"hold: released {task.name} -> {target.name}")
                for prefix in ("hold-invalid-", "hold-met-"):
                    (state / (prefix + task.name)).unlink(missing_ok=True)
            else:
                print(f"hold: release failed for {task.name}; left held")


if __name__ == "__main__":
    events = Path(os.environ.get("LANE_GUARD_EVENTS", str(Path.home() / "ops/events"))) / "lane-guard.jsonl"
    if sys.argv[1] == "--creation":
        if not condition(Path(sys.argv[2]).read_text()):
            alert(f"Hold created with invalid or missing release condition: {sys.argv[3]}", events)
    else:
        with (Path(sys.argv[2]) / "holds.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            scan(Path(sys.argv[1]), Path(sys.argv[2]), events)
