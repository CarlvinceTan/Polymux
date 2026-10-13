#!/bin/bash
# cleanup.sh [--days N] [--proof-days M] [--apply]   (default: dry run, N=7, M=14)
# pstack-style worktree + simulator cleanup: merged or stale lane worktrees, their cloned sims,
# per-worktree DerivedData, unavailable sims, and ~/verify-evidence older than N days.
# Scans ~/code/wt and ~/.cursor/worktrees; age = last activity (commit, index, newest file).
# Never touches: the main checkout, dirty or unpushed worktrees, anything holding a build slot
# or unit lock, a running verify/agent, ~/ops/goal-loop, ~/ops/pr-verify.
set -uo pipefail
DAYS=7; APPLY=0; PROOF_DAYS=14
while [ $# -gt 0 ]; do case $1 in --days) DAYS=$2; shift 2;; --proof-days) PROOF_DAYS=$2; shift 2;; --apply) APPLY=1; shift;; *) shift;; esac; done
REPO=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel); MAIN=$(git -C "$REPO" worktree list | head -1 | awk '{print $1}')
OPS=${LANES_HOME:-$HOME/ops/lanes}; LOCKS=$(python3 "$REPO/scripts/lanes.py" get lock_dir)
do_() { if [ $APPLY = 1 ]; then echo "+ $*"; "$@"; else echo "would: $*"; fi; }
keep() { echo "keep: $1 ($2)"; }
CW=${CURSOR_WT:-$HOME/.cursor/worktrees}
last_activity() {  # newest of: last commit, index write, newest tracked-or-untracked file (not .build)
  local c i f; c=$(git -C "$1" log -1 --format=%ct 2>/dev/null || echo 0)
  i=$(stat -f %m "$(git -C "$1" rev-parse --git-dir)/index" 2>/dev/null || echo 0)
  f=$(find "$1" -maxdepth 5 \( -name .build -o -name .git -o -name node_modules \) -prune -o -type f -exec stat -f %m {} + 2>/dev/null | sort -n | tail -1)
  printf '%s\n' "$c" "$i" "${f:-0}" | sort -n | tail -1; }
wt_exists() { [ -d "$HOME/code/wt/$1" ] && return 0; for d in "$CW"/*/"$1"; do [ -d "$d" ] && return 0; done; return 1; }
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
  if [ "$BR" = HEAD ] && [ $MERGED = 0 ] && [ -z "$(git -C "$W" branch -r --contains HEAD 2>/dev/null)" ]; then
    keep "$W" "detached HEAD not on any remote branch"; continue; fi
  AGE=$(( ( $(date +%s) - $(last_activity "$W") ) / 86400 ))
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
  wt_exists "$WT" && continue   # live worktree under ~/code/wt or ~/.cursor/worktrees/*
  [ "$S" = Booted ] && { keep "$N" "booted"; continue; }
  do_ xcrun simctl delete "$U"
done
# ~/.cursor/worktrees dirs that git no longer knows: report only (Cursor owns them)
for d in "$CW"/*/*; do [ -d "$d" ] || continue
  git -C "$REPO" worktree list --porcelain | grep -qxF "worktree $d" && continue
  [ -e "$d/.git" ] && keep "$d" "cursor worktree not registered with this repo; last activity $(( ( $(date +%s) - $(last_activity "$d") ) / 86400 ))d"; done
do_ xcrun simctl delete unavailable
git -C "$REPO" worktree prune --dry-run -v; [ $APPLY = 1 ] && git -C "$REPO" worktree prune
# proof-media/* branches (one per verify run) older than PROOF_DAYS (default 14): delete on origin.
NOW=$(date +%s); git -C "$REPO" for-each-ref --format='%(refname:lstrip=3) %(committerdate:unix)' refs/remotes/origin/proof-media/ | \
  while read -r b t; do [ $(( (NOW - t) / 86400 )) -ge "$PROOF_DAYS" ] && do_ git -C "$REPO" push -q origin --delete "$b"; done
[ -d "$HOME/verify-evidence" ] && find "$HOME/verify-evidence" -mindepth 2 -maxdepth 2 -type d -mtime +"$DAYS" | \
  while read -r d; do do_ rm -rf "$d"; done
echo "cleanup done ($([ $APPLY = 1 ] && echo applied || echo dry run), days=$DAYS)"
