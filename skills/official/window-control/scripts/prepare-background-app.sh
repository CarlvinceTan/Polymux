#!/bin/zsh

set -u

app_name=""
process_name=""
mode="prepare"
launch_even_if_running="false"
new_instance="false"
verify_command_contains=""
verified_launch_command=""
bundle_id=""
allow_frontmost_requested="false"
compiled_launch="false"
compiled_route_id=""
launch_behavior="nonactivating"
recovery_result=""
focus_result=""
window_result=""
watcher_status=""
window_watcher_status=""
strict_recovery_status=""
app_args=()
verified_launch_args=()
compatibility_audit="false"
audit_authorized="false"
app_path=""

usage() {
  print -u2 "Usage: prepare-background-app.sh --app APP_NAME [--process PROCESS_NAME] [--bundle-id ID] [--check-only] [--allow-frontmost-requested] [--compiled-launch] [--launch-even-if-running] [--verify-command-contains TEXT] [--verified-launch-command ABSOLUTE_PATH] [--verified-launch-arg VALUE ...] [--compatibility-audit --user-authorized-compatibility-audit --app-path APP_PATH]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      app_name="$2"
      shift 2
      ;;
    --process)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      process_name="$2"
      shift 2
      ;;
    --bundle-id)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      bundle_id="$2"
      shift 2
      ;;
    --check-only)
      mode="check"
      shift
      ;;
    --allow-frontmost-requested)
      allow_frontmost_requested="true"
      shift
      ;;
    --compiled-launch)
      compiled_launch="true"
      shift
      ;;
    --launch-even-if-running)
      launch_even_if_running="true"
      shift
      ;;
    --new-instance)
      new_instance="true"
      shift
      ;;
    --verify-command-contains)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      verify_command_contains="$2"
      shift 2
      ;;
    --verified-launch-command)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      verified_launch_command="$2"
      shift 2
      ;;
    --verified-launch-arg)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      verified_launch_args+=("$2")
      shift 2
      ;;
    --arg)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      app_args+=("$2")
      shift 2
      ;;
    --compatibility-audit)
      compatibility_audit="true"
      shift
      ;;
    --user-authorized-compatibility-audit)
      audit_authorized="true"
      shift
      ;;
    --app-path)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      app_path="$2"
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

[[ -n "$app_name" ]] || { usage; exit 2; }
[[ -n "$process_name" ]] || process_name="$app_name"
if [[ "$compatibility_audit" == "true" ]]; then
  if [[ "$audit_authorized" != "true" || -z "$app_path" || -z "$bundle_id" \
        || "$compiled_launch" == "true" || -n "$verified_launch_command" \
        || ${#verified_launch_args[@]} -gt 0 || "$launch_even_if_running" == "true" \
        || "$new_instance" == "true" || ${#app_args[@]} -gt 0 ]]; then
    print -r -- "status=blocked_audit_options_invalid"
    exit 2
  fi
elif [[ "$audit_authorized" == "true" || -n "$app_path" ]]; then
  print -r -- "status=blocked_conflicting_audit_options"
  exit 2
fi

frontmost_name() {
  local front_token front_info
  front_token="$(/usr/bin/lsappinfo front 2>/dev/null)" || return 1
  [[ -n "$front_token" ]] || return 1
  front_info="$(/usr/bin/lsappinfo info -only name "$front_token" 2>/dev/null)" || return 1
  print -r -- "$front_info" \
    | /usr/bin/sed -n 's/^"LSDisplayName"="\([^"]*\)"$/\1/p'
}

frontmost_pid() {
  local front_token front_info
  front_token="$(/usr/bin/lsappinfo front 2>/dev/null)" || return 1
  [[ -n "$front_token" ]] || return 1
  front_info="$(/usr/bin/lsappinfo info -only pid "$front_token" 2>/dev/null)" || return 1
  print -r -- "$front_info" \
    | /usr/bin/sed -n 's/^"pid"=\([0-9][0-9]*\)$/\1/p'
}

app_running() {
  if [[ -n "$(app_pids)" ]]; then
    print -r -- "true"
  else
    print -r -- "false"
  fi
}

app_pids() {
  local raw_pids raw_tokens token token_info pid
  local -a bundle_pids
  if [[ -n "$bundle_id" ]]; then
    raw_tokens="$(/usr/bin/lsappinfo find "bundleid=$bundle_id" 2>/dev/null)" || {
      print -r -- ""
      return 0
    }
    bundle_pids=()
    for token in ${(f)raw_tokens}; do
      [[ -n "$token" ]] || continue
      token_info="$(/usr/bin/lsappinfo info -only pid "$token" 2>/dev/null)" || return 1
      pid="$(print -r -- "$token_info" | /usr/bin/sed -n 's/^"pid"=\([0-9][0-9]*\)$/\1/p')"
      [[ -n "$pid" ]] && bundle_pids+=("$pid")
    done
    print -r -- "${(j:,:)bundle_pids}"
    return 0
  fi
  raw_pids="$(/usr/bin/pgrep -x -- "$process_name" 2>/dev/null)" || {
    print -r -- ""
    return 0
  }
  print -r -- "${(j:,:)${(f)raw_pids}}"
}

matching_pids() {
  local pid_csv command pid
  local -a matches
  pid_csv="$(app_pids)" || return 1
  matches=()

  for pid in ${(s:,:)pid_csv}; do
    [[ -n "$pid" ]] || continue
    if [[ -n "$verify_command_contains" ]]; then
      command="$(/bin/ps -p "$pid" -o command= 2>/dev/null)" || return 1
      [[ "$command" == *"$verify_command_contains"* ]] || continue
    fi
    matches+=("$pid")
  done

  print -r -- "${(j:,:)matches}"
}

has_new_pid() {
  local before_wrapped=",$1,"
  local pid
  for pid in ${(s:,:)2}; do
    [[ -n "$pid" ]] || continue
    [[ "$before_wrapped" == *",$pid,"* ]] || return 0
  done
  return 1
}

pid_in_csv() {
  local wanted="$1"
  local pid
  [[ -n "$wanted" ]] || return 1
  for pid in ${(s:,:)2}; do
    [[ -n "$pid" && "$pid" == "$wanted" ]] && return 0
  done
  return 1
}

report() {
  print -r -- "status=$1"
  print -r -- "app=$app_name"
  print -r -- "process=$process_name"
  print -r -- "frontmost_before=$frontmost_before"
  print -r -- "frontmost_after=$frontmost_after"
  print -r -- "frontmost_pid_before=$frontmost_pid_before"
  print -r -- "frontmost_pid_after=$frontmost_pid_after"
  print -r -- "app_running_before=$app_running_before"
  print -r -- "app_running_after=$app_running_after"
  print -r -- "matching_pids_before=$matching_pids_before"
  print -r -- "matching_pids_after=$matching_pids_after"
  print -r -- "launched=$launched"
  print -r -- "compiled_route_id=$compiled_route_id"
  print -r -- "launch_behavior=$launch_behavior"
  [[ -n "$recovery_result" ]] && print -r -- "recovery_result=$recovery_result"
  [[ -n "$focus_result" ]] && print -r -- "focus_result=$focus_result"
  [[ -n "$window_result" ]] && print -r -- "window_result=$window_result"
  [[ -n "$watcher_status" ]] && print -r -- "focus_watcher_status=$watcher_status"
  [[ -n "$window_watcher_status" ]] && print -r -- "window_watcher_status=$window_watcher_status"
  [[ -n "$strict_recovery_status" ]] && print -r -- "recovery_watcher_status=$strict_recovery_status"
}

frontmost_before="unknown"
frontmost_after="unknown"
frontmost_pid_before="unknown"
frontmost_pid_after="unknown"
app_running_before="unknown"
app_running_after="unknown"
matching_pids_before="unknown"
matching_pids_after="unknown"
launched="false"

if ! frontmost_before="$(frontmost_name)" || [[ -z "$frontmost_before" ]]; then
  report "blocked_state_unavailable"
  exit 6
fi

if ! frontmost_pid_before="$(frontmost_pid)" || [[ -z "$frontmost_pid_before" ]]; then
  report "blocked_state_unavailable"
  exit 6
fi

if ! app_running_before="$(app_running)" || [[ "$app_running_before" != "true" && "$app_running_before" != "false" ]]; then
  report "blocked_state_unavailable"
  exit 6
fi

if ! matching_pids_before="$(matching_pids)"; then
  report "blocked_state_unavailable"
  exit 6
fi

if [[ "$app_running_before" == "true" && -z "$matching_pids_before" && -z "$verify_command_contains" ]]; then
  report "blocked_state_unavailable"
  exit 6
fi

if [[ "$compatibility_audit" == "true" ]]; then
  if [[ "$app_running_before" == "true" ]]; then
    frontmost_after="$frontmost_before"
    frontmost_pid_after="$frontmost_pid_before"
    app_running_after="$app_running_before"
    matching_pids_after="$matching_pids_before"
    report "blocked_audit_requires_stopped_app"
    exit 12
  fi
  registry_script="${0:A:h}/app-control-registry.py"
  if ! audit_identity="$(/usr/bin/python3 "$registry_script" verify-audit-identity \
    --app-path "$app_path" \
    --bundle-id "$bundle_id" 2>/dev/null)"; then
    audit_status="$(print -r -- "$audit_identity" | /usr/bin/sed -n 's/^status=//p' | /usr/bin/head -n 1)"
    [[ -n "$audit_status" ]] || audit_status="blocked_audit_identity_unavailable"
    report "$audit_status"
    exit 12
  fi
  app_path="$(print -r -- "$audit_identity" | /usr/bin/sed -n 's/^app_path=//p' | /usr/bin/head -n 1)"
  audit_version="$(print -r -- "$audit_identity" | /usr/bin/sed -n 's/^version=//p' | /usr/bin/head -n 1)"
  audit_build="$(print -r -- "$audit_identity" | /usr/bin/sed -n 's/^app_build=//p' | /usr/bin/head -n 1)"
  [[ -n "$app_path" && -n "$audit_version" && -n "$audit_build" ]] || {
    report "blocked_audit_identity_unavailable"
    exit 12
  }
  compiled_route_id="audit:${bundle_id}:${audit_version}:${audit_build}"
  verified_launch_command="/usr/bin/open"
  verified_launch_args=("-g" "-j" "-a" "$app_path")
  launch_behavior="nonactivating"
fi

target_frontmost="false"
pid_in_csv "$frontmost_pid_before" "$matching_pids_before" && target_frontmost="true"

if [[ "$target_frontmost" == "true" ]]; then
  frontmost_after="$frontmost_before"
  frontmost_pid_after="$frontmost_pid_before"
  app_running_after="$app_running_before"
  matching_pids_after="$matching_pids_before"
  if [[ "$allow_frontmost_requested" == "true" && "$app_running_before" == "true" ]]; then
    report "ready_existing_frontmost_requested"
    exit 0
  else
    report "blocked_user_active"
    exit 3
  fi
fi

if [[ "$compiled_launch" == "true" ]]; then
  if [[ -n "$verified_launch_command" || ${#verified_launch_args[@]} -gt 0 ]]; then
    report "blocked_conflicting_launch_sources"
    exit 9
  fi
  registry_script="${0:A:h}/app-control-registry.py"
  registry_command=(/usr/bin/python3 "$registry_script" lookup-launch --app "$app_name")
  [[ -n "$bundle_id" ]] && registry_command+=(--bundle-id "$bundle_id")
  if ! compiled_output="$("${registry_command[@]}" 2>/dev/null)"; then
    compiled_status="$(print -r -- "$compiled_output" | /usr/bin/sed -n 's/^status=//p' | /usr/bin/head -n 1)"
    [[ -n "$compiled_status" ]] || compiled_status="blocked_compiled_route_unavailable"
    report "$compiled_status"
    exit 9
  fi
  while IFS= read -r compiled_line; do
    case "$compiled_line" in
      route_id=*) compiled_route_id="${compiled_line#route_id=}" ;;
      command=*) verified_launch_command="${compiled_line#command=}" ;;
      arg=*) verified_launch_args+=("${compiled_line#arg=}") ;;
      launch_behavior=*) launch_behavior="${compiled_line#launch_behavior=}" ;;
    esac
  done <<< "$compiled_output"
  if [[ -z "$compiled_route_id" || -z "$verified_launch_command" ]]; then
    report "blocked_compiled_route_invalid"
    exit 9
  fi
fi

if [[ "$mode" == "check" ]]; then
  frontmost_after="$(frontmost_name)" || { report "blocked_state_unavailable"; exit 6; }
  frontmost_pid_after="$(frontmost_pid)" || { report "blocked_state_unavailable"; exit 6; }
  app_running_after="$(app_running)" || { report "blocked_state_unavailable"; exit 6; }
  matching_pids_after="$(matching_pids)" || { report "blocked_state_unavailable"; exit 6; }
  if [[ "$app_running_before" == "true" ]]; then
    if [[ -n "$verify_command_contains" && -z "$matching_pids_before" ]]; then
      report "needs_specific_launch"
    else
      report "ready_existing_background"
    fi
  else
    if [[ "$compatibility_audit" == "true" ]]; then
      report "ready_compatibility_audit"
    elif [[ -n "$compiled_route_id" ]]; then
      if [[ "$launch_behavior" == "restore_previous_frontmost" ]]; then
        report "ready_compiled_recoverable_launch"
      else
        report "ready_compiled_hidden_launch"
      fi
    else
      report "needs_hidden_launch"
    fi
  fi
  exit 0
fi

if [[ "$app_running_before" == "true" && "$launch_even_if_running" != "true" ]]; then
  frontmost_after="$(frontmost_name)" || { report "blocked_state_unavailable"; exit 6; }
  frontmost_pid_after="$(frontmost_pid)" || { report "blocked_state_unavailable"; exit 6; }
  app_running_after="$(app_running)" || { report "blocked_state_unavailable"; exit 6; }
  matching_pids_after="$(matching_pids)" || { report "blocked_state_unavailable"; exit 6; }
  if [[ -n "$verify_command_contains" && -z "$matching_pids_before" ]]; then
    report "blocked_required_instance_missing"
    exit 7
  fi
  if pid_in_csv "$frontmost_pid_after" "$matching_pids_after"; then
    report "blocked_app_became_frontmost"
    exit 4
  fi
  report "ready_existing_background"
  exit 0
fi

if [[ -z "$verified_launch_command" \
      || "$verified_launch_command" != /* \
      || ! -x "$verified_launch_command" \
      || "$new_instance" == "true" \
      || ${#app_args[@]} -gt 0 ]]; then
  frontmost_after="$frontmost_before"
  app_running_after="$app_running_before"
  matching_pids_after="$matching_pids_before"
  report "blocked_unverified_launcher"
  exit 9
fi

if [[ "$launch_behavior" == "restore_previous_frontmost" ]]; then
  recovery_source="${0:A:h}/foreground-launch-recovery.swift"
  recovery_cache="${TMPDIR:-/tmp}/flareai-window-control"
  if ! /bin/mkdir -p "$recovery_cache"; then
    report "blocked_state_unavailable"
    exit 6
  fi
  recovery_digest="$(/usr/bin/shasum -a 256 "$recovery_source" | /usr/bin/awk '{print $1}')"
  recovery_binary="$recovery_cache/foreground-launch-recovery-$recovery_digest"
  if [[ ! -x "$recovery_binary" ]]; then
    recovery_temporary="$(/usr/bin/mktemp "$recovery_cache/recovery.XXXXXX")" || { report "blocked_state_unavailable"; exit 6; }
    if ! /usr/bin/xcrun swiftc -parse-as-library "$recovery_source" -o "$recovery_temporary"; then
      /bin/rm -f "$recovery_temporary"
      report "blocked_state_unavailable"
      exit 6
    fi
    /bin/chmod 700 "$recovery_temporary"
    /bin/mv -f "$recovery_temporary" "$recovery_binary"
  fi

  recovery_log="$(/usr/bin/mktemp -t flareai-window-control-recovery)" || { report "blocked_state_unavailable"; exit 6; }
  recovery_ready="$(/usr/bin/mktemp -t flareai-window-control-recovery-ready)" || { /bin/rm -f "$recovery_log"; report "blocked_state_unavailable"; exit 6; }
  /bin/rm -f "$recovery_ready"

  cleanup_recovery() {
    [[ -n "${recovery_pid:-}" ]] && /bin/kill "$recovery_pid" 2>/dev/null || true
    /bin/rm -f "$recovery_log" "$recovery_ready"
  }
  trap cleanup_recovery EXIT

  "$recovery_binary" \
    --bundle-id "$bundle_id" \
    --expected-prior-pid "$frontmost_pid_before" \
    --duration-ms 5000 \
    --ready-file "$recovery_ready" \
    --result-file "$recovery_log" &
  recovery_pid=$!
  recovery_ready_seen="false"
  for _ in {1..200}; do
    if [[ -s "$recovery_ready" ]]; then
      recovery_ready_seen="true"
      break
    fi
    if ! /bin/kill -0 "$recovery_pid" 2>/dev/null; then
      break
    fi
    /bin/sleep 0.01
  done
  if [[ "$recovery_ready_seen" != "true" ]]; then
    report "blocked_state_unavailable"
    exit 6
  fi

  launch_command=("$verified_launch_command")
  [[ ${#verified_launch_args[@]} -gt 0 ]] && launch_command+=("${verified_launch_args[@]}")
  launched="true"
  if ! "${launch_command[@]}" >/dev/null 2>&1; then
    wait "$recovery_pid" 2>/dev/null || true
    frontmost_after="$(frontmost_name 2>/dev/null)"
    frontmost_pid_after="$(frontmost_pid 2>/dev/null)"
    app_running_after="$(app_running 2>/dev/null)"
    matching_pids_after="$(matching_pids 2>/dev/null)"
    report "blocked_launch_failed"
    exit 5
  fi

  recovery_status=0
  wait "$recovery_pid" 2>/dev/null || recovery_status=$?
  [[ -s "$recovery_log" ]] && recovery_result="$(<"$recovery_log")"
  frontmost_after="$(frontmost_name 2>/dev/null)"
  frontmost_pid_after="$(frontmost_pid 2>/dev/null)"
  app_running_after="$(app_running 2>/dev/null)"
  matching_pids_after="$(matching_pids 2>/dev/null)"
  target_frontmost_after="false"
  pid_in_csv "$frontmost_pid_after" "$matching_pids_after" && target_frontmost_after="true"

  if [[ "$recovery_status" != "0" || "$recovery_result" == *'"status":"recovery_failed"'* \
        || "$recovery_result" == *'"status":"state_unavailable"'* \
        || -z "$frontmost_pid_after" || -z "$matching_pids_after" \
        || "$app_running_after" != "true" \
        || "$target_frontmost_after" == "true" ]]; then
    if [[ "$compatibility_audit" != "true" ]]; then
      /usr/bin/python3 "${0:A:h}/app-control-registry.py" record-incident \
        --route-id "$compiled_route_id" \
        --app-id "$bundle_id" \
        --controller compiled-foreground-recovery \
        --event foreground_recovery_failed \
        --details "${recovery_result:-Recovery did not return $app_name to the background.}" >/dev/null 2>&1 || true
    fi
    report "blocked_foreground_recovery_failed"
    exit 11
  fi

  if [[ -n "$verify_command_contains" && -z "$matching_pids_after" ]]; then
    report "blocked_launch_unverified"
    exit 8
  fi
  if [[ "$launch_even_if_running" == "true" ]] && ! has_new_pid "$matching_pids_before" "$matching_pids_after"; then
    report "blocked_launch_unverified"
    exit 8
  fi
  report "ready_background_recovered_launch"
  exit 0
fi

visibility_source="${0:A:h}/window-visibility-monitor.swift"
strict_recovery_source="${0:A:h}/foreground-launch-recovery.swift"
visibility_cache="${TMPDIR:-/tmp}/flareai-window-control"
if ! /bin/mkdir -p "$visibility_cache"; then
  report "blocked_state_unavailable"
  exit 6
fi
visibility_digest="$(/usr/bin/shasum -a 256 "$visibility_source" | /usr/bin/awk '{print $1}')"
visibility_binary="$visibility_cache/window-visibility-monitor-$visibility_digest"
if [[ ! -x "$visibility_binary" ]]; then
  visibility_temporary="$(/usr/bin/mktemp "$visibility_cache/visibility.XXXXXX")" || { report "blocked_state_unavailable"; exit 6; }
  if ! /usr/bin/xcrun swiftc -parse-as-library "$visibility_source" -o "$visibility_temporary"; then
    /bin/rm -f "$visibility_temporary"
    report "blocked_state_unavailable"
    exit 6
  fi
  /bin/chmod 700 "$visibility_temporary"
  /bin/mv -f "$visibility_temporary" "$visibility_binary"
fi
strict_recovery_digest="$(/usr/bin/shasum -a 256 "$strict_recovery_source" | /usr/bin/awk '{print $1}')"
strict_recovery_binary="$visibility_cache/foreground-launch-recovery-$strict_recovery_digest"
if [[ ! -x "$strict_recovery_binary" ]]; then
  strict_recovery_temporary="$(/usr/bin/mktemp "$visibility_cache/recovery.XXXXXX")" || { report "blocked_state_unavailable"; exit 6; }
  if ! /usr/bin/xcrun swiftc -parse-as-library "$strict_recovery_source" -o "$strict_recovery_temporary"; then
    /bin/rm -f "$strict_recovery_temporary"
    report "blocked_state_unavailable"
    exit 6
  fi
  /bin/chmod 700 "$strict_recovery_temporary"
  /bin/mv -f "$strict_recovery_temporary" "$strict_recovery_binary"
fi
if ! focus_log="$(/usr/bin/mktemp -t flareai-window-control-focus)" || [[ -z "$focus_log" ]]; then
  report "blocked_state_unavailable"
  exit 6
fi
if ! window_log="$(/usr/bin/mktemp -t flareai-window-control-window)" || [[ -z "$window_log" ]]; then
  /bin/rm -f "$focus_log"
  report "blocked_state_unavailable"
  exit 6
fi
if ! window_ready="$(/usr/bin/mktemp -t flareai-window-control-window-ready)" || [[ -z "$window_ready" ]]; then
  /bin/rm -f "$focus_log" "$window_log"
  report "blocked_state_unavailable"
  exit 6
fi
/bin/rm -f "$window_ready"
if ! strict_recovery_log="$(/usr/bin/mktemp -t flareai-window-control-strict-recovery)" || [[ -z "$strict_recovery_log" ]]; then
  /bin/rm -f "$focus_log" "$window_log" "$window_ready"
  report "blocked_state_unavailable"
  exit 6
fi
if ! strict_recovery_ready="$(/usr/bin/mktemp -t flareai-window-control-strict-recovery-ready)" || [[ -z "$strict_recovery_ready" ]]; then
  /bin/rm -f "$focus_log" "$window_log" "$window_ready" "$strict_recovery_log"
  report "blocked_state_unavailable"
  exit 6
fi
/bin/rm -f "$strict_recovery_ready"

cleanup_monitors() {
  [[ -n "${watcher_pid:-}" ]] && /bin/kill "$watcher_pid" 2>/dev/null || true
  [[ -n "${window_watcher_pid:-}" ]] && /bin/kill "$window_watcher_pid" 2>/dev/null || true
  [[ -n "${strict_recovery_pid:-}" ]] && /bin/kill "$strict_recovery_pid" 2>/dev/null || true
  /bin/rm -f "$focus_log" "$window_log" "$window_ready" "$strict_recovery_log" "$strict_recovery_ready"
}
trap cleanup_monitors EXIT

visibility_args=(
  --bundle-id "$bundle_id"
  --process "$process_name"
  --duration-ms 5000
  --ready-file "$window_ready"
  --result-file "$window_log"
)
"$visibility_binary" "${visibility_args[@]}" &
window_watcher_pid=$!
visibility_ready="false"
for _ in {1..200}; do
  if [[ -s "$window_ready" ]]; then
    visibility_ready="true"
    break
  fi
  if ! /bin/kill -0 "$window_watcher_pid" 2>/dev/null; then
    break
  fi
  /bin/sleep 0.01
done
if [[ "$visibility_ready" != "true" ]]; then
  report "blocked_state_unavailable"
  exit 6
fi

"$strict_recovery_binary" \
  --bundle-id "$bundle_id" \
  --expected-prior-pid "$frontmost_pid_before" \
  --duration-ms 5000 \
  --ready-file "$strict_recovery_ready" \
  --result-file "$strict_recovery_log" &
strict_recovery_pid=$!
strict_recovery_ready_seen="false"
for _ in {1..200}; do
  if [[ -s "$strict_recovery_ready" ]]; then
    strict_recovery_ready_seen="true"
    break
  fi
  if ! /bin/kill -0 "$strict_recovery_pid" 2>/dev/null; then
    break
  fi
  /bin/sleep 0.01
done
if [[ "$strict_recovery_ready_seen" != "true" ]]; then
  strict_recovery_status=0
  wait "$strict_recovery_pid" 2>/dev/null || strict_recovery_status=$?
  [[ -s "$strict_recovery_log" ]] && recovery_result="$(<"$strict_recovery_log")"
  frontmost_after="$(frontmost_name 2>/dev/null)"
  frontmost_pid_after="$(frontmost_pid 2>/dev/null)"
  app_running_after="$(app_running 2>/dev/null)"
  matching_pids_after="$(matching_pids 2>/dev/null)"
  if [[ "$recovery_result" == *'"status":"prior_state_changed"'* ]]; then
    report "blocked_prior_state_changed"
    exit 13
  fi
  report "blocked_state_unavailable"
  exit 6
fi

(
  for _ in {1..100}; do
    if ! observed_frontmost_pid="$(frontmost_pid)" || [[ -z "$observed_frontmost_pid" ]]; then
      print -r -- "state_unavailable" > "$focus_log"
      exit 6
    fi
    if ! observed_target_pids="$(app_pids)"; then
      print -r -- "state_unavailable" > "$focus_log"
      exit 6
    fi
    if pid_in_csv "$observed_frontmost_pid" "$observed_target_pids"; then
      print -r -- "foregrounded" > "$focus_log"
      exit 4
    fi
    /bin/sleep 0.05
  done
  exit 0
) &
watcher_pid=$!

launch_command=("$verified_launch_command")
if [[ ${#verified_launch_args[@]} -gt 0 ]]; then
  launch_command+=("${verified_launch_args[@]}")
fi

launched="true"
if ! "${launch_command[@]}" >/dev/null 2>&1; then
  watcher_status=0
  wait "$watcher_pid" 2>/dev/null || watcher_status=$?
  window_watcher_status=0
  wait "$window_watcher_pid" 2>/dev/null || window_watcher_status=$?
  strict_recovery_status=0
  wait "$strict_recovery_pid" 2>/dev/null || strict_recovery_status=$?
  frontmost_after="$(frontmost_name 2>/dev/null)"
  app_running_after="$(app_running 2>/dev/null)"
  matching_pids_after="$(matching_pids 2>/dev/null)"
  report "blocked_launch_failed"
  exit 5
fi

state_failed="false"
for _ in {1..100}; do
  running_now="$(app_running)" || { state_failed="true"; break; }
  [[ "$running_now" == "true" ]] && break
  /bin/sleep 0.05
done

watcher_status=0
wait "$watcher_pid" 2>/dev/null || watcher_status=$?
window_watcher_status=0
wait "$window_watcher_pid" 2>/dev/null || window_watcher_status=$?
strict_recovery_status=0
wait "$strict_recovery_pid" 2>/dev/null || strict_recovery_status=$?
strict_recovery_result=""
[[ -s "$strict_recovery_log" ]] && strict_recovery_result="$(<"$strict_recovery_log")"
recovery_result="$strict_recovery_result"
[[ -s "$focus_log" ]] && focus_result="$(<"$focus_log")"
[[ -s "$window_log" ]] && window_result="$(<"$window_log")"

if ! frontmost_after="$(frontmost_name)" || [[ -z "$frontmost_after" ]]; then
  state_failed="true"
fi
if ! frontmost_pid_after="$(frontmost_pid)" || [[ -z "$frontmost_pid_after" ]]; then
  state_failed="true"
fi
if ! app_running_after="$(app_running)" || [[ "$app_running_after" != "true" && "$app_running_after" != "false" ]]; then
  state_failed="true"
fi
if ! matching_pids_after="$(matching_pids)"; then
  state_failed="true"
fi

if [[ "$watcher_status" != "0" && "$watcher_status" != "4" ]]; then
  state_failed="true"
fi
if [[ "$window_watcher_status" != "0" && "$window_watcher_status" != "4" ]]; then
  state_failed="true"
fi
if [[ "$strict_recovery_status" != "0" || -z "$strict_recovery_result" \
      || "$strict_recovery_result" == *'"status":"state_unavailable"'* ]]; then
  state_failed="true"
fi

if [[ "$strict_recovery_result" == *'"status":"prior_state_changed"'* ]]; then
  report "blocked_prior_state_changed"
  exit 13
fi

if [[ "$strict_recovery_result" == *'"status":"recovery_failed"'* ]]; then
  if [[ -n "$compiled_route_id" && "$compatibility_audit" != "true" ]]; then
    /usr/bin/python3 "${0:A:h}/app-control-registry.py" record-incident \
      --route-id "$compiled_route_id" \
      --app-id "$bundle_id" \
      --controller compiled-hidden-launch-containment \
      --event foreground_recovery_failed \
      --details "$strict_recovery_result" >/dev/null 2>&1 || true
  fi
  report "blocked_foreground_recovery_failed"
  exit 11
fi

if [[ "$state_failed" == "true" || "$focus_result" == "state_unavailable" || ! -s "$window_log" ]]; then
  report "blocked_state_unavailable"
  exit 6
fi

if [[ "$app_running_after" != "true" ]]; then
  report "blocked_launch_failed"
  exit 5
fi

if [[ "$strict_recovery_result" == *'"status":"recovered"'* ]]; then
  if pid_in_csv "$frontmost_pid_after" "$matching_pids_after"; then
    report "blocked_foreground_recovery_failed"
    exit 11
  fi
  report "ready_background_recovered_launch"
  exit 0
fi

if [[ "$(<"$focus_log")" == "foregrounded" ]] || pid_in_csv "$frontmost_pid_after" "$matching_pids_after"; then
  if [[ -n "$compiled_route_id" && "$compatibility_audit" != "true" ]]; then
    /usr/bin/python3 "${0:A:h}/app-control-registry.py" record-incident \
      --route-id "$compiled_route_id" \
      --app-id "$bundle_id" \
      --controller compiled-hidden-launch \
      --event unexpected_foreground_activation \
      --details "Monitored launch brought $app_name frontmost." >/dev/null 2>&1 || true
  fi
  report "blocked_app_became_frontmost"
  exit 4
fi

if [[ "$(<"$window_log")" == *'"status":"window_exposed"'* ]]; then
  if [[ -n "$compiled_route_id" && "$compatibility_audit" != "true" ]]; then
    /usr/bin/python3 "${0:A:h}/app-control-registry.py" record-incident \
      --route-id "$compiled_route_id" \
      --app-id "$bundle_id" \
      --controller compiled-hidden-launch \
      --event unexpected_window_exposure \
      --details "$(<"$window_log")" >/dev/null 2>&1 || true
  fi
  report "blocked_app_exposed_window"
  exit 10
fi

if [[ -n "$verify_command_contains" && -z "$matching_pids_after" ]]; then
  report "blocked_launch_unverified"
  exit 8
fi

if [[ "$launch_even_if_running" == "true" ]] && ! has_new_pid "$matching_pids_before" "$matching_pids_after"; then
  report "blocked_launch_unverified"
  exit 8
fi

report "ready_hidden_launch"
exit 0
