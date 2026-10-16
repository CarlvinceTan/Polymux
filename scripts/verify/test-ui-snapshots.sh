#!/bin/bash
# Hermetic checks for ui_snapshots.sh MA2 mode: a stubbed toolchain records what the script does to
# the real-view renderer. No build, no simulator, no network.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
scratch=$(mktemp -d "$root/.build/snapshot-test.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/bin"
cat > "$scratch/bin/swift" <<'STUB'
#!/bin/bash
printf '%s\n' "$*" >> "$SNAPSHOT_TEST_SWIFT_LOG"
if [[ " $* " == *' --show-bin-path '* ]]; then printf '%s\n' "$SNAPSHOT_TEST_ROOT"; fi
STUB
cat > "$scratch/bin/swiftc" <<'STUB'
#!/bin/bash
printf '%s\n' "$@" >> "$SNAPSHOT_TEST_ARGS"
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then
    shift
    printf '#!/bin/bash\nprintf "%%s\\n" "$1" > "$SNAPSHOT_TEST_CAPTURE"\nexit "${SNAPSHOT_TEST_RENDER_EXIT:-73}"\n' > "$1"
    chmod +x "$1"
    exit 0
  fi
  shift
done
exit 1
STUB
chmod +x "$scratch/bin/"*
export PATH="$scratch/bin:$PATH" SNAPSHOT_TEST_ROOT="$scratch" MA2_MAC_ONLY=1
export SNAPSHOT_TEST_CAPTURE="$scratch/captured" SNAPSHOT_TEST_ARGS="$scratch/args" SNAPSHOT_TEST_SWIFT_LOG="$scratch/swift"
: > "$SNAPSHOT_TEST_ARGS"; : > "$SNAPSHOT_TEST_SWIFT_LOG"

for source in Avatar/AvatarOptions.swift Avatar/AvatarPalette.swift AvatarUI/AvatarView.swift; do
  [ -f "$root/apps/Polymux/Sources/$source" ] || { echo "FAIL: missing default snapshot source $source"; exit 1; }
  grep -q "Sources/$source" "$root/scripts/verify/ui_snapshots.sh" || { echo "FAIL: default snapshot omits $source"; exit 1; }
done
grep -q 'Sources/Views/PanelSurface.swift' "$root/scripts/verify/ui_snapshots.sh" || { echo "FAIL: default snapshot omits PanelSurface.swift"; exit 1; }

# run OUTPUT -> status; the script's combined output lands in $scratch/log
run() {
  set +e
  bash "$root/scripts/verify/ui_snapshots.sh" MA2 "$1" > "$scratch/log" 2>&1
  status=$?
  set -e
}
fail() { printf 'FAIL: %s\n' "$1"; exit 1; }

# The renderer must be handed the resolved output path, absolute or relative.
for output in "$scratch/absolute output" ".build/$(basename "$scratch")/relative output"; do
  run "$output"
  [ "$status" = 73 ] || { cat "$scratch/log"; fail "MA2 did not invoke the view renderer"; }
  expected="$output"
  [[ "$expected" = /* ]] || expected="$root/$expected"
  actual=$(cat "$SNAPSHOT_TEST_CAPTURE")
  [ "$actual" = "$expected" ] || fail "renderer output path: expected $expected, got $actual"
  echo "PASS: renderer receives the resolved output path: $output"
done

# Both new views are compiled into the renderer, so dropping one cannot silently pass.
for view in EmojiPicker MessageMenu; do
  grep -q "/$view.swift" "$SNAPSHOT_TEST_ARGS" || fail "the renderer does not compile $view.swift"
  echo "PASS: renderer compiles $view.swift"
done

# A renderer that fails must fail the script, or a broken view could report a clean run.
export SNAPSHOT_TEST_RENDER_EXIT=1
run "$scratch/failing output"
unset SNAPSHOT_TEST_RENDER_EXIT
[ "$status" = 1 ] || { cat "$scratch/log"; fail "a failing renderer exited $status, not 1"; }
echo "PASS: renderer failure fails the script"

# SNAPSHOT_PRODUCTS reuses an existing build: no swift build, swiftc links the given products.
: > "$SNAPSHOT_TEST_SWIFT_LOG"
export SNAPSHOT_PRODUCTS="$scratch/products"
run "$scratch/reused output"
unset SNAPSHOT_PRODUCTS
[ ! -s "$SNAPSHOT_TEST_SWIFT_LOG" ] || fail "SNAPSHOT_PRODUCTS still built the package"
grep -qx -- "$scratch/products" "$SNAPSHOT_TEST_ARGS" || fail "swiftc did not link the supplied products"
echo "PASS: SNAPSHOT_PRODUCTS skips the build and links the given directory"
