#!/bin/bash
# batch.sh run [N]        plan, code in parallel, integrate, verify once, open ONE batch PR.
# batch.sh merged <bid>   after the batch PR merged: every card -> Completed.
# Batch mode (13 Oct 2026):
#  1. Plan: batch_plan.py picks up to N (default: number of batch_lanes, capped by max_units) queued
#     briefs whose scope: globs don't overlap, so there's one writer per file. Briefs move to $OPS/batches/<bid>/.
#  2. Code: one agent per card, in parallel, each in its own worktree and branch batch/<bid>/<slug>, on
#     batch_lanes (lane3 codex, lane2 cursor; key from lanes.toml key@host). batch_fallback (lane4) runs only
#     when a primary lane fails. Agents do light checks only (swift build / go build / targeted tests),
#     never verify.sh, so coding holds no build slot.
#  3. Integrate: a fresh branch batch/<bid>-v1 off origin/main, with each card merged in (--no-ff). One
#     wt-setup + verify.sh (takes a max_builds slot) + proof capture for the whole batch.
#  4. Verify FAIL: bisect. Fresh branches batch/<bid>-v2.. hold half the cards each, so nothing is ever
#     rebased or force-pushed. The card whose half fails alone is dropped and re-queued, and the rest are re-verified.
#  5. One PR for the verified set. The body has one section per card (card link, summary, evidence). The PR
#     link and Verification are written to every card at each step (start, pr, verify, merged).
set -uo pipefail
SD=$(cd "$(dirname "$0")" && pwd); REPO=$(git -C "$SD/.." rev-parse --show-toplevel); . "$SD/lanelib.sh"
OPS=${LANES_HOME:-$HOME/ops/lanes}; WTR=${LANES_WT:-$HOME/code/wt}; EV="$OPS/events.tsv"
SLUG_REPO=$(repo_slug "$REPO"); cfg() { python3 "$SD/lanes.py" "$@"; }
LANES=${BATCH_LANES:-$(cfg list batch_lanes)}; FALLBACK=${BATCH_FALLBACK:-$(cfg list batch_fallback)}
ev() { printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$1" "$2" "${3:-}" "${4:-}" >> "$EV"; }
BU() { bash "$SD/board-update.sh" "$@" >> "$BL" 2>&1 || true; }
slug_of() { head -1 "$1" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-*//' | cut -c1-32 | sed 's/-*$//'; }
brief() { grep -vE '^(unit|needs|scope|expected_min|card|branch|brief|queue-note):' "$1"; }
prompt() { echo "Task: $(brief "$2")
You are $1, one of several agents coding a batch in parallel; each owns different files.
Edit only files matching: $(sed -n 's/^scope: *//p' "$2" | head -1)
Light checks only: compile (swift build --package-path <pkg>, go build ./..., go vet on touched packages)
and targeted unit tests for what you changed. Do NOT run scripts/verify.sh, xcodebuild, or UI tests:
the batch gets one full build + verify after every agent finishes.
Commit with a clear message ending in the trailer 'Lane: $1/$(cfg lane "$1" agent)'. Do not push or open a PR.
Never skip, delete or weaken tests. Keep it under ~300 changed lines."; }
agent() {  # $1 lane $2 worktree $3 task file $4 log
  local a cmd P; a=$(cfg lane "$1" agent); cmd=$(cfg lane "$1" cmd); P=$(prompt "$1" "$3")
  export GIT_COMMITTER_NAME="$(git -C "$2" config user.name || echo agent) ($1/$a)"
  [ -n "${BATCH_STUB_CMD:-}" ] && { (cd "$2" && LANE="$1" bash -c "$BATCH_STUB_CMD") >> "$4" 2>&1; return; }   # test hook
  case $a in
    cursor) local K; K=$(vault get "$(cfg lane "$1" key)" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' 2>/dev/null) || { echo "vault read failed" >> "$4"; return 98; }
      (cd "$2" && CURSOR_API_KEY="$K" "$cmd" -p --force --trust --workspace "$2" --output-format text "$P") >> "$4" 2>&1;;
    codex) (cd "$2" && "$cmd" exec -s danger-full-access "$P") >> "$4" 2>&1;;
    opencode) (cd "$2" && "$cmd" run "$P") >> "$4" 2>&1;;
    *) echo "unknown agent $a" >> "$4"; return 99;;
  esac
}
code_card() {  # $1 primary lane, $2 task file. Writes $D/<slug>.ok when its branch has commits.
  local s L wt br log ul; s=$(slug_of "$2"); br="batch/$BID/$s"; log="$OPS/logs/$BID-$s.log"; ul="$OPS/units/$s.lock"
  lock_take "$ul" || { echo "unit $s busy" >> "$log"; return 1; }
  for L in $1 $FALLBACK; do
    guard --preflight "$L" "$(head -1 "$2")" >> "$log" 2>&1 || continue
    wt="$WTR/$L-$BID-$s"; git -C "$REPO" worktree add -q -B "$br" "$wt" origin/main >> "$log" 2>&1 || continue
    ev "$BID-$s" running "$L" "$wt"; BU start "$s"
    agent "$L" "$wt" "$2" "$log"; local rc=$?
    if [ $rc = 0 ] && [ -n "$(git -C "$wt" log --oneline origin/main..HEAD)" ]; then
      (cd "$wt" && scope_check origin/main "$(sed -n 's/^scope: *//p' "$2" | head -1)") >> "$log" 2>&1 \
        && { echo "$L" > "$D/$s.ok"; ev "$BID-$s" coded "$L" "$br"; lock_drop "$ul"; return 0; }
      ev "$BID-$s" failed "$L" "outside scope"
    else ev "$BID-$s" failed "$L" "agent rc=$rc or no commit"; fi
    git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1
  done; lock_drop "$ul"; return 1
}
integrate() {  # $1 fresh branch, rest: slugs. Sets IW. Conflicting cards -> $D/conflict. rc = verify.sh rc
  local b=$1 s; shift; IW="$WTR/${b//\//-}"
  git -C "$REPO" worktree add -q -B "$b" "$IW" origin/main >> "$BL" 2>&1 || return 2
  for s in "$@"; do git -C "$IW" merge -q --no-ff --no-edit "batch/$BID/$s" >> "$BL" 2>&1 \
    || { git -C "$IW" merge --abort; grep -qx "$s" "$D/conflict" 2>/dev/null || echo "$s" >> "$D/conflict"; ev "$BID" conflict "$s"; }; done
  (cd "$IW" && bash "$SD/wt-setup.sh" && TI_BASE=origin/main bash "$SD/verify.sh") >> "$OPS/logs/${b//\//-}.log" 2>&1
}
verify_set() { TRY=$(( $(cat "$D/try" 2>/dev/null || echo 0) + 1 )); echo $TRY > "$D/try"; ev "$BID" verify "v$TRY" "$*"; integrate "batch/$BID-v$TRY" "$@"; }
bisect() {  # cards known to fail together -> prints the culprit(s); halves on fresh branches
  [ $# -le 1 ] && { echo "$@"; return; }
  local h=$(( $# / 2 )) a b; a=("${@:1:$h}"); b=("${@:$((h+1))}")
  if verify_set "${a[@]}"; then bisect "${b[@]}"; else bisect "${a[@]}"; verify_set "${b[@]}" || bisect "${b[@]}"; fi
}
case ${1:-} in
run)
  MAXU=$(cfg get max_units); NL=$(echo $LANES | wc -w | tr -d ' '); N=${2:-$NL}; [ "$N" -gt "${MAXU:-3}" ] && N=$MAXU
  [ "$N" -gt "$NL" ] && N=$NL   # one card per lane
  BID="b$(date +%m%d%H%M)"; D="$OPS/batches/$BID"; mkdir -p "$D" "$OPS/logs" "$OPS/units"; BL="$OPS/logs/$BID.log"
  PLAN=$(python3 "$SD/batch_plan.py" "$N" "$OPS"/queue/*.task); [ -n "$PLAN" ] || { echo "batch: nothing batchable"; exit 0; }
  T0=$(date +%s); ev "$BID" batch planned "$(echo $PLAN | xargs -n1 basename | tr '\n' ' ')"
  git -C "$REPO" fetch -q origin
  i=0; set -- $LANES; for t in $PLAN; do mv "$t" "$D/"; f="$D/$(basename "$t")"; s=$(slug_of "$f")
    BU card "$s" "$f"; echo "$s	$f" >> "$D/cards"; L=${@:$((i+1)):1}; i=$((i+1))
    code_card "$L" "$f" & done; wait
  OK=(); while IFS=$'\t' read -r s f; do if [ -f "$D/$s.ok" ]; then OK+=("$s"); else cp "$f" "$OPS/queue/" ; ev "$BID" requeued "$s" "coding failed"; fi; done < "$D/cards"
  [ ${#OK[@]} = 0 ] && { echo "batch $BID: no card coded"; exit 1; }
  T1=$(date +%s)
  if ! verify_set "${OK[@]}"; then BAD=$(bisect "${OK[@]}")
    for s in $BAD; do f=$(awk -F'\t' -v s="$s" '$1==s{print $2}' "$D/cards"); cp "$f" "$OPS/queue/"; BU verify "$s" failed; ev "$BID" requeued "$s" "batch verify bisect"; done
    KEEP=(); for s in "${OK[@]}"; do case " $BAD " in *" $s "*) ;; *) KEEP+=("$s");; esac; done; OK=("${KEEP[@]}")
    [ ${#OK[@]} = 0 ] && { echo "batch $BID: every card failed verify"; exit 1; }
    verify_set "${OK[@]}" || { echo "batch $BID: re-verify failed; NEEDS_CODY"; echo "$(date '+%F %T') $BID re-verify failed: $BL" >> "$OPS/NEEDS_CODY"; exit 1; }
  fi
  for s in $(cat "$D/conflict" 2>/dev/null); do f=$(awk -F'\t' -v s="$s" '$1==s{print $2}' "$D/cards"); cp "$f" "$OPS/queue/"; done
  OK2=(); for s in "${OK[@]}"; do grep -qx "$s" "$D/conflict" 2>/dev/null || OK2+=("$s"); done; OK=("${OK2[@]}")
  T2=$(date +%s); TRY=$(cat "$D/try"); B="batch/$BID-v$TRY"; IW="$WTR/${B//\//-}"; LV=$(cat "$IW/.build/proof/level" 2>/dev/null || echo build-only)
  git -C "$IW" push -q -u origin "$B" >> "$BL" 2>&1 || { echo "push failed"; exit 1; }
  MEDIA=""; n=$(ls "$IW"/.build/proof/*.png "$IW"/.build/proof/*.mp4 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" != 0 ]; then idx=$(mktemp); ref="proof-media/$BID-$(date +%H%M%S)"
    ( cd "$IW" && export GIT_INDEX_FILE=$idx && git read-tree --empty && for m in .build/proof/*.png .build/proof/*.mp4; do [ -f "$m" ] && git update-index --add --cacheinfo "100644,$(git hash-object -w "$m"),$(basename "$m")"; done
      git push -q origin "$(git commit-tree "$(git write-tree)" -m "proof $BID"):refs/heads/$ref" ) >> "$BL" 2>&1 \
      && { (cd "$IW/.build/proof" && ls *.png *.mp4 2>/dev/null) > "$IW/.build/proof/uploaded"; echo "https://github.com/$SLUG_REPO/raw/$ref" > "$IW/.build/proof/url-base"
        for m in $(cat "$IW/.build/proof/uploaded"); do MEDIA+="![$m](https://github.com/$SLUG_REPO/raw/$ref/$m)"$'\n'; done; }; rm -f "$idx"; fi
  BODY="Batch $BID: ${#OK[@]} card(s), coded in parallel, then one verify on \`$B\` (level **$LV**)."$'\n\n'
  for s in "${OK[@]}"; do f=$(awk -F'\t' -v s="$s" '$1==s{print $2}' "$D/cards")
    BODY+="## $(head -1 "$f" | sed 's/^# *//')"$'\n'"Card: $(sed -n 's/^card: *//p' "$f" | head -1)"$'\n'"Lane: $(cat "$D/$s.ok")"$'\n\n'
    BODY+="$(git -C "$IW" log --format='- %s' "origin/main..batch/$BID/$s" --no-merges)"$'\n\n'
    BODY+="Evidence: batch verify **$LV**; scope check passed; diff \`$(git -C "$IW" diff --shortstat "origin/main...batch/$BID/$s")\`"$'\n\n'; done
  BODY+="## Batch verify"$'\n'"$(cat "$IW/.build/proof/summary.md" 2>/dev/null)"$'\n\n'"$MEDIA"$'\n'
  [ -s "$D/conflict" ] && BODY+="Re-queued (merge conflict): $(tr '\n' ' ' < "$D/conflict")"$'\n\n'
  BODY+="Release Notes:"$'\n\n'"- $(for s in "${OK[@]}"; do head -1 "$(awk -F'\t' -v s="$s" '$1==s{print $2}' "$D/cards")" | sed 's/^# *//; s/:.*//'; done | paste -sd, - | sed 's/,/, /g'): $(for s in "${OK[@]}"; do head -1 "$(awk -F'\t' -v s="$s" '$1==s{print $2}' "$D/cards")" | sed 's/^[^:]*: *//'; done | paste -sd';' - | sed 's/;/; /g')."
  DR=""; [ "$LV" = build-only ] && DR=--draft
  URL=$(cd "$IW" && gh pr create $DR -R "$SLUG_REPO" --head "$B" --base main --title "Batch $BID: $(printf '%s ' "${OK[@]}" | cut -c1-55)" --body "$BODY" 2>>"$BL")
  [ -n "$URL" ] || { echo "gh pr create failed"; exit 1; }
  for s in "${OK[@]}"; do BU pr "$s" "$URL"; BU verify "$s" "$LV" "$IW/.build/proof" "$(cat "$IW/.build/proof/url-base" 2>/dev/null)"; done
  printf '%s\n' "${OK[@]}" > "$D/in-pr"; echo "$URL" > "$D/pr"
  ev "$BID" pr batch "$URL level=$LV cards=${#OK[@]} code=$((T1-T0))s verify=$((T2-T1))s"
  echo "$URL ($LV) cards=${#OK[@]} code=$((T1-T0))s verify=$((T2-T1))s";;
merged)
  BID=$2; D="$OPS/batches/$BID"; BL="$OPS/logs/$BID.log"
  [ -n "$(gh pr view "$(cat "$D/pr")" -R "$SLUG_REPO" --json mergedAt --jq '.mergedAt // empty')" ] || { echo "not merged yet"; exit 1; }
  for s in $(cat "$D/in-pr"); do BU merged "$s"; done; ev "$BID" merged batch "$(cat "$D/pr")";;
*) sed -n '2,3p' "$0"; exit 2;;
esac
