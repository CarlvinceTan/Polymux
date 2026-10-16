#!/bin/bash
# Hermetic dev -> main promotion tests with local Git repositories and a fake gh.
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
git branch dev
git push -q origin dev

mkdir -p "$T/bin"
cat > "$T/bin/gh" <<GH
#!/bin/bash
echo "\$*" >> "$T/gh.log"
case "\$1 \$2" in
  "api repos"*) cat "$T/comments.jsonl";;
  "pr view") cat "$T/pr.json";;
  "pr merge")
    [ ! -f "$T/defer-merge" ] || exit 0
    git -C "$T/repo" fetch -q origin main dev
    git -C "$T/repo" checkout -q main
    git -C "$T/repo" reset -q --hard origin/main
    git -C "$T/repo" merge -q --squash origin/dev
    git -C "$T/repo" commit -qm "Promote dev"
    git -C "$T/repo" push -q origin main
    ;;
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
set_pr() {
  printf '{"state":"%s","isDraft":%s,"isCrossRepository":%s,"headRefName":"%s","baseRefName":"%s","headRefOid":"%s"}\n' \
    "${2:-OPEN}" "${3:-false}" "${6:-false}" "${4:-dev}" "${5:-main}" "$1" > "$T/pr.json"
}
change_dev() {
  local name=$1
  git fetch -q origin main dev
  git checkout -q dev
  git reset -q --hard origin/dev
  echo "$name" >> changes.txt
  git add -A
  git commit -qm "$name"
  git push -q origin dev
  git checkout -q main
  git rev-parse dev
}
reset_dev() {
  git fetch -q origin main
  git push -q --force origin origin/main:refs/heads/dev
  git branch -f dev origin/main >/dev/null
}
queue() { bash scripts/merge/merge-queue.sh enqueue "$1" >/dev/null; }
run_queue() { : > "$T/gh.log"; bash scripts/merge/merge-queue.sh run >/dev/null 2>&1; }
merged() { grep -q "^pr merge $1 " "$T/gh.log"; }
blocked() { find "$MQ/blocked" -name "*-pr$1" -type f | grep -q . && ! merged "$1"; }
failed() { find "$MQ/failed" -name "*-pr$1" -type f | grep -q . && ! merged "$1"; }

BASE=$(git rev-parse main)
set_pr "$BASE" OPEN false feature main
check "enqueue rejects a feature branch" '! queue 1'
set_pr "$BASE" OPEN false dev feature
check "enqueue rejects a non-main base" '! queue 2'
set_pr "$BASE" OPEN true dev main
check "enqueue rejects a draft" '! queue 3'
set_pr "$BASE" OPEN false dev main true
check "enqueue rejects a fork" '! queue 30'

SHA=$(change_dev unsigned); set_pr "$SHA"; : > "$T/comments.jsonl"; queue 4; run_queue
check "no PASS is blocked" 'blocked 4'

SHA=$(git ls-remote origin refs/heads/dev | cut -f1); set_pr "$SHA"
comment 1 "$(verdict 5 "$SHA" PASS | sed -E 's/mac=[0-9a-f]{4}/mac=0000/')" > "$T/comments.jsonl"
queue 5; run_queue
check "a forged PASS is blocked" 'blocked 5'

set_pr "$SHA"
{ comment 1 "$(verdict 6 "$SHA" PASS)"; comment 2 "$(verdict 6 "$SHA" FIX)"; } > "$T/comments.jsonl"
queue 6; run_queue
check "a newer FIX blocks promotion" 'blocked 6'

set_pr "$SHA"; comment 1 "$(verdict 7 "$SHA" PASS)" > "$T/comments.jsonl"
queue 7; run_queue
REMOTE_MAIN=$(git ls-remote origin refs/heads/main | cut -f1)
REMOTE_DEV=$(git ls-remote origin refs/heads/dev | cut -f1)
check "reviewed dev is squash-promoted" 'merged 7 && [ "$REMOTE_MAIN" != "$SHA" ]'
check "dev is realigned to promoted main" '[ "$REMOTE_MAIN" = "$REMOTE_DEV" ]'
check "only main and dev remain" '[ "$(git ls-remote --heads origin | sed "s#.*refs/heads/##" | sort | tr "\n" " ")" = "dev main " ]'
check "the queue posts no PR comments" '! grep -q "^pr comment" "$T/gh.log"'

SHA=$(change_dev queued); set_pr "$SHA"; comment 1 "$(verdict 8 "$SHA" PASS)" > "$T/comments.jsonl"; queue 8
MOVED=$(change_dev moved); set_pr "$MOVED"; run_queue
check "dev moving after queueing blocks promotion" 'blocked 8'
reset_dev

SHA=$(change_dev behind-main); set_pr "$SHA"; comment 1 "$(verdict 9 "$SHA" PASS)" > "$T/comments.jsonl"; queue 9
git checkout -q main; git reset -q --hard origin/main; echo main-moved >> main.txt; git add -A; git commit -qm main-moved; git push -q origin main
run_queue
check "dev not based on current main is blocked" 'blocked 9'
reset_dev

SHA=$(change_dev no-level); set_pr "$SHA"; comment 1 "$(verdict 10 "$SHA" PASS)" > "$T/comments.jsonl"; queue 10
MERGE_VERIFY_CMD=true run_queue
check "a missing verification level refuses promotion" 'failed 10'
reset_dev

export MERGE_MEDIA_DIR="$T/promotion-evidence"
SHA=$(change_dev full); set_pr "$SHA"; comment 1 "$(verdict 11 "$SHA" PASS)" > "$T/comments.jsonl"; queue 11
VERIFY_TARGETS=affected MERGE_VERIFY_CMD='printf "VT=%s\nMEDIA=%s\n" "$VERIFY_TARGETS" "$VERIFY_MEDIA_DIR" > "$HOME/vt11"; mkdir -p .build/proof; echo unit-test-verified > .build/proof/level' run_queue
unset MERGE_MEDIA_DIR
check "the queue always runs full verification" 'merged 11 && grep -qx VT=full "$HOME/vt11"'
check "the queue reuses local promotion evidence" 'grep -qx "MEDIA=$T/promotion-evidence" "$HOME/vt11"'

SHA=$(change_dev delayed); set_pr "$SHA"; comment 1 "$(verdict 12 "$SHA" PASS)" > "$T/comments.jsonl"; queue 12
touch "$T/defer-merge"; run_queue; rm "$T/defer-merge"
PENDING_MAIN=$(git ls-remote origin refs/heads/main | cut -f1)
PENDING_DEV=$(git ls-remote origin refs/heads/dev | cut -f1)
check "post-merge alignment remains queued" 'grep -q "^phase: merged$" "$MQ"/*-pr12 && [ "$PENDING_MAIN" != "$PENDING_DEV" ]'
git fetch -q origin main dev
git checkout -q main
git reset -q --hard origin/main
git merge -q --squash origin/dev
git commit -qm "Delayed promotion"
git push -q origin main
run_queue
REMOTE_MAIN=$(git ls-remote origin refs/heads/main | cut -f1)
REMOTE_DEV=$(git ls-remote origin refs/heads/dev | cut -f1)
check "post-merge alignment retries to completion" '[ "$REMOTE_MAIN" = "$REMOTE_DEV" ] && find "$MQ/done" -name "*-pr12" -type f | grep -q .'

SHA=$(change_dev verdict); set_pr "$SHA"
printf '#!/bin/bash\necho "$*" >> "%s/gh.log"\ncase "$1 $2" in "pr view") echo %s;; "api repos"*) cat "%s/comments.jsonl";; "pr merge") exit 1;; esac\nexit 0\n' "$T" "$SHA" "$T" > "$T/bin/gh"
OUTPUT=$(PRINT_ONLY=1 bash scripts/merge/review-verdict.sh 13 PASS "docs ok")
check "review verdict does not expose the key" '! echo "$OUTPUT" | grep -q test-verdict-key && echo "$OUTPUT" | grep -q "verdict:v1"'

echo "test-merge-queue: $PASS passed, $FAILS failed"
[ $FAILS = 0 ]
