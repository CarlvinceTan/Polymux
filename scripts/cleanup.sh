#!/bin/bash
# cleanup.sh [--days N] [--apply]   (default: dry run, N=7)
# pstack-style worktree + simulator cleanup: merged or stale lane worktrees, their cloned sims,
# per-worktree DerivedData, unavailable sims, and ~/verify-evidence older than N days.
# Never touches: the main checkout, dirty or unpushed worktrees, anything holding a build slot
# or unit lock, a running verify/agent, ~/ops/goal-loop, ~/ops/pr-verify.
set -uo pipefail
DAYS=7; APPLY=0
while [ $# -gt 0 ]; do case $1 in --days) DAYS=$2; shift 2;; --apply) APPLY=1; shift;; *) shift;; esac; done
REPO=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel); MAIN=$(git -C "$REPO" worktree list | head -1 | awk '{print $1}')
OPS=${LANES_HOME:-$HOME/ops/lanes}; LOCKS=$(python3 "$REPO/scripts/lanes.py" get lock_dir)
do_() { if [ $APPLY = 1 ]; then echo "+ $*"; "$@"; else echo "would: $*"; fi; }
keep() { echo "keep: $1 ($2)"; }
in_use() {  # $1 worktree path
  grep -qsF "$1" "$LOCKS"/slot*/wt && return 0
  for u in "$OPS"/units/*.lock; do [ -d "$u" ] && kill -0 "$(cat "$u/pid" 2>/dev/null)" 2>/dev/null && \
    [[ "$1" == *"$(basename "$u" .lock)"* ]] && return 0; done
  pgrep -f "$1" >/dev/null
}
git -C "$REPO" fetch -q origin --prune
git -C "$REPO" worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r W; do
  [ "$W" = "$MAIN" ] && continue
  case $W in */ops/goal-loop*|*/ops/pr-verify*) continue;; esac
  case $W in "$HOME"/code/wt/*|"$HOME"/.cursor/worktrees/*) ;; *) keep "$W" "not a lane worktree"; continue;; esac
  in_use "$W" && { keep "$W" "in use or locked"; continue; }
  [ -n "$(git -C "$W" status --porcelain --untracked-files=no)" ] && { keep "$W" "uncommitted changes"; continue; }
  BR=$(git -C "$W" rev-parse --abbrev-ref HEAD)
  if [ "$BR" != HEAD ] && [ -n "$(git -C "$W" log --oneline "origin/$BR..HEAD" 2>/dev/null || git -C "$W" log --oneline origin/main..HEAD)" ]; then
    keep "$W" "unpushed commits on $BR"; continue; fi
  MERGED=0; git -C "$W" merge-base --is-ancestor HEAD origin/main && MERGED=1
  AGE=$(( ( $(date +%s) - $(stat -f %m "$W/.git") ) / 86400 ))
  [ $MERGED = 1 ] || [ $AGE -ge $DAYS ] || { keep "$W" "active, ${AGE}d old"; continue; }
  echo "remove: $W (merged=$MERGED age=${AGE}d)"
  U=$(sed -n 's/^SIM_UDID=//p' "$W/.build/env" 2>/dev/null)
  [ -n "$U" ] && { do_ xcrun simctl shutdown "$U" 2>/dev/null; do_ xcrun simctl delete "$U"; }
  do_ rm -rf "$W/.build"
  do_ git -C "$REPO" worktree remove "$W"   # refuses if dirty; no --force
done
# Cloned sims whose worktree is gone (name polymux-<wt>, never the template)
TPL=$(python3 "$REPO/scripts/lanes.py" get sim_template)
xcrun simctl list devices -j | python3 -c "import json,sys
for r,ds in json.load(sys.stdin)['devices'].items():
  for d in ds:
    if d['name'].startswith('polymux-'): print(d['udid'], d['name'], d['state'])" | while read -r U N S; do
  [ "$N" = "$TPL" ] && continue; WT=${N#polymux-}
  [ -d "$HOME/code/wt/$WT" ] && continue
  [ "$S" = Booted ] && { keep "$N" "booted"; continue; }
  do_ xcrun simctl delete "$U"
done
do_ xcrun simctl delete unavailable
git -C "$REPO" worktree prune --dry-run -v; [ $APPLY = 1 ] && git -C "$REPO" worktree prune
[ -d "$HOME/verify-evidence" ] && find "$HOME/verify-evidence" -mindepth 2 -maxdepth 2 -type d -mtime +"$DAYS" | \
  while read -r d; do do_ rm -rf "$d"; done
echo "cleanup done ($([ $APPLY = 1 ] && echo applied || echo dry run), days=$DAYS)"
