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
# Warm the template once (first boot builds dyld/data caches) so clones boot fast. Marker = done.
WARM="$HOME/ops/lanes/.sim-warm-$T"
if [ ! -f "$WARM" ]; then
  xcrun simctl boot "$T" >/dev/null 2>&1 || true
  perl -e 'alarm shift; exec @ARGV' 600 xcrun simctl bootstatus "$T" -b >/dev/null 2>&1 && sleep 60 && touch "$WARM"
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
