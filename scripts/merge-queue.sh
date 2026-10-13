#!/bin/bash
# merge-queue.sh: the 'merge' lane. Script only, no model agent. Serial FIFO post-approval gate.
#   merge-queue.sh enqueue <pr> [task-file]   approved PR -> $OPS/merge-queue/<ts>-pr<N> (Notion: approved)
#   merge-queue.sh run                       drain the queue one PR at a time (launchd tick or by hand)
#   merge-queue.sh status                    list queued PRs
# Task lanes (lane3 codex, lane2 cursor) only code, verify in their worktree and attach proof; they never merge.
# For each entry, under $OPS/locks/merge-lane (one runner at a time):
#   1. Merge origin/main into the PR branch (git merge, never rebase or force-push) and push it.
#   2. Re-verify at that head: verify.sh (takes a max_builds slot like any lane), then the card's
#      key behaviour check: the brief's 'check:' command line, if any.
#   3. Gate: the head contains current origin/main AND verify passed at exactly that sha. If main moved
#      meanwhile, go back to 1. Then: gh pr merge --squash --match-head-commit <sha>.
#   4. Fast-forward the cvmini main checkout (only when it's on main; --ff-only).
# Approval gate (before step 1, again after each merge of main, and again just before the merge):
#   Every account posts as CarlvinceTan, so a comment's author proves nothing. Only a SIGNED verdict counts:
#   scripts/review-verdict.sh (Liam's tooling) posts "Liam: PASS — head <sha7>" plus
#   <!-- verdict:v1 pr= sha= v= mac= --> with mac = HMAC-SHA256(vault key, "pr|sha|PASS"); see verdict.py.
#   The NEWEST valid verdict must be PASS (a later valid FIX blocks). Unsigned/forged comments and this
#   queue's own output are ignored. The queue posts no PR comments (it logs to $OPS/logs/merge-pr<N>.log).
#   Reviewed sha R must be the PR head, or the head must be reached from R only by clean merges of main:
#   walking first parents from head to R, every commit is a 2-parent merge whose 2nd parent is on
#   origin/main and whose tree equals `git merge-tree --write-tree p1 p2` (no conflict, no manual edits).
#   Any other new commit voids the approval (needs a fresh review). Not approved -> $MQ/blocked/, no fix brief.
#   Limit: the merge lane holds the same vault key; anything that can read that vault entry can sign.
#   Task lanes never read it (run-lane.sh only reads lane keys).
# Notion (board-update.sh) at each step: review (in review), approved, verify (re-verify level or failed), merged.
# On failure: a fix brief (original brief + branch + failure log tail) goes back to $OPS/queue for the PR's
# task lane, the card goes back to In Progress, and the queue moves on. Nothing else is blocked.
set -uo pipefail
SD=$(cd "$(dirname "$0")" && pwd); REPO=$(git -C "$SD/.." rev-parse --show-toplevel); . "$SD/lanelib.sh"
OPS=${LANES_HOME:-$HOME/ops/lanes}; WTR=${LANES_WT:-$HOME/code/wt}; MQ="$OPS/merge-queue"; EV="$OPS/events.tsv"
MAIN=${MERGE_MAIN_CHECKOUT:-$HOME/code/proj/Polymux}; SLUG_REPO=$(repo_slug "$REPO"); mkdir -p "$MQ/done" "$MQ/failed" "$MQ/blocked" "$OPS/logs"
ev() { printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$1" "$2" merge "${3:-}" >> "$EV"; }
BU() { [ -n "$UNIT" ] && bash "$SD/board-update.sh" "$@" >> "$LOG" 2>&1 || true; }
field() { sed -n "s/^$1: *//p" "$2" 2>/dev/null | head -1; }
QMARK="<!-- polymux-merge-queue -->"   # tags anything the queue ever writes to GitHub; verdict.py ignores it
verdict_key() { if [ -n "${VERDICT_KEY_CMD:-}" ]; then bash -c "$VERDICT_KEY_CMD"; else
  vault get "${VERDICT_KEY_TITLE:-Polymux review verdict HMAC}" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])'; fi; }
reviewed_sha() {  # $1 pr -> prints the sha of the newest valid signed verdict if it is PASS; else fails
  local f r; f=$(mktemp)
  gh api "repos/$SLUG_REPO/issues/$1/comments" --paginate --jq '.[] | {id, created_at, body, user: {login: .user.login}}' > "$f" 2>>"$LOG" || { rm -f "$f"; return 1; }
  r=$(verdict_key | python3 "$SD/verdict.py" newest "$1" "$f" 2>>"$LOG"); rm -f "$f"
  case $r in "PASS "*) echo "${r#PASS }";; *) echo "approval: newest signed verdict: ${r:-none}" >> "$LOG"; return 1;; esac; }
merge_only() {  # $1 reviewed sha, $2 head: head == R, or reached from R only by clean, unedited merges of main
  local c=$2 n=0 p; git -C "$REPO" cat-file -e "$1^{commit}" 2>/dev/null || return 1
  while [ "$c" != "$1" ]; do n=$((n+1)); [ $n -gt 20 ] && return 1
    p=($(git -C "$REPO" rev-list --parents -n1 "$c")); [ ${#p[@]} = 3 ] || { echo "approval: ${c:0:7} is not a merge" >> "$LOG"; return 1; }
    git -C "$REPO" merge-base --is-ancestor "${p[2]}" origin/main || { echo "approval: ${c:0:7} merges a non-main parent" >> "$LOG"; return 1; }
    local mt mrc; mt=$(git -C "$REPO" merge-tree --write-tree "${p[1]}" "${p[2]}" 2>/dev/null); mrc=$?   # 1 = conflicts, >1 = error
    [ $mrc = 0 ] || { echo "approval: ${c:0:7}: git merge-tree exit $mrc (conflict or error), not clean" >> "$LOG"; return 1; }
    [ "$(printf '%s\n' "$mt" | head -1)" = "$(git -C "$REPO" rev-parse "$c^{tree}")" ] ||
      { echo "approval: ${c:0:7} is not a clean auto-merge (manual edits)" >> "$LOG"; return 1; }
    c=${p[1]}; done; }
approved() {  # $1 pr, $2 head -> sets RS
  RS=$(reviewed_sha "$1") || return 1; merge_only "$RS" "$2" || { echo "approval: head ${2:0:7} is not reviewed ${RS:0:7} plus merge-only commits" >> "$LOG"; return 1; }; }
# fix_brief PR BRANCH LANE TASKFILE WHY LOG: a fix brief that passes queue-write --check: "# title" first, then
# needs:/type:/expected_min: (from the task file when it has them), pr:, branch:, lane:, then the brief body and failure tail.
fix_brief() { local pr=$1 br=$2 ln=$3 tf=$4 why=$5 log=$6 t="" tl="" nd="" ty="" ex="" h='^(unit|needs|scope|expected_min|card|issue|labels|branch|after|pr|priority|type|area|lane):'
  if [ -n "$tf" ] && [ -f "$tf" ]; then tl=$(grep -m1 -E '^# [^ ]' "$tf"); t=$tl
    # no "# " title: the first non-header, non-blank line is the title (as run-lane reads it)
    [ -n "$t" ] || { tl=$(grep -vE "$h" "$tf" | grep -m1 -vE '^[[:space:]]*$'); [ -n "$tl" ] && t="# $tl"; }
    nd=$(sed -n 's/^needs: *//p' "$tf" | head -1); ty=$(sed -n 's/^type: *//p' "$tf" | head -1); ex=$(sed -n 's/^expected_min: *\([0-9][0-9]*\) *$/\1/p' "$tf" | head -1); fi
  echo "${t:-# Fix PR #$pr after post-approval re-verify}"
  echo "needs: ${nd:-none}"; echo "type: ${ty:-bug}"; echo "expected_min: ${ex:-60}"; echo "pr: $pr"; echo "branch: $br"; [ -n "$ln" ] && echo "lane: $ln"
  # every other header of the original brief (scope, unit, card/issue, labels, after, area, priority) carried as-is
  [ -n "$tf" ] && [ -f "$tf" ] && grep -E '^(unit|scope|card|issue|labels|after|area|priority):' "$tf"
  if [ -n "$tl" ]; then echo; grep -vE "$h" "$tf" | awk -v t="$tl" '!d && $0 == t { d = 1; next } { print }'; fi
  printf '\n## Post-approval re-verify failed (merge lane)\n%s. Merge origin/main into this branch (no rebase or force-push), fix, verify, and push to PR #%s.\n```\n%s\n```\n' "$why" "$pr" "$(tail -n 40 "$log")"; }
case ${1:-} in
enqueue)
  PR=${2:?pr number}; TF=${3:-}; E="$MQ/$(date +%Y%m%d%H%M%S)-pr$PR"
  ls "$MQ"/*-pr"$PR" >/dev/null 2>&1 && { echo "PR #$PR already queued"; exit 0; }
  J=$(gh pr view "$PR" -R "$SLUG_REPO" --json headRefName,state,body) || exit 1
  [ "$(echo "$J" | python3 -c 'import json,sys; print(json.load(sys.stdin)["state"])')" = OPEN ] || { echo "PR #$PR is not open"; exit 1; }
  BR=$(echo "$J" | python3 -c 'import json,sys; print(json.load(sys.stdin)["headRefName"])')
  LN=$(echo "$J" | python3 -c 'import json,re,sys; m=re.search(r"^Lane: (lane\d+)",json.load(sys.stdin)["body"] or "",re.M); print(m.group(1) if m else "")')
  U=""; [ -n "$TF" ] && U=$(head -1 "$TF" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-*//' | cut -c1-32 | sed 's/-*$//')
  printf 'pr: %s\nbranch: %s\nlane: %s\nunit: %s\ntask: %s\n' "$PR" "$BR" "$LN" "$U" "$TF" > "$E.tmp" && mv "$E.tmp" "$E"
  UNIT=$U; LOG="$OPS/logs/merge-pr$PR.log"; BU review "$U"; echo "$(date '+%F %T') approved; queued" >> "$LOG"
  ev "pr$PR" approved "queued $E"; echo "queued PR #$PR ($BR)";;
status) for e in "$MQ"/*-pr*; do [ -f "$e" ] && echo "$(basename "$e"): $(field branch "$e")"; done; true;;
run)
  ML="$OPS/locks/merge-lane"; lock_take "$ML" || { echo "merge lane busy (pid $(lock_holder "$ML"))"; exit 0; }
  trap 'lock_drop "$ML"' EXIT
  for E in $(ls "$MQ"/*-pr* 2>/dev/null | sort); do
    PR=$(field pr "$E"); BR=$(field branch "$E"); UNIT=$(field unit "$E"); TF=$(field task "$E"); LN=$(field lane "$E")
    LOG="$OPS/logs/merge-pr$PR.log"; WT="$WTR/merge-pr$PR"; OK=0; WHY=""
    echo "== $(date '+%F %T') merge lane: PR #$PR ($BR)" >> "$LOG"; ev "pr$PR" running "$BR"
    BLK=$(branch_lock_dir "$BR"); lock_take "$BLK" || { echo "branch busy; retry next tick" >> "$LOG"; continue; }
    git -C "$REPO" fetch -q origin main "$BR" >> "$LOG" 2>&1; H0=$(git -C "$REPO" rev-parse -q --verify "origin/$BR")
    if [ -z "$H0" ] || ! approved "$PR" "$H0"; then
      echo "BLOCKED: no valid signed Liam PASS for head ${H0:0:7}; not merging (re-enqueue after review)" >> "$LOG"
      ev "pr$PR" blocked "no signed PASS for ${H0:0:7}"; lock_drop "$BLK"; mv "$E" "$MQ/blocked/"; continue; fi
    echo "approval: signed PASS for ${RS:0:7}; head ${H0:0:7}" >> "$LOG"
    for round in 1 2 3; do
      git -C "$REPO" fetch -q origin main "$BR" >> "$LOG" 2>&1 || { WHY="fetch failed"; break; }
      [ -d "$WT" ] || git -C "$REPO" worktree add -q --detach "$WT" "origin/$BR" >> "$LOG" 2>&1 || { WHY="worktree add failed"; break; }
      git -C "$WT" checkout -q -B "$BR" "origin/$BR" >> "$LOG" 2>&1 || { WHY="checkout failed"; break; }
      git -C "$WT" merge -q --no-edit origin/main >> "$LOG" 2>&1 || { git -C "$WT" merge --abort; WHY="merge of main conflicts"; break; }
      git -C "$WT" push -q origin "HEAD:$BR" >> "$LOG" 2>&1 || { WHY="push failed"; break; }
      SHA=$(git -C "$WT" rev-parse HEAD)
      approved "$PR" "$SHA" || { WHY="approval no longer valid at ${SHA:0:7}"; break; }
      # Merge lane always verifies everything: an inherited VERIFY_TARGETS=affected must never narrow it.
      ( export VERIFY_TARGETS=full; cd "$WT" && { [ -n "${LANE_SKIP_SETUP:-}" ] || bash "$SD/wt-setup.sh"; } && \
        if [ -n "${MERGE_VERIFY_CMD:-}" ]; then bash -c "$MERGE_VERIFY_CMD"; else TI_BASE=origin/main bash "$SD/verify.sh"; fi ) >> "$LOG" 2>&1 \
        || { WHY="re-verify failed at ${SHA:0:7}"; break; }
      CHK=$(field check "$TF"); [ -z "$CHK" ] || (cd "$WT" && bash -c "$CHK") >> "$LOG" 2>&1 || { WHY="key behaviour check failed: $CHK"; break; }
      LV=$(cat "$WT/.build/proof/level" 2>/dev/null)
      case $LV in UI-verified|unit-test-verified) ;; *) WHY="verification level missing or not mergeable (${LV:-none}) at ${SHA:0:7}"; break;; esac
      BU verify "$UNIT" "$LV"
      git -C "$REPO" fetch -q origin main
      if git -C "$WT" merge-base --is-ancestor origin/main "$SHA" && [ "$(git -C "$REPO" ls-remote origin "refs/heads/$BR" | cut -f1)" = "$SHA" ]; then
        approved "$PR" "$SHA" || { WHY="approval withdrawn during verify (newer FIX or new commit)"; break; }
        echo "re-verify on current main PASSED at $SHA (level $LV$([ -n "$CHK" ] && echo ", key check passed")); reviewed ${RS:0:7}. Squash-merging." >> "$LOG"
        gh pr merge "$PR" -R "$SLUG_REPO" --squash --match-head-commit "$SHA" >> "$LOG" 2>&1 && { OK=1; break; }
        WHY="gh pr merge refused"; break
      fi
      echo "main moved during verify; round $((round+1))" >> "$LOG"
    done
    [ $OK = 0 ] && [ -z "$WHY" ] && WHY="main kept moving (3 rounds)"
    lock_drop "$BLK"; git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1
    if [ $OK = 1 ]; then
      BU merged "$UNIT"; ev "pr$PR" merged "$SHA"; mv "$E" "$MQ/done/"
      [ "$(git -C "$MAIN" rev-parse --abbrev-ref HEAD)" = main ] && git -C "$MAIN" pull -q --ff-only origin main >> "$LOG" 2>&1
    else
      echo "FAILED: $WHY" >> "$LOG"; BU verify "$UNIT" failed; BU requeued "$UNIT"; ev "pr$PR" failed "$WHY"
      echo "post-approval re-verify FAILED ($WHY); fix brief sent back to ${LN:-its lane}" >> "$LOG"
      mkdir -p "$OPS/queue"; Q="$OPS/queue/$(date +%m%d%H%M)-fix-pr$PR.task"; fix_brief "$PR" "$BR" "$LN" "$TF" "$WHY" "$LOG" > "$Q.tmp"
      if [ -f "$SD/queue-write.sh" ] && ! bash "$SD/queue-write.sh" --check "$Q.tmp" >> "$LOG" 2>&1; then   # never queue a brief the lanes would reject
        mkdir -p "$OPS/queue-hold"; mv "$Q.tmp" "$OPS/queue-hold/$(basename "$Q")"; echo "fix brief failed queue-write --check; held in queue-hold/" >> "$LOG"
        echo "$(date '+%F %T') merge-lane: fix brief for PR #$PR failed queue-write --check; held in $OPS/queue-hold/$(basename "$Q") (log $LOG)" >> "$OPS/NEEDS_CODY"
      else mv "$Q.tmp" "$Q"; fi; mv "$E" "$MQ/failed/"
    fi
  done;;
*) sed -n '2,5p' "$0"; exit 2;;
esac
