import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("holds", Path(__file__).with_name("hold-release.py"))
holds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(holds)


class ReleaseTests(unittest.TestCase):
    def test_conditions(self):
        for value in ("after:pr:255 merged", "after:issue:262 closed alert-only"):
            self.assertIsNotNone(holds.condition("release: " + value))
        for value in ("after:pr:255 closed", "after:issue:0 closed", "after: none", "merge soon"):
            self.assertIsNone(holds.condition("release: " + value))
        self.assertIsNone(holds.condition("release: after:pr:1 merged\nrelease: after:pr:2 merged"))

    def test_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            state.mkdir()
            held = root / "queue-hold"
            held.mkdir()
            events = root / "events.jsonl"
            def task(name, release="", issue=262):
                path = held / (name + ".task")
                path.write_text(f"# {name}\nneeds: none\nexpected_min: 5\nissue: {issue}\n{release}\n")
                return path
            os.utime(task("ready", "release: after:pr:255 merged", 263), (1, 1))
            task("waiting", "release: after:pr:256 merged")
            task("only", "release: after:issue:262 closed alert-only")
            task("invalid")
            legacy = task("legacy")
            (held / "RELEASE-WHEN.txt").write_text("legacy.task: PR #255 merged")
            project = json.dumps({"items": [{"priority": "P1", "content": {
                "number": 262, "repository": "CarlvinceTan/polymux"}}, {"priority": "P0",
                "content": {"number": 263, "repository": "CarlvinceTan/polymux"}}]})
            def github(*args):
                if args[0] == "project":
                    return project
                return "CLOSED" if args[0] == "issue" else "MERGED" if args[2] == "255" else "ERROR"
            with patch.dict(os.environ, LANES_HOME=str(root), LANE_GUARD_NOW="1800"), patch.object(holds, "gh", side_effect=github):
                holds.scan(root, state, events)
                self.assertFalse(legacy.exists())
                self.assertEqual((held / "RELEASE-WHEN.txt").read_text(), "legacy.task: after:pr:255 merged")
                self.assertGreater((root / "queue" / "0000-hold-ready.task").stat().st_mtime, 1)
                self.assertTrue((root / "queue" / "0001-hold-legacy.task").exists())
                self.assertEqual(len(list((root / "queue").glob("*.task"))), 2)
                self.assertEqual(len(list(held.glob("*.task"))), 3)
                records = events.read_text().splitlines()
                self.assertTrue(any("met=false (ERROR)" in line for line in records))
                self.assertTrue(any("after:issue:262 closed" in line for line in records))
                holds.scan(root, state, events)
                self.assertEqual(records, events.read_text().splitlines())
                lock = root / "units" / "running.lock"
                lock.mkdir(parents=True)
                (lock / "pid").write_text(str(os.getpid()))
                self.assertTrue(holds.live(root))
                holds.scan(root, state, events)
                self.assertFalse((state / "holds-idle").exists())
                brief = root / "new.task"
                brief.write_text("# New hold\nneeds: none\nexpected_min: 5\n")
                writer = Path(__file__).with_name("queue-write.sh")
                with patch.dict(os.environ, LANE_GUARD_EVENTS=str(root)):
                    subprocess.run(["bash", str(writer), "--dir", str(held), str(brief)], check=True,
                                   stdout=subprocess.DEVNULL)
                creation = json.loads((root / "lane-guard.jsonl").read_text().splitlines()[-1])
                self.assertIn("invalid or missing release condition", creation["msg"])
                self.assertEqual(creation["notify"], ["Chief"])


if __name__ == "__main__":
    unittest.main()
