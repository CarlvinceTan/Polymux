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
mkdir -p scripts agents; cp "$SRC"/scripts/{run-lane,verify,lanelib,dispatch-guard,cleanup,wt-setup,board-update}.sh "$SRC"/scripts/media-check.py "$SRC"/scripts/lanes.py scripts/
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
task() { printf 'needs: none\nexpected_min: 5\n%s\n' "$1" > "$T/$2.task"; echo "$T/$2.task"; }
STUB_OK='echo $RANDOM >> f.txt && git add f.txt && git commit -qm "stub change" -m "Lane: $LANE/$AGENT"'
RL="bash scripts/run-lane.sh"
# 1 happy path (dry): commit with trailer, lane identity in committer, locks released
OUT=$(LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Happy path' t1)" --branch test/happy 2>&1); RC=$?
check "dry happy path exits 0" '[ $RC = 0 ] && echo "$OUT" | grep -q "DRY-OK laneA"'
check "lane trailer present" 'git -C "$LANES_WT/laneA-happy-path" log -1 --format=%B | grep -q "^Lane: laneA/opencode"'
check "committer names lane" 'git -C "$LANES_WT/laneA-happy-path" log -1 --format=%cn | grep -q "(laneA/opencode)"'
check "unit + branch locks released" '! ls -d "$LANES_HOME"/units/*.lock "$LANES_HOME"/branches/*.lock 2>/dev/null | grep -q .'
# 2 forced failure on both lanes -> failover -> NEEDS_CODY + failures.tsv
OUT=$(LANE_FORCE_FAIL="laneA laneB" $RL laneA "$(task 'Always fails' t2)" 2>&1); RC=$?
check "forced failure exits 1 after failover" '[ $RC = 1 ] && echo "$OUT" | grep -q "FAILED after: laneA laneB"'
check "NEEDS_CODY + failures.tsv written" 'grep -q "Always fails" "$LANES_HOME/NEEDS_CODY" && grep -q "Always fails" "$LANES_HOME/failures.tsv"'
# 3 stop rule
$RL laneA "$(task 'Always fails' t3)" >/dev/null 2>&1; RC=$?
check "stop rule refuses a twice-failed brief (exit 2)" '[ $RC = 2 ]'
# 4 unit lock contention (live holder) and stale reclaim (dead holder)
mkdir -p "$LANES_HOME/units/unit-busy.lock"; echo $$ > "$LANES_HOME/units/unit-busy.lock/pid"
$RL laneA "$(task 'Unit busy' t4)" >/dev/null 2>&1; RC=$?
check "unit lock contention exits 3" '[ $RC = 3 ]'
echo 999999 > "$LANES_HOME/units/unit-busy.lock/pid"
OUT=$(LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Unit busy' t5)" 2>&1); RC=$?
check "stale unit lock is reclaimed" '[ $RC = 0 ]'
# 5 branch lock: same branch, different title -> laneA refused on the branch, laneB uses its own branch
BL="$LANES_HOME/branches/test%shared.lock"; mkdir -p "$BL"; echo $$ > "$BL/pid"
OUT=$(LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Other title' t6)" --branch test/shared 2>&1); RC=$?
check "branch lock blocks a second writer" 'grep -q "branch test/shared has another writer" "$LANES_HOME/events.tsv"'
check "failover lane writes its own branch" '[ $RC = 0 ] && echo "$OUT" | grep -q "DRY-OK laneB"'
rm -rf "$BL"
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
# 17 failover: no --dispatch while the unit runs, exactly one at its end
export GLOG="$T/g17"
OUT=$(LANE_GUARD="$FG" LANE_FORCE_FAIL=laneA LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Failover guard' t8)" 2>&1); waitfor "$GLOG" dispatch
check "failover ran laneB with preflight, no --dispatch before unit end, one at end" 'echo "$OUT" | grep -q "DRY-OK laneB" && grep -q "^--preflight" "$GLOG.all" && [ "$(ndisp "$GLOG")" = 1 ] && ! grep -q "lock=yes" "$GLOG"'
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
check "--apply prunes old proof branch, keeps recent" '! git ls-remote --exit-code origin refs/heads/proof-media/old-run >/dev/null && [ "$(git ls-remote origin "refs/heads/proof-media/verify-vo-one-*" | wc -l | tr -d " ")" = 2 ]'
# 18 continuous dispatch: once, after the unit lock is released, background, non-fatal
export GLOG="$T/g18"; rm -f "$LANES_HOME/chain-fails"
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
# 19 no chain on SIGTERM, on a short failure, or after 2 failed ends in a row
export GLOG="$T/g19"
LANE_GUARD="$FG" LANE_DRY=1 LANE_STUB_CMD='sleep 5' $RL laneA "$(task 'Chain term' t19)" >/dev/null 2>&1 & P=$!
for k in $(seq 1 50); do [ -d "$LANES_HOME/units/chain-term.lock" ] && break; sleep 0.1; done; kill -TERM $P; wait $P
check "SIGTERM: no dispatch" 'grep -q "chain-term rc=143: not chaining" "$CL" && [ "$(ndisp "$GLOG")" = 0 ]'
OUT=$(LANE_GUARD="$FG" LANE_FORCE_FAIL="laneA laneB" $RL laneA "$(task 'Chain short fail' t19b)" 2>&1)
check "failed unit shorter than LANE_CHAIN_MIN_S: no dispatch" 'grep -q "chain-short-fail rc=1: not chaining" "$CL" && [ "$(ndisp "$GLOG")" = 0 ]'
rm -f "$LANES_HOME/chain-fails"; export GLOG="$T/g19c"
LANE_CHAIN_MIN_S=0 LANE_GUARD="$FG" LANE_FORCE_FAIL="laneA laneB" $RL laneA "$(task 'Chain fail one' t19c)" >/dev/null 2>&1; waitfor "$GLOG" dispatch
LANE_CHAIN_MIN_S=0 LANE_GUARD="$FG" LANE_FORCE_FAIL="laneA laneB" $RL laneA "$(task 'Chain fail two' t19d)" >/dev/null 2>&1
check "2nd failed end in a row stops chaining" '[ "$(ndisp "$GLOG")" = 1 ] && grep -q "chain-fail-two rc=1: not chaining" "$CL" && [ "$(cat "$LANES_HOME/chain-fails")" = 2 ]'
# 9 lanes.py per-host override
printf '[l]\nkey = "neutral"\nkey@hostx = "special"\n' > "$T/o.toml"
check "lanes.py host override" '[ "$(LANES_TOML=$T/o.toml LANES_HOST=hostx python3 scripts/lanes.py lane l key)" = special ] && [ "$(LANES_TOML=$T/o.toml LANES_HOST=y python3 scripts/lanes.py lane l key)" = neutral ]'
# 16 board-update.sh (Notion board) cases
. "$SRC/scripts/test-board.sh"
[ -n "${TL_DEBUG:-}" ] && echo "$OUT"
echo "test-lanes: $PASS passed, $FAILS failed"; [ $FAILS = 0 ]
