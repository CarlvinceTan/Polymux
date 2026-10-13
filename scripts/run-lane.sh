#!/bin/bash
# run-lane.sh <lane> "<task>"|<task-file> [--branch B] [--base origin/main]
# run-lane.sh --verify-only <branch>     (Mac proof for cloud-agent PRs)
# Worktree -> headless agent -> our own verify.sh -> push + PR with proof.
# On failure the task fails over once to the next lane in agents/lanes.toml; after 2
# failures it writes ~/ops/lanes/failures.tsv + NEEDS_CODY. No daemon, no DB.
# One writer per branch: $OPS/branches/<branch>.lock (plus the unit lock). Lane commits carry
# a "Lane: <lane>/<agent>" trailer so one writer per branch can be audited from history.
set -uo pipefail
SD=$(cd "$(dirname "$0")" && pwd); REPO=$(git -C "$SD/.." rev-parse --show-toplevel); . "$SD/lanelib.sh"
OPS=${LANES_HOME:-$HOME/ops/lanes}; WTR=${LANES_WT:-$HOME/code/wt}; mkdir -p "$OPS/logs"; EV="$OPS/events.tsv"
SLUG_REPO=$(repo_slug "$REPO"); HOST=$(hostname -s)
ev() { printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$ID" "$1" "${2:-}" "${3:-}" >> "$EV"; }
cfg() { python3 "$SD/lanes.py" "$@"; }
publish_proof() {  # $1 worktree, $2 task id -> markdown; media goes to its own branch proof-media/<id>
  local wt=$1 id=$2 idx c err ref="proof-media/$2" n=0; idx=$(mktemp)
  for f in "$wt"/.build/proof/*.png "$wt"/.build/proof/*.mp4; do [ -f "$f" ] && n=$((n+1)); done
  [ $n = 0 ] && { echo "_no media captured_"; return; }
  err=$( cd "$wt" && export GIT_INDEX_FILE=$idx && git read-tree --empty &&
    for f in .build/proof/*.png .build/proof/*.mp4; do [ -f "$f" ] || continue
      git update-index --add --cacheinfo "100644,$(git hash-object -w "$f"),$(basename "$f")" || exit 1; done &&
    c=$(git commit-tree "$(git write-tree)" -m "proof $id") &&
    git push -q origin "$c:refs/heads/$ref" 2>&1 ); local rc=$?; rm -f "$idx"
  if [ $rc -ne 0 ]; then echo "proof push failed ($ref): $err" >&2
    echo "_media upload to \`$ref\` failed: $(echo "$err" | tail -1 | cut -c1-200)_"; return; fi
  local u="https://github.com/$SLUG_REPO/raw/$ref"
  for f in "$wt"/.build/proof/*.png; do [ -f "$f" ] && echo "![$(basename "$f")]($u/$(basename "$f"))"; done
  [ -f "$wt/.build/proof/ios.mp4" ] && echo "[iOS video]($u/ios.mp4)"
}
if [ "${1:-}" = "--verify-only" ]; then
  BR=$2; ID="verify-${BR//\//-}"; WT="$WTR/$ID"; BL=$(branch_lock_dir "$BR")
  lock_take "$BL" || { echo "branch '$BR' already has a writer (pid $(lock_holder "$BL")); not verifying"; exit 3; }
  trap 'lock_drop "$BL"' EXIT; ev running verify "$BR"
  git -C "$REPO" fetch -q origin "$BR" && { [ -d "$WT" ] || git -C "$REPO" worktree add -q --detach "$WT" FETCH_HEAD; }
  git -C "$WT" checkout -q --detach FETCH_HEAD
  (cd "$WT" && bash "$SD/wt-setup.sh" && bash "$SD/verify.sh") > "$OPS/logs/$ID.log" 2>&1; rc=$?
  BODY="$(cat "$WT/.build/proof/summary.md")"$'\n\n'"$(publish_proof "$WT" "$ID" 2>>"$OPS/logs/$ID.log")"
  gh pr comment "$BR" -R "$SLUG_REPO" --body "Mac proof ($HOST):"$'\n'"$BODY" && ev pr verify "$BR"
  [ $rc = 0 ] || ev failed verify "$BR"; exit $rc
fi
LANE=$1; TASK=$2; UNIT=$2; shift 2; BASE=origin/main; BRANCH=""; NEEDS=none; EXP=60; SCOPE=""
if [ -f "$TASK" ]; then  # task file: "needs:", "expected_min:", "scope: a/**,b/*" (allowed files); rest is the brief
  NEEDS=$(sed -n 's/^needs: *//p' "$TASK" | head -1); EXP=$(sed -n 's/^expected_min: *//p' "$TASK" | head -1)
  SCOPE=$(sed -n 's/^scope: *//p' "$TASK" | head -1)
  TASK=$(grep -vE '^(unit|needs|scope|expected_min):' "$TASK"); EXP=${EXP:-60}
fi
TARGET=${LANE_TARGET:-$HOST}   # dispatcher Xcode guard: refuse before any claim/worktree
bash "$SD/dispatch-guard.sh" "$UNIT" "$TARGET" || exit 4
while [ $# -gt 0 ]; do case $1 in --branch) BRANCH=$2; shift 2;; --base) BASE=$2; shift 2;; *) shift;; esac; done
TITLE=$(echo "$TASK" | head -1); SLUG=$(echo "$TITLE" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | cut -c1-32 | sed 's/-$//')
ID="$(date +%m%d%H%M)-$SLUG"; BRANCH=${BRANCH:-agent/$SLUG}
prompt() { echo "Task: $TASK
Rules: work only in this worktree. Keep the change small and scoped.${SCOPE:+ Only touch files matching: $SCOPE.} Build and test ONLY via
'bash "$SD/verify.sh"' and iterate until it exits 0 (never run it in the background). Commit your work with a clear message
ending in the trailer line 'Lane: $1/$(cfg lane "$1" agent)'.
Do not push and do not open a PR. Never skip, delete or weaken tests; a behaviour change
needs a test change (or a 'No-test-reason: ...' line in the commit). Keep it under ~300 changed lines. If you cannot make verify.sh pass, say why and stop."; }
run_agent() {  # $1 lane, $2 worktree, $3 log. Lane identity is in the committer name.
  local a cmd P; a=$(cfg lane "$1" agent); cmd=$(cfg lane "$1" cmd); P=$(prompt "$1")
  export GIT_COMMITTER_NAME="$(git -C "$2" config user.name || echo agent) ($1/$a)"
  case " ${LANE_FORCE_FAIL:-} " in *" $1 "*) echo "forced failure (LANE_FORCE_FAIL test)" >> "$3"; return 97;; esac
  [ -n "${LANE_STUB_CMD:-}" ] && { (cd "$2" && LANE="$1" AGENT="$a" bash -c "$LANE_STUB_CMD") >> "$3" 2>&1; return; }  # test hook
  case $a in
    cursor) local K; K=$(vault get "$(cfg lane "$1" key)" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' 2>/dev/null) || { echo "vault read failed" >>"$3"; return 98; }
      # Key only in this child's environment: never argv (ps), never exported, keychain untouched.
      (cd "$2" && CURSOR_API_KEY="$K" "$cmd" -p --force --trust --workspace "$2" --output-format text "$P") >> "$3" 2>&1;;
    codex) (cd "$2" && "$cmd" exec --full-auto "$P") >> "$3" 2>&1;;
    opencode) (cd "$2" && "$cmd" run "$P") >> "$3" 2>&1;;
    *) echo "unknown agent $a" >> "$3"; return 99;;
  esac
}
# Stop rule: a brief that already failed twice goes to Cody, never straight back to an agent.
grep -qF "	$TITLE	" "$OPS/failures.tsv" 2>/dev/null && { echo "refusing: '$TITLE' already failed twice (see $OPS/failures.tsv); fix the brief"; exit 2; }
G=$(guard --preflight "$LANE" "$TITLE" 2>&1) || { echo "lane-guard --preflight refused: $G"; exit 5; }
# One writer per unit and per branch.
UL="$OPS/units/$SLUG.lock"; BLS=""
lock_take "$UL" || { echo "unit '$SLUG' already has a writer (pid $(lock_holder "$UL")); not starting"; exit 3; }
trap 'lock_drop "$UL"; for b in $BLS; do lock_drop "$b"; done' EXIT
ev queued "$LANE" "$TITLE (needs=$NEEDS, expected=${EXP}m)"
git -C "$REPO" fetch -q origin; TRIED=""; N=0
for L in $(cfg order "$LANE"); do
  N=$((N+1)); [ $N -gt 2 ] && break
  [ $N -gt 1 ] && { guard --dispatch "$L" >> "$OPS/logs/$ID-$L.log" 2>&1 || true; }   # requeue to next lane
  B=$BRANCH; [ $N -gt 1 ] && B="$BRANCH-$L"; WT="$WTR/$L-$SLUG"; LOG="$OPS/logs/$ID-$L.log"
  TRIED="$TRIED $L"; BL=$(branch_lock_dir "$B")
  lock_take "$BL" || { ev failed "$L" "branch $B has another writer (pid $(lock_holder "$BL"))"; continue; }; BLS="$BLS $BL"
  ev running "$L" "$WT"
  if [ ! -d "$WT" ]; then  # reuse an existing (unpushed) branch, else create it from BASE
    if git -C "$REPO" show-ref -q "refs/heads/$B"; then git -C "$REPO" worktree add -q "$WT" "$B"
    else git -C "$REPO" worktree add -q -b "$B" "$WT" "$BASE"; fi >> "$LOG" 2>&1 || { ev failed "$L" "worktree add failed"; continue; }
  fi
  [ -n "${LANE_SKIP_SETUP:-}" ] || (cd "$WT" && bash "$SD/wt-setup.sh") >> "$LOG" 2>&1
  [ -n "${LANE_PREV:-}" ] && sleep "${LANE_STAGGER:-20}"   # stagger agent launches (keychain race)
  LANE_PREV=$L
  run_agent "$L" "$WT" "$LOG" < /dev/null & AP=$!; LAST=$(date +%s); SIG=""
  while kill -0 $AP 2>/dev/null; do sleep "${LANE_POLL:-30}"   # liveness = new commit/push/change, not log mtime
    S=$(git -C "$WT" rev-parse HEAD; git -C "$WT" ls-remote origin "$B" 2>/dev/null; git -C "$WT" status --porcelain | shasum)
    [ "$S" != "$SIG" ] && { SIG=$S; LAST=$(date +%s); }
    if [ $(( $(date +%s) - LAST )) -gt $((EXP * 60)) ]; then ev STUCK "$L" "no commit/push/change for ${EXP}m; requeue"
      pkill -P $AP 2>/dev/null; kill $AP 2>/dev/null; break; fi
  done; wait $AP; rc=$?
  if [ $rc -ne 0 ]; then ev failed "$L" "agent rc=$rc"; continue; fi
  [ -n "$(git -C "$WT" log --oneline "$BASE"..HEAD)" ] || { echo "agent made no commit" >> "$LOG"; ev failed "$L" "no commit"; continue; }
  NT=$(git -C "$WT" log --format='%H%x09%(trailers:key=Lane,valueonly,separator=%x2C)' "$BASE"..HEAD | awk -F'\t' '$2==""' | wc -l | tr -d ' ')
  [ "$NT" = 0 ] || echo "warn: $NT lane commit(s) without a 'Lane:' trailer (committer name still says $L)" | tee -a "$LOG"
  CH=$(git -C "$WT" diff --shortstat "$BASE"...HEAD | awk '{print $4+$6}')
  if [ "${CH:-0}" -gt "${SIZE_CAP:-300}" ]; then echo "warn: $CH changed lines > ${SIZE_CAP:-300}" | tee -a "$LOG"
    git -C "$WT" log --format=%B "$BASE"..HEAD | grep -qE '^Size-reason: *[^ ]' || { ev failed "$L" "size $CH > cap, no Size-reason"; continue; }; fi
  [ -n "${LANE_DRY:-}" ] && { ev dry "$L" "checks passed; stopping before verify/push"; echo "DRY-OK $L"; exit 0; }
  (cd "$WT" && TI_BASE=$BASE VERIFY_SCOPE="$SCOPE" bash "$SD/verify.sh") >> "$LOG" 2>&1; VRC=$?
  [ -x ~/.local/bin/lane-guard ] && { ~/.local/bin/lane-guard --task-end "$L" "$ID" "$VRC" "$LOG" >> "$LOG" 2>&1 || true; }  # Carl's hook; non-fatal
  [ $VRC = 0 ] || { ev failed "$L" "verify failed"; continue; }
  git -C "$WT" push -q -u origin "$B" >> "$LOG" 2>&1 || { ev failed "$L" "push failed"; continue; }
  BODY="Task: $TITLE"$'\n'"Lane: $L ($(cfg lane "$L" agent)/$(cfg lane "$L" account)), tried:$TRIED"$'\n\n'
  BODY+="$(cat "$WT/.build/proof/summary.md")"$'\n\n'"$(publish_proof "$WT" "$ID" 2>>"$LOG")"
  LV=$(cat "$WT/.build/proof/level" 2>/dev/null || echo build-only); DRAFT=""
  case $LV in UI-verified|unit-test-verified) ;; build-only) ;; *) ev failed "$L" "level $LV"; continue;; esac
  [ "$LV" = build-only ] && { DRAFT=--draft; BODY="**Verification level: build-only, so this is NOT ready for review (draft).**"$'\n\n'"$BODY"; }
  URL=$(cd "$WT" && gh pr create $DRAFT -R "$SLUG_REPO" --head "$B" --base main --title "$(echo "$TASK" | head -1 | cut -c1-70)" --body "$BODY" 2>>"$LOG")
  [ -n "$URL" ] || { ev failed "$L" "gh pr create failed"; continue; }
  ev pr "$L" "$URL level=$LV"; printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$ID" "$URL" "$(git -C "$WT" rev-parse HEAD)" "$LV" >> "$OPS/results.tsv"
  echo "$URL ($LV)"; exit 0
done
ERR=$(tail -n 5 "$LOG" | tr '\t\n' '  ')
printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$TITLE" "${TRIED# }" "$ERR" "$LOG" >> "$OPS/failures.tsv"
echo "$(date '+%F %T') $ID: $TITLE (lanes:$TRIED) log $LOG" >> "$OPS/NEEDS_CODY"
ev needs_cody "${TRIED# }" "$LOG"; echo "FAILED after:$TRIED -> $OPS/NEEDS_CODY"; exit 1
