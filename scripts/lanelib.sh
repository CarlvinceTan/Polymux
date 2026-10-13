#!/bin/bash
# Shared helpers for run-lane.sh / verify.sh (sourced, not run).
# lock_take DIR: atomic writer lock. mkdir is atomic; a stale lock (dead pid) is reclaimed by
# renaming it to a unique name, then checking the moved lock still holds the dead pid we saw.
# If it doesn't, another reclaimer won and we moved ITS live lock: put it back and fail.
lock_take() {
  local d=$1 op
  mkdir -p "$(dirname "$d")"
  if mkdir "$d" 2>/dev/null; then echo $$ > "$d/pid"; return 0; fi
  op=$(cat "$d/pid" 2>/dev/null); [ -z "$op" ] && { sleep 2; op=$(cat "$d/pid" 2>/dev/null); }
  if [ -n "$op" ] && kill -0 "$op" 2>/dev/null; then return 1; fi
  local t="$d.stale.$$.$RANDOM"
  mv "$d" "$t" 2>/dev/null || return 1                    # lost the race: someone else moved it
  if [ "$(cat "$t/pid" 2>/dev/null)" != "$op" ]; then      # not the stale lock we judged dead
    [ -e "$d" ] || mv "$t" "$d" 2>/dev/null; rm -rf "$t" 2>/dev/null; return 1; fi
  rm -rf "$t"; mkdir "$d" 2>/dev/null || return 1; echo $$ > "$d/pid"
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
branch_lock_dir() { echo "${LANES_HOME:-$HOME/ops/lanes}/branches/$(echo "$1" | tr '/' '%').lock"; }
# owner/repo from origin (git@github.com:o/r.git | https://github.com/o/r[.git])
repo_slug() { git -C "${1:-.}" remote get-url origin | sed -E 's#^(git@[^:]+:|https?://[^/]+/)##; s#\.git$##'; }
# Carl's lane-guard hook; missing = skip, never fatal unless the caller checks rc.
LANE_GUARD=${LANE_GUARD:-$HOME/.local/bin/lane-guard}
guard() { [ -x "$LANE_GUARD" ] || return 0; "$LANE_GUARD" "$@"; }
