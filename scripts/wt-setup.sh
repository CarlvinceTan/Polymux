#!/bin/bash
# Per-worktree isolation: DerivedData, SPM clone dir, result bundles, proof dir and a
# simctl-cloned simulator. Idempotent. Writes .build/env for verify.sh.
set -euo pipefail
SD=$(cd "$(dirname "$0")" && pwd); ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
WT=$(basename "$ROOT" | tr -c 'A-Za-z0-9-\n' '-')
B="$ROOT/.build"; mkdir -p "$B"/{DD,SPM,results,proof,modcache,logs}
grep -qx '.build/' .gitignore 2>/dev/null || echo '.build/' >> .git/info/exclude 2>/dev/null || echo '.build/' >> "$(git rev-parse --git-common-dir)/info/exclude"
DEVICE=$(python3 "$SD/lanes.py" get sim_device); TPL=$(python3 "$SD/lanes.py" get sim_template)
udid_of() { xcrun simctl list devices -j | python3 -c "import json,sys
n=sys.argv[1]
for r,ds in json.load(sys.stdin)['devices'].items():
  for d in ds:
    if d['name']==n and d.get('isAvailable'): print(d['udid']); raise SystemExit" "$1"; }
T=$(udid_of "$TPL")
if [ -z "$T" ]; then
  RT=$(xcrun simctl list runtimes -j | python3 -c "import json,sys
r=[x for x in json.load(sys.stdin)['runtimes'] if x['platform']=='iOS' and x['isAvailable']]; print(r[-1]['identifier'])")
  T=$(xcrun simctl create "$TPL" "$DEVICE" "$RT")
fi
# Warm the template once (first boot builds dyld/data caches) so clones boot fast.
# Markers under $LANES_HOME: .sim-warm-<udid> = done; .sim-warm-fail-<udid> counts failed attempts.
# After SIM_WARM_MAX (default 2) failures we stop retrying (clones still work, just boot slower).
OPS=${LANES_HOME:-$HOME/ops/lanes}; mkdir -p "$OPS"; WARM="$OPS/.sim-warm-$T"; WFAIL="$OPS/.sim-warm-fail-$T"
WN=$(cat "$WFAIL" 2>/dev/null || echo 0)
if [ ! -f "$WARM" ] && [ "$WN" -lt "${SIM_WARM_MAX:-2}" ]; then
  xcrun simctl boot "$T" >/dev/null 2>&1 || true
  if perl -e 'alarm shift; exec @ARGV' "${SIM_WARM_TIMEOUT:-600}" xcrun simctl bootstatus "$T" -b >/dev/null 2>&1; then
    sleep "${SIM_WARM_SETTLE:-60}"; touch "$WARM"; rm -f "$WFAIL"
  else echo $((WN+1)) > "$WFAIL"; echo "wt-setup: template warm failed (attempt $((WN+1)) of ${SIM_WARM_MAX:-2})" >&2; fi
  xcrun simctl shutdown "$T" >/dev/null 2>&1 || true
fi
SIM="polymux-$WT"; U=$(udid_of "$SIM")
[ -n "$U" ] || U=$(xcrun simctl clone "$T" "$SIM")
cat > "$B/env" <<E
WT_NAME=$WT
SIM_UDID=$U
DD=$B/DD
SPM=$B/SPM
E
echo "wt-setup: $WT sim=$U"
