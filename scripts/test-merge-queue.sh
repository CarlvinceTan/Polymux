#!/bin/bash
# test-merge-queue.sh: hermetic tests for the merge lane approval gate (no network, no vault, fake gh).
set -uo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd); T=$(cd "$(mktemp -d)" && pwd -P); trap 'rm -rf "$T"' EXIT
PASS=0; FAILS=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "ok   $1"; else FAILS=$((FAILS+1)); echo "FAIL $1"; fi; }
git init -q --bare "$T/origin.git"; git init -q -b main "$T/repo"; cd "$T/repo"
git config user.name "MQ Test"; git config user.email mq@test.invalid
mkdir -p scripts; cp "$SRC"/scripts/{merge-queue,lanelib}.sh "$SRC"/scripts/verdict.py scripts/
echo base > README; printf 'a\nb\nc\n' > f.txt; git add -A; git commit -qm base; git remote add origin "$T/origin.git"; git push -q origin main
mkdir -p "$T/bin"; cat > "$T/bin/gh" <<GH
#!/bin/bash
echo "\$*" >> "$T/gh.log"
case "\$1 \$2" in "api repos"*) cat "$T/comments.jsonl";; "pr merge") exit 0;; esac; exit 0
GH
chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH" HOME="$T/home" LANES_HOME="$T/home/ops/lanes" LANES_WT="$T/home/wt" LANE_SKIP_SETUP=1
export MERGE_MAIN_CHECKOUT="$T/none" VERDICT_KEY_CMD='echo test-verdict-key' MERGE_VERIFY_CMD='mkdir -p .build/proof && echo unit-test-verified > .build/proof/level'
MQ="$LANES_HOME/merge-queue"; mkdir -p "$MQ" "$HOME"
sign() { echo test-verdict-key | python3 scripts/verdict.py sign "$1" "$2" "$3"; }
verdict() { local m; m=$(sign "$1" "$2" "$3"); printf 'Liam: %s — head %s.\n\n<!-- verdict:v1 pr=%s sha=%s v=%s mac=%s -->' "$3" "${2:0:7}" "$1" "$2" "$3" "$m"; }
cm() { python3 -c 'import json,sys; print(json.dumps({"id":int(sys.argv[1]),"created_at":"2026-10-13T0%s:00:00Z"%sys.argv[1],"body":sys.argv[2],"user":{"login":sys.argv[3] if len(sys.argv)>3 else "CarlvinceTan"}}))' "$@"; }
mkpr() { git checkout -q -b "$1" main; echo "$1" > "$1.txt"; git add -A; git commit -qm "$1"; git push -q origin "$1"; git checkout -q main; git rev-parse "$1"; }
enq() { printf 'pr: %s\nbranch: %s\nlane: lane3\nunit: \ntask: \n' "$1" "$2" > "$MQ/2026-pr$1"; }
run() { : > "$T/gh.log"; bash scripts/merge-queue.sh run >/dev/null 2>&1; }
merged() { grep -q "^pr merge $1 " "$T/gh.log"; }
blocked() { [ -f "$MQ/blocked/2026-pr$1" ] && ! merged "$1"; }
# 1 no verdict at all
S=$(mkpr p1); enq 1 p1; : > "$T/comments.jsonl"; run
check "no PASS: blocked, not merged" 'blocked 1'
# 2 PASS for a different sha
S=$(mkpr p2); enq 2 p2; cm 1 "$(verdict 2 "$(git rev-parse main)" PASS)" > "$T/comments.jsonl"; run
check "PASS naming the wrong sha: blocked" 'blocked 2'
# 3 forged mac / unsigned plain text / wrong PR number
S=$(mkpr p3); enq 3 p3
{ cm 1 "$(verdict 3 "$S" PASS | sed -E "s/mac=[0-9a-f]{4}/mac=0000/")"; cm 2 "Liam: PASS $S"; cm 3 "$(verdict 99 "$S" PASS)"; } > "$T/comments.jsonl"; run
check "forged HMAC, unsigned 'Liam: PASS <sha>' and other-PR verdict all ignored" 'blocked 3'
# 4 the queue's own (marked) comment is ignored even if signed; other logins ignored
S=$(mkpr p4); enq 4 p4; { cm 1 "$(verdict 4 "$S" PASS) <!-- polymux-merge-queue -->"; cm 2 "$(verdict 4 "$S" PASS)" mallory; } > "$T/comments.jsonl"; run
check "queue-marked and non-allowed-login verdicts ignored" 'blocked 4'
# 5 FIX after PASS
S=$(mkpr p5); enq 5 p5; { cm 1 "$(verdict 5 "$S" PASS)"; cm 2 "$(verdict 5 "$S" FIX)"; } > "$T/comments.jsonl"; run
check "newer FIX after PASS blocks" 'blocked 5'
# 6 stale PASS: new commit after the review
S=$(mkpr p6); enq 6 p6; cm 1 "$(verdict 6 "$S" PASS)" > "$T/comments.jsonl"
git checkout -q p6; echo more >> p6.txt; git commit -qam more; git push -q origin p6; git checkout -q main; run
check "new commit after PASS (stale approval): blocked" 'blocked 6'
# 7 valid PASS, main moved: merge-main pushed (fast-forward, no force), then merged at the new head
S=$(mkpr p7); enq 7 p7; cm 1 "$(verdict 7 "$S" PASS)" > "$T/comments.jsonl"
echo main2 > m.txt; git add -A; git commit -qm main2; git push -q origin main; run; H=$(git ls-remote origin refs/heads/p7 | cut -f1)
check "valid signed PASS + main moved: clean merge-only head accepted and squash-merged at that head" 'merged 7 && grep -q -- "--match-head-commit $H" "$T/gh.log" && [ "$H" != "$S" ]'
check "no force-push: reviewed head is an ancestor of the pushed head" 'git fetch -q origin && git merge-base --is-ancestor "$S" "$H" && git merge-base --is-ancestor origin/main "$H"'
check "queue posts no PR comments (logs instead)" '! grep -rq "^pr comment" "$T/gh.log" && grep -q "Squash-merging" "$LANES_HOME/logs/merge-pr7.log"'
# 8 PASS then a merge of main WITH a manual edit: not merge-only
S=$(mkpr p8); enq 8 p8; cm 1 "$(verdict 8 "$S" PASS)" > "$T/comments.jsonl"
echo main3 > m3.txt; git add -A; git commit -qm main3; git push -q origin main
git checkout -q p8; git merge -q --no-commit main; echo sneaky >> p8.txt; git add -A; git commit -qm "merge main (edited)"; git push -q origin p8; git checkout -q main; run
check "merge of main carrying manual edits voids the approval" 'blocked 8'
# 9 PASS then a clean merge of main pushed by someone: still approved
S=$(mkpr p9); enq 9 p9; cm 1 "$(verdict 9 "$S" PASS)" > "$T/comments.jsonl"
echo main4 > m4.txt; git add -A; git commit -qm main4; git push -q origin main
git checkout -q p9; git merge -q --no-edit main; git push -q origin p9; git checkout -q main; run
check "clean merge of main after review keeps the approval" 'merged 9'
# 10 conflict with main: failed, branch on origin untouched
git checkout -q -b p10 main; echo X > f.txt; git commit -qam p10; git push -q origin p10; S=$(git rev-parse HEAD); git checkout -q main
echo Y > f.txt; git commit -qam mainY; git push -q origin main; enq 10 p10; cm 1 "$(verdict 10 "$S" PASS)" > "$T/comments.jsonl"; run
check "conflict with main: failed, nothing merged or pushed" '[ -f "$MQ/failed/2026-pr10" ] && ! merged 10 && [ "$(git ls-remote origin refs/heads/p10 | cut -f1)" = "$S" ] && grep -q "merge of main conflicts" "$LANES_HOME/logs/merge-pr10.log"'
# 11 verification level missing: refuse to merge
S=$(mkpr p11); enq 11 p11; cm 1 "$(verdict 11 "$S" PASS)" > "$T/comments.jsonl"
: > "$T/gh.log"; MERGE_VERIFY_CMD='true' bash scripts/merge-queue.sh run >/dev/null 2>&1
check "missing verification level: refused, not merged" '[ -f "$MQ/failed/2026-pr11" ] && ! merged 11 && grep -q "verification level missing" "$LANES_HOME/logs/merge-pr11.log"'
# 12 review-verdict.sh output is accepted by the checker; key never printed
S=$(mkpr p12); cp "$SRC/scripts/review-verdict.sh" scripts/
printf '#!/bin/bash\necho "$*" >> "%s/gh.log"\ncase "$1 $2" in "pr view") echo %s;; "api repos"*) cat "%s/comments.jsonl";; esac; exit 0\n' "$T" "$S" "$T" > "$T/bin/gh"
OUTV=$(PRINT_ONLY=1 bash scripts/review-verdict.sh 12 PASS "docs ok"); cm 1 "$OUTV" > "$T/comments.jsonl"; enq 12 p12; run
check "review-verdict.sh comment is accepted; the key never appears in output or logs" 'merged 12 && ! echo "$OUTV" | grep -q test-verdict-key && ! grep -rq test-verdict-key "$LANES_HOME" "$T/gh.log"'
echo "test-merge-queue: $PASS passed, $FAILS failed"; [ $FAILS = 0 ]
