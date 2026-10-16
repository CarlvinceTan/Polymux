#!/bin/bash
# Serial gate for the repository's only pull request topology: dev -> main.
#   merge-queue.sh enqueue <pr>  approved promotion -> $MERGE_HOME/merge-queue/<ts>-pr<N>
#   merge-queue.sh run           verify and squash-promote dev, then realign dev to main
#   merge-queue.sh status        list queued promotions
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

write_entry() {
  local entry=$1 pr=$2 head=$3 media=$4 phase=$5 main_before=${6:-}
  {
    printf 'pr: %s\nhead: %s\nmedia: %s\nphase: %s\n' "$pr" "$head" "$media" "$phase"
    [ -z "$main_before" ] || printf 'main-before: %s\n' "$main_before"
  } > "$entry.tmp" && mv "$entry.tmp" "$entry"
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

approved() {
  RS=$(reviewed_sha "$1") || return 1
  [ "$RS" = "$2" ] || {
    echo "approval: dev head ${2:0:7} is not reviewed ${RS:0:7}" >> "$LOG"
    return 1
  }
}

pr_json() {
  gh pr view "$1" -R "$SLUG_REPO" --json state,isDraft,isCrossRepository,headRefName,baseRefName,headRefOid
}

valid_promotion() {
  python3 -c 'import json,sys
p=json.load(sys.stdin)
ok=(p.get("state")=="OPEN" and not p.get("isDraft") and not p.get("isCrossRepository") and
    p.get("headRefName")=="dev" and p.get("baseRefName")=="main")
raise SystemExit(0 if ok else 1)'
}

json_field() {
  python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"
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

sync_dev() {
  local main_sha=$1 expected_dev=$2 remote_dev
  remote_dev=$(git -C "$REPO" ls-remote origin refs/heads/dev 2>/dev/null | cut -f1)
  case $remote_dev in
    "") git -C "$REPO" push -q origin "$main_sha:refs/heads/dev";;
    "$main_sha") return 0;;
    "$expected_dev") git -C "$REPO" push -q --force-with-lease="refs/heads/dev:$expected_dev" origin "$main_sha:refs/heads/dev";;
    *) echo "dev moved after promotion: ${remote_dev:0:7}, expected ${expected_dev:0:7}" >> "$LOG"; return 1;;
  esac
}

case ${1:-} in
  enqueue)
    PR=${2:?pr number}
    ENTRY="$MQ/$(date +%Y%m%d%H%M%S)-pr$PR"
    ls "$MQ"/*-pr"$PR" >/dev/null 2>&1 && { echo "PR #$PR already queued"; exit 0; }
    JSON=$(pr_json "$PR") || exit 1
    if ! printf '%s' "$JSON" | valid_promotion; then
      echo "PR #$PR must be an open, non-draft dev -> main promotion"
      exit 1
    fi
    HEAD=$(printf '%s' "$JSON" | json_field headRefOid)
    MEDIA=${MERGE_MEDIA_DIR:-$REPO/.build/captures}
    case $MEDIA in /*) ;; *) MEDIA="$REPO/$MEDIA";; esac
    write_entry "$ENTRY" "$PR" "$HEAD" "$MEDIA" queued
    LOG="$OPS/logs/merge-pr$PR.log"
    echo "$(date '+%F %T') approved; queued dev -> main at ${HEAD:0:7}" >> "$LOG"
    event "pr$PR" approved "queued $ENTRY"
    echo "queued PR #$PR (dev -> main at ${HEAD:0:7})"
    ;;
  status)
    for entry in "$MQ"/*-pr*; do
      [ -f "$entry" ] && echo "$(basename "$entry"): dev at $(field head "$entry")"
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
    for ENTRY in $(find "$MQ" -maxdepth 1 -type f -name '*-pr*' -print | sort); do
      PR=$(field pr "$ENTRY")
      QUEUED=$(field head "$ENTRY")
      MEDIA=$(field media "$ENTRY")
      PHASE=$(field phase "$ENTRY")
      MAIN_BEFORE=$(field main-before "$ENTRY")
      [ -n "$MEDIA" ] || MEDIA="$REPO/.build/captures"
      [ -n "$PHASE" ] || PHASE=queued
      LOG="$OPS/logs/merge-pr$PR.log"
      WT="$WTR/merge-pr$PR"
      OK=0
      WHY=""
      PENDING=""
      SHA=""
      echo "== $(date '+%F %T') promotion queue: PR #$PR ($PHASE)" >> "$LOG"
      event "pr$PR" running "dev -> main ($PHASE)"
      if [ "$PHASE" = queued ]; then
        JSON=$(pr_json "$PR" 2>>"$LOG") || JSON=""
        if ! printf '%s' "$JSON" | valid_promotion; then
          WHY="PR is not an open, non-draft dev -> main promotion"
        else
          SHA=$(printf '%s' "$JSON" | json_field headRefOid)
        fi
        git -C "$REPO" fetch -q origin main dev >> "$LOG" 2>&1 || WHY="fetch failed"
        [ -n "$WHY" ] || [ "$SHA" = "$QUEUED" ] || WHY="dev moved after queueing"
        [ -n "$WHY" ] || [ "$(git -C "$REPO" rev-parse -q --verify origin/dev)" = "$SHA" ] || WHY="GitHub head does not match origin/dev"
        if [ -z "$WHY" ] && ! approved "$PR" "$SHA"; then
          WHY="no valid signed PASS for dev head ${SHA:0:7}"
        fi
        if [ -z "$WHY" ] && ! git -C "$REPO" merge-base --is-ancestor origin/main "$SHA"; then
          WHY="dev is not based on current main"
        fi
        MAIN_BEFORE=$(git -C "$REPO" rev-parse -q --verify origin/main)
        if [ -z "$WHY" ]; then
          git -C "$REPO" worktree add -q --detach "$WT" "$SHA" >> "$LOG" 2>&1 || WHY="worktree add failed"
        fi
        if [ -z "$WHY" ]; then
          ( export VERIFY_TARGETS=full VERIFY_MEDIA_DIR="$MEDIA"; cd "$WT" && {
              [ -n "${MERGE_SKIP_SETUP:-}" ] || bash "$SD/../verify/wt-setup.sh"
            } && if [ -n "${MERGE_VERIFY_CMD:-}" ]; then
              bash -c "$MERGE_VERIFY_CMD"
            else
              TI_BASE=origin/main bash "$SD/../verify/verify.sh"
            fi ) >> "$LOG" 2>&1 || WHY="re-verify failed at ${SHA:0:7}"
        fi
        LEVEL=$(cat "$WT/.build/proof/level" 2>/dev/null)
        if [ -z "$WHY" ]; then
          case $LEVEL in UI-verified|unit-test-verified) ;; *) WHY="verification level missing or not mergeable (${LEVEL:-none}) at ${SHA:0:7}";; esac
        fi
        git -C "$REPO" fetch -q origin main dev >> "$LOG" 2>&1 || [ -n "$WHY" ] || WHY="final fetch failed"
        [ -n "$WHY" ] || [ "$(git -C "$REPO" rev-parse origin/main)" = "$MAIN_BEFORE" ] || WHY="main moved during verification"
        [ -n "$WHY" ] || [ "$(git -C "$REPO" rev-parse origin/dev)" = "$SHA" ] || WHY="dev moved during verification"
        if [ -z "$WHY" ] && ! approved "$PR" "$SHA"; then
          WHY="approval withdrawn during verification"
        fi
        if [ -z "$WHY" ]; then
          echo "re-verify PASSED at $SHA (level $LEVEL); squash-promoting dev to main" >> "$LOG"
          write_entry "$ENTRY" "$PR" "$SHA" "$MEDIA" submitting "$MAIN_BEFORE"
          PHASE=submitting
          if gh pr merge "$PR" -R "$SLUG_REPO" --squash --match-head-commit "$SHA" >> "$LOG" 2>&1; then
            write_entry "$ENTRY" "$PR" "$SHA" "$MEDIA" merged "$MAIN_BEFORE"
            PHASE=merged
          else
            JSON=$(pr_json "$PR" 2>>"$LOG") || JSON=""
            case $(printf '%s' "$JSON" | json_field state 2>/dev/null) in
              MERGED) write_entry "$ENTRY" "$PR" "$SHA" "$MEDIA" merged "$MAIN_BEFORE"; PHASE=merged;;
              OPEN) WHY="gh pr merge refused";;
              *) PENDING="merge result is ambiguous; inspect PR #$PR";;
            esac
          fi
        fi
      elif [ "$PHASE" = submitting ]; then
        JSON=$(pr_json "$PR" 2>>"$LOG") || JSON=""
        case $(printf '%s' "$JSON" | json_field state 2>/dev/null) in
          MERGED) write_entry "$ENTRY" "$PR" "$QUEUED" "$MEDIA" merged "$MAIN_BEFORE"; PHASE=merged;;
          OPEN) WHY="merge submission did not complete";;
          *) PENDING="merge result is ambiguous; inspect PR #$PR";;
        esac
      elif [ "$PHASE" != merged ]; then
        WHY="unknown queue phase $PHASE"
      fi
      SHA=$QUEUED
      MAIN_AFTER=""
      if [ -z "$WHY" ] && [ -z "$PENDING" ] && [ "$PHASE" = merged ]; then
        for _ in 1 2 3 4 5; do
          git -C "$REPO" fetch -q origin main >> "$LOG" 2>&1 || true
          MAIN_AFTER=$(git -C "$REPO" rev-parse -q --verify origin/main)
          [ "$MAIN_AFTER" != "$MAIN_BEFORE" ] && break
          sleep 2
        done
        [ "$MAIN_AFTER" != "$MAIN_BEFORE" ] || PENDING="main has not advanced after merge"
      fi
      if [ -z "$WHY" ] && [ -z "$PENDING" ] && [ "$PHASE" = merged ] && [ "$(git -C "$REPO" rev-parse "$MAIN_AFTER^{tree}")" != "$(git -C "$REPO" rev-parse "$SHA^{tree}")" ]; then
        PENDING="promoted main tree does not match verified dev"
      fi
      if [ -z "$WHY" ] && [ -z "$PENDING" ] && [ "$PHASE" = merged ] && ! sync_dev "$MAIN_AFTER" "$SHA"; then
        PENDING="could not realign dev to promoted main"
      fi
      [ -n "$WHY" ] || [ -n "$PENDING" ] || [ "$PHASE" != merged ] || OK=1
      git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true
      if [ $OK = 1 ]; then
        event "pr$PR" merged "$MAIN_AFTER"
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
      elif [ -n "$PENDING" ]; then
        echo "PENDING: $PENDING" >> "$LOG"
        event "pr$PR" alignment_pending "$PENDING"
        echo "$(date '+%F %T') promotion of PR #$PR needs reconciliation: $PENDING; see $LOG" >> "$OPS/NEEDS_CODY"
      else
        echo "FAILED: $WHY" >> "$LOG"
        event "pr$PR" failed "$WHY"
        echo "$(date '+%F %T') promotion of PR #$PR failed: $WHY; see $LOG" >> "$OPS/NEEDS_CODY"
        if [[ "$WHY" == no\ valid\ signed\ PASS* || "$WHY" == *moved* || "$WHY" == PR\ is* || "$WHY" == dev\ is* ]]; then
          mv "$ENTRY" "$MQ/blocked/"
        else
          mv "$ENTRY" "$MQ/failed/"
        fi
      fi
    done
    ;;
  *) sed -n '2,5p' "$0"; exit 2;;
esac
