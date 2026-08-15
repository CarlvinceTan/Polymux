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
fi

cache_root="${TMPDIR:-/tmp}/midas-window-control"
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

if [[ "$controller_status" == "8" && "$compatibility_audit" != "true" ]]; then
  /usr/bin/python3 "$registry_script" record-incident \
    --route-id "$route_id" \
    --app-id "$app_id" \
    --controller exact-window-capture+accessibility \
    --event unexpected_foreground_activation \
    --details "Exact-window controller foregrounded target PID $pid during $command_name." >/dev/null 2>&1 || true
fi

print -r -- "$controller_output"
exit "$controller_status"
