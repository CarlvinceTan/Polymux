#!/bin/zsh

# Pure helpers shared by the background launcher and its tests. They do not
# inspect or launch applications.

compiled_args_contain() {
  local expected="$1"
  shift
  local argument
  [[ -n "$expected" ]] || return 1
  for argument in "$@"; do
    [[ "$argument" == "$expected" ]] && return 0
  done
  return 1
}

new_csv_pids() {
  local before_wrapped=",$1,"
  local pid
  local -a result
  result=()
  for pid in ${(s:,:)2}; do
    [[ "$pid" == <-> ]] || continue
    [[ "$before_wrapped" == *",$pid,"* ]] || result+=("$pid")
  done
  print -r -- "${(j:,:)result}"
}

unique_new_csv_pid() {
  local candidates
  local -a pids
  candidates="$(new_csv_pids "$1" "$2")" || return 1
  [[ -n "$candidates" ]] || return 1
  pids=("${(@s:,:)candidates}")
  (( ${#pids[@]} == 1 )) || return 1
  print -r -- "$pids[1]"
}
