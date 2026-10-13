#!/bin/bash
# test-lanes.sh: hermetic tests for the lane scripts (no agents, no Xcode, no network, no vault).
# Uses the run-lane hooks LANE_DRY / LANE_FORCE_FAIL / LANE_STUB_CMD / LANE_SKIP_SETUP in a temp
# repo with a local bare origin. Usage: bash scripts/test-lanes.sh   (exit 0 = all passed)
set -uo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd); T=$(cd "$(mktemp -d)" && pwd -P); trap 'rm -rf "$T"' EXIT
PASS=0; FAILS=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "ok   $1"; else FAILS=$((FAILS+1)); echo "FAIL $1"; fi; }
git init -q --bare "$T/origin.git"; git init -q -b main "$T/repo"; cd "$T/repo"
git config user.name "Lane Test"; git config user.email lane@test.invalid
mkdir -p scripts agents; cp "$SRC"/scripts/{run-lane,verify,lanelib,dispatch-guard,cleanup,wt-setup,board-update,queue-write}.sh "$SRC"/scripts/media-check.py "$SRC"/scripts/lanes.py scripts/
cat > agents/lanes.toml <<'TOML'
max_builds = 1
lock_dir = "~/ops/lanes/locks"
sim_template = "polymux-template"
mac_hosts = ["testmac"]
[laneA]
agent = "opencode"
cmd = "true"
[laneB]
agent = "codex"
cmd = "true"
TOML
echo base > README; git add -A; git commit -qm base; git remote add origin "$T/origin.git"; git push -q origin main
export HOME="$T/home" LANES_HOME="$T/home/ops/lanes" LANES_WT="$T/home/code/wt" LANE_SKIP_SETUP=1 LANE_TARGET=testmac
export LANE_STAGGER=0 LANE_POLL=1 LANE_GUARD="$T/no-lane-guard" DISPATCH_INTAKE="$T/intake.jsonl"
mkdir -p "$HOME/code/wt" "$LANES_HOME"
export LANE_BREAKER_N=99   # global breaker off except in its own test (19e); many cases fail fast on purpose
task() { printf '# %s\nneeds: none\nexpected_min: 5\n' "$1" > "$T/$2.task"; echo "$T/$2.task"; }
STUB_OK='echo $RANDOM >> f.txt && git add f.txt && git commit -qm "stub change" -m "Lane: $LANE/$AGENT"'
RL="bash scripts/run-lane.sh"
# 1 happy path (dry): commit with trailer, lane identity in committer, locks released
OUT=$(LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Happy path' t1)" --branch test/happy 2>&1); RC=$?
check "dry happy path exits 0" '[ $RC = 0 ] && echo "$OUT" | grep -q "DRY-OK laneA"'
check "lane trailer present" 'git -C "$LANES_WT/laneA-happy-path" log -1 --format=%B | grep -q "^Lane: laneA/opencode"'
check "committer names lane" 'git -C "$LANES_WT/laneA-happy-path" log -1 --format=%cn | grep -q "(laneA/opencode)"'
check "unit + branch locks released" '! ls -d "$LANES_HOME"/units/*.lock "$LANES_HOME"/branches/*.lock 2>/dev/null | grep -q .'
# 2 first failure -> brief back to queue/ as attempt 2 (no in-process failover); attempt 2 fails -> NEEDS_CODY
OUT=$(LANE_CHAIN_MIN_S=0 LANE_FORCE_FAIL="laneA laneB" $RL laneA "$(task 'Always fails' t2)" 2>&1); RC=$?
RQ=$(ls "$LANES_HOME"/queue/*-always-fails-retry.task 2>/dev/null | head -1)
check "first failure: exit 1, re-queued as attempt 2, laneB not tried, no NEEDS_CODY" '[ $RC = 1 ] && echo "$OUT" | grep -q "REQUEUED after: laneA" && grep -qx "# Always fails (attempt 2)" "$RQ" && [ "$(head -1 "$RQ")" = "# Always fails (attempt 2)" ] && grep -qx "needs: none" "$RQ" && ! grep -q "always-fails	running	laneB" "$LANES_HOME/events.tsv" && [ ! -f "$LANES_HOME/NEEDS_CODY" ]'
mv "$RQ" "$T/t2b.task"; OUT=$(LANE_FORCE_FAIL="laneA laneB" $RL laneB "$T/t2b.task" 2>&1); RC=$?
check "attempt 2 fails -> exit 1, NEEDS_CODY + failures.tsv, nothing re-queued" '[ $RC = 1 ] && echo "$OUT" | grep -q "FAILED after: laneB" && grep -q "Always fails" "$LANES_HOME/NEEDS_CODY" && grep -q "Always fails (attempt 2)" "$LANES_HOME/failures.tsv" && ! ls "$LANES_HOME"/queue/*.task >/dev/null 2>&1'
# 2d deferred by policy: a failed unit whose title/slug is parked in deferred/ is not re-queued; its retry goes to deferred/
mkdir -p "$LANES_HOME/deferred"; printf '# Parked unit\nneeds: none\nexpected_min: 5\n' > "$LANES_HOME/deferred/0010--parked-unit.task"
OUT=$(LANE_CHAIN_MIN_S=0 LANE_FORCE_FAIL="laneA laneB" $RL laneA "$(task 'Parked unit' t2d)" 2>&1); RC=$?
check "deferred unit (title match): retry parked in deferred/, nothing in queue/" '[ $RC = 1 ] && echo "$OUT" | grep -q "DEFERRED after: laneA" && ls "$LANES_HOME"/deferred/*-parked-unit-retry.task >/dev/null 2>&1 && ! ls "$LANES_HOME"/queue/*parked-unit* >/dev/null 2>&1 && grep -q "retry parked in deferred/" "$LANES_HOME/logs/dispatch-chain.log"'
printf '# Other words entirely\nneeds: none\nexpected_min: 5\n' > "$LANES_HOME/deferred/10131232--slug-match-only.task"
OUT=$(LANE_CHAIN_MIN_S=0 LANE_FORCE_FAIL="laneA laneB" $RL laneA "$(task 'Slug match only' t2e)" 2>&1); RC=$?
check "deferred unit (slug match): retry parked in deferred/" '[ $RC = 1 ] && ls "$LANES_HOME"/deferred/*-slug-match-only-retry.task >/dev/null 2>&1 && ! ls "$LANES_HOME"/queue/*slug-match-only* >/dev/null 2>&1'
# 2f lane-guard --task-end already parked the retry in deferred/: run-lane must not write a second one
printf '# Parked dup (attempt 2)\nneeds: none\nexpected_min: 5\n' > "$LANES_HOME/deferred/10131300-parked-dup.task"
printf '# Parked dup\nneeds: none\nexpected_min: 5\n' > "$LANES_HOME/deferred/0011--parked-dup.task"
OUT=$(LANE_CHAIN_MIN_S=0 LANE_FORCE_FAIL="laneA laneB" $RL laneA "$(task 'Parked dup' t2f)" 2>&1); RC=$?
check "deferred retry already written by lane-guard: no second retry (deferred/ or queue/)" '[ $RC = 1 ] && echo "$OUT" | grep -q "DEFERRED after: laneA" && [ "$(ls "$LANES_HOME"/deferred/ | grep -c parked-dup)" = 2 ] && ! ls "$LANES_HOME"/queue/*parked-dup* >/dev/null 2>&1 && grep -q "already re-queued (.*deferred/10131300-parked-dup.task)" "$LANES_HOME/events.tsv"'
# 3 stop rule
cp "$T/t2b.task" "$T/t3.task"; $RL laneA "$T/t3.task" >/dev/null 2>&1; RC=$?
check "stop rule refuses a twice-failed brief (exit 2)" '[ $RC = 2 ]'
# 4 unit lock contention (live holder) and stale reclaim (dead holder)
mkdir -p "$LANES_HOME/units/unit-busy.lock"; echo $$ > "$LANES_HOME/units/unit-busy.lock/pid"
$RL laneA "$(task 'Unit busy' t4)" >/dev/null 2>&1; RC=$?
check "unit lock contention exits 3" '[ $RC = 3 ]'
echo 999999 > "$LANES_HOME/units/unit-busy.lock/pid"
OUT=$(LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Unit busy' t5)" 2>&1); RC=$?
check "stale unit lock is reclaimed" '[ $RC = 0 ]'
# 5 branch lock: same branch, different title -> refused on the branch, re-queued (no second writer)
BL="$LANES_HOME/branches/test%shared.lock"; mkdir -p "$BL"; echo $$ > "$BL/pid"
OUT=$(LANE_CHAIN_MIN_S=0 LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Other title' t6)" --branch test/shared 2>&1); RC=$?
check "branch lock blocks a second writer" 'grep -q "branch test/shared has another writer" "$LANES_HOME/events.tsv"'
check "branch-locked unit is re-queued with its branch, not run" '[ $RC = 1 ] && grep -qx "branch: test/shared" "$LANES_HOME"/queue/*-other-title-retry.task'
rm -rf "$BL" "$LANES_HOME"/queue/*.task
# 6 missing trailer is flagged
OUT=$(LANE_DRY=1 LANE_STUB_CMD='echo n >> g.txt && git add g.txt && git commit -qm "no trailer"' $RL laneA "$(task 'No trailer' t7)" 2>&1)
check "missing Lane trailer warned" 'echo "$OUT" | grep -q "without a .Lane:. trailer"'
# 7 dispatch guard: Swift scope refused on a non-Mac host, allowed on a mac_hosts entry
printf 'needs: swift\nscope: apps/Polymux/**\nSwift unit\n' > "$T/sw.task"
bash scripts/dispatch-guard.sh "$T/sw.task" linuxbox >/dev/null; R1=$?; bash scripts/dispatch-guard.sh "$T/sw.task" testmac >/dev/null; R2=$?
check "dispatch-guard uses mac_hosts" '[ $R1 = 4 ] && [ $R2 = 0 ]'
# 10 two reclaimers at once on a stale lock: exactly one wins, every round
WINS_BAD=0; for i in $(seq 1 15); do D="$T/race.lock"; rm -rf "$D" "$T"/race.lock.stale.*; mkdir "$D"; echo 999999 > "$D/pid"
  for k in 1 2; do bash -c '. "$1"; lock_take "$2" && echo win' _ scripts/lanelib.sh "$D" > "$T/w$k" & done; wait
  [ "$(cat "$T/w1" "$T/w2" | grep -c win)" = 1 ] || WINS_BAD=$((WINS_BAD+1)); done
check "concurrent stale reclaim: one winner per round" '[ $WINS_BAD = 0 ]'
# 11 scope check: nested + deleted files, patterns never glob against real files
git checkout -q -b scope-test main; mkdir -p apps/x/y docs; echo s > apps/x/y/z.swift; echo d > docs/n.md; echo top > TOP.md
git add -A; git rm -q README; git commit -qm scope
SC() { bash -c '. "$1"; scope_check main "$2"' _ scripts/lanelib.sh "$1" 2>&1; }
check "scope: nested + deleted inside scope pass" 'SC "apps/**,*.md,README" >/dev/null'
check "scope: deleted file outside scope fails" '! SC "apps/**,*.md" >/dev/null && grep -q "outside scope: README" <<< "$(SC "apps/**,*.md")"'
check "scope: *.md matches nested docs/n.md despite TOP.md existing" '! grep -q docs/n.md <<< "$(SC "apps/**,*.md,README")"'
git checkout -q main
# 12 verify-only: rerun gets its own proof branch; failed fetch stops
mkdir -p "$T/bin"; printf '#!/bin/sh\nexit 0\n' > "$T/bin/gh"; chmod +x "$T/bin/gh"
git push -q origin main:refs/heads/vo/one
VC='mkdir -p .build/proof && date +%s%N > .build/proof/a.png && echo "## ok" > .build/proof/summary.md'
PATH="$T/bin:$PATH" LANE_VERIFY_CMD="$VC" $RL --verify-only vo/one >/dev/null 2>&1; R1=$?
PATH="$T/bin:$PATH" LANE_VERIFY_CMD="$VC" $RL --verify-only vo/one >/dev/null 2>&1; R2=$?
check "verify-only rerun succeeds" '[ $R1 = 0 ] && [ $R2 = 0 ]'
check "publish_proof records what it uploaded (proof/uploaded)" '[ "$(cat "$LANES_WT/verify-vo-one/.build/proof/uploaded")" = a.png ]'
check "each run has its own proof branch" '[ "$(git ls-remote origin "refs/heads/proof-media/verify-vo-one-*" | wc -l | tr -d " ")" = 2 ]'
PATH="$T/bin:$PATH" LANE_VERIFY_CMD="$VC" $RL --verify-only no/such-branch >/dev/null 2>&1; R3=$?
check "verify-only stops when fetch fails" '[ $R3 = 1 ] && [ ! -d "$LANES_WT/verify-no-such-branch" ]'
# 13 four racers: never two winners, and the winner's lock is never deleted
BAD=0; for i in $(seq 1 15); do D="$T/r4.lock"; rm -rf "$D" "$T"/r4.lock.stale.*; mkdir "$D"; echo 999999 > "$D/pid"
  for k in 1 2 3 4; do bash -c '. "$1"; lock_take "$2" 2>/dev/null && echo "win $$"' _ scripts/lanelib.sh "$D" > "$T/v$k" & done; wait
  W=$(cat "$T"/v? | awk '/win/{print $2}'); N=$(echo "$W" | grep -c .)
  if [ "$N" -gt 1 ]; then BAD=$((BAD+1)); elif [ "$N" = 1 ]; then
    [ "$(cat "$D/pid" "$T"/r4.lock.stale.*/pid 2>/dev/null | grep -cx "$W")" -ge 1 ] || BAD=$((BAD+1)); fi; done
check "4 racing reclaimers: <=1 winner, winner lock kept" '[ $BAD = 0 ]'
# 14 test-lanes comes from the checkout under test when it has one
mkdir -p "$T/pr/scripts"; touch "$T/pr/scripts/test-lanes.sh"
check "lane tests run from the PR worktree" '[ "$(. scripts/lanelib.sh; lane_tests_path "$T/pr" /infra/scripts)" = "$T/pr/scripts/test-lanes.sh" ] && [ "$(. scripts/lanelib.sh; lane_tests_path "$T/none" /infra/scripts)" = /infra/scripts/test-lanes.sh ]'
# 15 proof-media branches: old ones (>14d) pruned, dry run by default
OLD=$(GIT_COMMITTER_DATE="$(( $(date +%s) - 20*86400 )) +0000" git commit-tree "$(git write-tree)" -m old-proof)
git push -q origin "$OLD:refs/heads/proof-media/old-run"
# 16 empty-pid lock: live during its grace period, stale after it; gate age is numeric
E="$T/empty.lock"; mkdir "$E"
check "empty-pid lock within grace is not taken" '! (. scripts/lanelib.sh; lock_take "$E")'
touch -t 202001010000 "$E"
check "empty-pid lock past grace is reclaimed" '(. scripts/lanelib.sh; lock_take "$E") && [ -s "$E/pid" ]'
check "_mtime/_age are numeric" '(. scripts/lanelib.sh; [ "$(_age "$E")" -ge 0 ] 2>/dev/null)'
# fake lane-guard: logs every call to $GLOG.all; for --dispatch logs "<args> lock=yes|no" (a unit lock
# still held at call time) to $GLOG; GSLEEP=n makes --dispatch sleep n s, log "done" and exit 1.
mkguard() { printf '#!/bin/sh\n[ "$1" = --help ] && { echo "usage: %s"; exit 2; }\necho "$*" >> "$GLOG.all"\n[ "$1" = --dispatch ] || exit 0\nl=no; ls -d "$LANES_HOME"/units/*.lock >/dev/null 2>&1 && l=yes\necho "$* lock=$l" >> "$GLOG"\n[ -n "${GSLEEP:-}" ] && { sleep "$GSLEEP"; echo done >> "$GLOG"; exit 1; }\nexit 0\n' "$2" > "$1"; chmod +x "$1"; }
waitfor() { local k; for k in $(seq 1 50); do grep -q -- "$2" "$1" 2>/dev/null && return 0; sleep 0.1; done; return 1; }   # ~5 s
ndisp() { cat "$1" 2>/dev/null | grep -c -- '^--dispatch'; }
FG="$T/fake-guard"; mkguard "$FG" "lane-guard --dispatch [lane]"; FGF="$T/fake-guard-fl"; mkguard "$FGF" "supports --free-lane"; CL="$LANES_HOME/logs/dispatch-chain.log"
# 17 failed unit: brief re-queued and the freed lane refilled at once (one --dispatch, after lock release)
export GLOG="$T/g17"
OUT=$(LANE_GUARD="$FG" LANE_FORCE_FAIL=laneA LANE_CHAIN_MIN_S=0 $RL laneA "$(task 'Failover guard' t8)" 2>&1); waitfor "$GLOG" dispatch
check "failure: preflight ran, re-queued, laneB not run, exactly one dispatch after lock release" 'echo "$OUT" | grep -q "REQUEUED after: laneA" && grep -q "^--preflight" "$GLOG.all" && [ "$(ndisp "$GLOG")" = 1 ] && grep -q "lock=no" "$GLOG" && ! grep -q "failover-guard	running	laneB" "$LANES_HOME/events.tsv"'
for k in $(seq 1 50); do [ -d "$LANES_HOME/dispatch-chain.lock" ] || break; sleep 0.1; done; rm -f "$LANES_HOME"/queue/*.task
export GLOG="$T/g17b"
OUT=$(LANE_GUARD="$FGF" LANE_FORCE_FAIL=laneA LANE_CHAIN_MIN_S=0 $RL laneA "$(task 'Failover refill' t8b)" 2>&1); waitfor "$GLOG" "free-lane"
check "lane freed by a failure is refilled immediately (--free-lane laneA), retry left in queue for it" 'grep -q "^--dispatch --free-lane laneA lock=no" "$GLOG" && ls "$LANES_HOME"/queue/*-failover-refill-retry.task >/dev/null'
for k in $(seq 1 50); do [ -d "$LANES_HOME/dispatch-chain.lock" ] || break; sleep 0.1; done; rm -f "$LANES_HOME"/queue/*.task
# 17d missing toolchain: verify.sh preflight -> infra (exit 10), not a task failure, no --task-end (PAUSE), no chain
export GLOG="$T/g17d"; mkdir -p "$T/emptybin"; printf 'needs: go\nexpected_min: 5\nInfra tool\n' > "$T/t8d.task"
OUT=$(VERIFY_PATH="$T/emptybin" LANE_GUARD="$FGF" LANE_STUB_CMD="$STUB_OK" $RL laneA "$T/t8d.task" 2>&1); RC=$?; sleep 1
check "missing toolchain: infra error (exit 10), failures.tsv infra row, NEEDS_CODY names the tool" '[ $RC = 10 ] && echo "$OUT" | grep -q "INFRA: missing toolchain: go" && grep -q "	infra	laneA	missing toolchain: go" "$LANES_HOME/failures.tsv" && grep -q "INFRA missing toolchain.*: go" "$LANES_HOME/NEEDS_CODY"'
check "missing toolchain: no --task-end (PAUSE), no fail streak, no failover, task held not failed" '! grep -q "^--task-end" "$GLOG.all" && [ ! -e "$LANES_HOME/chain-fails/infra-tool" ] && ! grep -q "infra-tool	running	laneB" "$LANES_HOME/events.tsv" && ls "$LANES_HOME"/queue-hold/*-infra-tool-infra.task >/dev/null && ! grep -q "	Infra tool	" "$LANES_HOME/failures.tsv"'
# 20 continuing an existing PR: size measured from the branch head at unit start; open PR -> comment, no new PR
GB="$T/ghbin"; mkdir -p "$GB"; printf '#!/bin/sh\necho "$*" >> "%s/gh.log"\ncase "$1 $2" in\n"pr list") cat "%s/openpr" 2>/dev/null;;\n"pr create") echo https://github.com/o/r/pull/100;;\nesac\nexit 0\n' "$T" "$T" > "$GB/gh"; chmod +x "$GB/gh"
git checkout -q -b test/big main; seq 1 400 > big.txt; git add big.txt; git commit -qm "big earlier work" -m "Lane: laneA/opencode"; git checkout -q main
OUT=$(LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Continue big' t20)" --branch test/big 2>&1); RC=$?
check "size cap counts only this unit's work, not the whole branch" '[ $RC = 0 ] && echo "$OUT" | grep -q "DRY-OK laneA" && ! echo "$OUT" | grep -q "changed lines >"'
git push -q origin test/big:refs/heads/test/open; echo https://github.com/o/r/pull/55 > "$T/openpr"; : > "$T/gh.log"
VC2='mkdir -p .build/proof && echo "## ok" > .build/proof/summary.md && echo unit-test-verified > .build/proof/level'
OUT=$(PATH="$GB:$PATH" LANE_VERIFY_CMD="$VC2" LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Continue open' t21)" --branch test/open 2>&1); RC=$?
NH=$(git ls-remote origin refs/heads/test/open | cut -f1)
check "open PR: pushed, commented new head, no new PR, success recorded" '[ $RC = 0 ] && ! grep -q "^pr create" "$T/gh.log" && grep -q "^pr comment https://github.com/o/r/pull/55 .*new head $NH" "$T/gh.log" && [ "$NH" != "$(git rev-parse test/big)" ] && grep -q "continue-open	https://github.com/o/r/pull/55	$NH" "$LANES_HOME/results.tsv" && [ -f "$LANES_HOME/cards/continue-open.wt" ]'
# 21 PR body footer, build-only existing PR -> draft, gh pr list error, local branch behind origin
G2="$T/ghbin2"; mkdir -p "$G2"; cat > "$G2/gh" <<GH
#!/bin/bash
echo "\$1 \$2 \$3" >> "$T/gh2.log"; k="\$1-\$2"; b=""; while [ \$# -gt 0 ]; do [ "\$1" = --body ] && b=\$2; shift; done
[ -n "\$b" ] && printf '%s' "\$b" > "$T/body-\$k"
case \$k in pr-list) [ -f "$T/listfail" ] && exit 1; cat "$T/openpr2" 2>/dev/null;; pr-create) echo https://github.com/o/r/pull/101;; esac; exit 0
GH
chmod +x "$G2/gh"; VC3='mkdir -p .build/proof && echo "## ok" > .build/proof/summary.md && echo build-only > .build/proof/level'
endsrn() { python3 -c 'import sys; sys.exit(not open(sys.argv[1]).read().endswith("Release Notes:\n\n- N/A"))' "$1"; }
: > "$T/gh2.log"; OUT=$(PATH="$G2:$PATH" LANE_VERIFY_CMD="$VC3" LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Footer new' t22)" --branch test/footer-new 2>&1); RC=$?
check "new PR body ends in Release Notes / blank line / - N/A (build-only -> draft create)" '[ $RC = 0 ] && endsrn "$T/body-pr-create" && grep -q "Release Notes:" "$T/body-pr-create"'
git push -q origin main:refs/heads/test/footer-open; echo https://github.com/o/r/pull/56 > "$T/openpr2"; : > "$T/gh2.log"
OUT=$(PATH="$G2:$PATH" LANE_VERIFY_CMD="$VC3" LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Footer open' t23)" --branch test/footer-open 2>&1); RC=$?
check "existing PR: comment ends in the Release Notes footer" '[ $RC = 0 ] && endsrn "$T/body-pr-comment"'
check "existing PR at build-only is marked draft (pr ready --undo)" 'grep -q "^pr ready --undo" "$T/gh2.log" && ! grep -q "^pr create" "$T/gh2.log"'
git push -q origin main:refs/heads/test/listfail; touch "$T/listfail"; : > "$T/gh2.log"
OUT=$(PATH="$G2:$PATH" LANE_FORCE_FAIL=laneB LANE_VERIFY_CMD="$VC3" LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'List fails' t24)" --branch test/listfail 2>&1); RC=$?; rm -f "$T/listfail" "$T/openpr2"
check "gh pr list error: explicit failure, no PR created or commented" '[ $RC != 0 ] && grep -q "gh pr list failed" "$LANES_HOME/events.tsv" && ! grep -qE "^pr (create|comment)" "$T/gh2.log"'
git branch -q test/behind main; git checkout -q -b tmp-ahead main; echo ahead > ahead.txt; git add ahead.txt; git commit -qm ahead; git push -q origin tmp-ahead:refs/heads/test/behind; AH=$(git rev-parse HEAD); git checkout -q main; git fetch -q origin
OUT=$(LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Behind origin' t25)" --branch test/behind 2>&1); RC=$?
check "local branch behind origin is fast-forwarded before the agent runs" '[ $RC = 0 ] && git -C "$LANES_WT/laneA-behind-origin" merge-base --is-ancestor "$AH" HEAD'
# 8 cleanup dry run: dirty and unpushed kept, merged removable, nothing deleted
git worktree add -q -b c/dirty "$HOME/code/wt/dirty" main && echo x > "$HOME/code/wt/dirty/README"
git worktree add -q -b c/unpushed "$HOME/code/wt/unpushed" main && (cd "$HOME/code/wt/unpushed" && echo y > u && git add u && git commit -qm u)
git worktree add -q --detach "$HOME/code/wt/merged" main
git worktree add -q --detach "$HOME/code/wt/localonly" scope-test
OUT=$(PATH="$T/bin:$PATH"; mkdir -p "$T/bin"; printf '#!/bin/sh\n[ "$3" = devices ] && echo "{\\"devices\\":{}}"; exit 0\n' > "$T/bin/xcrun"; chmod +x "$T/bin/xcrun"; bash scripts/cleanup.sh 2>&1)
check "cleanup keeps dirty" 'echo "$OUT" | grep -q "keep: $HOME/code/wt/dirty (uncommitted"'
check "cleanup keeps unpushed" 'echo "$OUT" | grep -q "keep: $HOME/code/wt/unpushed (unpushed"'
check "cleanup keeps detached HEAD not on a remote" 'echo "$OUT" | grep -q "keep: $HOME/code/wt/localonly (detached HEAD not on any remote"'
check "cleanup would prune old proof branch only" 'echo "$OUT" | grep -q "would: .*--delete proof-media/old-run" && ! echo "$OUT" | grep -q "delete proof-media/verify-vo-one"'
check "dry run kept the old proof branch" 'git ls-remote --exit-code origin refs/heads/proof-media/old-run >/dev/null'
check "cleanup would remove merged" 'echo "$OUT" | grep -q "remove: $HOME/code/wt/merged (merged=1"'
check "cleanup dry run deleted nothing" '[ -d "$HOME/code/wt/merged" ] && echo "$OUT" | grep -q "dry run"'
PATH="$T/bin:$PATH" bash scripts/cleanup.sh --apply >/dev/null 2>&1
# 8b cleanup never deletes a shut-down sim whose verify is still running (live verify.lock or fresh marker)
SB="$T/simbin"; mkdir -p "$SB" "$LANES_HOME/locks/active"; git worktree add -q --detach "$HOME/code/wt/vlive" main
mkdir -p "$HOME/code/wt/vlive/.build/verify.lock"; echo $$ > "$HOME/code/wt/vlive/.build/verify.lock/pid"
touch "$LANES_HOME/locks/active/polymux-prv-fresh"; touch -t 202001010000 "$LANES_HOME/locks/active/polymux-old-gone"
printf '#!/bin/sh\necho "$*" >> "%s/simctl.log"\n[ "$3" = devices ] && echo "{\\"devices\\":{\\"r\\":[{\\"udid\\":\\"U1\\",\\"name\\":\\"polymux-vlive\\",\\"state\\":\\"Shutdown\\"},{\\"udid\\":\\"U2\\",\\"name\\":\\"polymux-prv-fresh\\",\\"state\\":\\"Shutdown\\"},{\\"udid\\":\\"U3\\",\\"name\\":\\"polymux-old-gone\\",\\"state\\":\\"Shutdown\\"}]}}"\nexit 0\n' "$T" > "$SB/xcrun"; chmod +x "$SB/xcrun"; : > "$T/simctl.log"
OUT=$(PATH="$SB:$T/bin:$PATH" bash scripts/cleanup.sh --apply 2>&1)
check "cleanup keeps worktree + sim with a live verify.lock and a sim with a fresh marker; deletes the stale one" 'echo "$OUT" | grep -q "keep: $HOME/code/wt/vlive (in use" && ! grep -q "delete U1" "$T/simctl.log" && ! grep -q "delete U2" "$T/simctl.log" && grep -q "simctl delete U3" "$T/simctl.log" && echo "$OUT" | grep -q "keep: polymux-prv-fresh (verify running"'
rm -rf "$HOME/code/wt/vlive/.build"; git worktree remove "$HOME/code/wt/vlive"
check "--apply prunes old proof branch, keeps recent" '! git ls-remote --exit-code origin refs/heads/proof-media/old-run >/dev/null && [ "$(git ls-remote origin "refs/heads/proof-media/verify-vo-one-*" | wc -l | tr -d " ")" = 2 ]'
# 18 continuous dispatch: once, after the unit lock is released, background, non-fatal
export GLOG="$T/g18"; rm -rf "$LANES_HOME/chain-fails"
OUT=$(LANE_GUARD="$FG" LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Chain next' t16)" 2>&1); waitfor "$GLOG" dispatch
check "unit end dispatches next exactly once" '[ "$(ndisp "$GLOG")" = 1 ]'
check "dispatch called after unit lock release" 'grep -q "lock=no" "$GLOG" && ! grep -q "lock=yes" "$GLOG"'
export GLOG="$T/g18b"
OUT=$(GSLEEP=2 LANE_GUARD="$FG" LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Chain slow' t16b)" 2>&1); RC=$?; [ -f "$GLOG" ] && grep -q done "$GLOG"; DONE_AT_RETURN=$?
check "non-fatal: slow failing guard, run-lane returns at once with 0" '[ $RC = 0 ] && [ $DONE_AT_RETURN != 0 ] && waitfor "$GLOG" done'
for k in $(seq 1 50); do [ -d "$LANES_HOME/dispatch-chain.lock" ] || break; sleep 0.1; done   # chained call holds this lock until the guard exits
export GLOG="$T/g18c"
OUT=$(LANE_GUARD="$FGF" LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Chain freelane' t16c)" 2>&1); waitfor "$GLOG" dispatch
check "freed lane passed as --free-lane when lane-guard supports it" 'grep -q "^--dispatch --free-lane laneA lock=no" "$GLOG"'
export GLOG="$T/g18d"
OUT=$(LANE_NO_CHAIN=1 LANE_GUARD="$FG" LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Chain off' t17)" 2>&1)
check "LANE_NO_CHAIN disables dispatch" '[ "$(ndisp "$GLOG")" = 0 ]'
# 19 no chain on SIGTERM; a failing task never blocks refilling the lane, but its own queued retries are held
export GLOG="$T/g19"
LANE_GUARD="$FG" LANE_DRY=1 LANE_STUB_CMD='sleep 5' $RL laneA "$(task 'Chain term' t19)" >/dev/null 2>&1 & P=$!
for k in $(seq 1 50); do [ -d "$LANES_HOME/units/chain-term.lock" ] && break; sleep 0.1; done; kill -TERM $P; wait $P
check "SIGTERM: no dispatch" 'grep -q "chain-term rc=143: not chaining" "$CL" && [ "$(ndisp "$GLOG")" = 0 ]'
mkdir -p "$LANES_HOME/queue"; printf '# Chain short fail (attempt 2)\nneeds: none\n' > "$LANES_HOME/queue/r1.task"; printf '# Other card\nneeds: none\n' > "$LANES_HOME/queue/r2.task"
OUT=$(LANE_GUARD="$FGF" LANE_FORCE_FAIL="laneA laneB" $RL laneA "$(task 'Chain short fail' t19b)" 2>&1); waitfor "$GLOG" "free-lane laneA"
check "short failure: lane still refilled, same task's retry held, other card kept" 'grep -q "^--dispatch --free-lane laneA" "$GLOG" && [ -f "$LANES_HOME/queue-hold/r1.task" ] && [ -f "$LANES_HOME/queue/r2.task" ]'
rm -f "$LANES_HOME"/queue/*.task; for k in $(seq 1 50); do [ -d "$LANES_HOME/dispatch-chain.lock" ] || break; sleep 0.1; done
export GLOG="$T/g19c"
LANE_CHAIN_MIN_S=0 LANE_GUARD="$FG" LANE_FORCE_FAIL="laneA laneB" $RL laneA "$(task 'Chain fail one' t19c)" >/dev/null 2>&1; waitfor "$GLOG" "lock=no"
for k in $(seq 1 50); do [ -d "$LANES_HOME/dispatch-chain.lock" ] || break; sleep 0.1; done
R3=$(ls "$LANES_HOME"/queue/*-chain-fail-one-retry.task 2>/dev/null | head -1)
check "1st (long) failure: retry stays queued, lane refilled" '[ -n "$R3" ] && [ "$(ndisp "$GLOG")" = 1 ]'
cp "$R3" "$T/t19d.task"; mkdir -p "$LANES_HOME/queue"; printf '# Chain fail one (attempt 3)\nneeds: none\n' > "$LANES_HOME/queue/r3.task"; rm -f "$R3"
LANE_CHAIN_MIN_S=0 LANE_GUARD="$FG" LANE_FORCE_FAIL="laneA laneB" $RL laneA "$T/t19d.task" > "$T/o19d" 2>&1; sleep 1; [ -n "${TL_DEBUG:-}" ] && { cat "$T/o19d" "$T/t19d.task"; ls "$LANES_HOME/chain-fails"; }
for k in $(seq 1 50); do [ -d "$LANES_HOME/dispatch-chain.lock" ] || break; sleep 0.1; done
check "2nd failure of the same task: its retries held, lane still refilled (no global streak)" '[ "$(ndisp "$GLOG")" = 2 ] && [ -f "$LANES_HOME/queue-hold/r3.task" ] && [ "$(cat "$LANES_HOME/chain-fails/chain-fail-one")" = 2 ]'
rm -f "$LANES_HOME"/queue/*.task
# 19e global breaker: fast failures of 3 distinct tasks within the window -> PAUSE + NEEDS_CODY, no chain;
# repeats of one task and entries older than the window don't count
export GLOG="$T/g19e"; rm -f "$LANES_HOME/PAUSE" "$LANES_HOME/NEEDS_CODY"; printf '1000\told-task\n' > "$LANES_HOME/fast-fails.tsv"
bfail() { LANE_BREAKER_N=3 LANE_GUARD="$FG" LANE_FORCE_FAIL=laneA $RL laneA "$(task "$1" "$2")" >/dev/null 2>&1; sleep 0.3
  for k in $(seq 1 50); do [ -d "$LANES_HOME/dispatch-chain.lock" ] || break; sleep 0.1; done; rm -f "$LANES_HOME"/queue/*.task; }
bfail 'Brk one' tb1; bfail 'Brk one' tb1b; bfail 'Brk two' tb2
check "breaker: 2 distinct fast-failing tasks (one repeated, one stale entry) -> no PAUSE, still chaining" '[ ! -f "$LANES_HOME/PAUSE" ] && [ "$(ndisp "$GLOG")" = 3 ] && ! grep -q old-task "$LANES_HOME/fast-fails.tsv"'
bfail 'Brk three' tb3
check "breaker: 3rd distinct fast failure -> PAUSE + NEEDS_CODY BREAKER, no dispatch" '[ -f "$LANES_HOME/PAUSE" ] && grep -q "BREAKER: 3 distinct tasks failed fast" "$LANES_HOME/NEEDS_CODY" && [ "$(ndisp "$GLOG")" = 3 ] && grep -q "brk-three rc=1: not chaining (PAUSE set)" "$CL"'
rm -f "$LANES_HOME/PAUSE" "$LANES_HOME/NEEDS_CODY" "$LANES_HOME/fast-fails.tsv"
# 19f refill skipped after the ~10 s dispatch-chain lock wait is logged, not silent
export GLOG="$T/g19f"; mkdir -p "$LANES_HOME/dispatch-chain.lock"; echo $$ > "$LANES_HOME/dispatch-chain.lock/pid"
LANE_GUARD="$FG" LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Chain busy' t19f)" >/dev/null 2>&1
for k in $(seq 1 150); do grep -q "chain-busy: refill of lane laneA skipped" "$CL" && break; sleep 0.1; done; rm -rf "$LANES_HOME/dispatch-chain.lock"
check "chain lock busy ~10 s: refill skipped and logged, no dispatch" 'grep -q "chain-busy: refill of lane laneA skipped: .*dispatch-chain.lock busy" "$CL" && [ "$(ndisp "$GLOG")" = 0 ]'
# 21 queue-write.sh: validation, atomic locked writes, run-lane requeue shape
QWS="bash scripts/queue-write.sh"; QD="$LANES_HOME/queue"; mkdir -p "$QD"; rm -f "$QD"/*.task
printf 'needs: xcode\nexpected_min: 60\nbranch: x/y\n# Late title\n' > "$T/bad1.task"
OUT=$($QWS "$T/bad1.task" 2>&1); RC=$?
check "queue-write rejects title-not-first + branch-before-title, writes nothing" '[ $RC = 2 ] && grep -q "line 1 must be a" <<< "$OUT" && grep -q "branch: line 3 comes before the title" <<< "$OUT" && grep -q "rejected" <<< "$OUT" && ! ls "$QD"/*.task >/dev/null 2>&1'
OUT=$(printf '# T\nexpected_min: soon\nafter: pr:12 pr:abc branch-on-main:\npr: twelve\n' | $QWS - 2>&1); RC=$?
check "queue-write rejects missing needs, bad expected_min, bad after:/pr: refs" '[ $RC = 2 ] && grep -q "missing needs" <<< "$OUT" && grep -q "expected_min must be whole minutes" <<< "$OUT" && grep -q "\"pr:abc\"" <<< "$OUT" && grep -q "\"branch-on-main:\"" <<< "$OUT" && grep -q "pr: ref \"twelve\"" <<< "$OUT" && ! grep -q "pr:12\"" <<< "$OUT"'
printf '# Good brief\nneeds: none\nexpected_min: 30\nbranch: feat/x\nafter: pr:12 branch-on-main:agent/a-b\npr: #12\n\nDo the thing.\n' > "$T/good.task"
OUT=$($QWS --name good.task "$T/good.task" 2>&1); RC=$?
check "queue-write accepts a good brief, atomically, no temp left" '[ $RC = 0 ] && cmp -s "$T/good.task" "$QD/good.task" && ! ls -a "$QD" | grep -q "^\.queue-write" && [ "$(grep -c . <<< "$OUT")" = 1 ]'
OUT=$($QWS --name good.task "$T/good.task" 2>&1); RC=$?
check "queue-write never overwrites an existing brief without --force" '[ $RC = 4 ] && cmp -s "$T/good.task" "$QD/good.task"'
rm -f "$QD"/*.task
for mode in flock mkdir; do BAD=0
  for i in $(seq 1 6); do rm -f "$QD"/*.task
    for k in 1 2 3 4 5 6 7 8; do printf '# Racer %s\nneeds: none\nexpected_min: 5\n%s\n' "$k" "$(head -c 3000 /dev/zero | tr '\0' "$k")" > "$T/race$k.task"; done
    for k in 1 2 3 4 5 6 7 8; do ( [ $mode = mkdir ] && export QUEUE_LOCK_MKDIR=1; $QWS --name same.task "$T/race$k.task" >/dev/null 2>&1; $QWS - < "$T/race$k.task" >/dev/null 2>&1 ) & done; wait
    N=$(ls "$QD"/*.task | wc -l | tr -d ' '); W=0; for k in 1 2 3 4 5 6 7 8; do cmp -s "$QD/same.task" "$T/race$k.task" && W=$((W+1)); done
    OKALL=1; for f in "$QD"/*-racer-*.task; do M=0; for k in 1 2 3 4 5 6 7 8; do cmp -s "$f" "$T/race$k.task" && M=1; done; [ $M = 1 ] || OKALL=0; done
    { [ "$N" = 9 ] && [ $W = 1 ] && [ $OKALL = 1 ] && ! ls -a "$QD" | grep -q "^\.queue-write"; } || BAD=$((BAD+1)); done
  check "queue-write ($mode lock): 8 concurrent writers, nothing clobbered or torn" '[ $BAD = 0 ]'
done
rm -f "$QD"/*.task; rm -rf "$LANES_HOME/queue.lock.d"
if command -v flock >/dev/null 2>&1; then ( flock 9; sleep 3 ) 9>>"$LANES_HOME/queue.lock" & HP=$!; sleep 0.5
  OUT=$(QUEUE_LOCK_WAIT=1 $QWS "$T/good.task" 2>&1); RC=$?; wait $HP
  check "queue-write waits for the queue lock and gives up cleanly (exit 3)" '[ $RC = 3 ] && grep -q "busy" <<< "$OUT" && ! ls "$QD"/*.task >/dev/null 2>&1'
fi
printf 'needs: xcode\nexpected_min: 60\nbranch: goal/x\n# Fix me (attempt 2)\n\nbody\n' > "$QD/fixme.task"; printf 'no title at all\nneeds: none\n' > "$QD/human.task"
OUT=$($QWS --fix "$QD/fixme.task" "$QD/human.task" 2>&1); RC=$?
check "queue-write --fix moves the title up, leaves a non-obvious brief alone" '[ $RC = 2 ] && [ "$(head -1 "$QD/fixme.task")" = "# Fix me (attempt 2)" ] && $QWS --check "$QD/fixme.task" && grep -q "not fixed (needs a human): .*human.task" <<< "$OUT" && [ "$(head -1 "$QD/human.task")" = "no title at all" ]'
rm -f "$QD"/*.task
OUT=$(LANE_CHAIN_MIN_S=0 LANE_FORCE_FAIL=laneA $RL laneA "$(task 'Requeue shape' t21)" --branch test/rq-shape 2>&1)
RQ=$(ls "$QD"/*-requeue-shape-retry.task 2>/dev/null | head -1)
check "run-lane requeue goes through queue-write: title first, branch after it, valid" '[ -n "$RQ" ] && [ "$(head -1 "$RQ")" = "# Requeue shape (attempt 2)" ] && [ "$(grep -c "^branch: test/rq-shape$" "$RQ")" = 1 ] && $QWS --check "$RQ"'
for k in $(seq 1 50); do [ -d "$LANES_HOME/dispatch-chain.lock" ] || break; sleep 0.1; done; rm -f "$QD"/*.task
# 9 lanes.py per-host override
printf '[l]\nkey = "neutral"\nkey@hostx = "special"\n' > "$T/o.toml"
check "lanes.py host override" '[ "$(LANES_TOML=$T/o.toml LANES_HOST=hostx python3 scripts/lanes.py lane l key)" = special ] && [ "$(LANES_TOML=$T/o.toml LANES_HOST=y python3 scripts/lanes.py lane l key)" = neutral ]'
# 24 (#75) prompt names the size cap and this run's start commit
OUT=$(LANE_NO_CHAIN=1 LANE_DRY=1 LANE_STUB_CMD='printf "%s" "$PROMPT" > "$HOME/../prompt.txt"; '"$STUB_OK" $RL laneA "$(task 'Prompt start' p1)" 2>&1)
PS0=$(git -C "$LANES_WT/laneA-prompt-start" rev-parse HEAD~1)
check "prompt has size cap and the run's start commit (size base == START)" 'grep -q "Size cap: 300 changed lines" "$T/prompt.txt" && grep -q "git diff --stat $PS0..HEAD" "$T/prompt.txt"'
# 25 idle agent: whole process group stopped, no surviving grandchild
OUT=$(LANE_NO_CHAIN=1 LANE_IDLE_S=2 LANE_KILL_WAIT=1 LANE_STUB_CMD='trap "" TERM; (trap "" TERM; sleep 300) & echo $! > "$HOME/../gc.pid"; sleep 300' $RL laneA "$(task 'Idle group' p2)" 2>&1)
GC=$(cat "$T/gc.pid" 2>/dev/null); sleep 0.5
check "idle fast-fail kills the agent's whole process group (TERM-ignoring grandchild gone)" '[ -n "$GC" ] && ! kill -0 "$GC" 2>/dev/null && grep -q "fast-fail: idle 2s" "$LANES_HOME/events.tsv"'
rm -f "$LANES_HOME"/queue/*.task
# 26 worktree add fails once (path occupied by a file), then succeeds; agent runs once
: > "$T/runs"; echo x > "$LANES_WT/laneA-wt-retry"
OUT=$(LANE_NO_CHAIN=1 LANE_RETRY_SLEEP=0 LANE_DRY=1 LANE_STUB_CMD='echo r >> "$HOME/../runs"; '"$STUB_OK" $RL laneA "$(task 'Wt retry' p3)" 2>&1); RC=$?
check "worktree add retried after a failed attempt; agent ran exactly once" '[ $RC = 0 ] && [ "$(wc -l < "$T/runs" | tr -d " ")" = 1 ] && grep -q "worktree add failed (try 1)" "$LANES_HOME"/logs/*wt-retry-laneA.log'
# 27 gh pr create fails twice then succeeds; agent ran once
G3="$T/ghbin3"; mkdir -p "$G3"; : > "$T/pc.n"
printf '#!/bin/bash\ncase "$1 $2" in\n"pr create") echo x >> "%s/pc.n"; [ $(wc -l < "%s/pc.n") -ge 3 ] && { echo https://github.com/o/r/pull/102; exit 0; }; exit 1;;\nesac\nexit 0\n' "$T" "$T" > "$G3/gh"; chmod +x "$G3/gh"; : > "$T/runs"
OUT=$(PATH="$G3:$PATH" LANE_NO_CHAIN=1 LANE_RETRY_SLEEP=0 LANE_VERIFY_CMD="$VC2" LANE_STUB_CMD='echo r >> "$HOME/../runs"; '"$STUB_OK" $RL laneA "$(task 'Pr retry' p4)" --branch test/pr-retry 2>&1); RC=$?
check "gh pr create fails twice then succeeds; agent ran once" '[ $RC = 0 ] && echo "$OUT" | grep -q pull/102 && [ "$(wc -l < "$T/pc.n" | tr -d " ")" = 3 ] && [ "$(wc -l < "$T/runs" | tr -d " ")" = 1 ]'
# 23 wt-setup warms the sim template once; failed warms are capped; markers live under LANES_HOME
WS="$T/warmbin"; mkdir -p "$WS"; : > "$T/warm.log"
cat > "$WS/xcrun" <<XC
#!/bin/bash
echo "\$*" >> "$T/warm.log"
case "\$2" in
  list) [ "\$3" = devices ] && echo '{"devices":{"r":[{"name":"polymux-template","udid":"TPL1","isAvailable":true}]}}';;
  bootstatus) [ -f "$T/warmfail" ] && exit 1; exit 0;;
  clone) echo CLONE1;;
esac; exit 0
XC
chmod +x "$WS/xcrun"; git worktree add -q --detach "$T/wsA" main
WSR() { (cd "$T/wsA" && PATH="$WS:$PATH" SIM_WARM_SETTLE=0 SIM_WARM_TIMEOUT=5 bash scripts/wt-setup.sh) >/dev/null 2>&1; }
touch "$T/warmfail"; WSR; WSR; WSR
check "warm failures capped at 2 attempts, counted under LANES_HOME" '[ "$(grep -c "simctl bootstatus" "$T/warm.log")" = 2 ] && [ "$(cat "$LANES_HOME/.sim-warm-fail-TPL1")" = 2 ] && [ ! -e "$LANES_HOME/.sim-warm-TPL1" ]'
rm -f "$T/warmfail" "$LANES_HOME/.sim-warm-fail-TPL1"; : > "$T/warm.log"; WSR; WSR
check "successful warm runs once, then the marker skips it" '[ "$(grep -c "simctl bootstatus" "$T/warm.log")" = 1 ] && [ -f "$LANES_HOME/.sim-warm-TPL1" ] && [ ! -e "$LANES_HOME/.sim-warm-fail-TPL1" ]'
git worktree remove --force "$T/wsA"
# 28 stale worktree holding the branch (free_branch before git worktree add)
mkbr() { git branch -q "$1" main; git checkout -q "$1"; echo "$1" > "br-$(echo "$1" | tr / -).txt"; git add -A; git commit -qm "$1"; git push -q origin "$1"; git checkout -q main; }
mkbr test/stale1; git worktree add -q "$T/stalewt1" test/stale1
OUT=$(LANE_NO_CHAIN=1 LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Stale clean' s1)" --branch test/stale1 2>&1); RC=$?
check "clean stale worktree holding the branch is removed, run proceeds" '[ $RC = 0 ] && [ ! -d "$T/stalewt1" ] && grep -q "removed stale worktree $T/stalewt1" "$LANES_HOME"/logs/*stale-clean-laneA.log'
mkbr test/stale2; git worktree add -q "$T/stalewt2" test/stale2; echo wip > "$T/stalewt2/wip.txt"
OUT=$(LANE_NO_CHAIN=1 LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Stale dirty' s2)" --branch test/stale2 2>&1); RC=$?
check "dirty stale worktree is detached with its changes kept, run proceeds" '[ $RC = 0 ] && [ -f "$T/stalewt2/wip.txt" ] && [ -z "$(git -C "$T/stalewt2" branch --show-current)" ]'
git worktree remove --force "$T/stalewt2"
mkbr test/stale3; git worktree add -q "$T/stalewt3" test/stale3; (cd "$T/stalewt3" && exec sleep 60) & SP=$!; for k in $(seq 1 100); do lsof -d cwd -Fn 2>/dev/null | grep -q "^n$T/stalewt3$" && break; sleep 0.1; done   # wait until the live cwd is visible (load)
OUT=$(LANE_NO_CHAIN=1 LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Stale live' s3)" --branch test/stale3 2>&1); RC=$?
kill $SP 2>/dev/null; wait $SP 2>/dev/null
check "worktree in use by a live process is left alone (no remove, no detach)" '[ $RC != 0 ] && [ -d "$T/stalewt3" ] && [ "$(git -C "$T/stalewt3" branch --show-current)" = test/stale3 ] && grep -q "live process; leaving it" "$LANES_HOME"/logs/*stale-live-laneA.log'
git worktree remove --force "$T/stalewt3"; rm -f "$LANES_HOME/queue/"*.task
# 28b free_branch fails closed: failing/missing lsof, live verify lock, held unit lock
FL="$T/failsof"; mkdir -p "$FL"; printf '#!/bin/sh\nexit 1\n' > "$FL/lsof"; chmod +x "$FL/lsof"
mkbr test/stale5; git worktree add -q "$T/stalewt5" test/stale5
OUT=$(PATH="$FL:$PATH" LANE_NO_CHAIN=1 LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Stale nolsof' s5)" --branch test/stale5 2>&1); RC=$?
check "lsof failing with no output: worktree left alone (fail closed)" '[ $RC != 0 ] && [ -d "$T/stalewt5" ] && [ "$(git -C "$T/stalewt5" branch --show-current)" = test/stale5 ] && grep -q "fail closed" "$LANES_HOME"/logs/*stale-nolsof-laneA.log'
NL=$(PATH=/nonexistent; . scripts/lanelib.sh; cwd_in_use "$T/stalewt5"; echo $?)
check "lsof missing: cwd_in_use reports unknown (2)" '[ "$NL" = 2 ]'
git worktree remove --force "$T/stalewt5"; rm -f "$LANES_HOME/queue/"*.task
mkbr test/stale6; git worktree add -q "$T/stalewt6" test/stale6; sleep 60 & VP=$!; mkdir -p "$T/stalewt6/.build/verify.lock"; echo $VP > "$T/stalewt6/.build/verify.lock/pid"
OUT=$(LANE_NO_CHAIN=1 LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Stale verify' s6)" --branch test/stale6 2>&1); RC=$?
kill $VP; wait $VP 2>/dev/null
check "live .build/verify.lock (no process cwd in the tree): worktree left alone" '[ $RC != 0 ] && [ -d "$T/stalewt6" ] && [ "$(git -C "$T/stalewt6" branch --show-current)" = test/stale6 ] && grep -q "which is in use" "$LANES_HOME"/logs/*stale-verify-laneA.log'
git worktree remove --force "$T/stalewt6"; rm -f "$LANES_HOME/queue/"*.task
mkbr test/stale7; git worktree add -q "$T/laneZ-held-unit7" test/stale7; sleep 60 & UP=$!; mkdir -p "$LANES_HOME/units/held-unit7.lock"; echo $UP > "$LANES_HOME/units/held-unit7.lock/pid"
OUT=$(LANE_NO_CHAIN=1 LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Stale unit' s7)" --branch test/stale7 2>&1); RC=$?
kill $UP; wait $UP 2>/dev/null; rm -rf "$LANES_HOME/units/held-unit7.lock"
check "held unit lock for the worktree: worktree left alone" '[ $RC != 0 ] && [ -d "$T/laneZ-held-unit7" ] && [ "$(git -C "$T/laneZ-held-unit7" branch --show-current)" = test/stale7 ]'
git worktree remove --force "$T/laneZ-held-unit7"; rm -f "$LANES_HOME/queue/"*.task
mkbr test/div; git checkout -q test/div; echo local > div.txt; git add -A; git commit -qm local-only; LOC=$(git rev-parse HEAD); git checkout -q main
git worktree add -q --detach "$T/divpush" origin/test/div; (cd "$T/divpush" && echo remote > div2.txt && git add -A && git commit -qm remote-only && git push -q origin HEAD:test/div); git worktree remove --force "$T/divpush"; git fetch -q origin
OUT=$(LANE_NO_CHAIN=1 LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Div branch' s4)" --branch test/div 2>&1); RC=$?
check "diverged local branch kept as cody-stale/<branch>-<sha>, run continues from origin" '[ $RC = 0 ] && [ "$(git rev-parse "cody-stale/test/div-${LOC:0:7}")" = "$LOC" ] && git merge-base --is-ancestor origin/test/div test/div'
rm -f "$LANES_HOME/queue/"*.task
# 16 board-update.sh (Notion board) cases
. "$SRC/scripts/test-board.sh"
[ -n "${TL_DEBUG:-}" ] && echo "$OUT"
echo "test-lanes: $PASS passed, $FAILS failed"; [ $FAILS = 0 ]
