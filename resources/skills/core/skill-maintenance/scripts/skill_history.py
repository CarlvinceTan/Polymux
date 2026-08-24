#!/usr/bin/env python3
"""Record approved personal-skill deployments in an isolated Git history."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid


DEFAULT_REPO = Path.home() / ".polymux" / "skill-history.git"
DEFAULT_WORKTREES = Path.home() / ".polymux" / "skill-maintenance" / "git-worktrees"
DEFAULT_POLYMUX_ROOT = Path.home() / ".polymux" / "skills"
DEFAULT_AGENTS_ROOT = Path.home() / ".agents" / "skills"
DEFAULT_REGRESSION_ROOT = Path.home() / ".polymux" / "skill-maintenance"
GIT = shutil.which("git") or "/usr/bin/git"
IGNORED_NAMES = {".git", ".DS_Store", "__pycache__", ".esphome"}


class HistoryError(RuntimeError):
    pass


@dataclass(frozen=True)
class Config:
    repo: Path
    worktrees: Path
    polymux_root: Path
    agents_root: Path
    regression_root: Path

    @property
    def live_roots(self) -> tuple[Path, Path]:
        return (self.polymux_root, self.agents_root)


def resolved(path: Path) -> Path:
    return path.expanduser().resolve(strict=False)


def is_within(path: Path, parent: Path) -> bool:
    try:
        resolved(path).relative_to(resolved(parent))
        return True
    except ValueError:
        return False


def validate_layout(config: Config) -> None:
    for live_root in config.live_roots:
        if is_within(config.repo, live_root) or is_within(config.worktrees, live_root):
            raise HistoryError("Git history and worktrees must remain outside live skill roots")
    if is_within(config.repo, config.worktrees) or is_within(config.worktrees, config.repo):
        raise HistoryError("The bare repository and worktree area must not overlap")


def git_env() -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "GIT_AUTHOR_NAME": "Polymux Skill Maintenance",
            "GIT_AUTHOR_EMAIL": "skill-maintenance@local.invalid",
            "GIT_COMMITTER_NAME": "Polymux Skill Maintenance",
            "GIT_COMMITTER_EMAIL": "skill-maintenance@local.invalid",
        }
    )
    return env


def run_git(
    config: Config,
    args: list[str],
    *,
    cwd: Path | None = None,
    input_text: str | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    command = [GIT]
    if cwd is None:
        command.extend([f"--git-dir={config.repo}"])
    command.extend(args)
    proc = subprocess.run(
        command,
        cwd=cwd,
        input=input_text,
        text=True,
        capture_output=True,
        env=git_env(),
    )
    if check and proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip() or "Git command failed"
        raise HistoryError(detail)
    return proc


@contextmanager
def history_lock(config: Config):
    config.repo.parent.mkdir(parents=True, exist_ok=True)
    lock_path = config.repo.parent / f".{config.repo.name}.lock"
    with lock_path.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield


def ensure_repo_locked(config: Config) -> bool:
    """Ensure the bare repository exists; return True when newly created."""
    if config.repo.exists():
        bare = run_git(config, ["rev-parse", "--is-bare-repository"]).stdout.strip()
        if bare != "true":
            raise HistoryError(f"History path is not a bare Git repository: {config.repo}")
        return False

    config.repo.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [GIT, "init", "--bare", str(config.repo)],
        text=True,
        capture_output=True,
        env=git_env(),
    )
    if proc.returncode != 0:
        raise HistoryError(proc.stderr.strip() or "Unable to initialize skill history")
    run_git(config, ["symbolic-ref", "HEAD", "refs/heads/main"])
    empty_tree = run_git(config, ["mktree"], input_text="").stdout.strip()
    initial = run_git(
        config,
        ["commit-tree", empty_tree, "-m", "Initialize protected skill history"],
    ).stdout.strip()
    run_git(config, ["update-ref", "refs/heads/main", initial])
    return True


def registered_worktrees(config: Config) -> list[Path]:
    output = run_git(config, ["worktree", "list", "--porcelain"]).stdout
    paths: list[Path] = []
    for line in output.splitlines():
        if line.startswith("worktree "):
            paths.append(Path(line.removeprefix("worktree ")))
    return paths


def assert_no_live_worktrees(config: Config) -> None:
    for path in registered_worktrees(config):
        for live_root in config.live_roots:
            if is_within(path, live_root):
                raise HistoryError(f"Refusing Git worktree inside live skills: {path}")


def ignored(_directory: str, names: list[str]) -> set[str]:
    return {
        name
        for name in names
        if name in IGNORED_NAMES or name.endswith(".pyc") or name.endswith(".pyo")
    }


def copy_skill_root(source_root: Path, destination_root: Path) -> int:
    if destination_root.exists():
        shutil.rmtree(destination_root)
    destination_root.mkdir(parents=True)
    count = 0
    if not source_root.is_dir():
        return count
    for source in sorted(source_root.iterdir(), key=lambda item: item.name):
        if source.name.startswith(".") or not source.is_dir():
            continue
        if not (source / "SKILL.md").is_file():
            continue
        shutil.copytree(
            source,
            destination_root / source.name,
            symlinks=True,
            ignore=ignored,
        )
        count += 1
    return count


def sync_live_to_worktree(config: Config, worktree: Path) -> dict[str, int]:
    return {
        "polymux": copy_skill_root(config.polymux_root, worktree / "polymux"),
        "agents": copy_skill_root(config.agents_root, worktree / "agents"),
    }


def legacy_deleted_snapshots(config: Config) -> dict[tuple[str, str], Path]:
    """Return the last approved baseline for skills deleted before Git history."""
    candidates = config.regression_root / "candidates"
    if not candidates.is_dir():
        return {}
    selected: dict[tuple[str, str], tuple[str, Path]] = {}
    for metadata_path in candidates.glob("*/candidate.json"):
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if metadata.get("action") != "delete":
            continue
        if not str(metadata.get("status", "")).startswith("approved"):
            continue
        target_id = str(metadata.get("target_id", ""))
        if ":" not in target_id:
            continue
        scope, name = target_id.split(":", 1)
        if scope not in {"polymux", "agents"} or not name:
            continue
        live_root = config.polymux_root if scope == "polymux" else config.agents_root
        if (live_root / name / "SKILL.md").is_file():
            continue
        snapshot = Path(str(metadata.get("baseline_snapshot", "")))
        if not (snapshot / "SKILL.md").is_file():
            continue
        approved_at = str(metadata.get("approved_at") or metadata.get("updated_at") or "")
        key = (scope, name)
        if key not in selected or approved_at > selected[key][0]:
            selected[key] = (approved_at, snapshot)
    return {key: value[1] for key, value in selected.items()}


def commit_legacy_import_locked(config: Config) -> dict[str, object]:
    """Seed history with current skills plus recoverable pre-Git deletions."""
    base = run_git(config, ["rev-parse", "refs/heads/main^{commit}"]).stdout.strip()
    deleted = legacy_deleted_snapshots(config)
    with detached_worktree(config) as worktree:
        counts = sync_live_to_worktree(config, worktree)
        for (scope, name), snapshot in sorted(deleted.items()):
            destination = worktree / scope / name
            if destination.exists():
                shutil.rmtree(destination)
            shutil.copytree(snapshot, destination, symlinks=True, ignore=ignored)
        run_git(config, ["add", "-A"], cwd=worktree)
        message = (
            "skills: import legacy approved history\n\n"
            f"Recoverable-Deleted-Skills: {len(deleted)}"
        )
        run_git(
            config,
            [
                "-c",
                "commit.gpgsign=false",
                "-c",
                "core.hooksPath=/dev/null",
                "commit",
                "-m",
                message,
            ],
            cwd=worktree,
        )
        commit = run_git(config, ["rev-parse", "HEAD"], cwd=worktree).stdout.strip()
        run_git(config, ["update-ref", "refs/heads/main", commit, base])
        return {
            "status": "recorded",
            "commit": commit,
            "skills": counts,
            "recoverable_deleted_skills": len(deleted),
        }


@contextmanager
def detached_worktree(config: Config, ref: str = "refs/heads/main"):
    config.worktrees.mkdir(parents=True, exist_ok=True)
    run_git(config, ["worktree", "prune", "--expire", "now"])
    path = config.worktrees / f"record-{uuid.uuid4().hex}"
    run_git(config, ["worktree", "add", "--detach", str(path), ref])
    try:
        yield path
    finally:
        run_git(config, ["worktree", "remove", "--force", str(path)], check=False)
        if path.exists():
            shutil.rmtree(path)
        run_git(config, ["worktree", "prune", "--expire", "now"], check=False)


def commit_snapshot_locked(
    config: Config,
    *,
    action: str,
    candidate_id: str | None,
    run_id: str | None,
) -> dict[str, object]:
    assert_no_live_worktrees(config)
    base = run_git(config, ["rev-parse", "refs/heads/main^{commit}"]).stdout.strip()
    with detached_worktree(config) as worktree:
        counts = sync_live_to_worktree(config, worktree)
        run_git(config, ["add", "-A"], cwd=worktree)
        changes = run_git(config, ["status", "--porcelain"], cwd=worktree).stdout
        if not changes.strip():
            return {"status": "unchanged", "commit": base, "skills": counts}

        subject = f"skills: {action}"
        trailers = []
        if candidate_id:
            trailers.append(f"Candidate: {candidate_id}")
        if run_id:
            trailers.append(f"Run: {run_id}")
        message = subject + ("\n\n" + "\n".join(trailers) if trailers else "")
        run_git(
            config,
            [
                "-c",
                "commit.gpgsign=false",
                "-c",
                "core.hooksPath=/dev/null",
                "commit",
                "-m",
                message,
            ],
            cwd=worktree,
        )
        commit = run_git(config, ["rev-parse", "HEAD"], cwd=worktree).stdout.strip()
        run_git(config, ["update-ref", "refs/heads/main", commit, base])
        return {"status": "recorded", "commit": commit, "skills": counts}


def initialize(config: Config) -> dict[str, object]:
    validate_layout(config)
    with history_lock(config):
        created = ensure_repo_locked(config)
        legacy = commit_legacy_import_locked(config) if created else None
        result = commit_snapshot_locked(
            config,
            action="baseline approved skills",
            candidate_id=None,
            run_id=None,
        )
        result["repository"] = str(config.repo)
        result["initialized"] = created
        if legacy is not None:
            result["legacy_import"] = legacy
        return result


def record(
    config: Config,
    *,
    action: str,
    candidate_id: str | None,
    run_id: str | None,
) -> dict[str, object]:
    validate_layout(config)
    with history_lock(config):
        ensure_repo_locked(config)
        result = commit_snapshot_locked(
            config,
            action=action,
            candidate_id=candidate_id,
            run_id=run_id,
        )
        result["repository"] = str(config.repo)
        result["remote"] = push_origin_locked(config)
        return result


def push_origin_locked(config: Config) -> dict[str, str]:
    remotes = run_git(config, ["remote"]).stdout.splitlines()
    if "origin" not in remotes:
        return {"status": "not-configured"}
    pushed = run_git(
        config,
        ["push", "origin", "refs/heads/main:refs/heads/main"],
        check=False,
    )
    if pushed.returncode == 0:
        return {"status": "pushed"}
    detail = pushed.stderr.strip().splitlines()
    return {
        "status": "failed",
        "message": detail[-1] if detail else "Git push failed",
    }


def push_origin(config: Config) -> dict[str, object]:
    validate_layout(config)
    with history_lock(config):
        ensure_repo_locked(config)
        result: dict[str, object] = push_origin_locked(config)
        result["repository"] = str(config.repo)
        return result


def status(config: Config, *, initialize_missing: bool) -> dict[str, object]:
    validate_layout(config)
    with history_lock(config):
        if not config.repo.exists():
            if not initialize_missing:
                raise HistoryError("Skill history is not initialized")
            created = ensure_repo_locked(config)
            if created:
                commit_legacy_import_locked(config)
            commit_snapshot_locked(
                config,
                action="baseline approved skills",
                candidate_id=None,
                run_id=None,
            )
        else:
            ensure_repo_locked(config)
        assert_no_live_worktrees(config)
        head = run_git(config, ["rev-parse", "refs/heads/main^{commit}"]).stdout.strip()
        with detached_worktree(config) as worktree:
            counts = sync_live_to_worktree(config, worktree)
            run_git(config, ["add", "-A"], cwd=worktree)
            changes = run_git(config, ["status", "--porcelain"], cwd=worktree).stdout
        return {
            "status": "clean" if not changes.strip() else "mismatch",
            "commit": head,
            "repository": str(config.repo),
            "skills": counts,
            "changes": changes.splitlines(),
        }


def create_inspection_worktree(config: Config, ref: str, requested: Path | None) -> dict[str, str]:
    validate_layout(config)
    with history_lock(config):
        ensure_repo_locked(config)
        assert_no_live_worktrees(config)
        commit = run_git(config, ["rev-parse", f"{ref}^{{commit}}"]).stdout.strip()
        short = commit[:12]
        if requested is None:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            path = config.worktrees / f"inspect-{stamp}-{short}"
        else:
            path = requested
        for live_root in config.live_roots:
            if is_within(path, live_root):
                raise HistoryError("Inspection worktrees cannot be created inside live skills")
        if path.exists():
            raise HistoryError(f"Worktree path already exists: {path}")
        path.parent.mkdir(parents=True, exist_ok=True)
        run_git(config, ["worktree", "add", "--detach", str(path), commit])
        return {"status": "created", "commit": commit, "path": str(path)}


def history_log(config: Config, limit: int) -> list[dict[str, str]]:
    validate_layout(config)
    if not config.repo.exists():
        raise HistoryError("Skill history is not initialized")
    output = run_git(
        config,
        ["log", f"-{limit}", "--format=%H%x09%aI%x09%s", "refs/heads/main"],
    ).stdout
    entries = []
    for line in output.splitlines():
        commit, timestamp, subject = line.split("\t", 2)
        entries.append({"commit": commit, "timestamp": timestamp, "subject": subject})
    return entries


def config_from_args(args: argparse.Namespace) -> Config:
    return Config(
        repo=Path(args.repo),
        worktrees=Path(args.worktrees),
        polymux_root=Path(args.polymux_root),
        agents_root=Path(args.agents_root),
        regression_root=Path(args.regression_root),
    )


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument("--repo", default=str(DEFAULT_REPO))
    root.add_argument("--worktrees", default=str(DEFAULT_WORKTREES))
    root.add_argument("--polymux-root", default=str(DEFAULT_POLYMUX_ROOT))
    root.add_argument("--agents-root", default=str(DEFAULT_AGENTS_ROOT))
    root.add_argument("--regression-root", default=str(DEFAULT_REGRESSION_ROOT))
    commands = root.add_subparsers(dest="command", required=True)

    commands.add_parser("init", help="Initialize local Git history from approved live skills")
    commands.add_parser("preflight", help="Require Git history to match approved live skills")
    commands.add_parser("status", help="Compare Git history with approved live skills")
    commands.add_parser("push", help="Fast-forward approved main history to origin")

    record_parser = commands.add_parser("record", help="Record an approved deployment")
    record_parser.add_argument("--action", required=True)
    record_parser.add_argument("--candidate-id")
    record_parser.add_argument("--run-id")

    log_parser = commands.add_parser("log", help="Show approved deployment history")
    log_parser.add_argument("--limit", type=int, default=20)

    worktree_parser = commands.add_parser("worktree", help="Create a detached inspection worktree")
    worktree_parser.add_argument("ref", nargs="?", default="refs/heads/main")
    worktree_parser.add_argument("--path", type=Path)
    return root


def main() -> int:
    args = parser().parse_args()
    config = config_from_args(args)
    try:
        if args.command == "init":
            result: object = initialize(config)
        elif args.command == "preflight":
            result = status(config, initialize_missing=True)
            if result["status"] != "clean":
                print(json.dumps(result, indent=2), file=sys.stderr)
                return 3
        elif args.command == "status":
            result = status(config, initialize_missing=False)
        elif args.command == "push":
            result = push_origin(config)
        elif args.command == "record":
            result = record(
                config,
                action=args.action,
                candidate_id=args.candidate_id,
                run_id=args.run_id,
            )
        elif args.command == "log":
            result = {"status": "ok", "entries": history_log(config, args.limit)}
        elif args.command == "worktree":
            result = create_inspection_worktree(config, args.ref, args.path)
        else:
            raise HistoryError(f"Unsupported command: {args.command}")
    except HistoryError as exc:
        print(f"Skill history error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
