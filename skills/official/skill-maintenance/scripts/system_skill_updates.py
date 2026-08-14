#!/opt/homebrew/bin/python3.14
"""Detect bundled system-skill updates and route merges through maintenance."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile


CODEX_HOME = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")).expanduser()
DEFAULT_STATE_ROOT = Path(
    os.environ.get(
        "CODEX_SKILL_MAINTENANCE_HOME",
        CODEX_HOME / "skill-maintenance" / "system-updates",
    )
).expanduser()
APP_CODEX = Path("/Applications/ChatGPT.app/Contents/Resources/codex")
MAINTENANCE = Path(__file__).with_name("skill_maintenance.py")
PYTHON = "/opt/homebrew/bin/python3.14"
MARKER = ".codex-system-skills.marker"
MISSING = object()


class UpdateError(RuntimeError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def expanded(value) -> Path:
    return Path(os.path.expandvars(str(value))).expanduser().resolve(strict=False)


def load_config(state_root: Path) -> dict:
    config = read_json(state_root / "config.json")
    if not isinstance(config, dict):
        raise UpdateError(f"Missing or invalid config: {state_root / 'config.json'}")
    protected = config.get("protected")
    if not isinstance(protected, list) or not protected:
        raise UpdateError("Config must contain at least one protected skill")
    for item in protected:
        if not item.get("name") or not item.get("custom_path"):
            raise UpdateError("Each protected skill needs name and custom_path")
    return config


def find_codex(config: dict) -> Path:
    configured = config.get("codex_binary")
    if configured and expanded(configured).is_file():
        return expanded(configured)
    if APP_CODEX.is_file():
        return APP_CODEX
    found = shutil.which("codex")
    if found:
        return Path(found)
    raise UpdateError("Could not find the Codex executable")


def iter_tree(root: Path) -> dict[str, tuple[str, bytes, int]]:
    entries = {}
    if not root.exists():
        return entries
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if rel == MARKER:
            continue
        if path.is_symlink():
            entries[rel] = ("symlink", os.readlink(path).encode(), 0o777)
        elif path.is_file():
            entries[rel] = ("file", path.read_bytes(), stat.S_IMODE(path.stat().st_mode))
    return entries


def entry_equal(left, right) -> bool:
    if left is MISSING or right is MISSING:
        return left is right
    return left[0] == right[0] and left[1] == right[1]


def hash_tree(root: Path) -> str:
    digest = hashlib.sha256()
    for rel, entry in sorted(iter_tree(root).items()):
        digest.update(rel.encode())
        digest.update(b"\0" + entry[0].encode() + b"\0")
        digest.update(hashlib.sha256(entry[1]).digest())
    return digest.hexdigest()


def changed_paths(old_root: Path, new_root: Path) -> dict[str, list[str]]:
    old, new = iter_tree(old_root), iter_tree(new_root)
    result = {"added": [], "removed": [], "changed": []}
    for rel in sorted(set(old) | set(new)):
        if rel not in old:
            result["added"].append(rel)
        elif rel not in new:
            result["removed"].append(rel)
        elif not entry_equal(old[rel], new[rel]):
            result["changed"].append(rel)
    return result


def atomic_copytree(source: Path, destination: Path) -> None:
    if not source.is_dir():
        raise UpdateError(f"Source directory is missing: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    new_path = destination.parent / f".{destination.name}.new-{os.getpid()}"
    old_path = destination.parent / f".{destination.name}.old-{os.getpid()}"
    for path in (new_path, old_path):
        if path.exists():
            shutil.rmtree(path)
    shutil.copytree(source, new_path, symlinks=True)
    if destination.exists():
        os.replace(destination, old_path)
    os.replace(new_path, destination)
    if old_path.exists():
        shutil.rmtree(old_path)


def extract_upstream(config: dict, destination: Path) -> None:
    codex = find_codex(config)
    with tempfile.TemporaryDirectory(prefix="codex-system-updates-") as temporary_home:
        env = os.environ.copy()
        env["CODEX_HOME"] = temporary_home
        result = subprocess.run(
            [str(codex), "debug", "prompt-input", "--", "system skill update inventory"],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise UpdateError(f"Codex system-skill extraction failed: {result.stderr.strip()}")
        source = Path(temporary_home) / "skills/.system"
        if not source.is_dir():
            raise UpdateError("Codex did not materialize bundled system skills")
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(source, destination, symlinks=True)


def is_text(entry) -> bool:
    if entry is MISSING or entry[0] != "file" or b"\0" in entry[1]:
        return False
    try:
        entry[1].decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def write_entry(root: Path, rel: str, entry) -> None:
    if entry is MISSING:
        return
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if entry[0] == "symlink":
        path.symlink_to(entry[1].decode())
    else:
        path.write_bytes(entry[1])
        path.chmod(entry[2])


def merge_text(local: Path, base: Path, upstream: Path):
    result = subprocess.run(
        [
            "git", "merge-file", "-p", "--diff3",
            "-L", "custom", "-L", "previous-upstream", "-L", "new-upstream",
            str(local), str(base), str(upstream),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode not in (0, 1):
        raise UpdateError(result.stderr.decode("utf-8", "replace"))
    return result.stdout, result.returncode == 0


def auto_merge(base_root: Path, local_root: Path, upstream_root: Path, merged_root: Path):
    if merged_root.exists():
        shutil.rmtree(merged_root)
    merged_root.mkdir(parents=True)
    base, local, upstream = iter_tree(base_root), iter_tree(local_root), iter_tree(upstream_root)
    conflicts = []
    for rel in sorted(set(base) | set(local) | set(upstream)):
        b = base.get(rel, MISSING)
        l = local.get(rel, MISSING)
        u = upstream.get(rel, MISSING)
        if entry_equal(l, u):
            chosen = l
        elif entry_equal(l, b):
            chosen = u
        elif entry_equal(u, b):
            chosen = l
        elif b is MISSING and l is not MISSING and u is not MISSING:
            chosen = l
            conflicts.append({"path": rel, "reason": "both_added_differently"})
        elif l is MISSING:
            chosen = MISSING
            conflicts.append({"path": rel, "reason": "custom_deleted_upstream_changed"})
        elif u is MISSING:
            chosen = l
            conflicts.append({"path": rel, "reason": "upstream_deleted_custom_changed"})
        elif is_text(b) and is_text(l) and is_text(u):
            output, clean = merge_text(local_root / rel, base_root / rel, upstream_root / rel)
            chosen = ("file", output, l[2])
            if not clean:
                conflicts.append({"path": rel, "reason": "text_conflict"})
        else:
            chosen = l
            conflicts.append({"path": rel, "reason": "binary_or_type_conflict"})
        write_entry(merged_root, rel, chosen)
    return conflicts


def paths_for(state_root: Path, name: str) -> dict[str, Path]:
    return {
        "baseline": state_root / "baselines" / name,
        "pending": state_root / "pending" / f"{name}.json",
    }


def create_review(state_root: Path, spec: dict, baseline: Path, custom: Path, upstream: Path):
    name = spec["name"]
    upstream_hash = hash_tree(upstream)
    review = state_root / "reviews" / f"{stamp()}-{name}-{upstream_hash[:10]}"
    review.mkdir(parents=True)
    shutil.copytree(baseline, review / "base", symlinks=True)
    shutil.copytree(custom, review / "local", symlinks=True)
    shutil.copytree(upstream, review / "upstream", symlinks=True)
    conflicts = auto_merge(review / "base", review / "local", review / "upstream", review / "merged")
    write_json(review / "conflicts.json", conflicts)
    metadata = {
        "version": 2,
        "skill": name,
        "created_at": now_iso(),
        "status": "prepared",
        "custom_path": str(custom),
        "base_hash": hash_tree(baseline),
        "custom_hash": hash_tree(custom),
        "upstream_hash": upstream_hash,
        "upstream_changes": changed_paths(baseline, upstream),
        "custom_changes": changed_paths(baseline, custom),
        "conflict_count": len(conflicts),
    }
    write_json(review / "review.json", metadata)
    write_json(paths_for(state_root, name)["pending"], {
        "skill": name,
        "review_dir": str(review),
        "upstream_hash": upstream_hash,
        "created_at": metadata["created_at"],
        "task_status": "not_started",
    })
    return review, metadata


def check_all(state_root: Path, config: dict):
    state_root.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix="system-update-check-", dir=state_root) as temporary:
        extracted = Path(temporary) / "system"
        extract_upstream(config, extracted)
        for spec in config["protected"]:
            name = spec["name"]
            custom = expanded(spec["custom_path"])
            upstream = extracted / name
            paths = paths_for(state_root, name)
            baseline = paths["baseline"]
            if not upstream.is_dir():
                results.append({"skill": name, "status": "missing_upstream"})
            elif not custom.is_dir():
                results.append({"skill": name, "status": "missing_custom"})
            elif not baseline.is_dir():
                atomic_copytree(upstream, baseline)
                results.append({"skill": name, "status": "baseline_initialized"})
            elif hash_tree(baseline) == hash_tree(upstream):
                results.append({
                    "skill": name,
                    "status": "unchanged",
                    "upstream_hash": hash_tree(upstream),
                    "custom_hash": hash_tree(custom),
                })
            else:
                pending = read_json(paths["pending"], {}) or {}
                if pending.get("upstream_hash") == hash_tree(upstream):
                    results.append({
                        "skill": name,
                        "status": "pending",
                        "review_dir": pending.get("review_dir"),
                    })
                else:
                    review, metadata = create_review(state_root, spec, baseline, custom, upstream)
                    results.append({
                        "skill": name,
                        "status": "changed",
                        "review_dir": str(review),
                        "conflict_count": metadata["conflict_count"],
                    })
    return results


def status_all(state_root: Path, config: dict):
    results = []
    for spec in config["protected"]:
        name = spec["name"]
        custom = expanded(spec["custom_path"])
        paths = paths_for(state_root, name)
        results.append({
            "skill": name,
            "custom_path": str(custom),
            "custom_exists": custom.is_dir(),
            "custom_hash": hash_tree(custom) if custom.is_dir() else None,
            "baseline_exists": paths["baseline"].is_dir(),
            "baseline_hash": hash_tree(paths["baseline"]) if paths["baseline"].is_dir() else None,
            "pending": read_json(paths["pending"], None),
        })
    return results


def validate_merged(review: Path, metadata: dict) -> dict:
    merged = review / "merged"
    skill_md = merged / "SKILL.md"
    if not skill_md.is_file():
        raise UpdateError("Merged skill has no SKILL.md")
    text = skill_md.read_text(encoding="utf-8")
    match = re.search(r"(?m)^name:\s*['\"]?([^'\"\n]+)", text)
    if not match or match.group(1).strip() != metadata["skill"]:
        raise UpdateError("Merged skill name is invalid")
    for rel, entry in iter_tree(merged).items():
        if is_text(entry):
            body = entry[1].decode("utf-8")
            if "<<<<<<< " in body or "=======\n" in body or ">>>>>>> " in body:
                raise UpdateError(f"Unresolved conflict markers: {rel}")
    conflicts = read_json(review / "conflicts.json", []) or []
    resolution = read_json(review / "resolution.json")
    if not isinstance(resolution, dict):
        raise UpdateError("resolution.json is required before staging")
    resolved = resolution.get("resolved_paths")
    if not isinstance(resolved, list):
        raise UpdateError("resolution.json resolved_paths must be a list")
    missing = {item["path"] for item in conflicts} - set(resolved)
    if missing:
        raise UpdateError("Unresolved review paths: " + ", ".join(sorted(missing)))
    if not str(resolution.get("summary", "")).strip() or not resolution.get("validation"):
        raise UpdateError("resolution.json needs summary and validation")
    return resolution


def pending_review(state_root: Path, name: str) -> Path:
    pending = read_json(paths_for(state_root, name)["pending"])
    if not pending or not pending.get("review_dir"):
        raise UpdateError(f"No pending review for {name}")
    review = expanded(pending["review_dir"])
    if not review.is_dir():
        raise UpdateError(f"Review directory is missing: {review}")
    return review


def stage_review(state_root: Path, name: str):
    review = pending_review(state_root, name)
    metadata = read_json(review / "review.json")
    validate_merged(review, metadata)
    custom = expanded(metadata["custom_path"])
    if hash_tree(custom) != metadata["custom_hash"]:
        raise UpdateError("Live custom skill changed after review preparation")
    if hash_tree(review / "upstream") != metadata["upstream_hash"]:
        raise UpdateError("Upstream review snapshot changed")
    staged = subprocess.run(
        [PYTHON, str(MAINTENANCE), "stage", name],
        text=True,
        capture_output=True,
    )
    if staged.returncode != 0:
        raise UpdateError(staged.stderr.strip() or staged.stdout.strip())
    result = json.loads(staged.stdout)
    candidate = expanded(result["candidate_path"])
    atomic_copytree(review / "merged", candidate)
    backup = state_root / "backups" / f"{stamp()}-{name}-before-maintenance"
    shutil.copytree(custom, backup, symlinks=True)
    metadata.update({
        "status": "staged",
        "staged_at": now_iso(),
        "candidate_id": result["candidate_id"],
        "candidate_path": str(candidate),
        "merged_hash": hash_tree(candidate),
        "backup_path": str(backup),
    })
    write_json(review / "review.json", metadata)
    pending = read_json(paths_for(state_root, name)["pending"], {}) or {}
    pending.update({"task_status": "staged", "candidate_id": result["candidate_id"]})
    write_json(paths_for(state_root, name)["pending"], pending)
    return {
        "skill": name,
        "review_dir": str(review),
        "candidate_id": result["candidate_id"],
        "candidate_path": str(candidate),
        "status": "staged",
    }


def find_review_for_candidate(state_root: Path, candidate_id: str):
    for review_json in (state_root / "reviews").glob("*/review.json"):
        metadata = read_json(review_json, {}) or {}
        if metadata.get("candidate_id") == candidate_id:
            return review_json.parent, metadata
    return None, None


def finalize_candidate(state_root: Path, candidate_id: str):
    review, metadata = find_review_for_candidate(state_root, candidate_id)
    if review is None:
        return {"status": "not-system-update", "candidate_id": candidate_id}
    custom = expanded(metadata["custom_path"])
    if hash_tree(custom) != metadata.get("merged_hash"):
        raise UpdateError("Promoted live skill does not match reviewed merge")
    upstream = review / "upstream"
    if hash_tree(upstream) != metadata["upstream_hash"]:
        raise UpdateError("Reviewed upstream snapshot changed")
    atomic_copytree(upstream, paths_for(state_root, metadata["skill"])["baseline"])
    metadata.update({"status": "applied", "applied_at": now_iso()})
    write_json(review / "review.json", metadata)
    pending_path = paths_for(state_root, metadata["skill"])["pending"]
    pending = read_json(pending_path, {}) or {}
    if pending.get("review_dir") == str(review):
        pending_path.unlink(missing_ok=True)
    write_json(state_root / "history" / f"{stamp()}-{metadata['skill']}.json", metadata)
    return {"status": "finalized", "skill": metadata["skill"], "review_dir": str(review)}


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument("--state-root", default=str(DEFAULT_STATE_ROOT))
    commands = root.add_subparsers(dest="command", required=True)
    for name in ("check", "status", "watch"):
        command = commands.add_parser(name)
        command.add_argument("--json", action="store_true")
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--skill", required=True)
    prepare.add_argument("--json", action="store_true")
    stage = commands.add_parser("stage-review")
    stage.add_argument("--skill", required=True)
    stage.add_argument("--json", action="store_true")
    finalize = commands.add_parser("finalize-candidate")
    finalize.add_argument("candidate_id")
    finalize.add_argument("--json", action="store_true")
    return root


def emit(value, as_json: bool) -> None:
    print(json.dumps(value, indent=2, sort_keys=True) if as_json else value)


def main() -> int:
    args = parser().parse_args()
    state_root = expanded(args.state_root)
    config = load_config(state_root)
    if args.command in ("check", "watch"):
        result = check_all(state_root, config)
    elif args.command == "status":
        result = status_all(state_root, config)
    elif args.command == "prepare":
        review = pending_review(state_root, args.skill)
        result = {"skill": args.skill, "review_dir": str(review), "status": read_json(review / "review.json")}
    elif args.command == "stage-review":
        result = stage_review(state_root, args.skill)
    elif args.command == "finalize-candidate":
        result = finalize_candidate(state_root, args.candidate_id)
    else:
        raise UpdateError(f"Unsupported command: {args.command}")
    emit(result, args.json)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"skill-maintenance system updates: {exc}", file=sys.stderr)
        raise SystemExit(1)
