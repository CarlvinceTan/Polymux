#!/bin/bash
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
git init -q -b main "$T/repo"
mkdir -p "$T/repo/apps/server"

rc=0
(cd "$T/repo" && VERIFY_PATH=/nonexistent bash "$ROOT/scripts/verify/verify.sh") > "$T/output" 2>&1 || rc=$?
[ $rc = 10 ] || { echo "FAIL: missing toolchain exit $rc, want 10"; exit 1; }
grep -q "INFRA missing toolchain: go" "$T/output" || { echo "FAIL: missing tool not reported"; exit 1; }
[ "$(cat "$T/repo/.build/proof/level")" = blocked ] || { echo "FAIL: proof level not blocked"; exit 1; }
grep -q "verify.sh: INFRA" "$T/repo/.build/proof/summary.md" || { echo "FAIL: infra summary missing"; exit 1; }
echo "PASS: missing toolchain exits 10 with blocked proof"
