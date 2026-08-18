#!/bin/zsh

set -u

command_name=""
app_name=""
app_id=""
lease_window_id=""
lease_token=""
pid=""
native_window_id=""
output=""
match_attribute=""
match_value=""
new_value=""
new_value_provided="false"
compatibility_audit="false"
audit_authorized="false"
app_path=""

usage() {
  print -u2 "Usage: exact-window-control.sh {list|capture|inspect|press|set-value} --app APP --app-id BUNDLE_ID --pid PID [--lease-window-id LEASE_ID --lease-token TOKEN --native-window-id CG_ID] [--output PNG] [--match-attribute role|title|description|identifier --match-value VALUE] [--new-value VALUE] [--compatibility-audit --user-authorized-compatibility-audit --app-path APP_PATH]"
}

[[ $# -ge 1 ]] || { usage; exit 2; }
command_name="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) app_name="$2"; shift 2 ;;
    --app-id) app_id="$2"; shift 2 ;;
    --lease-window-id) lease_window_id="$2"; shift 2 ;;
    --lease-token) lease_token="$2"; shift 2 ;;
    --pid) pid="$2"; shift 2 ;;
    --native-window-id) native_window_id="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    --match-attribute) match_attribute="$2"; shift 2 ;;
    --match-value) match_value="$2"; shift 2 ;;
    --new-value) new_value="$2"; new_value_provided="true"; shift 2 ;;
    --compatibility-audit) compatibility_audit="true"; shift ;;
    --user-authorized-compatibility-audit) audit_authorized="true"; shift ;;
    --app-path) app_path="$2"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

[[ "$command_name" == "list" || "$command_name" == "capture" || "$command_name" == "inspect" || "$command_name" == "press" || "$command_name" == "set-value" ]] || { usage; exit 2; }
[[ -n "$app_name" && -n "$app_id" && -n "$pid" ]] || { usage; exit 2; }
[[ "$pid" == <-> ]] || { usage; exit 2; }
if [[ "$command_name" != "list" ]]; then
  [[ -n "$lease_window_id" && -n "$lease_token" && -n "$native_window_id" ]] || { usage; exit 2; }
  [[ "$native_window_id" == <-> ]] || { usage; exit 2; }
  expected_lease_prefix="cg-$native_window_id"
  if [[ "$lease_window_id" != "$expected_lease_prefix" && "$lease_window_id" != "$expected_lease_prefix:"* ]]; then
    print -r -- '{"status":"blocked_lease_window_mismatch"}'
    exit 3
  fi
fi
[[ "$command_name" != "capture" || -n "$output" ]] || { usage; exit 2; }
if [[ "$command_name" == "press" || "$command_name" == "set-value" ]]; then
  [[ -n "$match_attribute" && -n "$match_value" ]] || { usage; exit 2; }
fi
[[ "$command_name" != "set-value" || "$new_value_provided" == "true" ]] || { usage; exit 2; }
if [[ "$compatibility_audit" == "true" ]]; then
  [[ "$audit_authorized" == "true" && -n "$app_path" ]] || {
    print -r -- '{"status":"blocked_audit_authorization_missing"}'
    exit 2
  }
elif [[ "$audit_authorized" == "true" || -n "$app_path" ]]; then
  print -r -- '{"status":"blocked_conflicting_audit_options"}'
  exit 2
fi

script_dir="${0:A:h}"
lease_script="$script_dir/window-control-lease.py"
registry_script="$script_dir/app-control-registry.py"
observations_script="$script_dir/runtime-route-observations.py"
source_file="$script_dir/exact-window-controller.swift"

if [[ "$command_name" != "list" ]]; then
  if ! lease_output="$(/usr/bin/python3 "$lease_script" validate \
    --app-id "$app_id" \
    --window-id "$lease_window_id" \
    --token "$lease_token" 2>/dev/null)"; then
    print -r -- "$lease_output"
    exit 3
  fi
fi

capability="$command_name"
[[ "$command_name" == "list" ]] && capability="inspect"
first_use="false"
first_use_app_path=""
recovery_result=""
if [[ "$compatibility_audit" == "true" ]]; then
  if ! route_output="$(/usr/bin/python3 "$registry_script" verify-audit-identity \
    --app-path "$app_path" \
    --bundle-id "$app_id" \
    --pid "$pid" \
    --require-nonfrontmost 2>/dev/null)"; then
    print -r -- "$route_output"
    exit 4
  fi
  route_id="audit:$app_id:$pid"
else
  if ! route_output="$(/usr/bin/python3 "$registry_script" lookup-control \
    --app "$app_name" \
    --bundle-id "$app_id" \
    --capability "$capability" 2>/dev/null)"; then
    print -r -- "$route_output"
    exit 4
  fi
  route_id="$(print -r -- "$route_output" | /usr/bin/sed -n 's/^route_id=//p' | /usr/bin/head -n 1)"
  [[ -n "$route_id" ]] || { print -r -- '{"status":"blocked_control_route_invalid"}'; exit 4; }
  # An app with no compiled route for this capability is a first use, not a
  # wall: the attempt still runs under the lease and the same fail-closed
  # controller, and the outcome is what makes the next one compiled.
  route_status="$(print -r -- "$route_output" | /usr/bin/sed -n 's/^status=//p' | /usr/bin/head -n 1)"
  if [[ "$route_status" == "first_use_monitored" ]]; then
    first_use="true"
    first_use_app_path="$(print -r -- "$route_output" | /usr/bin/sed -n 's/^app_path=//p' | /usr/bin/head -n 1)"
  fi
fi

cache_root="${TMPDIR:-/tmp}/flareai-window-control"
/bin/mkdir -p "$cache_root" || { print -r -- '{"status":"blocked_controller_cache"}'; exit 5; }
source_digest="$(/usr/bin/shasum -a 256 "$source_file" | /usr/bin/awk '{print $1}')"
binary="$cache_root/exact-window-controller-$source_digest"
if [[ ! -x "$binary" ]]; then
  temporary_binary="$(/usr/bin/mktemp "$cache_root/controller.XXXXXX")" || { print -r -- '{"status":"blocked_controller_compile"}'; exit 5; }
  if ! /usr/bin/xcrun swiftc -parse-as-library "$source_file" -o "$temporary_binary"; then
    /bin/rm -f "$temporary_binary"
    print -r -- '{"status":"blocked_controller_compile"}'
    exit 5
  fi
  /bin/chmod 700 "$temporary_binary"
  /bin/mv -f "$temporary_binary" "$binary"
fi

if [[ "$first_use" == "true" ]]; then
  recovery_source="$script_dir/foreground-launch-recovery.swift"
  recovery_digest="$(/usr/bin/shasum -a 256 "$recovery_source" | /usr/bin/awk '{print $1}')"
  recovery_binary="$cache_root/foreground-launch-recovery-$recovery_digest"
  if [[ ! -x "$recovery_binary" ]]; then
    recovery_temporary="$(/usr/bin/mktemp "$cache_root/recovery.XXXXXX")" || { print -r -- '{"status":"blocked_controller_cache"}'; exit 5; }
    if ! /usr/bin/xcrun swiftc -parse-as-library "$recovery_source" -o "$recovery_temporary"; then
      /bin/rm -f "$recovery_temporary"
      print -r -- '{"status":"blocked_controller_compile"}'
      exit 5
    fi
    /bin/chmod 700 "$recovery_temporary"
    /bin/mv -f "$recovery_temporary" "$recovery_binary"
  fi

  frontmost_token="$(/usr/bin/lsappinfo front 2>/dev/null)"
  frontmost_pid_before="$(/usr/bin/lsappinfo info -only pid "$frontmost_token" 2>/dev/null | /usr/bin/sed -n 's/^"pid"=//p')"
  if [[ -n "$frontmost_pid_before" ]]; then
    recovery_log="$(/usr/bin/mktemp -t flareai-control-recovery)" || { print -r -- '{"status":"blocked_controller_cache"}'; exit 5; }
    recovery_ready="$(/usr/bin/mktemp -t flareai-control-recovery-ready)" || { /bin/rm -f "$recovery_log"; print -r -- '{"status":"blocked_controller_cache"}'; exit 5; }
    /bin/rm -f "$recovery_ready"
    cleanup_recovery() {
      [[ -n "${recovery_pid:-}" ]] && /bin/kill "$recovery_pid" 2>/dev/null || true
      /bin/rm -f "$recovery_log" "$recovery_ready"
    }
    trap cleanup_recovery EXIT
    "$recovery_binary" \
      --bundle-id "$app_id" \
      --expected-prior-pid "$frontmost_pid_before" \
      --duration-ms 5000 \
      --ready-file "$recovery_ready" \
      --result-file "$recovery_log" &
    recovery_pid=$!
    # Armed before the call, never after: a watcher started late has already
    # missed the takeover it exists to undo.
    for _ in {1..200}; do
      [[ -s "$recovery_ready" ]] && break
      /bin/sleep 0.01
    done
  fi
fi

controller_args=("$command_name" --pid "$pid")
[[ -n "$native_window_id" ]] && controller_args+=(--window-id "$native_window_id")
[[ -n "$output" ]] && controller_args+=(--output "$output")
[[ -n "$match_attribute" ]] && controller_args+=(--match-attribute "$match_attribute")
[[ -n "$match_value" ]] && controller_args+=(--match-value "$match_value")
[[ "$new_value_provided" == "true" ]] && controller_args+=(--new-value "$new_value")

set +e
controller_output="$("$binary" "${controller_args[@]}")"
controller_status=$?
set -e

# Read the watcher before deciding anything: whether the app came to the front
# and whether it was put back are two different facts, and only the second one
# says the attempt was contained.
if [[ -n "${recovery_pid:-}" ]]; then
  /bin/kill "$recovery_pid" 2>/dev/null || true
  wait "$recovery_pid" 2>/dev/null || true
  [[ -s "${recovery_log:-}" ]] && recovery_result="$(<"$recovery_log")"
fi

took_focus="false"
[[ "$controller_status" == "8" ]] && took_focus="true"
if [[ -n "$recovery_result" && "$recovery_result" != *'"takeovers":0'* ]]; then
  took_focus="true"
fi
# Only the watcher's own word counts as recovery. "clear" means it never
# surfaced, which is not the same thing, and a controller that reports surfacing
# while the watcher saw nothing is treated as unrecovered rather than argued with.
recovered="false"
[[ "$recovery_result" == *'"status":"recovered"'* ]] && recovered="true"

# Only on a first use: a compiled route already resolved its own path, and the
# cache exists to remember what is not yet compiled.
[[ "$first_use" == "true" && -n "$first_use_app_path" ]] && /usr/bin/python3 "$observations_script" record \
  --app-path "$first_use_app_path" \
  --capability "$capability" \
  --route exact-window-capture+accessibility \
  --prepared-state observed \
  --result "$([[ "$controller_status" == "0" && "$took_focus" != "true" ]] && print -- success || print -- failure)" \
  >/dev/null 2>&1 || true

if [[ "$compatibility_audit" != "true" && "$took_focus" == "true" && "$recovered" != "true" ]]; then
  # It surfaced and stayed. That is the one outcome that must not be attempted
  # again, so it is quarantined — for control only, leaving this app's launch
  # routes alone, since the launcher is a separate question.
  /usr/bin/python3 "$registry_script" record-incident \
    --route-id "$route_id" \
    --app-id "$app_id" \
    --kind control \
    --controller exact-window-capture+accessibility \
    --event unexpected_foreground_activation \
    --details "Controller surfaced $app_name (PID $pid) during $command_name and it was not restored. Recovery: ${recovery_result:-unavailable}" >/dev/null 2>&1 || true
elif [[ "$took_focus" == "true" ]]; then
  # It surfaced and the watcher put the user's app back, so the attempt was
  # contained. Not quarantined — but not remembered as a safe route either: the
  # observation cache above already holds the failure, so the next attempt tries
  # again watched rather than trusting a route that needed rescuing.
  :
elif [[ "$first_use" == "true" && "$controller_status" == "0" ]]; then
  # Remembered only on a clean pass, and only for the capability actually
  # exercised: proving capture never implies a press is safe.
  /usr/bin/python3 "$registry_script" remember-route \
    --kind control \
    --app "$app_name" \
    --bundle-id "$app_id" \
    --capability "$capability" >/dev/null 2>&1 || true
fi

print -r -- "$controller_output"
exit "$controller_status"
