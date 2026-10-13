#!/bin/bash
# approve-proof.sh <worktree> <file...>   run by the reviewing tester (Liam/Argus) AFTER viewing each shot
# in <worktree>/.build/proof against the review-cards pre-publish media check. Writes the approved
# names to .build/proof/approved (merged with any names already approved) (board-update.sh appends only listed, uploaded, media-check-passing
# files), then re-runs the board media append for that unit. The board write stays a dry run unless
# ~/ops/lanes/BOARD_LIVE exists (this script never creates it). Exit 1 if a file is unknown or not uploaded.
set -uo pipefail
SD=$(cd "$(dirname "$0")" && pwd); OPS=${LANES_HOME:-$HOME/ops/lanes}
[ $# -ge 2 ] || { echo "usage: approve-proof.sh <worktree> <file...>" >&2; exit 2; }
WT=$(cd "$1" && pwd) || exit 1; P="$WT/.build/proof"; shift
for f in "$@"; do
  case $f in */*|.*) echo "refusing '$f': give a plain file name in .build/proof (no '/', no leading '.')" >&2; exit 1;; esac
  [ -f "$P/$f" ] || { echo "no such proof file: $P/$f" >&2; exit 1; }
  grep -qxF "$f" "$P/uploaded" 2>/dev/null || { echo "not uploaded by publish_proof (no link to append): $f" >&2; exit 1; }
done
{ cat "$P/approved" 2>/dev/null; printf '%s\n' "$@"; } | awk 'NF && !s[$0]++' > "$P/approved.tmp" && mv "$P/approved.tmp" "$P/approved"; echo "approved: $*"
U=$(grep -lxF "$(basename "$WT")" "$OPS"/cards/*.wt 2>/dev/null | head -1)
[ -n "$U" ] || { echo "no board card for $(basename "$WT") (cards/*.wt); approved list written, nothing appended"; exit 0; }
U=$(basename "$U" .wt)
bash "$SD/board-update.sh" verify "$U" "$(cat "$P/level" 2>/dev/null || echo build-only)" "$P" "$(cat "$P/url-base" 2>/dev/null)"
