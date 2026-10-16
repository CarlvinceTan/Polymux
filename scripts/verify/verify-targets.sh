#!/bin/bash
# verify-targets.sh BASE [LOG]: prints shell assignments VT GO_PKGS SWIFT APP WHY for verify.sh to eval.
# VERIFY_TARGETS unset or anything but "affected" -> full.
# affected -> affected.py; if it fails or prints nothing usable -> full. Fail toward full, never skip.
SD=$(cd "$(dirname "$0")" && pwd); BASE=${1:-origin/main}; LOG=${2:-/dev/null}
full() { printf "VT=full\nGO_PKGS=./...\nSWIFT=all\nAPP=1\nWHY=%q\n" "$1"; exit 0; }
[ "${VERIFY_TARGETS:-full}" = affected ] || full "VERIFY_TARGETS=${VERIFY_TARGETS:-unset}"
A=$(python3 "${AFFECTED_PY:-$SD/affected.py}" "$BASE" 2>"$LOG") || full "affected.py failed"
GO_PKGS=__unset SWIFT=__unset APP=__unset WHY=""; eval "$A" 2>/dev/null || full "affected.py output unparsable"
case "$GO_PKGS$SWIFT$APP" in *__unset*) full "affected.py output incomplete";; esac
[ "$GO_PKGS" = all ] && GO_PKGS=./...
printf "VT=affected\nGO_PKGS=%q\nSWIFT=%q\nAPP=%q\nWHY=%q\n" "$GO_PKGS" "$SWIFT" "$APP" "$WHY"
