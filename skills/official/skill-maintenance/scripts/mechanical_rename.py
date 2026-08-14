#!/opt/homebrew/bin/python3.14
"""Deterministically prove that a candidate is only a declared literal rename."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
from typing import Any


class RenameProofError(RuntimeError):
    pass


def _ignored(path: Path, base: Path, policy: dict[str, Any]) -> bool:
    relative = path.relative_to(base)
    ignored_names = set(policy.get("ignored_names", []))
    if any(part in ignored_names for part in relative.parts):
        return True
    if any(path.name.endswith(suffix) for suffix in policy.get("ignored_suffixes", [])):
        return True
    return path.name.startswith(".syncthing.")


def _replace(value: str, replacements: list[tuple[str, str]], usage: dict[str, int]) -> str:
    result = value
    for old, new in replacements:
        count = result.count(old)
        if count:
            usage[old] += count
            result = result.replace(old, new)
    return result


def _entry_digest(entries: dict[str, dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for relative, entry in sorted(entries.items()):
        digest.update(relative.encode("utf-8") + b"\0")
        digest.update(entry["kind"].encode("ascii") + b"\0")
        digest.update(str(entry["mode"]).encode("ascii") + b"\0")
        value = entry.get("value", b"")
        if isinstance(value, str):
            value = value.encode("utf-8")
        digest.update(value)
        digest.update(b"\0")
    return digest.hexdigest()


def _read_entries(root: Path, policy: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if not root.is_dir():
        raise RenameProofError(f"Skill tree is missing: {root}")
    entries: dict[str, dict[str, Any]] = {}
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        if _ignored(path, root, policy):
            continue
        relative = path.relative_to(root).as_posix()
        mode = path.lstat().st_mode & 0o777
        if path.is_symlink():
            entry = {"kind": "symlink", "mode": mode, "value": os.readlink(path)}
        elif path.is_dir():
            entry = {"kind": "directory", "mode": mode}
        elif path.is_file():
            entry = {"kind": "file", "mode": mode, "value": path.read_bytes()}
        else:
            raise RenameProofError(f"Unsupported special file: {path}")
        entries[relative] = entry
    return entries


def _transform_entries(
    entries: dict[str, dict[str, Any]], replacements: list[tuple[str, str]]
) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    usage = {old: 0 for old, _ in replacements}
    transformed: dict[str, dict[str, Any]] = {}
    for relative, entry in sorted(entries.items()):
        renamed = _replace(relative, replacements, usage)
        pure = PurePosixPath(renamed)
        if pure.is_absolute() or ".." in pure.parts or renamed in {"", "."}:
            raise RenameProofError(f"Replacement creates an unsafe path: {renamed!r}")
        if renamed in transformed:
            raise RenameProofError(f"Replacement creates a path collision: {renamed}")
        updated = {"kind": entry["kind"], "mode": entry["mode"]}
        if entry["kind"] == "symlink":
            updated["value"] = _replace(str(entry["value"]), replacements, usage)
        elif entry["kind"] == "file":
            payload = bytes(entry["value"])
            try:
                text = payload.decode("utf-8")
            except UnicodeDecodeError:
                updated["value"] = payload
            else:
                updated["value"] = _replace(text, replacements, usage).encode("utf-8")
        transformed[renamed] = updated
    return transformed, usage


def _normalize_replacements(raw: list[list[str] | tuple[str, str]]) -> list[tuple[str, str]]:
    if not raw:
        raise RenameProofError("At least one --replace OLD=NEW value is required")
    result: list[tuple[str, str]] = []
    seen: set[str] = set()
    for pair in raw:
        if len(pair) != 2:
            raise RenameProofError("Each replacement must contain exactly two values")
        old, new = str(pair[0]), str(pair[1])
        if not old or not new or old == new:
            raise RenameProofError("Replacement values must be non-empty and different")
        if old in seen:
            raise RenameProofError(f"Duplicate replacement source: {old}")
        seen.add(old)
        result.append((old, new))
    return result


def prove(
    *,
    metadata: dict[str, Any],
    state: dict[str, Any],
    policy: dict[str, Any],
    replacements: list[list[str] | tuple[str, str]],
    source_skill: str | None = None,
    replacement_skill: str | None = None,
) -> dict[str, Any]:
    pairs = _normalize_replacements(replacements)
    action = metadata.get("action")
    skills = state.get("skills", {})

    def require_primary_pair(source_id: str, destination_id: str) -> None:
        old_name = source_id.split(":", 1)[-1]
        new_name = destination_id.split(":", 1)[-1]
        if (old_name, new_name) not in pairs:
            raise RenameProofError(
                f"Declared replacements must include the skill rename {old_name}={new_name}"
            )

    if action == "update":
        if not source_skill or not replacement_skill:
            raise RenameProofError("A dependent rename update requires --source-skill and --replacement-skill")
        if source_skill not in skills:
            raise RenameProofError(f"Approved source skill is missing: {source_skill}")
        if replacement_skill not in skills:
            raise RenameProofError(f"Approved replacement skill is missing: {replacement_skill}")
        require_primary_pair(source_skill, replacement_skill)
        source_id = metadata["target_id"]
        source_root = Path(metadata["baseline_snapshot"])
        destination_id = metadata["target_id"]
        destination_root = Path(metadata["candidate_path"])
    elif action == "new":
        if not source_skill or replacement_skill:
            raise RenameProofError("A new renamed skill requires only --source-skill")
        if source_skill not in skills:
            raise RenameProofError(f"Approved source skill is missing: {source_skill}")
        source_id = source_skill
        source_root = Path(skills[source_skill]["snapshot"])
        destination_id = metadata["target_id"]
        destination_root = Path(metadata["candidate_path"])
        if source_id == destination_id:
            raise RenameProofError("The renamed skill must have a different target id")
        require_primary_pair(source_id, destination_id)
    elif action == "delete":
        if source_skill or not replacement_skill:
            raise RenameProofError("A rename deletion requires only --replacement-skill")
        if replacement_skill not in skills:
            raise RenameProofError(f"Approved replacement skill is missing: {replacement_skill}")
        source_id = metadata["target_id"]
        source_root = Path(metadata["baseline_snapshot"])
        destination_id = replacement_skill
        destination_root = Path(skills[replacement_skill]["snapshot"])
        if source_id == destination_id:
            raise RenameProofError("The replacement skill must have a different target id")
        require_primary_pair(source_id, destination_id)
    else:
        raise RenameProofError(f"Unsupported candidate action for rename proof: {action}")

    source_entries = _read_entries(source_root, policy)
    expected_entries, usage = _transform_entries(source_entries, pairs)
    destination_entries = _read_entries(destination_root, policy)

    unused = [old for old, count in usage.items() if count == 0]
    if unused:
        raise RenameProofError(f"Declared replacements were unused: {', '.join(unused)}")

    missing = sorted(set(expected_entries) - set(destination_entries))
    extra = sorted(set(destination_entries) - set(expected_entries))
    changed = sorted(
        relative
        for relative in set(expected_entries) & set(destination_entries)
        if expected_entries[relative] != destination_entries[relative]
    )
    if missing or extra or changed:
        details = []
        if missing:
            details.append(f"missing={missing[:8]}")
        if extra:
            details.append(f"extra={extra[:8]}")
        if changed:
            details.append(f"changed={changed[:8]}")
        raise RenameProofError("Candidate contains changes beyond the declared rename: " + "; ".join(details))

    proof = {
        "version": 1,
        "action": action,
        "candidate_skill": metadata["target_id"],
        "tree_source_skill": source_id,
        "tree_destination_skill": destination_id,
        "renamed_source_skill": source_skill or source_id,
        "renamed_destination_skill": replacement_skill or destination_id,
        "replacement_skill": replacement_skill,
        "replacements": [[old, new] for old, new in pairs],
        "usage": usage,
        "source_tree_digest": _entry_digest(source_entries),
        "destination_tree_digest": _entry_digest(destination_entries),
        "entry_count": len(destination_entries),
    }
    proof["proof_digest"] = hashlib.sha256(
        json.dumps(proof, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return proof
