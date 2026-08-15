#!/usr/bin/env python3
"""Atomically migrate exact skill identifiers in protected routing metadata."""

from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile


SUITE = Path.home() / ".midas" / "skill-maintenance"
POLICY = SUITE / "policy.json"
HOOKS = Path.home() / ".midas" / "hooks.json"
BACKUPS = SUITE / "migration-backups"
RUNNER = SUITE / "runner.py"


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"Expected an object in {path}")
    return value


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=False)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def rename_policy(value: dict, old: str, new: str) -> dict:
    result = copy.deepcopy(value)
    for section in ("skill_capabilities", "skill_dependencies"):
        mapping = result.get(section, {})
        if old in mapping:
            if new in mapping:
                raise ValueError(f"Both {old!r} and {new!r} already exist in {section}")
            mapping[new] = mapping.pop(old)
    for dependencies in result.get("skill_dependencies", {}).values():
        for index, dependency in enumerate(dependencies):
            if dependency == old:
                dependencies[index] = new
    return result


def replace_registered_references(policy: dict, replacements: list[tuple[str, str]]) -> dict[Path, dict]:
    updated = {}
    for raw_path in policy.get("deletion_reference_registries", []):
        path = Path(raw_path)
        value = load_json(path)
        text = json.dumps(value, ensure_ascii=False)
        for before, after in replacements:
            if before not in text:
                raise ValueError(f"Registered reference text not found in {path}: {before!r}")
            text = text.replace(before, after)
        updated[path] = json.loads(text)
    return updated


def update_hook_suite_digest(value: dict, digest: str) -> dict:
    result = copy.deepcopy(value)
    found = 0
    for groups in result.get("hooks", {}).values():
        for group in groups:
            for hook in group.get("hooks", []):
                command = hook.get("command")
                if not isinstance(command, str) or "--expected-suite-sha" not in command:
                    continue
                hook["command"], count = re.subn(
                    r"(?<=--expected-suite-sha )[0-9a-f]{64}", digest, command
                )
                found += count
    if found == 0:
        raise ValueError("No expected suite digest was found in hooks.json")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("old")
    parser.add_argument("new")
    parser.add_argument("--registry-replace", action="append", default=[])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.old == args.new or not args.old or not args.new:
        parser.error("old and new must be different non-empty identifiers")
    replacements = []
    for item in args.registry_replace:
        if "=" not in item:
            parser.error("--registry-replace requires BEFORE=AFTER")
        replacements.append(tuple(item.split("=", 1)))

    policy_before = load_json(POLICY)
    policy_after = rename_policy(policy_before, args.old, args.new)
    registry_after = replace_registered_references(policy_before, replacements)
    if args.dry_run:
        print(json.dumps({"status": "dry-run", "old": args.old, "new": args.new,
                          "registries": [str(path) for path in registry_after]}, indent=2))
        return 0

    hooks_before = load_json(HOOKS)
    paths = [POLICY, HOOKS, *registry_after]
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = BACKUPS / f"{timestamp}-{args.old}-to-{args.new}"
    backup.mkdir(parents=True)
    for path in paths:
        shutil.copy2(path, backup / path.name)

    try:
        atomic_json(POLICY, policy_after)
        for path, value in registry_after.items():
            atomic_json(path, value)
        sys.path.insert(0, str(SUITE))
        import runner
        sealed = runner.seal_baseline()
        digest = runner.suite_control_digest()
        atomic_json(HOOKS, update_hook_suite_digest(hooks_before, digest))
    except Exception:
        for path in paths:
            shutil.copy2(backup / path.name, path)
        raise

    print(json.dumps({"status": "migrated", "old": args.old, "new": args.new,
                      "suite_control_digest": digest, "seal": sealed,
                      "backup": str(backup)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
