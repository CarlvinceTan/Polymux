#!/usr/bin/env python3
"""Bounded, read-only inventory and dependency audit for installed skills."""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import subprocess


NAME = re.compile(r"^name:\s*['\"]?([^'\"\s]+)", re.MULTILINE)
ROOT_REFERENCE = re.compile(r"(?:~/|/Users/[^/]+/)(?:\.codex|\.agents|\.polymux[^/]*)/skills")


def skill_records(root: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    if not root.is_dir():
        return records
    for folder in sorted(item for item in root.iterdir() if item.is_dir() and not item.name.startswith(".")):
        source = folder / "SKILL.md"
        if not source.is_file():
            records.append({"directory": folder.name, "status": "missing-skill-file"})
            continue
        text = source.read_text(errors="replace")
        match = NAME.search(text)
        declared = match.group(1) if match else None
        records.append({
            "directory": folder.name,
            "declaredName": declared,
            "status": "ok" if declared == folder.name else "name-mismatch",
            "path": str(source),
        })
    return records


def reverse_dependencies(roots: list[Path], names: set[str]) -> dict[str, list[str]]:
    edges: set[tuple[str, str, str]] = set()
    for root in roots:
        if not root.is_dir():
            continue
        for source in sorted(root.glob("*/SKILL.md")):
            owner = source.parent.name
            text = source.read_text(errors="replace")
            for target in names - {owner}:
                if re.search(rf"(?:\${re.escape(target)}\b|`{re.escape(target)}`|/{re.escape(target)}/SKILL\.md\b)", text):
                    edges.add((owner, target, str(source)))
    result: dict[str, set[str]] = {}
    for source, target, _evidence in edges:
        result.setdefault(target, set()).add(source)
    return {target: sorted(sources) for target, sources in sorted(result.items())}


def hardcoded_roots(roots: list[Path]) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    for root in roots:
        if not root.is_dir():
            continue
        for source in sorted(root.glob("*/SKILL.md")):
            for value in sorted(set(ROOT_REFERENCE.findall(source.read_text(errors="replace")))):
                findings.append({"skill": source.parent.name, "reference": value, "evidence": str(source)})
    return findings


def gate_summary(personal_root: Path) -> dict[str, object]:
    entry = personal_root / "skill-maintenance" / "scripts" / "skill_maintenance.py"
    if not entry.is_file():
        return {"status": "unavailable", "reason": "maintenance entry point is absent"}
    result: dict[str, object] = {"status": "available", "entryPoint": str(entry)}
    for command in ("doctor", "scan", "verify-guard"):
        run = subprocess.run(
            ["python3", str(entry), command], capture_output=True, text=True, timeout=30,
        )
        value: object = (run.stdout or run.stderr).strip()[:4000]
        try:
            value = json.loads(value) if value else None
        except json.JSONDecodeError:
            pass
        if isinstance(value, dict):
            value = {
                key: value[key] for key in ("status", "clean", "errors", "warnings")
                if key in value
            }
        result[command] = {"exitCode": run.returncode, "result": value}
    listed = subprocess.run(
        ["python3", str(entry), "list"], capture_output=True, text=True, timeout=30,
    )
    try:
        candidates = json.loads(listed.stdout).get("candidates", [])
        result["candidateSummary"] = {
            "total": len(candidates),
            "byStatus": dict(sorted(Counter(str(item.get("status", "unknown")) for item in candidates).items())),
        }
    except (json.JSONDecodeError, AttributeError):
        result["candidateSummary"] = {"status": "unavailable", "exitCode": listed.returncode}
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    inferred_home = Path(__file__).resolve().parents[3]
    parser.add_argument("--home", type=Path, default=inferred_home)
    parser.add_argument("--skip-gate", action="store_true")
    args = parser.parse_args()
    roots = [args.home / "skills", args.home / "official-skills"]
    inventory = {str(root): skill_records(root) for root in roots}
    names = {
        str(item["declaredName"])
        for records in inventory.values() for item in records if item.get("declaredName")
    }
    installed = {
        root: [str(item.get("declaredName") or item["directory"]) for item in records]
        for root, records in inventory.items()
    }
    issues = [
        {"root": root, **item}
        for root, records in inventory.items() for item in records if item["status"] != "ok"
    ]
    print(json.dumps({
        "roots": [str(root) for root in roots],
        "installedSkills": installed,
        "inventoryIssues": issues,
        "reverseDependencies": reverse_dependencies(roots, names),
        "hardcodedSkillRoots": hardcoded_roots(roots),
        "maintenanceGate": {"status": "skipped"} if args.skip_gate else gate_summary(roots[0]),
    }, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
