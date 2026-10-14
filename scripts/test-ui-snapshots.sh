#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d "$root/.build/snapshot-test.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/bin"
cat > "$scratch/bin/swift" <<'STUB'
#!/bin/bash
if [[ " $* " == *' --show-bin-path '* ]]; then printf '%s\n' "$SNAPSHOT_TEST_ROOT"; fi
STUB
cat > "$scratch/bin/swiftc" <<'STUB'
#!/bin/bash
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then
    shift
    printf '#!/bin/bash\nprintf "%%s\\n" "$1" > "$SNAPSHOT_TEST_CAPTURE"\nexit 73\n' > "$1"
    chmod +x "$1"
    exit 0
  fi
  shift
done
exit 1
STUB
chmod +x "$scratch/bin/"*
export PATH="$scratch/bin:$PATH" SNAPSHOT_TEST_ROOT="$scratch"
export SNAPSHOT_TEST_CAPTURE="$scratch/captured"
for output in "$scratch/absolute output" ".build/$(basename "$scratch")/relative output"; do
  set +e
  bash "$root/scripts/ui_snapshots.sh" MA2 "$output" > "$scratch/log" 2>&1
  status=$?
  set -e
  if [ "$status" != 73 ]; then cat "$scratch/log"; echo "FAIL: MA2 did not invoke the view renderer"; exit 1; fi
  expected="$output"
  [[ "$expected" = /* ]] || expected="$root/$expected"
  actual=$(cat "$SNAPSHOT_TEST_CAPTURE")
  if [ "$actual" != "$expected" ]; then
    printf 'FAIL: renderer output path\nexpected: %s\nactual: %s\n' "$expected" "$actual"
    exit 1
  fi
  echo "PASS: renderer receives resolved output path: $output"
done
