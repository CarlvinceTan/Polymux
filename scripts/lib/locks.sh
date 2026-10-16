#!/bin/bash

_mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }
_age() { echo $(( $(date +%s) - $(_mtime "$1") )); }

# mkdir is atomic; a reclaim gate ensures only one process replaces a stale lock.
lock_take() {
  local d=$1 op cur g="$1.reclaim" rc=1
  mkdir -p "$(dirname "$d")"
  if mkdir "$d" 2>/dev/null; then echo $$ > "$d/pid"; return 0; fi
  op=$(cat "$d/pid" 2>/dev/null)
  if [ -z "$op" ]; then [ "$(_age "$d")" -lt "${LOCK_GRACE:-10}" ] && return 1
  elif kill -0 "$op" 2>/dev/null; then return 1; fi
  if ! mkdir "$g" 2>/dev/null; then
    [ "$(_age "$g")" -gt 60 ] && rm -rf "$g"
    return 1
  fi
  cur=$(cat "$d/pid" 2>/dev/null)
  if [ -d "$d" ] && [ "$cur" = "$op" ] && ! { [ -n "$cur" ] && kill -0 "$cur" 2>/dev/null; }; then
    rm -rf "$d" && mkdir "$d" 2>/dev/null && echo $$ > "$d/pid" && rc=0
  fi
  rmdir "$g" 2>/dev/null
  return $rc
}

lock_holder() { cat "$1/pid" 2>/dev/null; }
lock_drop() { [ "$(lock_holder "$1")" = "$$" ] && rm -rf "$1"; return 0; }
