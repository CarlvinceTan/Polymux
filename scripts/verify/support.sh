#!/bin/bash
SD=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$SD/../lib/locks.sh"

scope_check() {
  local base=$1 bad=0 f g ok
  local -a patterns
  IFS=, read -ra patterns <<< "$2"
  set -f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    ok=0
    for g in "${patterns[@]}"; do
      g=${g# }
      case "$f" in $g) ok=1; break;; esac
    done
    [ $ok = 1 ] || { echo "outside scope: $f"; bad=1; }
  done < <(git diff --name-only --no-renames "$base"...HEAD)
  set +f
  return $bad
}
