#!/bin/bash
# test-affected.sh: hermetic tests for scripts/affected.py + scripts/verify-targets.sh (VERIFY_TARGETS).
# Stubs `go list` and `swift package dump-package`; temp git repo; no network, no toolchain. Exit 0 = all passed.
set -uo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd); T=$(cd "$(mktemp -d)" && pwd -P); trap 'rm -rf "$T"' EXIT
PASS=0; FAILS=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "ok   $1"; else FAILS=$((FAILS+1)); echo "FAIL $1"; fi; }
mkdir -p "$T/bin"
cat > "$T/bin/go" <<'GO'
#!/bin/bash
[ "$2" = "-m" ] && { echo example.com/srv; exit 0; }
echo "example.com/srv/internal/store|$PWD/internal/store| database/sql"
echo "example.com/srv/internal/server|$PWD/internal/server|example.com/srv/internal/store net/http"
echo "example.com/srv/cmd/server|$PWD/cmd/server|example.com/srv/internal/server"
echo "example.com/srv/internal/other|$PWD/internal/other|fmt"
GO
cat > "$T/bin/swift" <<'SW'
#!/bin/bash
[ -n "${SWIFT_FAIL:-}" ] && exit 1
cat <<'J'
{"targets":[
 {"name":"Kit","type":"regular","path":"packages/Kit/Sources/Kit","dependencies":[]},
 {"name":"AppCore","type":"regular","path":"packages/Kit/Sources/AppCore","dependencies":[{"byName":["Kit",null]}]},
 {"name":"KitTests","type":"test","path":"packages/Kit/Tests/KitTests","dependencies":[{"byName":["Kit",null]}]},
 {"name":"AppCoreTests","type":"test","path":"packages/Kit/Tests/AppCoreTests","dependencies":[{"byName":["AppCore",null]}]},
 {"name":"Other","type":"regular","path":"packages/Other/Sources/Other","dependencies":[]},
 {"name":"OtherTests","type":"test","path":"packages/Other/Tests/OtherTests","dependencies":[{"byName":["Other",null]}]}]}
J
SW
chmod +x "$T/bin/go" "$T/bin/swift"; export PATH="$T/bin:$PATH"
git init -q -b main "$T/repo"; cd "$T/repo"; git config user.name t; git config user.email t@test.invalid
mkdir -p scripts apps/server packages/Kit/Sources/Kit; cp "$SRC/scripts/affected.py" "$SRC/scripts/verify-targets.sh" scripts/
echo "// pkg" > Package.swift; echo "module example.com/srv" > apps/server/go.mod; echo x > packages/Kit/Sources/Kit/a.swift; echo "#!/bin/bash" > scripts/verify.sh
git add -A; git commit -qm base
aff() {  # aff PATH...: change PATHs on a fresh branch, run affected.py against main, eval its output
  git checkout -q -B t main; for p in "$@"; do mkdir -p "$(dirname "$p")"; echo "$RANDOM" >> "$p"; done; git add -A; git commit -qm t
  GO_PKGS=; SWIFT=; APP=; WHY=; eval "$(python3 scripts/affected.py main)"; }
aff apps/server/internal/store/run.go
check "Go: a shared package widens to its importers only" '[ "$GO_PKGS" = "./cmd/server ./internal/server ./internal/store" ] && [ -z "$SWIFT" ] && [ "$APP" = 0 ]'
aff packages/Kit/Sources/Kit/a.swift
check "Swift: a shared target widens to dependent test targets, app built" '[ "$SWIFT" = "^(AppCoreTests|KitTests)\." ] && [ "$APP" = 1 ] && [ -z "$GO_PKGS" ]'
aff tools/new-thing.sh
check "unknown path goes full" '[ "$GO_PKGS" = all ] && [ "$SWIFT" = all ] && [ "$APP" = 1 ]'
aff Package.swift; A1="$GO_PKGS $SWIFT $APP"; aff apps/server/go.mod
check "Package.swift goes full; go.mod means all Go packages" '[ "$A1" = "all all 1" ] && [ "$GO_PKGS" = all ]'
aff scripts/verify.sh; A1="$GO_PKGS $SWIFT $APP"; aff scripts/affected.py; A2="$GO_PKGS $SWIFT $APP"; aff scripts/templates/ReadinessTests.swift; A3="$GO_PKGS $SWIFT $APP"
check "verify tooling (verify.sh, affected.py, templates/) goes full" '[ "$A1" = "all all 1" ] && [ "$A2" = "all all 1" ] && [ "$A3" = "all all 1" ]'
aff scripts/run-lane.sh docs/x.md
check "lane-only scripts and docs stay inert (lane-tests cover them)" '[ -z "$GO_PKGS" ] && [ -z "$SWIFT" ] && [ "$APP" = 0 ]'
aff packages/Kit/Resources/new.json
check "ownerless non-doc file under packages/ runs every Swift target" '[ "$SWIFT" = all ] && [ "$APP" = 1 ]'
vt() { VT=; GO_PKGS=; SWIFT=; APP=; WHY=; eval "$(env "$@" bash scripts/verify-targets.sh main)"; }
aff packages/Kit/Sources/Kit/a.swift
vt -u VERIFY_TARGETS; check "VERIFY_TARGETS unset means full" '[ "$VT" = full ] && [ "$GO_PKGS" = ./... ] && [ "$SWIFT" = all ] && [ "$APP" = 1 ]'
vt VERIFY_TARGETS=affected SWIFT_FAIL=1; check "affected.py failing leads to full" '[ "$VT" = full ] && [ "$SWIFT" = all ] && [ "$APP" = 1 ] && [ "$WHY" = "affected.py failed" ]'
vt VERIFY_TARGETS=affected AFFECTED_PY=/dev/null; check "affected.py printing nothing leads to full" '[ "$VT" = full ] && [ "$GO_PKGS" = ./... ]'
vt VERIFY_TARGETS=affected; check "VERIFY_TARGETS=affected narrows" '[ "$VT" = affected ] && [ "$SWIFT" = "^(AppCoreTests|KitTests)\." ]'
echo "test-affected: $PASS passed, $FAILS failed"; [ $FAILS = 0 ]
