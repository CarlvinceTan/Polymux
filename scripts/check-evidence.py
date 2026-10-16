#!/usr/bin/env python3
"""Require valid captures for UI changes and recordings for performance work."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def changed(base):
    paths = set()
    for args in [(f"{base}...HEAD",), ("HEAD",)]:
        result = subprocess.run(["git", "diff", "--name-only", "-z", *args],
                                capture_output=True, check=True)
        paths.update(os.fsdecode(p) for p in result.stdout.split(b"\0") if p)
    return paths


def visual(path):
    return path.startswith(("apps/Polymux/Sources/", "apps/site/src/",
                            "apps/site/public/", "apps/desktop/src/renderer/",
                            "packages/PolymuxKit/Sources/")) and not path.endswith(".md")


def labels(issue):
    value = os.environ.get("VERIFY_LABELS", "")
    pr = os.environ.get("VERIFY_PR", "")
    if pr:
        result = subprocess.run(["gh", "pr", "view", pr, "--json", "labels"],
                                capture_output=True, text=True, check=True)
        value += "," + ",".join(x["name"] for x in json.loads(result.stdout)["labels"])
    if issue:
        result = subprocess.run(["gh", "issue", "view", issue, "--json", "labels"],
                                capture_output=True, text=True, check=True)
        value += "," + ",".join(x["name"] for x in json.loads(result.stdout)["labels"])
    return {x.strip().lower().removeprefix("type:") for x in value.split(",")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base")
    parser.add_argument("proof", type=Path)
    parser.add_argument("--issue", default=os.environ.get("VERIFY_ISSUE", ""))
    args = parser.parse_args()
    try:
        paths = changed(args.base)
        ui = any(visual(p) for p in paths)
        performance = bool(paths and labels(args.issue) & {"performance", "responsiveness"})
        if not ui and not performance:
            print("evidence: no visual captures required")
            return 0
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("media-check.py")),
                                 str(args.proof)], capture_output=True, text=True)
        if result.returncode:
            print(result.stderr.strip(), file=sys.stderr)
            return 1
        valid = []
        for line in result.stdout.splitlines():
            fields = line.split("\t", 2)
            if len(fields) == 3 and fields[0] == "PASS":
                valid.append(fields[2])
            elif line.startswith("FAIL\t"):
                print("evidence: rejected " + line[5:])
        missing = []
        if ui and not any(p.lower().endswith(".png") for p in valid):
            missing.append("UI diff requires a valid screenshot")
        if performance and not any(p.lower().endswith(".mp4") for p in valid):
            missing.append("performance/responsiveness work requires a valid recording")
        for message in missing:
            print("evidence: " + message)
        if missing:
            return 1
        print("evidence: required captures passed validation")
        return 0
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"evidence: cannot verify captures ({type(error).__name__})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
