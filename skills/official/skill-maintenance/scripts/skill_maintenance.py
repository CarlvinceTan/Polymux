#!/opt/homebrew/bin/python3.14
"""Stable entry point for the runner with isolated Git deployment history."""

from __future__ import annotations

from pathlib import Path
import fcntl
import hashlib
import json
import subprocess
import sys


RUNNER = Path("/Users/carlvincetan/.codex/skill-regression/runner.py")
HISTORY = Path(__file__).with_name("skill_history.py")
SYSTEM_UPDATES = Path(__file__).with_name("system_skill_updates.py")
PYTHON = "/opt/homebrew/bin/python3.14"
MUTATING_COMMANDS = {"promote", "approve-intentional"}
EVALUATION_COMMANDS = {"check", "check-rename", "run"}
EVALUATION_LOCKS = RUNNER.parent / "state" / "evaluation-locks"


def history_command(*args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [PYTHON, str(HISTORY), *args],
        text=True,
        capture_output=capture,
        cwd=RUNNER.parent,
    )


def system_command(*args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [PYTHON, str(SYSTEM_UPDATES), *args],
        text=True,
        capture_output=capture,
        cwd=RUNNER.parent,
    )


def run_evaluation(arguments: list[str]) -> subprocess.CompletedProcess[str] | None:
    """Run one evaluation process per candidate while retaining internal parallelism."""
    if len(arguments) < 2:
        return subprocess.run([PYTHON, str(RUNNER), *arguments], cwd=RUNNER.parent)
    candidate_id = arguments[1]
    lock_name = hashlib.sha256(candidate_id.encode("utf-8")).hexdigest() + ".lock"
    EVALUATION_LOCKS.mkdir(parents=True, exist_ok=True)
    with (EVALUATION_LOCKS / lock_name).open("a+") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(
                "An evaluation for this candidate is already running. Wait for it "
                "to finish before starting or resuming another check.",
                file=sys.stderr,
            )
            return None
        try:
            return subprocess.run([PYTHON, str(RUNNER), *arguments], cwd=RUNNER.parent)
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def main() -> int:
    if not RUNNER.is_file():
        print(f"Skill maintenance runner is missing: {RUNNER}", file=sys.stderr)
        return 2
    if not HISTORY.is_file():
        print(f"Skill history helper is missing: {HISTORY}", file=sys.stderr)
        return 2
    if not SYSTEM_UPDATES.is_file():
        print(f"System update helper is missing: {SYSTEM_UPDATES}", file=sys.stderr)
        return 2

    arguments = sys.argv[1:]
    if arguments and arguments[0] == "history":
        return history_command(*arguments[1:]).returncode
    if arguments and arguments[0] == "system":
        return system_command(*arguments[1:]).returncode

    command = arguments[0] if arguments else ""
    if command in MUTATING_COMMANDS:
        preflight = history_command("preflight", capture=True)
        if preflight.returncode != 0:
            sys.stderr.write(preflight.stderr or preflight.stdout)
            print("Refusing promotion because approved Git history is not current.", file=sys.stderr)
            return preflight.returncode

    if command in MUTATING_COMMANDS:
        runner = subprocess.run(
            [PYTHON, str(RUNNER), *arguments],
            text=True,
            capture_output=True,
            cwd=RUNNER.parent,
        )
        sys.stdout.write(runner.stdout)
        sys.stderr.write(runner.stderr)
    elif command in EVALUATION_COMMANDS:
        runner = run_evaluation(arguments)
        if runner is None:
            return 2
    else:
        runner = subprocess.run([PYTHON, str(RUNNER), *arguments], cwd=RUNNER.parent)
    if runner.returncode != 0 or command not in MUTATING_COMMANDS:
        return runner.returncode

    candidate_id = arguments[1] if len(arguments) > 1 else None
    history_args = ["record", "--action", command]
    if candidate_id:
        history_args.extend(["--candidate-id", candidate_id])
    run_id = None
    if "--run-id" in arguments:
        index = arguments.index("--run-id")
        if index + 1 < len(arguments):
            run_id = arguments[index + 1]
    if run_id is None:
        try:
            run_id = json.loads(runner.stdout).get("run_id")
        except (json.JSONDecodeError, AttributeError):
            run_id = None
    if run_id:
        history_args.extend(["--run-id", run_id])
    recorded = history_command(*history_args, capture=True)
    if recorded.returncode != 0:
        sys.stderr.write(recorded.stderr or recorded.stdout)
        print("Promotion succeeded, but Git history recording failed.", file=sys.stderr)
        return 4
    try:
        record_result = json.loads(recorded.stdout)
        commit = record_result.get("commit", "unknown")
        remote_status = record_result.get("remote", {}).get("status")
    except json.JSONDecodeError:
        commit = "unknown"
        remote_status = None
    print(f"Approved skill history recorded at {commit}.", file=sys.stderr)
    if remote_status == "failed":
        print(
            "GitHub synchronization failed; local approved history is intact. "
            "Retry with `history push`.",
            file=sys.stderr,
        )
    if candidate_id:
        finalized = system_command("finalize-candidate", candidate_id, "--json", capture=True)
        if finalized.returncode != 0:
            sys.stderr.write(finalized.stderr or finalized.stdout)
            print(
                "Promotion and Git history succeeded, but system-update state "
                "finalization failed.",
                file=sys.stderr,
            )
            return 5
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
