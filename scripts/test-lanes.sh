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
mkdir -p scripts agents; cp "$SRC"/scripts/{run-lane,verify,lanelib,dispatch-guard,cleanup,wt-setup}.sh "$SRC"/scripts/lanes.py scripts/
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
# 8 cleanup dry run: dirty and unpushed kept, merged removable, nothing deleted
git worktree add -q -b c/dirty "$HOME/code/wt/dirty" main && echo x > "$HOME/code/wt/dirty/README"
git worktree add -q -b c/unpushed "$HOME/code/wt/unpushed" main && (cd "$HOME/code/wt/unpushed" && echo y > u && git add u && git commit -qm u)
git worktree add -q --detach "$HOME/code/wt/merged" main
OUT=$(PATH="$T/bin:$PATH"; mkdir -p "$T/bin"; printf '#!/bin/sh\n[ "$3" = devices ] && echo "{\\"devices\\":{}}"; exit 0\n' > "$T/bin/xcrun"; chmod +x "$T/bin/xcrun"; bash scripts/cleanup.sh 2>&1)
check "cleanup keeps dirty" 'echo "$OUT" | grep -q "keep: $HOME/code/wt/dirty (uncommitted"'
check "cleanup keeps unpushed" 'echo "$OUT" | grep -q "keep: $HOME/code/wt/unpushed (unpushed"'
check "cleanup would remove merged" 'echo "$OUT" | grep -q "remove: $HOME/code/wt/merged (merged=1"'
check "cleanup dry run deleted nothing" '[ -d "$HOME/code/wt/merged" ] && echo "$OUT" | grep -q "dry run"'
# 9 lanes.py per-host override
printf '[l]\nkey = "neutral"\nkey@hostx = "special"\n' > "$T/o.toml"
check "lanes.py host override" '[ "$(LANES_TOML=$T/o.toml LANES_HOST=hostx python3 scripts/lanes.py lane l key)" = special ] && [ "$(LANES_TOML=$T/o.toml LANES_HOST=y python3 scripts/lanes.py lane l key)" = neutral ]'
[ -n "${TL_DEBUG:-}" ] && echo "$OUT"
echo "test-lanes: $PASS passed, $FAILS failed"; [ $FAILS = 0 ]
