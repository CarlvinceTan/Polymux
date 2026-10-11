# Native Mac control

Polymux pairs a Mac with one existing agent. The client opens an outbound pinned-TLS
WebSocket to the server's device listener, normally port `7339`. SSH, a global
Cua installation, and a second application are not required. Ordinary chat and
speech do not require pairing or control permissions.

## Build and enrollment

Run `python3 scripts/fetch_cua.py` once before building macOS. It stages the pinned
Cua Driver `0.34.1` release in `.vendor/cua`, checks the archive SHA-256, and never
installs or starts a service. Xcode copies its executable into
`Polymux.app/Contents/Helpers`, embeds the license and LaunchAgent definition, and
signs the nested executable before the enclosing app. iOS builds do not embed it.
Keep release provenance and third-party notices with distribution artifacts.

On the server, with the existing data directory and agent ID:

```sh
polymux-server device pair -agent assistant
polymux-server device pair -agent coding -capabilities native,commands
polymux-server device list
polymux-server device revoke -id DEVICE_ID
```

Use `-data PATH` for a nondefault data directory and `-url https://HOST:PORT` for
a nondefault device listener. The backend accepts `-device-listen IP:PORT`; its
default is backend port plus two. Listeners retain Polymux's tailnet restriction;
loopback fixtures require `-dev`. No service is installed by these commands.

Paste the single-use, ten-minute code into **Settings > This Mac**. It pins the
server identity and binds capabilities to the selected agent. The Mac can narrow
the offered capabilities, never expand them. Device credentials stay in the
local Keychain; the server keeps credential/code hashes and its TLS identity in
an owner-only SQLite directory. Codes are temporary credentials: do not log,
send to agents, or commit them. Failed or ambiguous enrollment is not retried;
inspect `device list`, revoke an orphan pairing, and create a fresh code.
The pin is a private app-scoped signing certificate, never installed in system
trust. Server TLS leaves renew automatically after at most 90 days while that
pin stays unchanged. The signing identity expires after five years; changing
its address or replacing an expired identity requires explicit re-pairing.

## Permissions and execution

- **Observe and control apps:** Accessibility and Screen Recording. Polymux owns
  the prompts. The bundled runtime checks host attribution, the actual parent
  bundle, and a temporary capture before advertising native readiness. The
  screenshot is deleted, not sent to the agent. Grant changes require relaunch.
- **Commands and files:** a separate explicit grant to execute commands as the
  signed-in user with that account's filesystem access. Executables and args are
  passed separately; output is capped at 64 KiB. macOS folder grants are requested
  only as needed. This is not a folder sandbox or permission to explore accounts.
- The agent uses `control_device` to list its own devices and advertised native
  schemas, then calls an operation. Device-bound session labels and private
  per-call captures prevent arbitrary screenshot output paths. Images are returned
  to the model as images, not inaccessible paths on another host.
- Native control is background-window-only. Browser/DOM tools, desktop input,
  permission/config changes and foreground delivery are not exposed. Cua runs in
  standard mode, without approval bypasses. Untrusted app/tool content cannot
  grant new authority. Effects still need task-relevant user permission and
  concrete observation/action/verification.
  Known app-menu paths use `invoke_menu`, not AXMenuBar clicks. That semantic
  route owns its bounded activation and focus restoration; arbitrary foreground
  input is still refused.
  `contracts/control.json` owns the native ceiling for both Go and Swift;
  `python3 contracts/generate.py --check` rejects drift or browser/desktop tools.
- Device calls are serialized. Disconnects/cancellation stop the owned local
  generation and report unknown completion. Requests are never replayed after
  reconnect or restart. A process may have produced effects before interruption.
  Command cleanup kills the owned process group and drains the request before
  releasing ownership. This covers inherited descendants, not a program that
  deliberately escapes its group or asks another service to start work.
- Devices are unavailable to creation, group and peer-request turns. Direct
  chat, bounded direct continuations, and direct voice consultation can use the
  explicitly paired agent's device. Pairing does not leak private device access
  to teammates.

## Background ownership and removal

**Keep control in background** explicitly registers the bundle's LaunchAgent
through `SMAppService`. It runs the same signed Polymux executable with
`--companion`, without chat windows. A process lock permits only one local
controller; the foreground app and companion do not drive the Mac concurrently.
This runs after login, not before login. When the foreground app quits, the
companion can acquire ownership and reconnect without replaying prior work.
If LaunchServices sends a human reopen to the windowless companion, it launches
the ordinary client entry rather than swallowing the request without a window.

The private Cua child has a host-liveness pipe, an isolated app-owned home, no
telemetry, and a private socket. It never connects to, stops or reconfigures an
independently installed daemon. Turning control off closes owned connections and
children; it does not revoke the pairing or silently change the background
registration. **Forget this Mac** stops control, unregisters the companion,
revokes the server pairing and removes its Keychain entry. The separate cleanup
choice removes only `Application Support/Polymux/control`, not conversations or
independently installed tools. Failed server revocation retains the credential
for review. Removing the bundle removes the executables; use Forget first for
explicit pairing and data cleanup.

## Verification gates

Go tests cover one-use/expiry races, capability narrowing, agent scope, TLS-only
ingress, revocation and interrupted dispatch. Swift tests cover local readiness,
exclusive ownership, native argument bounds, bounded commands, cancellation and
the embedded MCP lifecycle through a fake child, without starting real Cua.
The required cross-language check uses a temporary loopback server and synthetic
credentials, never the real Keychain. Its runner builds the fixture and refuses
to ignore a failing test:

```sh
python3 scripts/check_control.py
```

For the full Swift suite with the same fixture:

```sh
python3 scripts/check_control.py --all
```

Regression guards verified 2026-10-10:

| Failure | Guard and check | Coverage |
| --- | --- | --- |
| Long-lived TLS leaf rejected by Apple | Renewable 90-day leaf under the stable private pin; `TestCertificates` and required `ChannelTests` | Real Foundation TLS on loopback, not production enrollment |
| Canceled work starts or outlives its owner | Generation/cancellation barriers, owned process groups and shutdown draining; `CommandRunnerTests` and reconnect fixture | Inherited descendants; deliberate process-group escapes remain outside the guarantee |
| Dead or revoked GUI helper still appears ready | Both children must be live; permission status is checked on refresh; `EmbeddedDriverTests` | Fake helper revocation, with real TCC acceptance still pending |
| Native ceilings drift between languages | One policy source and `contracts/generate.py --check` | Browser/desktop ceiling plus local argument bounds |
| Temporary preview cannot be launched by bundle ID | Owned `~/Applications` fixture from `scripts/control_preview.py` | Launch path and unpaired/capability layouts visually checked through Cua; fixture removed afterward |

Signed/notarized distribution is not yet verified. Release acceptance still
requires a clean Mac with no SSH/Cua installation, first connection with missing,
denied and granted permissions, live revocation, app-closed/login reconnect,
Keychain access from both launch paths, and cleanup with an independent Cua
installation present. Build/tests do not prove macOS TCC attribution or login-item
approval on a real signed device. No normal app, server, login item, or installed
Cua service was replaced to run the synthetic tests.

For a safe settings layout check, `python3 scripts/control_preview.py` builds an
owned fixture in `~/Applications`, where Cua can resolve its bundle identifier.
It does not start control or read credentials. Launch
`com.test.polymux-control-preview` through Cua MCP, verify its executable path,
then close it and use the script's `--clean` option. Registration alone does not
make a temporary build resolvable in Cua Driver 0.32.0; the fixture path is a
structural guard for that observed launch failure.
