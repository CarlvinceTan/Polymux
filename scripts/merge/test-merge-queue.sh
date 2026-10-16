#!/bin/bash
# Hermetic merge queue tests with local Git repositories and a fake gh.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
T=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$T"' EXIT
PASS=0
FAILS=0
check() {
  if eval "$2"; then PASS=$((PASS+1)); echo "ok   $1"
  else FAILS=$((FAILS+1)); echo "FAIL $1"
  fi
}

git init -q --bare "$T/origin.git"
git init -q -b main "$T/repo"
cd "$T/repo"
git config user.name "Merge Test"
git config user.email merge@test.invalid
mkdir -p scripts/merge scripts/lib
cp "$ROOT"/scripts/merge/{merge-queue.sh,review-verdict.sh,support.sh,verdict.py} scripts/merge/
cp "$ROOT/scripts/lib/locks.sh" scripts/lib/
echo base > fixture.txt
git add -A
git commit -qm base
git remote add origin "$T/origin.git"
git push -q origin main

mkdir -p "$T/bin"
cat > "$T/bin/gh" <<GH
#!/bin/bash
echo "\$*" >> "$T/gh.log"
case "\$1 \$2" in
  "api repos"*) cat "$T/comments.jsonl";;
  "pr merge") exit 0;;
esac
exit 0
GH
chmod +x "$T/bin/gh"

export PATH="$T/bin:$PATH" HOME="$T/home" MERGE_HOME="$T/home/ops/merge" MERGE_WT_ROOT="$T/home/wt"
export MERGE_SKIP_SETUP=1 MERGE_MAIN_CHECKOUT="$T/none" VERDICT_KEY_CMD='echo test-verdict-key'
export MERGE_VERIFY_CMD='mkdir -p .build/proof && echo unit-test-verified > .build/proof/level'
MQ="$MERGE_HOME/merge-queue"
mkdir -p "$MQ" "$HOME"

sign() { echo test-verdict-key | python3 scripts/merge/verdict.py sign "$1" "$2" "$3"; }
verdict() {
  local mac
  mac=$(sign "$1" "$2" "$3")
  printf 'Liam: %s — head %s.\n\n<!-- verdict:v1 pr=%s sha=%s v=%s mac=%s -->' "$3" "${2:0:7}" "$1" "$2" "$3" "$mac"
}
comment() {
  python3 -c 'import json,sys; print(json.dumps({"id":int(sys.argv[1]),"created_at":"2026-10-13T0%s:00:00Z"%sys.argv[1],"body":sys.argv[2],"user":{"login":sys.argv[3] if len(sys.argv)>3 else "CarlvinceTan"}}))' "$@"
}
make_pr() {
  git checkout -q -b "$1" main
  echo "$1" > "$1.txt"
  git add -A
  git commit -qm "$1"
  git push -q origin "$1"
  git checkout -q main
  git rev-parse "$1"
}
enqueue() { printf 'pr: %s\nbranch: %s\n' "$1" "$2" > "$MQ/2026-pr$1"; }
run_queue() { : > "$T/gh.log"; bash scripts/merge/merge-queue.sh run >/dev/null 2>&1; }
merged() { grep -q "^pr merge $1 " "$T/gh.log"; }
blocked() { [ -f "$MQ/blocked/2026-pr$1" ] && ! merged "$1"; }

SHA=$(make_pr p1); enqueue 1 p1; : > "$T/comments.jsonl"; run_queue
check "no PASS is blocked" 'blocked 1'

SHA=$(make_pr p2); enqueue 2 p2
comment 1 "$(verdict 2 "$(git rev-parse main)" PASS)" > "$T/comments.jsonl"
run_queue
check "PASS for a different SHA is blocked" 'blocked 2'

SHA=$(make_pr p3); enqueue 3 p3
{
  comment 1 "$(verdict 3 "$SHA" PASS | sed -E 's/mac=[0-9a-f]{4}/mac=0000/')"
  comment 2 "Liam: PASS $SHA"
  comment 3 "$(verdict 99 "$SHA" PASS)"
} > "$T/comments.jsonl"
run_queue
check "forged, unsigned, and other-PR verdicts are ignored" 'blocked 3'

SHA=$(make_pr p4); enqueue 4 p4
{
  comment 1 "$(verdict 4 "$SHA" PASS) <!-- polymux-merge-queue -->"
  comment 2 "$(verdict 4 "$SHA" PASS)" mallory
} > "$T/comments.jsonl"
run_queue
check "queue-marked and non-allowed-login verdicts are ignored" 'blocked 4'

SHA=$(make_pr p5); enqueue 5 p5
{ comment 1 "$(verdict 5 "$SHA" PASS)"; comment 2 "$(verdict 5 "$SHA" FIX)"; } > "$T/comments.jsonl"
run_queue
check "newer FIX after PASS blocks" 'blocked 5'

SHA=$(make_pr p6); enqueue 6 p6; comment 1 "$(verdict 6 "$SHA" PASS)" > "$T/comments.jsonl"
git checkout -q p6; echo more >> p6.txt; git commit -qam more; git push -q origin p6; git checkout -q main
run_queue
check "a new commit after PASS blocks" 'blocked 6'

SHA=$(make_pr p7); enqueue 7 p7; comment 1 "$(verdict 7 "$SHA" PASS)" > "$T/comments.jsonl"
echo main2 > main2.txt; git add -A; git commit -qm main2; git push -q origin main
run_queue
HEAD=$(git ls-remote origin refs/heads/p7 | cut -f1)
check "a clean merge of moved main remains approved" 'merged 7 && grep -q -- "--match-head-commit $HEAD" "$T/gh.log" && [ "$HEAD" != "$SHA" ]'
check "the reviewed head remains an ancestor" 'git fetch -q origin && git merge-base --is-ancestor "$SHA" "$HEAD" && git merge-base --is-ancestor origin/main "$HEAD"'
check "the queue posts no PR comments" '! grep -q "^pr comment" "$T/gh.log" && grep -q "Squash-merging" "$MERGE_HOME/logs/merge-pr7.log"'

SHA=$(make_pr p8); enqueue 8 p8; comment 1 "$(verdict 8 "$SHA" PASS)" > "$T/comments.jsonl"
echo main3 > main3.txt; git add -A; git commit -qm main3; git push -q origin main
git checkout -q p8; git merge -q --no-commit main; echo sneaky >> p8.txt; git add -A; git commit -qm "merge main edited"; git push -q origin p8; git checkout -q main
run_queue
check "manual edits in a main merge void approval" 'blocked 8'

SHA=$(make_pr p9); enqueue 9 p9; comment 1 "$(verdict 9 "$SHA" PASS)" > "$T/comments.jsonl"
echo main4 > main4.txt; git add -A; git commit -qm main4; git push -q origin main
git checkout -q p9; git merge -q --no-edit main; git push -q origin p9; git checkout -q main
run_queue
check "a clean main merge pushed elsewhere remains approved" 'merged 9'

git checkout -q -b p10 main; echo branch > fixture.txt; git commit -qam p10; git push -q origin p10
SHA=$(git rev-parse HEAD); git checkout -q main; echo main > fixture.txt; git commit -qam main10; git push -q origin main
enqueue 10 p10; comment 1 "$(verdict 10 "$SHA" PASS)" > "$T/comments.jsonl"
run_queue
check "a conflict is archived without modifying the branch" '[ -f "$MQ/failed/2026-pr10" ] && ! merged 10 && [ "$(git ls-remote origin refs/heads/p10 | cut -f1)" = "$SHA" ] && grep -q "merge of main conflicts" "$MERGE_HOME/logs/merge-pr10.log" && grep -q "PR #10 failed" "$MERGE_HOME/NEEDS_CODY"'

SHA=$(make_pr p11); enqueue 11 p11; comment 1 "$(verdict 11 "$SHA" PASS)" > "$T/comments.jsonl"
: > "$T/gh.log"; MERGE_VERIFY_CMD=true bash scripts/merge/merge-queue.sh run >/dev/null 2>&1
check "a missing verification level refuses merge" '[ -f "$MQ/failed/2026-pr11" ] && ! merged 11 && grep -q "verification level missing" "$MERGE_HOME/logs/merge-pr11.log"'

SHA=$(make_pr p13); enqueue 13 p13
{ comment 1 "$(verdict 13 "$SHA" PASS)"; comment 2 "Liam: FIX ${SHA:0:7} — one more thing"; } > "$T/comments.jsonl"
run_queue
check "an unsigned FIX after signed PASS blocks" 'blocked 13'

SHA=$(make_pr p14); enqueue 14 p14
{ comment 1 "$(verdict 14 "$SHA" PASS)"; comment 2 "changes requested: see above"; } > "$T/comments.jsonl"
run_queue
SHA=$(make_pr p15); enqueue 15 p15
{ comment 1 "$(verdict 15 "$SHA" PASS)"; comment 2 "liam: fix the release note"; } > "$T/comments.jsonl"
run_queue
check "other unsigned fix requests after PASS block" 'blocked 14 && blocked 15'

SHA=$(make_pr p16); enqueue 16 p16
{ comment 1 "Liam: FIX old head"; comment 2 "$(verdict 16 "$SHA" PASS)"; comment 3 "Thanks"; } > "$T/comments.jsonl"
run_queue
check "an older unsigned FIX does not block a signed PASS" 'merged 16'

git checkout -q -b p17 main; echo branch17 > fixture.txt; git commit -qam p17; git push -q origin p17
SHA=$(git rev-parse HEAD); git checkout -q main; echo main17 > fixture.txt; git commit -qam main17; git push -q origin main
TREE=$(git merge-tree --write-tree p17 main | head -1)
MERGE=$(git commit-tree "$TREE" -p "$SHA" -p main -m "merge conflicted main")
git push -q origin "$MERGE:refs/heads/p17"
enqueue 17 p17; comment 1 "$(verdict 17 "$SHA" PASS)" > "$T/comments.jsonl"
run_queue
check "a conflicted merge-tree result voids approval" '! merged 17 && grep -q "merge-tree exit 1" "$MERGE_HOME/logs/merge-pr17.log"'

SHA=$(make_pr p18); enqueue 18 p18; comment 1 "$(verdict 18 "$SHA" PASS)" > "$T/comments.jsonl"
: > "$T/gh.log"
VERIFY_TARGETS=affected MERGE_VERIFY_CMD='echo "VT=$VERIFY_TARGETS" > "$HOME/vt18"; mkdir -p .build/proof; echo unit-test-verified > .build/proof/level' bash scripts/merge/merge-queue.sh run >/dev/null 2>&1
check "the queue always runs full verification" 'merged 18 && [ "$(cat "$HOME/vt18")" = VT=full ]'

SHA=$(make_pr p12)
printf '#!/bin/bash\necho "$*" >> "%s/gh.log"\ncase "$1 $2" in "pr view") echo %s;; "api repos"*) cat "%s/comments.jsonl";; esac\nexit 0\n' "$T" "$SHA" "$T" > "$T/bin/gh"
OUTPUT=$(PRINT_ONLY=1 bash scripts/merge/review-verdict.sh 12 PASS "docs ok")
comment 1 "$OUTPUT" > "$T/comments.jsonl"; enqueue 12 p12; run_queue
check "review-verdict output is accepted without exposing the key" 'merged 12 && ! echo "$OUTPUT" | grep -q test-verdict-key && ! grep -rq test-verdict-key "$MERGE_HOME" "$T/gh.log"'

mkdir -p scripts/deploy
cat > scripts/deploy/deploy.py <<'PY'
import json, os, pathlib, subprocess, sys
pathlib.Path(os.environ["DEPLOY_TEST_LOG"]).write_text(" ".join(sys.argv[1:4]))
failed = int(os.environ.get("DEPLOY_TEST_FAIL", "0"))
if not failed:
    sha = subprocess.check_output(["git", "rev-parse", "origin/main"], text=True).strip()
    pathlib.Path(sys.argv[sys.argv.index("--receipt") + 1]).write_text(json.dumps({"sha": sha}))
sys.exit(failed)
PY
printf '# test host installer\n' > scripts/deploy/deploy_host.py
git add scripts/deploy; git commit -qm "Add test deployment"; git push -q origin main
export DEPLOY_TEST_LOG="$T/deployed.json"

SHA=$(make_pr p25); enqueue 25 p25; comment 1 "$(verdict 25 "$SHA" PASS)" > "$T/comments.jsonl"
MERGE_MAIN_CHECKOUT="$T/repo" run_queue
check "a merge deploys the checked main ref" 'merged 25 && [ "$(cat "$T/deployed.json")" = "update --ref origin/main" ] && grep -q "pr25.*deployed" "$MERGE_HOME/events.tsv"'

SHA=$(make_pr p26); enqueue 26 p26; comment 1 "$(verdict 26 "$SHA" PASS)" > "$T/comments.jsonl"
DEPLOY_TEST_FAIL=1 MERGE_MAIN_CHECKOUT="$T/repo" run_queue
check "deployment failure leaves a retry marker" 'merged 26 && [ -f "$MQ/done/2026-pr26" ] && grep -q "pr26.*deploy_failed" "$MERGE_HOME/events.tsv" && [ -f "$MERGE_HOME/deploy-pending" ]'

SHA=$(make_pr p27); enqueue 27 p27; comment 1 "$(verdict 27 "$SHA" PASS)" > "$T/comments.jsonl"
rm "$T/deployed.json"; echo '# uncommitted edit' >> scripts/deploy/deploy.py
MERGE_MAIN_CHECKOUT="$T/repo" run_queue
check "uncommitted deployment code is not executed" 'merged 27 && [ ! -f "$T/deployed.json" ] && grep -q "uncommitted edit" scripts/deploy/deploy.py && grep -q "pr27.*deploy_failed" "$MERGE_HOME/events.tsv"'
git checkout -- scripts/deploy/deploy.py
MERGE_MAIN_CHECKOUT="$T/repo" run_queue
check "the next queue tick retries deployment only" '[ -f "$T/deployed.json" ] && [ ! -f "$MERGE_HOME/deploy-pending" ] && ! grep -q "^pr merge " "$T/gh.log"'

echo outside > outside.txt; git add outside.txt; git commit -qm "Merge outside queue"; git push -q origin main
rm "$T/deployed.json"
MERGE_MAIN_CHECKOUT="$T/repo" run_queue
check "a main change outside the queue deploys next tick" '[ -f "$T/deployed.json" ] && [ ! -f "$MERGE_HOME/deploy-pending" ] && ! grep -q "^pr merge " "$T/gh.log"'

echo "test-merge-queue: $PASS passed, $FAILS failed"
[ $FAILS = 0 ]
