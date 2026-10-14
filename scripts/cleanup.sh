#!/bin/bash
# cleanup.sh [--days N] [--proof-days M] [--apply]   (default: dry run, N=7, M=14)
# pstack-style worktree + simulator cleanup: merged or stale lane worktrees, their cloned sims,
# per-worktree DerivedData, unavailable sims, and ~/verify-evidence older than N days.
# A removable tree is saved to ~/code/wt-trash (or $WT_TRASH), then unregistered.
# Build output is stripped first; dirty files are also saved to ~/verify-evidence.
# Scans ~/code/wt and ~/.cursor/worktrees; age = last activity (commit, index, newest file).
# Never touches: the main checkout, dirty or unpushed worktrees, anything holding a build slot
# or unit lock, a running verify/agent (live .build/verify.lock, or a verify marker newer than
# VERIFY_FRESH_MIN, default 120 min: .build/verify-active or $LOCKS/active/<sim name>), ~/ops/goal-loop,
# ~/ops/pr-verify. A cloned sim is kept on the same rule even when its worktree is gone or elsewhere.
set -uo pipefail
DAYS=7; APPLY=0; PROOF_DAYS=14
while [ $# -gt 0 ]; do case $1 in --days) DAYS=$2; shift 2;; --proof-days) PROOF_DAYS=$2; shift 2;; --apply) APPLY=1; shift;; *) shift;; esac; done
REPO=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel); MAIN=$(git -C "$REPO" worktree list --porcelain | sed -n '1s/^worktree //p')
. "$REPO/scripts/lanelib.sh"   # _mtime: portable mtime (GNU stat -c first; BSD stat -f %m on macOS)
OPS=${LANES_HOME:-$HOME/ops/lanes}; LOCKS=$(python3 "$REPO/scripts/lanes.py" get lock_dir)
do_() { if [ $APPLY = 1 ]; then echo "+ $*"; "$@"; else echo "would: $*"; fi; }
keep() { echo "keep: $1 ($2)"; }
# Save source before removing the registration so trash cannot hold a branch.
TRASH=${WT_TRASH:-$HOME/code/wt-trash}
strip_build() { local x; for x in .build DerivedData; do [ -e "$1/$x" ] || continue
  do_ chmod -R u+w "$1/$x"; do_ rm -rf "$1/$x"; done; }
trash_move() {
  local d="$TRASH/${1##*/}" e
  [ -e "$d" ] && d="$d-$(date +%Y%m%d%H%M%S)-$$"
  if [ -n "$(git -C "$1" status --porcelain --untracked-files=all)" ]; then
    e="$HOME/verify-evidence/${1##*/}/trash-$(date +%Y%m%d-%H%M%S)-$$"
    do_ mkdir -p "$e" && do_ cp -R "$1/." "$e/" || return 1
    do_ rm -f "$e/.git" || return 1
  fi
  do_ mkdir -p "$TRASH" && do_ cp -R "$1" "$d" || return 1
  do_ rm -f "$d/.git" || return 1
  do_ git -C "$REPO" worktree remove --force "$1" || return 1
  do_ git -C "$REPO" worktree prune; }
board_merged() {  # --apply only: card whose .wt is exactly this worktree, PR (results.tsv) merged per gh
  local c u n=$(basename "$1"); [ $APPLY = 1 ] || return 0
  for c in "$OPS"/cards/*.wt; do [ -f "$c" ] && [ "$(cat "$c")" = "$n" ] || continue; c=$(basename "$c" .wt)
    u=$(awk -F'\t' -v s="$c" '{i=$2; sub(/^[0-9]+-/,"",i)} i==s{u=$3} END{print u}' "$OPS/results.tsv" 2>/dev/null)
    [ -n "$u" ] && [ -n "$(gh pr view "$u" --json state,mergedAt -q 'select(.state=="MERGED") | .mergedAt' 2>/dev/null)" ] && \
      do_ bash "$REPO/scripts/board-update.sh" merged "$c"; done; }
CW=${CURSOR_WT:-$HOME/.cursor/worktrees}
last_activity() {  # newest of: last commit, index write, newest tracked-or-untracked file (not .build)
  local c i f; c=$(git -C "$1" log -1 --format=%ct 2>/dev/null || echo 0)
  i=$(_mtime "$(git -C "$1" rev-parse --git-dir)/index")
  f=$(find "$1" -maxdepth 5 \( -name .build -o -name .git -o -name node_modules \) -prune -o -type f -print0 2>/dev/null | \
    while IFS= read -r -d '' x; do _mtime "$x"; done | sort -n | tail -1)
  printf '%s\n' "$c" "$i" "${f:-0}" | sort -n | tail -1; }
wt_exists() { [ -d "$HOME/code/wt/$1" ] && return 0; for d in "$CW"/*/"$1"; do [ -d "$d" ] && return 0; done; return 1; }
# fresh / verify_active / in_use live in lanelib.sh (shared with run-lane.sh free_branch).
git -C "$REPO" fetch -q origin --prune
wts() { git -C "$REPO" worktree list --porcelain | sed -n 's/^worktree //p'; }   # one path per line; paths may contain spaces
wts | while IFS= read -r W; do
  [ "$W" = "$MAIN" ] && continue
  case $W in */ops/goal-loop*|*/ops/pr-verify*) continue;; esac
  # Never remove the merge lane: launchd com.carlvince.merge-lane runs ~/code/wt/merge-lane/scripts/merge-queue.sh,
  # so deleting it makes that job exit 127. Match the name, and skip symlinks: git lists the resolved path, so
  # also skip a worktree reached through a symlink ~/code/wt/<name> (merge-lane now lives at ~/code/merge-lane).
  case ${W##*/} in merge-lane) keep "$W" "merge-lane (never removed)"; continue;; esac
  { [ -L "$W" ] || [ -L "$HOME/code/wt/${W##*/}" ]; } && { keep "$W" "symlink (never removed)"; continue; }
  case $W in "$HOME"/code/wt/*|"$HOME"/.cursor/worktrees/*) ;; *) keep "$W" "not a lane worktree"; continue;; esac
  board_merged "$W"   # squash merges never show in ancestry, so ask gh
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
  strip_build "$W"
  trash_move "$W"
done
# Trash purge: strip build output from every trashed tree, then delete entries older than 24 h whose
# branch is pushed and that have no tracked changes (untracked agent debris doesn't count, same as the
# keep rule above). A trashed tree whose git state can't be read is kept: never delete unverifiable work.
if [ -d "$TRASH" ]; then
  for d in "$TRASH"/*; do [ -d "$d" ] || continue
    H=$(( ( $(date +%s) - $(_mtime "$d") ) / 3600 ))   # read the age first: rm .build would reset the tree's mtime
    strip_build "$d"
    [ "$H" -ge 24 ] || { keep "$d" "trashed ${H}h ago"; continue; }
    TL=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null); [ -n "$TL" ] && [ "$TL" = "$(cd "$d" && pwd -P)" ] || {
      keep "$d" "git state unreadable"; continue; }
    [ -z "$(git -C "$d" status --porcelain --untracked-files=no 2>/dev/null)" ] || { keep "$d" "uncommitted changes"; continue; }
    [ -n "$(git -C "$d" branch -r --contains HEAD 2>/dev/null)" ] || { keep "$d" "unpushed commits"; continue; }
    echo "purge: $d (trashed ${H}h ago, pushed and clean)"
    do_ git -C "$REPO" worktree remove --force "$d" || do_ rm -rf "$d"
  done
fi
# Cloned sims whose worktree is gone (name polymux-<wt>, never the template)
TPL=$(python3 "$REPO/scripts/lanes.py" get sim_template)
xcrun simctl list devices -j | python3 -c "import json,sys
for r,ds in json.load(sys.stdin)['devices'].items():
  for d in ds:
    if d['name'].startswith('polymux-'): print(d['udid'], d['name'], d['state'])" | while read -r U N S; do
  [ "$N" = "$TPL" ] && continue; WT=${N#polymux-}
  wt_exists "$WT" && continue   # live worktree under ~/code/wt or ~/.cursor/worktrees/*
  [ "$S" = Booted ] && { keep "$N" "booted"; continue; }
  VA=""; while IFS= read -r d; do [ -n "$d" ] || continue
    [ "$(basename "$d")" = "$WT" ] && verify_active "$d" "$N" && VA=1; done < <(wts; for d in "$HOME"/ops/pr-verify/*; do printf '%s\n' "$d"; done)
  { [ -n "$VA" ] || verify_active "" "$N"; } && { keep "$N" "verify running or marker < ${VERIFY_FRESH_MIN:-120}m"; continue; }
  do_ xcrun simctl delete "$U"
done
# ~/.cursor/worktrees dirs that git no longer knows: report only (Cursor owns them)
for d in "$CW"/*/*; do [ -d "$d" ] || continue
  git -C "$REPO" worktree list --porcelain | grep -qxF "worktree $d" && continue
  [ -e "$d/.git" ] && keep "$d" "cursor worktree not registered with this repo; last activity $(( ( $(date +%s) - $(last_activity "$d") ) / 86400 ))d"; done
do_ xcrun simctl delete unavailable
git -C "$REPO" worktree prune --dry-run -v; [ $APPLY = 1 ] && git -C "$REPO" worktree prune
# proof-media/* branches (one per verify run) older than PROOF_DAYS (default 14): delete on origin.
NOW=$(date +%s); git -C "$REPO" for-each-ref --format='%(refname:lstrip=3) %(committerdate:unix)' refs/remotes/origin/proof-media/ 'refs/remotes/origin/proof-media-*' | \
  while read -r b t; do [ $(( (NOW - t) / 86400 )) -ge "$PROOF_DAYS" ] && do_ git -C "$REPO" push -q origin --delete "$b"; done
[ -d "$HOME/verify-evidence" ] && find "$HOME/verify-evidence" -mindepth 2 -maxdepth 2 -type d -mtime +"$DAYS" | \
  while read -r d; do do_ rm -rf "$d"; done
echo "cleanup done ($([ $APPLY = 1 ] && echo applied || echo dry run), days=$DAYS)"
