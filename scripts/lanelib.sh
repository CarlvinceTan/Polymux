#!/bin/bash
# Shared helpers for run-lane.sh / verify.sh (sourced, not run).
# lock_take DIR: atomic writer lock. mkdir is atomic; a stale lock (dead pid) is reclaimed by
# renaming it to a unique name first (rename is atomic, so only one reclaimer wins), then mkdir.
lock_take() {
  local d=$1 op
  mkdir -p "$(dirname "$d")"
  if mkdir "$d" 2>/dev/null; then echo $$ > "$d/pid"; return 0; fi
  op=$(cat "$d/pid" 2>/dev/null); [ -z "$op" ] && { sleep 2; op=$(cat "$d/pid" 2>/dev/null); }
  if [ -n "$op" ] && kill -0 "$op" 2>/dev/null; then return 1; fi
  mv "$d" "$d.stale.$$.$RANDOM" 2>/dev/null || return 1   # lost the race: someone else reclaimed
  rm -rf "$d".stale.$$.* 2>/dev/null
  mkdir "$d" 2>/dev/null || return 1; echo $$ > "$d/pid"
}
lock_holder() { cat "$1/pid" 2>/dev/null; }
lock_drop() { [ "$(cat "$1/pid" 2>/dev/null)" = "$$" ] && rm -rf "$1"; return 0; }
branch_lock_dir() { echo "${LANES_HOME:-$HOME/ops/lanes}/branches/$(echo "$1" | tr '/' '%').lock"; }
# owner/repo from origin (git@github.com:o/r.git | https://github.com/o/r[.git])
repo_slug() { git -C "${1:-.}" remote get-url origin | sed -E 's#^(git@[^:]+:|https?://[^/]+/)##; s#\.git$##'; }
# Carl's lane-guard hook; missing = skip, never fatal unless the caller checks rc.
LANE_GUARD=${LANE_GUARD:-$HOME/.local/bin/lane-guard}
guard() { [ -x "$LANE_GUARD" ] || return 0; "$LANE_GUARD" "$@"; }
