#!/bin/bash
# review-verdict.sh <pr> PASS|FIX ["notes"]   (Liam's review tooling only)
# Posts "Liam: <V> — head <sha7>. <notes>" with a signed marker the merge queue verifies:
#   <!-- verdict:v1 pr=<pr> sha=<full head sha> v=<V> mac=<HMAC-SHA256(key, "pr|sha|V")> -->
# The key is the vault entry $VERDICT_KEY_TITLE (default "Polymux review verdict HMAC"), read at run time and
# passed to verdict.py on stdin only: never argv, env, files or logs. Only review tooling and the merge queue read it.
# The verdict names the PR head at signing time; any later commit (other than a clean merge of main, see
# merge-queue.sh) invalidates it. PRINT_ONLY=1 prints the comment instead of posting it.
set -euo pipefail
SD=$(cd "$(dirname "$0")" && pwd); . "$SD/support.sh"
PR=${1:?pr}; V=${2:?PASS|FIX}; NOTES=${3:-}; case $V in PASS|FIX) ;; *) echo "verdict must be PASS or FIX"; exit 2;; esac
SLUG=$(repo_slug "$(git -C "$SD" rev-parse --show-toplevel)")
SHA=$(gh pr view "$PR" -R "$SLUG" --json headRefOid -q .headRefOid); [[ $SHA =~ ^[0-9a-f]{40}$ ]] || { echo "no head sha"; exit 1; }
verdict_key() { if [ -n "${VERDICT_KEY_CMD:-}" ]; then bash -c "$VERDICT_KEY_CMD"; else
  vault get "${VERDICT_KEY_TITLE:-Polymux review verdict HMAC}" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])'; fi; }
MAC=$(verdict_key | python3 "$SD/verdict.py" sign "$PR" "$SHA" "$V") || { echo "verdict key unavailable"; exit 1; }
BODY="Liam: $V — head ${SHA:0:7}.${NOTES:+ $NOTES}"$'\n\n'"<!-- verdict:v1 pr=$PR sha=$SHA v=$V mac=$MAC -->"
if [ -n "${PRINT_ONLY:-}" ]; then printf '%s\n' "$BODY"; else gh_write pr comment "$PR" -R "$SLUG" --body "$BODY"; fi
