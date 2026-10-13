#!/bin/bash
# run-lane.sh <lane> "<task>" [--branch B] [--base origin/main]
# run-lane.sh --verify-only <branch>     (Mac proof for cloud-agent PRs)
# Worktree -> headless agent -> our own verify.sh -> push + PR with proof.
# On failure the task fails over once to the next lane in agents/lanes.toml; after 2
# failures it writes ~/ops/lanes/failures.tsv + NEEDS_CODY. No daemon, no DB.
set -uo pipefail
REPO=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
OPS=${LANES_HOME:-$HOME/ops/lanes}; mkdir -p "$OPS/logs"; EV="$OPS/events.tsv"
ev() { printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$ID" "$1" "${2:-}" "${3:-}" >> "$EV"; }
cfg() { python3 "$REPO/scripts/lanes.py" "$@"; }
publish_proof() {  # $1 worktree, $2 tag -> prints markdown with raw media links
  local wt=$1 tag=$2 idx; idx=$(mktemp); local par
  git -C "$wt" fetch -q origin proof-media 2>/dev/null && par=$(git -C "$wt" rev-parse FETCH_HEAD)
  ( cd "$wt"; export GIT_INDEX_FILE=$idx
    [ -n "${par:-}" ] && git read-tree "$par" || git read-tree --empty
    for f in .build/proof/*.png .build/proof/*.mp4; do [ -f "$f" ] || continue
      git update-index --add --cacheinfo "100644,$(git hash-object -w "$f"),$tag/$(basename "$f")"; done
    c=$(git commit-tree "$(git write-tree)" ${par:+-p $par} -m "proof $tag")
    git push -q origin "$c:refs/heads/proof-media" ) >/dev/null 2>&1 || { echo "_media upload failed_"; return; }
  rm -f "$idx"; local u="https://github.com/CarlvinceTan/Polymux/raw/proof-media/$tag"
  for f in "$wt"/.build/proof/*.png; do [ -f "$f" ] && echo "![$(basename "$f")]($u/$(basename "$f"))"; done
  [ -f "$wt/.build/proof/ios.mp4" ] && echo "[iOS video]($u/ios.mp4)"
}
if [ "${1:-}" = "--verify-only" ]; then
  BR=$2; ID="verify-${BR//\//-}"; WT="$HOME/code/wt/$ID"; ev running verify "$BR"
  git -C "$REPO" fetch -q origin "$BR" && { [ -d "$WT" ] || git -C "$REPO" worktree add -q --detach "$WT" FETCH_HEAD; }
  git -C "$WT" checkout -q --detach FETCH_HEAD
  (cd "$WT" && bash "$REPO/scripts/wt-setup.sh" && bash "$REPO/scripts/verify.sh") > "$OPS/logs/$ID.log" 2>&1; rc=$?
  BODY="$(cat "$WT/.build/proof/summary.md")"$'\n\n'"$(publish_proof "$WT" "$ID")"
  gh pr comment "$BR" -R CarlvinceTan/Polymux --body "Mac proof (cvmini):"$'\n'"$BODY" && ev pr verify "$BR"
  [ $rc = 0 ] || ev failed verify "$BR"; exit $rc
fi
LANE=$1; TASK=$2; UNIT=$2; shift 2; BASE=origin/main; BRANCH=""; NEEDS=none; EXP=60
if [ -f "$TASK" ]; then  # task file: "needs: xcode|ios-sim|none", "expected_min: N", rest is the brief
  NEEDS=$(sed -n 's/^needs: *//p' "$TASK" | head -1); EXP=$(sed -n 's/^expected_min: *//p' "$TASK" | head -1)
  TASK=$(grep -vE '^(unit|needs|scope|expected_min):' "$TASK"); EXP=${EXP:-60}
fi
TARGET=${LANE_TARGET:-$(hostname -s)}   # dispatcher Xcode guard: refuse before any claim/worktree
bash "$REPO/scripts/dispatch-guard.sh" "$UNIT" "$TARGET" || exit 4
while [ $# -gt 0 ]; do case $1 in --branch) BRANCH=$2; shift 2;; --base) BASE=$2; shift 2;; *) shift;; esac; done
TITLE=$(echo "$TASK" | head -1); SLUG=$(echo "$TITLE" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | cut -c1-32 | sed 's/-$//')
ID="$(date +%m%d%H%M)-$SLUG"; BRANCH=${BRANCH:-agent/$SLUG}
PROMPT="Task: $TASK
Rules: work only in this worktree. Keep the change small and scoped. Build and test ONLY via
'bash "$REPO/scripts/verify.sh"' and iterate until it exits 0. Commit your work with a clear message.
Do not push and do not open a PR. Never skip, delete or weaken tests; a behaviour change
needs a test change (or a 'No-test-reason: ...' line in the commit). Keep it under ~300 changed lines. If you cannot make verify.sh pass, say why and stop."
run_agent() {  # $1 lane, $2 worktree, $3 log
  local a cmd; a=$(cfg lane "$1" agent); cmd=$(cfg lane "$1" cmd)
  case " ${LANE_FORCE_FAIL:-} " in *" $1 "*) echo "forced failure (LANE_FORCE_FAIL test)" >> "$3"; return 97;; esac
  [ -n "${LANE_STUB_CMD:-}" ] && { (cd "$2" && bash -c "$LANE_STUB_CMD") >> "$3" 2>&1; return; }  # test hook
  case $a in
    cursor) local K; K=$(vault get "$(cfg lane "$1" key)" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' 2>/dev/null) || { echo "vault read failed" >>"$3"; return 98; }
      (cd "$2" && "$cmd" -p --force --trust --workspace "$2" --api-key "$K" --output-format text "$PROMPT") >> "$3" 2>&1;;
    codex) (cd "$2" && "$cmd" exec --full-auto "$PROMPT") >> "$3" 2>&1;;
    opencode) (cd "$2" && "$cmd" run "$PROMPT") >> "$3" 2>&1;;
    *) echo "unknown agent $a" >> "$3"; return 99;;
  esac
}
# Stop rule: a brief that already failed twice goes to Cody, never straight back to an agent.
grep -qF "	$TITLE	" "$OPS/failures.tsv" 2>/dev/null && { echo "refusing: '$TITLE' already failed twice (see $OPS/failures.tsv); fix the brief"; exit 2; }
# One writer per unit: a second lane cannot start the same unit while this one holds it.
UL="$OPS/units/$SLUG.lock"; mkdir -p "$OPS/units"
if ! mkdir "$UL" 2>/dev/null; then kill -0 "$(cat "$UL/pid" 2>/dev/null)" 2>/dev/null && \
  { echo "unit '$SLUG' already has a writer (pid $(cat "$UL/pid")); not starting"; exit 3; }; rm -rf "$UL"; mkdir "$UL"; fi
ev queued "$LANE" "$TITLE (needs=$NEEDS, expected=${EXP}m)"; echo $$ > "$UL/pid"; trap 'rm -rf "$UL"' EXIT
git -C "$REPO" fetch -q origin; TRIED=""; N=0
for L in $(cfg order "$LANE"); do
  N=$((N+1)); [ $N -gt 2 ] && break
  B=$BRANCH; [ $N -gt 1 ] && B="$BRANCH-$L"; WT="$HOME/code/wt/$L-$SLUG"; LOG="$OPS/logs/$ID-$L.log"
  TRIED="$TRIED $L"; ev running "$L" "$WT"
  if [ ! -d "$WT" ]; then  # reuse an existing (unpushed) branch, else create it from BASE
    if git -C "$REPO" show-ref -q "refs/heads/$B"; then git -C "$REPO" worktree add -q "$WT" "$B"
    else git -C "$REPO" worktree add -q -b "$B" "$WT" "$BASE"; fi >> "$LOG" 2>&1 || { ev failed "$L" "worktree add failed"; continue; }
  fi
  (cd "$WT" && bash "$REPO/scripts/wt-setup.sh") >> "$LOG" 2>&1
  [ -n "${LANE_PREV:-}" ] && sleep "${LANE_STAGGER:-20}"   # stagger agent launches (keychain race)
  LANE_PREV=$L
  run_agent "$L" "$WT" "$LOG" < /dev/null & AP=$!; LAST=$(date +%s); SIG=""
  while kill -0 $AP 2>/dev/null; do sleep 30   # liveness = new commit/push/check, not log mtime
    S=$(git -C "$WT" rev-parse HEAD; git -C "$WT" ls-remote origin "$B" 2>/dev/null; git -C "$WT" status --porcelain | shasum)
    [ "$S" != "$SIG" ] && { SIG=$S; LAST=$(date +%s); }
    if [ $(( $(date +%s) - LAST )) -gt $((EXP * 60)) ]; then ev STUCK "$L" "no commit/push/change for ${EXP}m; requeue"
      pkill -P $AP 2>/dev/null; kill $AP 2>/dev/null; break; fi
  done; wait $AP; rc=$?
  if [ $rc -ne 0 ]; then ev failed "$L" "agent rc=$rc"; continue; fi
  [ -n "$(git -C "$WT" log --oneline "$BASE"..HEAD)" ] || { echo "agent made no commit" >> "$LOG"; ev failed "$L" "no commit"; continue; }
  CH=$(git -C "$WT" diff --shortstat "$BASE"...HEAD | awk '{print $4+$6}')
  if [ "${CH:-0}" -gt "${SIZE_CAP:-300}" ]; then echo "warn: $CH changed lines > ${SIZE_CAP:-300}" | tee -a "$LOG"
    git -C "$WT" log --format=%B "$BASE"..HEAD | grep -qE '^Size-reason: *[^ ]' || { ev failed "$L" "size $CH > cap, no Size-reason"; continue; }; fi
  [ -n "${LANE_DRY:-}" ] && { ev dry "$L" "checks passed; stopping before verify/push"; echo "DRY-OK $L"; exit 0; }
  (cd "$WT" && TI_BASE=$BASE bash "$REPO/scripts/verify.sh") >> "$LOG" 2>&1; VRC=$?
  [ -x ~/.local/bin/lane-guard ] && { ~/.local/bin/lane-guard --task-end "$L" "$ID" "$VRC" "$LOG" >> "$LOG" 2>&1 || true; }  # Carl's hook; non-fatal
  [ $VRC = 0 ] || { ev failed "$L" "verify failed"; continue; }
  git -C "$WT" push -q -u origin "$B" >> "$LOG" 2>&1 || { ev failed "$L" "push failed"; continue; }
  BODY="Task: $TITLE"$'\n'"Lane: $L ($(cfg lane "$L" agent)/$(cfg lane "$L" account)), tried:$TRIED"$'\n\n'
  BODY+="$(cat "$WT/.build/proof/summary.md")"$'\n\n'"$(publish_proof "$WT" "$ID")"
  LV=$(cat "$WT/.build/proof/level" 2>/dev/null || echo build-only); DRAFT=""
  case $LV in UI-verified|unit-test-verified) ;; build-only) ;; *) ev failed "$L" "level $LV"; continue;; esac
  [ "$LV" = build-only ] && { DRAFT=--draft; BODY="**Verification level: build-only, so this is NOT ready for review (draft).**"$'\n\n'"$BODY"; }
  URL=$(cd "$WT" && gh pr create $DRAFT -R CarlvinceTan/Polymux --head "$B" --base main --title "$(echo "$TASK" | head -1 | cut -c1-70)" --body "$BODY" 2>>"$LOG")
  [ -n "$URL" ] || { ev failed "$L" "gh pr create failed"; continue; }
  ev pr "$L" "$URL level=$LV"; printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$ID" "$URL" "$(git -C "$WT" rev-parse HEAD)" "$LV" >> "$OPS/results.tsv"
  echo "$URL ($LV)"; exit 0
done
ERR=$(tail -n 5 "$LOG" | tr '\t\n' '  ')
printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$TITLE" "${TRIED# }" "$ERR" "$LOG" >> "$OPS/failures.tsv"
echo "$(date '+%F %T') $ID: $TITLE (lanes:$TRIED) log $LOG" >> "$OPS/NEEDS_CODY"
ev needs_cody "${TRIED# }" "$LOG"; echo "FAILED after:$TRIED -> $OPS/NEEDS_CODY"; exit 1
