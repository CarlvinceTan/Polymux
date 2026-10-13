#!/bin/bash
# dispatch-guard.sh <unit-file> <target>   exit 0 = may dispatch, 4 = REFUSED (no claim, no retry)
# Rule (verify-before-done 7): Xcode/Swift work runs only on cvmini. Unit file fields:
#   unit: polymux/NC   needs: xcode,swift | go | none   scope: apps/Polymux/**,packages/X/*
# Used by run-lane.sh, pick-coder and any cloud launcher. Refusals go to Chief's intake
# (~/ops/events/dispatch-refusals.jsonl, one JSON line, notify Chief).
F=$1; T=${2:?target}; INTAKE=${DISPATCH_INTAKE:-$HOME/ops/events/dispatch-refusals.jsonl}
field() { [ -f "$F" ] && sed -n "s/^$1: *//p" "$F" | head -1; }
U=$(field unit); U=${U:-$(basename "$F" .task)}; N=$(field needs); S=$(field scope)
[ -z "$S" ] && [ -f "$F" ] && S=$(sed -n 's/^Files in scope: *//p' "$F" | head -1)   # goal-loop briefs
case $T in cvmini) OS=macos;; cvmac|*mac*) OS=macos;; *) OS=linux;; esac
refuse() { echo "$1"; mkdir -p "$(dirname "$INTAKE")"
  printf '{"ts":"%s","type":"dispatch_refused","unit":"%s","target":"%s","msg":"%s","notify":["Chief"],"delivered":false}\n' \
    "$(date -u +%FT%TZ)" "$U" "$T" "$(echo "$1" | sed 's/"/\\"/g')" >> "$INTAKE"; exit 4; }
APPLE=""; echo ",$N," | grep -qiE ',(xcode|swift|simulator|ios|macos|ios-sim),' && APPLE=$N
if echo "$S" | tr ',' '\n' | grep -qE '^apps/Polymux|\.swift$|\.xcodeproj|(^|/)Package\.swift$|PolymuxKit|/Sources/'; then
  APPLE=${APPLE:-xcode,swift}; fi
if [ -n "$APPLE" ] && [ "$T" != cvmini ]; then
  refuse "REFUSED $U -> $T ($OS): unit needs $APPLE (apps/Polymux macOS). Fix: dispatch to cvmini with \`ssh cvmini 'scripts/run-lane.sh <lane> $U'\`, or remove the Swift paths from the unit's scope. Rule: verify-before-done 7."
fi
[ -n "$N" ] || refuse "REFUSED $U: no \`needs:\` field. Fix: add e.g. \`needs: xcode,swift\` to the unit brief, then re-dispatch."
echo "dispatch OK: $U -> $T (needs $N)"
