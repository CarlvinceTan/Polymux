#!/bin/bash
# gui-run.sh CMD...: run CMD in the logged-in GUI (Aqua) session and return its exit code.
# macOS XCUITest needs the gui/<uid> launchd domain (Automation Mode, window server); a bare ssh
# session is "Background" and the runner times out. Already in Aqua -> exec.
# Otherwise: a one-shot LaunchAgent in gui/$UID runs CMD in this cwd with this env PATH, output to stdout.
set -uo pipefail
[ "$(launchctl managername 2>/dev/null)" = Aqua ] && exec "$@"
[ "${GUI_RUN_FORCE_EXEC:-0}" = 1 ] && exec "$@"   # tests only
D=$(mktemp -d "${TMPDIR:-/tmp}/gui-run.XXXXXX"); LBL="com.carlvince.gui-run.$$"; U=$(id -u)
printf "%q " "$@" > "$D/cmd"
cat > "$D/run.sh" <<SH
#!/bin/bash
cd $(printf %q "$PWD")
export PATH=$(printf %q "$PATH") HOME=$(printf %q "$HOME")
export POLYMUX_DATA_DIR=$(printf %q "${POLYMUX_DATA_DIR:-}")
export TEST_RUNNER_POLYMUX_DATA_DIR=$(printf %q "${TEST_RUNNER_POLYMUX_DATA_DIR:-}")
export SIMCTL_CHILD_POLYMUX_DATA_DIR=$(printf %q "${SIMCTL_CHILD_POLYMUX_DATA_DIR:-}")
bash $(printf %q "$D/cmd.sh") > $(printf %q "$D/out") 2>&1; echo \$? > $(printf %q "$D/rc.tmp"); mv $(printf %q "$D/rc.tmp") $(printf %q "$D/rc")
SH
{ echo "#!/bin/bash"; cat "$D/cmd"; echo; } > "$D/cmd.sh"
cat > "$D/job.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>$LBL</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$D/run.sh</string></array>
<key>RunAtLoad</key><true/><key>LimitLoadToSessionType</key><string>Aqua</string></dict></plist>
PL
cleanup() { launchctl bootout "gui/$U/$LBL" >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT; trap "exit 143" TERM INT ALRM HUP
launchctl bootstrap "gui/$U" "$D/job.plist" || { echo "gui-run: no GUI session for uid $U (is the user logged in?)"; exit 125; }
touch "$D/out"; tail -f "$D/out" & T=$!
while [ ! -f "$D/rc" ]; do sleep 1; done
sleep 1; kill $T 2>/dev/null; exit "$(cat "$D/rc")"
