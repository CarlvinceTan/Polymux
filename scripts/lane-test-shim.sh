#!/bin/bash
# Lane test-tool shim: the PATH-first wrapper run-lane.sh installs for go, swift and xcodebuild so the
# lane watchdog counts the test processes an agent starts itself, not only the verifier's steps. It
# resolves the real tool past its own dir, streams its output through, and when that run fails appends
# the failing test names it printed to the attempt's live ledger (LANE_TEST_LOG, one line per name per
# run). Text the agent merely echoes never passes through here, so quoted output cannot trip the stop.
# verify.sh unsets LANE_TEST_SHIM: its steps keep counting their own failures once, via verify-step.sh.
set -uo pipefail
n=${0##*/}; d=$(cd "$(dirname "$0")" && pwd -P); f=$0
while [ -L "$f" ]; do l=$(readlink "$f"); case $l in /*) f=$l;; *) f=$(dirname "$f")/$l;; esac; done
SD=$(cd "$(dirname "$f")" && pwd -P)
P=$PATH; case $P in "$d":*) P=${P#*:};; esac   # look for the real tool past our own dir
R=$(PATH=$P command -v "$n" 2>/dev/null) || { echo "$n: command not found" >&2; exit 127; }
case $R in "$d"/*) echo "$n: shim loop at $R" >&2; exit 127;; esac
[ -n "${LANE_TEST_SHIM:-}" ] && [ -n "${LANE_TEST_LOG:-}" ] || exec "$R" "$@"
t=$(mktemp -d "${TMPDIR:-/tmp}/lane-test-shim.XXXXXX") || exec "$R" "$@"
trap 'rm -rf "$t"' EXIT
"$R" "$@" > >(tee "$t/out") 2> >(tee "$t/err" >&2); rc=$?
wait   # tee copies are children: without this the scan below can read a half-written file
if [ "$rc" != 0 ]; then . "$SD/lanelib.sh"
  { wd_fail_names < "$t/out"; wd_fail_names < "$t/err"; } | sort -u >> "$LANE_TEST_LOG" || true; fi
exit "$rc"
