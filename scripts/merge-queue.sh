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
# Notion (board-update.sh) at each step: review (in review), approved, verify (re-verify level or failed), merged.
# On failure: a fix brief (original brief + branch + failure log tail) goes back to $OPS/queue for the PR's
# task lane, the card goes back to In Progress, and the queue moves on. Nothing else is blocked.
set -uo pipefail
SD=$(cd "$(dirname "$0")" && pwd); REPO=$(git -C "$SD/.." rev-parse --show-toplevel); . "$SD/lanelib.sh"
OPS=${LANES_HOME:-$HOME/ops/lanes}; WTR=${LANES_WT:-$HOME/code/wt}; MQ="$OPS/merge-queue"; EV="$OPS/events.tsv"
MAIN=${MERGE_MAIN_CHECKOUT:-$HOME/code/proj/Polymux}; SLUG_REPO=$(repo_slug "$REPO"); mkdir -p "$MQ/done" "$MQ/failed" "$OPS/logs"
ev() { printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$1" "$2" merge "${3:-}" >> "$EV"; }
BU() { [ -n "$UNIT" ] && bash "$SD/board-update.sh" "$@" >> "$LOG" 2>&1 || true; }
field() { sed -n "s/^$1: *//p" "$2" 2>/dev/null | head -1; }
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
    for round in 1 2 3; do
      git -C "$REPO" fetch -q origin main "$BR" >> "$LOG" 2>&1 || { WHY="fetch failed"; break; }
      [ -d "$WT" ] || git -C "$REPO" worktree add -q --detach "$WT" "origin/$BR" >> "$LOG" 2>&1 || { WHY="worktree add failed"; break; }
      git -C "$WT" checkout -q -B "$BR" "origin/$BR" >> "$LOG" 2>&1 || { WHY="checkout failed"; break; }
      git -C "$WT" merge -q --no-edit origin/main >> "$LOG" 2>&1 || { git -C "$WT" merge --abort; WHY="merge of main conflicts"; break; }
      git -C "$WT" push -q origin "HEAD:$BR" >> "$LOG" 2>&1 || { WHY="push failed"; break; }
      SHA=$(git -C "$WT" rev-parse HEAD)
      ( cd "$WT" && { [ -n "${LANE_SKIP_SETUP:-}" ] || bash "$SD/wt-setup.sh"; } && \
        if [ -n "${MERGE_VERIFY_CMD:-}" ]; then bash -c "$MERGE_VERIFY_CMD"; else TI_BASE=origin/main bash "$SD/verify.sh"; fi ) >> "$LOG" 2>&1 \
        || { WHY="re-verify failed at ${SHA:0:7}"; break; }
      CHK=$(field check "$TF"); [ -z "$CHK" ] || (cd "$WT" && bash -c "$CHK") >> "$LOG" 2>&1 || { WHY="key behaviour check failed: $CHK"; break; }
      LV=$(cat "$WT/.build/proof/level" 2>/dev/null || echo unit-test-verified); BU verify "$UNIT" "$LV"
      git -C "$REPO" fetch -q origin main
      if git -C "$WT" merge-base --is-ancestor origin/main "$SHA" && [ "$(git -C "$REPO" ls-remote origin "refs/heads/$BR" | cut -f1)" = "$SHA" ]; then
        gh pr comment "$PR" -R "$SLUG_REPO" --body "Merge lane: re-verify on current main PASSED at \`$SHA\` (level $LV$([ -n "$CHK" ] && echo ", key check passed")). Squash-merging." >> "$LOG" 2>&1
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
      gh pr comment "$PR" -R "$SLUG_REPO" --body "Merge lane: post-approval re-verify on current main FAILED ($WHY). Sent back to ${LN:-its lane} as a fix attempt; log \`$LOG\`." >> "$LOG" 2>&1
      Q="$OPS/queue/$(date +%m%d%H%M)-fix-pr$PR.task"
      { [ -f "$TF" ] && grep -vE '^(branch|lane):' "$TF" || echo "# Fix PR #$PR after post-approval re-verify"
        echo "branch: $BR"; [ -n "$LN" ] && echo "lane: $LN"
        printf '\n## Post-approval re-verify failed (merge lane)\n%s. Merge origin/main into this branch (no rebase or force-push), fix, verify, and push to PR #%s.\n```\n%s\n```\n' "$WHY" "$PR" "$(tail -n 40 "$LOG")"
      } > "$Q.tmp" && mv "$Q.tmp" "$Q"; mv "$E" "$MQ/failed/"
    fi
  done;;
*) sed -n '2,5p' "$0"; exit 2;;
esac
