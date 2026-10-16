#!/bin/bash
# Serial FIFO post-approval merge gate.
#   merge-queue.sh enqueue <pr>  approved PR -> $MERGE_HOME/merge-queue/<ts>-pr<N>
#   merge-queue.sh run           drain the queue one PR at a time
#   merge-queue.sh status        list queued PRs
set -uo pipefail

SD=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$SD" rev-parse --show-toplevel)
. "$SD/support.sh"

# Preserve configured locations because pending merge and deployment state is valuable.
OPS=${MERGE_HOME:-${LANES_HOME:-$HOME/ops/lanes}}
WTR=${MERGE_WT_ROOT:-${LANES_WT:-$HOME/code/wt}}
MQ="$OPS/merge-queue"
EV="$OPS/events.tsv"
MAIN=${MERGE_MAIN_CHECKOUT:-$HOME/code/proj/Polymux}
SLUG_REPO=$(repo_slug "$REPO")
mkdir -p "$MQ/done" "$MQ/failed" "$MQ/blocked" "$OPS/logs"

event() {
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$1" "$2" merge "${3:-}" >> "$EV"
}

field() { sed -n "s/^$1: *//p" "$2" 2>/dev/null | head -1; }
branch_lock() { echo "$OPS/branches/$(echo "$1" | tr '/' '%').lock"; }

verdict_key() {
  if [ -n "${VERDICT_KEY_CMD:-}" ]; then
    bash -c "$VERDICT_KEY_CMD"
  else
    vault get "${VERDICT_KEY_TITLE:-Polymux review verdict HMAC}" 2>/dev/null |
      python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])'
  fi
}

reviewed_sha() {
  local comments result
  comments=$(mktemp)
  gh api "repos/$SLUG_REPO/issues/$1/comments" --paginate \
    --jq '.[] | {id, created_at, body, user: {login: .user.login}}' > "$comments" 2>>"$LOG" || {
      rm -f "$comments"
      return 1
    }
  result=$(verdict_key | python3 "$SD/verdict.py" newest "$1" "$comments" 2>>"$LOG")
  rm -f "$comments"
  case $result in
    "PASS "*) echo "${result#PASS }";;
    *) echo "approval: newest signed verdict: ${result:-none}" >> "$LOG"; return 1;;
  esac
}

# Accept the reviewed head plus clean, unedited merges from main.
merge_only() {
  local current=$2 count=0 parents tree rc
  git -C "$REPO" cat-file -e "$1^{commit}" 2>/dev/null || return 1
  while [ "$current" != "$1" ]; do
    count=$((count+1))
    [ $count -gt 20 ] && return 1
    parents=($(git -C "$REPO" rev-list --parents -n1 "$current"))
    [ ${#parents[@]} = 3 ] || {
      echo "approval: ${current:0:7} is not a merge" >> "$LOG"
      return 1
    }
    git -C "$REPO" merge-base --is-ancestor "${parents[2]}" origin/main || {
      echo "approval: ${current:0:7} merges a non-main parent" >> "$LOG"
      return 1
    }
    tree=$(git -C "$REPO" merge-tree --write-tree "${parents[1]}" "${parents[2]}" 2>/dev/null)
    rc=$?
    [ $rc = 0 ] || {
      echo "approval: ${current:0:7}: git merge-tree exit $rc (conflict or error), not clean" >> "$LOG"
      return 1
    }
    [ "$(printf '%s\n' "$tree" | head -1)" = "$(git -C "$REPO" rev-parse "$current^{tree}")" ] || {
      echo "approval: ${current:0:7} is not a clean auto-merge (manual edits)" >> "$LOG"
      return 1
    }
    current=${parents[1]}
  done
}

approved() {
  RS=$(reviewed_sha "$1") || return 1
  merge_only "$RS" "$2" || {
    echo "approval: head ${2:0:7} is not reviewed ${RS:0:7} plus merge-only commits" >> "$LOG"
    return 1
  }
}

deploy_main() {
  local deploy="$MAIN/scripts/deploy/deploy.py"
  local host="$MAIN/scripts/deploy/deploy_host.py"
  [ "$(git -C "$MAIN" rev-parse --abbrev-ref HEAD 2>/dev/null)" = main ] || return 1
  git -C "$MAIN" pull -q --ff-only origin main || return 1
  [ -f "$deploy" ] && [ -f "$host" ] || return 1
  git -C "$MAIN" diff --quiet HEAD -- scripts/deploy/deploy.py scripts/deploy/deploy_host.py || return 1
  python3 "$deploy" update --ref origin/main --receipt "$OPS/deployed.json"
}

case ${1:-} in
  enqueue)
    PR=${2:?pr number}
    ENTRY="$MQ/$(date +%Y%m%d%H%M%S)-pr$PR"
    ls "$MQ"/*-pr"$PR" >/dev/null 2>&1 && { echo "PR #$PR already queued"; exit 0; }
    JSON=$(gh pr view "$PR" -R "$SLUG_REPO" --json headRefName,state) || exit 1
    [ "$(echo "$JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["state"])')" = OPEN ] || {
      echo "PR #$PR is not open"
      exit 1
    }
    BRANCH=$(echo "$JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["headRefName"])')
    printf 'pr: %s\nbranch: %s\n' "$PR" "$BRANCH" > "$ENTRY.tmp" && mv "$ENTRY.tmp" "$ENTRY"
    LOG="$OPS/logs/merge-pr$PR.log"
    echo "$(date '+%F %T') approved; queued" >> "$LOG"
    event "pr$PR" approved "queued $ENTRY"
    echo "queued PR #$PR ($BRANCH)"
    ;;
  status)
    for entry in "$MQ"/*-pr*; do
      [ -f "$entry" ] && echo "$(basename "$entry"): $(field branch "$entry")"
    done
    true
    ;;
  run)
    MERGE_LOCK="$OPS/locks/merge-queue"
    lock_take "$MERGE_LOCK" || { echo "merge queue busy (pid $(lock_holder "$MERGE_LOCK"))"; exit 0; }
    trap 'lock_drop "$MERGE_LOCK"' EXIT
    latest=$(git -C "$REPO" ls-remote origin refs/heads/main 2>/dev/null | cut -f1)
    deployed=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("sha", ""))' "$OPS/deployed.json" 2>/dev/null || true)
    [ -z "$latest" ] || [ "$latest" = "$deployed" ] || touch "$OPS/deploy-pending"
    if [ -f "$OPS/deploy-pending" ]; then
      LOG="$OPS/logs/deploy-retry.log"
      if deploy_main >> "$LOG" 2>&1; then
        rm -f "$OPS/deploy-pending"
        event deploy deployed "pending main deployment verified"
      else
        event deploy deploy_failed "retry pending; see $LOG"
      fi
    fi
    for ENTRY in $(ls "$MQ"/*-pr* 2>/dev/null | sort); do
      PR=$(field pr "$ENTRY")
      BRANCH=$(field branch "$ENTRY")
      LOG="$OPS/logs/merge-pr$PR.log"
      WT="$WTR/merge-pr$PR"
      OK=0
      WHY=""
      echo "== $(date '+%F %T') merge queue: PR #$PR ($BRANCH)" >> "$LOG"
      event "pr$PR" running "$BRANCH"
      BRANCH_LOCK=$(branch_lock "$BRANCH")
      lock_take "$BRANCH_LOCK" || { echo "branch busy; retry next tick" >> "$LOG"; continue; }
      git -C "$REPO" fetch -q origin main "$BRANCH" >> "$LOG" 2>&1
      HEAD=$(git -C "$REPO" rev-parse -q --verify "origin/$BRANCH")
      if [ -z "$HEAD" ] || ! approved "$PR" "$HEAD"; then
        echo "BLOCKED: no valid signed Liam PASS for head ${HEAD:0:7}; not merging" >> "$LOG"
        event "pr$PR" blocked "no signed PASS for ${HEAD:0:7}"
        lock_drop "$BRANCH_LOCK"
        mv "$ENTRY" "$MQ/blocked/"
        continue
      fi
      echo "approval: signed PASS for ${RS:0:7}; head ${HEAD:0:7}" >> "$LOG"
      for round in 1 2 3; do
        git -C "$REPO" fetch -q origin main "$BRANCH" >> "$LOG" 2>&1 || { WHY="fetch failed"; break; }
        [ -d "$WT" ] || git -C "$REPO" worktree add -q --detach "$WT" "origin/$BRANCH" >> "$LOG" 2>&1 || { WHY="worktree add failed"; break; }
        git -C "$WT" checkout -q -B "$BRANCH" "origin/$BRANCH" >> "$LOG" 2>&1 || { WHY="checkout failed"; break; }
        git -C "$WT" merge -q --no-edit origin/main >> "$LOG" 2>&1 || { git -C "$WT" merge --abort; WHY="merge of main conflicts"; break; }
        git -C "$WT" push -q origin "HEAD:$BRANCH" >> "$LOG" 2>&1 || { WHY="push failed"; break; }
        SHA=$(git -C "$WT" rev-parse HEAD)
        approved "$PR" "$SHA" || { WHY="approval no longer valid at ${SHA:0:7}"; break; }
        ( export VERIFY_TARGETS=full; cd "$WT" && {
            [ -n "${MERGE_SKIP_SETUP:-}" ] || bash "$SD/../verify/wt-setup.sh"
          } && if [ -n "${MERGE_VERIFY_CMD:-}" ]; then
            bash -c "$MERGE_VERIFY_CMD"
          else
            TI_BASE=origin/main bash "$SD/../verify/verify.sh"
          fi ) >> "$LOG" 2>&1 || { WHY="re-verify failed at ${SHA:0:7}"; break; }
        LEVEL=$(cat "$WT/.build/proof/level" 2>/dev/null)
        case $LEVEL in UI-verified|unit-test-verified) ;; *) WHY="verification level missing or not mergeable (${LEVEL:-none}) at ${SHA:0:7}"; break;; esac
        git -C "$REPO" fetch -q origin main
        if git -C "$WT" merge-base --is-ancestor origin/main "$SHA" && [ "$(git -C "$REPO" ls-remote origin "refs/heads/$BRANCH" | cut -f1)" = "$SHA" ]; then
          approved "$PR" "$SHA" || { WHY="approval withdrawn during verify (newer FIX or new commit)"; break; }
          echo "re-verify on current main PASSED at $SHA (level $LEVEL); reviewed ${RS:0:7}. Squash-merging." >> "$LOG"
          gh pr merge "$PR" -R "$SLUG_REPO" --squash --match-head-commit "$SHA" >> "$LOG" 2>&1 && { OK=1; break; }
          WHY="gh pr merge refused"
          break
        fi
        echo "main moved during verify; round $((round+1))" >> "$LOG"
      done
      [ $OK = 0 ] && [ -z "$WHY" ] && WHY="main kept moving (3 rounds)"
      lock_drop "$BRANCH_LOCK"
      git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1
      if [ $OK = 1 ]; then
        event "pr$PR" merged "$SHA"
        mv "$ENTRY" "$MQ/done/"
        if deploy_main >> "$LOG" 2>&1; then
          rm -f "$OPS/deploy-pending"
          event "pr$PR" deployed "main verified on cvmini and cvmac"
        else
          echo "DEPLOY FAILED: check the installation error and retry scripts/deploy/deploy.py update" >> "$LOG"
          touch "$OPS/deploy-pending"
          event "pr$PR" deploy_failed "see $LOG"
          echo "$(date '+%F %T') deployment after PR #$PR failed; check $LOG and retry scripts/deploy/deploy.py update" >> "$OPS/NEEDS_CODY"
        fi
      else
        echo "FAILED: $WHY" >> "$LOG"
        event "pr$PR" failed "$WHY"
        echo "$(date '+%F %T') merge of PR #$PR failed: $WHY; see $LOG" >> "$OPS/NEEDS_CODY"
        mv "$ENTRY" "$MQ/failed/"
      fi
    done
    ;;
  *) sed -n '2,5p' "$0"; exit 2;;
esac
