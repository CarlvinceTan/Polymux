#!/usr/bin/env python3
"""Atomically remove one deleted skill identifier from protected metadata."""

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


def delete_from_policy(value: dict, skill: str) -> tuple[dict, list[str]]:
    result = copy.deepcopy(value)
    changes: list[str] = []
    for section in ("skill_capabilities", "skill_dependencies"):
        mapping = result.get(section, {})
        if skill in mapping:
            mapping.pop(skill)
            changes.append(f"{section}.{skill}")
    for owner, dependencies in result.get("skill_dependencies", {}).items():
        filtered = [dependency for dependency in dependencies if dependency != skill]
        if filtered != dependencies:
            result["skill_dependencies"][owner] = filtered
            changes.append(f"skill_dependencies.{owner}[]")
    return result, changes


def delete_from_registries(policy: dict, skill: str) -> tuple[dict[Path, dict], list[str]]:
    updated: dict[Path, dict] = {}
    changes: list[str] = []
    for raw_path in policy.get("deletion_reference_registries", []):
        path = Path(raw_path)
        value = load_json(path)
        skills = value.get("skills")
        if isinstance(skills, dict) and skill in skills:
            result = copy.deepcopy(value)
            result["skills"].pop(skill)
            updated[path] = result
            changes.append(f"{path}:skills.{skill}")
    return updated, changes


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
    parser.add_argument("skill")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.skill.strip():
        parser.error("skill must be a non-empty identifier")

    policy_before = load_json(POLICY)
    policy_after, policy_changes = delete_from_policy(policy_before, args.skill)
    registry_after, registry_changes = delete_from_registries(policy_before, args.skill)
    changes = [*policy_changes, *registry_changes]
    if not changes:
        raise ValueError(f"No protected metadata references found for {args.skill!r}")

    preview = {"status": "dry-run", "skill": args.skill, "changes": changes}
    if args.dry_run:
        print(json.dumps(preview, indent=2))
        return 0

    hooks_before = load_json(HOOKS)
    paths = [POLICY, HOOKS, *registry_after]
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = BACKUPS / f"{timestamp}-delete-{args.skill}"
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

    print(json.dumps({
        "status": "migrated",
        "skill": args.skill,
        "changes": changes,
        "suite_control_digest": digest,
        "seal": sealed,
        "backup": str(backup),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
