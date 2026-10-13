#!/bin/bash
# Shared helpers for run-lane.sh / verify.sh (sourced, not run).
# lock_take DIR: writer lock. mkdir is atomic. A stale lock (dead pid) is reclaimed only by the
# holder of a short-lived gate DIR.reclaim, which re-checks the pid under the gate before replacing
# it, so with any number of racing reclaimers at most one wins and no live lock is ever moved or
# deleted. If anything changed, the reclaimer gives up (returns 1). A gate older than 60 s is a
# dead reclaimer and is cleared (the next attempt can then proceed).
# A lock with no pid file is being created; it counts as stale only after LOCK_GRACE seconds (10).
_mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }   # GNU first: GNU 'stat -f %m' prints '?'
_age() { echo $(( $(date +%s) - $(_mtime "$1") )); }
lock_take() {
  local d=$1 op cur g="$1.reclaim" rc=1
  mkdir -p "$(dirname "$d")"
  if mkdir "$d" 2>/dev/null; then echo $$ > "$d/pid"; return 0; fi
  op=$(cat "$d/pid" 2>/dev/null)
  if [ -z "$op" ]; then [ "$(_age "$d")" -lt "${LOCK_GRACE:-10}" ] && return 1
  elif kill -0 "$op" 2>/dev/null; then return 1; fi
  if ! mkdir "$g" 2>/dev/null; then
    [ "$(_age "$g")" -gt 60 ] && rm -rf "$g"; return 1; fi
  cur=$(cat "$d/pid" 2>/dev/null)
  if [ -d "$d" ] && [ "$cur" = "$op" ] && ! { [ -n "$cur" ] && kill -0 "$cur" 2>/dev/null; }; then
    rm -rf "$d" && mkdir "$d" 2>/dev/null && echo $$ > "$d/pid" && rc=0; fi
  rmdir "$g" 2>/dev/null; return $rc
}
# scope_check BASE "glob,glob": every changed (incl. deleted, nested) file must match one glob.
# set -f so patterns never expand against real files; case patterns match '/' with '*'.
scope_check() {
  local base=$1 bad=0 f g ok; local -a pats; IFS=, read -ra pats <<< "$2"
  set -f
  while IFS= read -r f; do [ -n "$f" ] || continue; ok=0
    for g in "${pats[@]}"; do g=${g# }; case "$f" in $g) ok=1; break;; esac; done
    [ $ok = 1 ] || { echo "outside scope: $f"; bad=1; }
  done < <(git diff --name-only --no-renames "$base"...HEAD)
  set +f; return $bad
}
lock_holder() { cat "$1/pid" 2>/dev/null; }
lock_drop() { [ "$(cat "$1/pid" 2>/dev/null)" = "$$" ] && rm -rf "$1"; return 0; }
# Lane scripts changed between BASE and HEAD in the current repo?
lane_files_changed() { git diff --name-only "$1"...HEAD | grep -qE '^(scripts/(run-lane|verify|lanelib|cleanup|dispatch-guard|wt-setup|test-lanes|bootstrap-mac|board-update|test-board|approve-proof|merge-queue|test-merge-queue|review-verdict)\.sh|scripts/(lanes|media-check|verdict)\.py|agents/lanes\.toml)$'; }
# test-lanes.sh to run: the checkout under test (a PR's own worktree in --verify-only), else ours.
lane_tests_path() { if [ -f "$1/scripts/test-lanes.sh" ]; then echo "$1/scripts/test-lanes.sh"; else echo "$2/test-lanes.sh"; fi; }
branch_lock_dir() { echo "${LANES_HOME:-$HOME/ops/lanes}/branches/$(echo "$1" | tr '/' '%').lock"; }
# owner/repo from origin (git@github.com:o/r.git | https://github.com/o/r[.git])
repo_slug() { git -C "${1:-.}" remote get-url origin | sed -E 's#^(git@[^:]+:|https?://[^/]+/)##; s#\.git$##'; }
# Carl's lane-guard hook; missing = skip, never fatal unless the caller checks rc.
LANE_GUARD=${LANE_GUARD:-$HOME/.local/bin/lane-guard}
guard() { [ -x "$LANE_GUARD" ] || return 0; "$LANE_GUARD" "$@"; }
