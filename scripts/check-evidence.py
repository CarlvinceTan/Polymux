#!/usr/bin/env python3
"""Register source-bound captures and require them for UI/performance work."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

MANIFEST = "evidence.json"


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, check=True).stdout


def source(base):
    paths, diffs = set(), []
    for args in [(f"{base}...HEAD",), ("HEAD",)]:
        paths.update(os.fsdecode(p) for p in git("diff", "--name-only", "-z", *args).split(b"\0") if p)
        diffs.append(git("diff", "--binary", "--full-index", "--no-ext-diff", *args))
    return {"head": git("rev-parse", "HEAD").decode().strip(),
            "fingerprint": hashlib.sha256(b"\0".join(diffs)).hexdigest()}, paths


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


def capture(directory, name):
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("capture directory is missing or a symlink")
    if not isinstance(name, str) or not name or Path(name).name != name or name in (".", ".."):
        raise ValueError("capture must be a plain filename")
    path = directory / name
    if path.is_symlink() or not path.is_file():
        raise ValueError("capture is missing or a symlink")
    return path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(directory):
    manifest = json.loads(capture(directory, MANIFEST).read_text())
    if not isinstance(manifest, dict) or manifest.get("version") != 1 or not isinstance(manifest.get("captures"), list):
        raise ValueError("invalid capture manifest")
    return manifest


def register(args, binding, paths):
    if not args.flow or not args.flow.strip() or not args.state or not args.state.strip() or not args.theme:
        raise ValueError("registration requires flow, state and theme")
    path = Path(args.record)
    if ".." in path.parts or path.parent.resolve() != args.captures.resolve():
        raise ValueError("recorded file must be inside the capture directory")
    path = capture(args.captures, path.name)
    if path.suffix.lower() not in (".png", ".mp4"):
        raise ValueError("capture must be PNG or MP4")
    coverage = sorted(set(args.path))
    if any(p not in paths or not visual(p) for p in coverage):
        raise ValueError("coverage must name changed UI paths")
    if path.suffix.lower() == ".png" and (args.theme == "neutral" or not coverage):
        raise ValueError("screenshots require a theme and changed UI path coverage")
    manifest = {"version": 1, **binding, "captures": []}
    if (args.captures / MANIFEST).exists() or (args.captures / MANIFEST).is_symlink():
        previous = load(args.captures)
        if all(previous.get(k) == v for k, v in binding.items()):
            manifest = previous
    if any(not isinstance(entry, dict) for entry in manifest["captures"]):
        raise ValueError("invalid capture entry")
    manifest["captures"] = [entry for entry in manifest["captures"] if entry.get("file") != path.name]
    manifest["captures"].append({"file": path.name, "sha256": digest(path),
                                 "flow": args.flow.strip(), "state": args.state.strip(),
                                 "theme": args.theme, "paths": coverage})
    with tempfile.NamedTemporaryFile(mode="w", dir=args.captures, prefix=".evidence-", delete=False) as output:
        temp = Path(output.name)
        json.dump(manifest, output, indent=2)
        output.write("\n")
    try:
        temp.replace(args.captures / MANIFEST)
    finally:
        temp.unlink(missing_ok=True)
    print("evidence: registered " + path.name)
    return 0


def verify(args, binding, paths):
    ui = {p for p in paths if visual(p)}
    performance = bool(paths and labels(args.issue) & {"performance", "responsiveness"})
    if not ui and not performance:
        print("evidence: no visual captures required")
        return 0
    manifest = load(args.captures)
    if any(manifest.get(k) != v for k, v in binding.items()):
        raise ValueError("captures do not match the current head and tracked changes")
    entries, names = [], set()
    for entry in manifest["captures"]:
        if not isinstance(entry, dict):
            raise ValueError("invalid capture entry")
        path = capture(args.captures, entry.get("file"))
        if path.name in names or path.suffix.lower() not in (".png", ".mp4"):
            raise ValueError("duplicate or unsupported capture")
        names.add(path.name)
        if entry.get("sha256") != digest(path):
            raise ValueError("capture content changed after registration")
        if any(not isinstance(entry.get(k), str) or not entry[k].strip() for k in ("flow", "state")):
            raise ValueError("capture requires a named flow and state")
        coverage = entry.get("paths")
        if entry.get("theme") not in ("light", "dark", "neutral") or not isinstance(coverage, list) or any(not isinstance(p, str) or p not in ui for p in coverage):
            raise ValueError("invalid capture theme or UI path coverage")
        entries.append((entry, path))
    with tempfile.TemporaryDirectory() as directory:
        snapshots = Path(directory)
        for entry, path in entries:
            copied = snapshots / path.name
            shutil.copyfile(path, copied)
            if digest(copied) != entry["sha256"]:
                raise ValueError("capture changed during verification")
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("media-check.py")),
                                 directory], capture_output=True, text=True)
        if result.returncode:
            print(result.stderr.strip(), file=sys.stderr)
            return 1
        valid = {Path(fields[2]).name for line in result.stdout.splitlines()
                 if len(fields := line.split("\t", 2)) == 3 and fields[0] == "PASS"}
        if any(path.name not in valid for _, path in entries):
            raise ValueError("registered capture failed media validation")
        missing = []
        for path in sorted(ui):
            for theme in ("light", "dark"):
                if not any(file.suffix.lower() == ".png" and entry["theme"] == theme and path in entry["paths"] for entry, file in entries):
                    missing.append(f"{path} requires a valid {theme} screenshot")
        if performance and not any(path.suffix.lower() == ".mp4" for _, path in entries):
            missing.append("performance/responsiveness work requires a valid recording")
        for message in missing:
            print("evidence: " + message)
        if missing:
            return 1
        if args.output:
            args.output.mkdir(parents=True, exist_ok=True)
            if args.output.is_symlink():
                raise ValueError("proof output is a symlink")
            for _, path in entries:
                destination = args.output / path.name
                if destination.is_symlink():
                    raise ValueError("proof output file is a symlink")
                shutil.copyfile(snapshots / path.name, destination)
            destination = args.output / MANIFEST
            if destination.is_symlink():
                raise ValueError("proof manifest is a symlink")
            destination.write_text(json.dumps(manifest, indent=2) + "\n")
    print("evidence: required registered captures passed validation")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base")
    parser.add_argument("captures", type=Path)
    parser.add_argument("--issue", default=os.environ.get("VERIFY_ISSUE", ""))
    parser.add_argument("--record")
    parser.add_argument("--flow")
    parser.add_argument("--state")
    parser.add_argument("--theme", choices=("light", "dark", "neutral"))
    parser.add_argument("--path", action="append", default=[])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        binding, paths = source(args.base)
        return register(args, binding, paths) if args.record else verify(args, binding, paths)
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(f"evidence: cannot verify captures ({type(error).__name__}: {error})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
