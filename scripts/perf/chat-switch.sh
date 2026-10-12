#!/usr/bin/env bash
# Release-build chat switching and fail when cached reselects miss the budget.
# Opens 10 chats, reselects 5, and records click-to-content time.
# On macOS, an installed PolymuxUITests target can replace the numbers with
# os_signpost intervals (subsystem com.polymux.chat, click -> content).
set -euo pipefail

budget=50
while [[ $# -gt 0 ]]; do
  case "$1" in
    --budget-ms)
      budget="${2:?missing milliseconds}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/perf/out"
mkdir -p "$out"
report="$out/chat-switch.json"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

export POLYMUX_PERF_OUT="$report"
swift build -c release --package-path "$root/packages/PolymuxKit"
swift test -c release --package-path "$root/packages/PolymuxKit" \
  --filter 'ChatStoreCacheTests|ChatStoreDeltaTests' | tee "$log"

if [[ ! -f "$report" ]]; then
  line="$(grep 'CHAT_SWITCH ' "$log" | tail -1 || true)"
  if [[ -z "$line" ]]; then
    echo "chat switch report was not produced" >&2
    exit 1
  fi
  printf '%s\n' "${line#CHAT_SWITCH }" > "$report"
fi

python3 - "$report" "$budget" <<'PY'
import json, sys
path, budget = sys.argv[1], float(sys.argv[2])
with open(path) as handle:
    report = json.load(handle)
report["budget_ms"] = budget
after = float(report["after_p95_ms"])
hangs = int(report["hangs_over_16ms"])
with open(path, "w") as handle:
    json.dump(report, handle, indent=2)
    handle.write("\n")
print(
    f"before p95 {report['before_p95_ms']:.3f} ms, "
    f"after p95 {after:.3f} ms, hangs {hangs}, budget {budget:.0f} ms"
)
if after >= budget or hangs:
    sys.exit(1)
PY
