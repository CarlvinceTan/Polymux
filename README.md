# FlareAI

FlareAI is a lean, local-first desktop agent built with Electron and TypeScript.

**Requires a Mac with Apple Silicon.** The bridge fleet is published as
`darwin-arm64` and nothing else, so an Intel build would install and open with no
messaging in it — packaging for `x64` refuses rather than shipping that. See
[Bridge binaries](#bridge-binaries).

**macOS only for now.** `npm run make` still produces Windows and Linux artifacts,
but several subsystems reach for macOS-specific facilities with no fallback: mailbox
passwords go through the `security` keychain tool, screen and accessibility features
go through macOS permission APIs, and the bundled bridges are `darwin-arm64` builds.
Treat the non-Mac targets as unsupported until those paths are made portable.

## Backend

- `core` owns the provider-neutral agent loop, streaming events, cancellation, steering, and tool execution.
- `agent` adds FlareAI policy: layered prompts, Pi-compatible skills, file-backed local memory, goals, compaction, and simple subagents.
- `inference` is a thin adapter over `pi-ai`.
- `tools` provides only `read`, `bash`, `edit`, and `write` by default, plus MCP connections.
- `storage` persists chats, runs, replayable events, goals, compaction summaries, artifacts, and references in SQLite.
- `protocol` defines and validates the secure Electron main/preload API.

There is no project layer, plugin/team system, or approval UI in the backend.

## Development

```sh
npm install
FLAREAI_MODEL=openai/gpt-5.6-terra npm start
```

Other useful commands:

```sh
npm run check
npm run test:backend
npm run test:ui
npm run package
npm run make
```

### Bridge binaries

Messaging runs through mautrix bridges that FlareAI supervises itself — no Docker, no
Synapse. The binaries are not in git; fetch them before packaging:

```sh
npm run bridges:fetch
```

That pulls 14 pinned bridges (~610 MB) into `bridges/`, verifying each against the
checksum upstream publishes for it, and `npm run make` runs it automatically. Twelve
come from GitHub releases; iMessage and Google Chat have no usable release, so they
come from pinned mau.dev CI commits with hashes recorded in the script. `bridges/`
ships as an `extraResource`, and at runtime `BridgeHost` searches the bundled copy
first, then `<userData>/hub/bin` — drop a binary there to add a network the bundle
does not carry, and it is picked up on the next launch.

**Apple Silicon only.** Upstream publishes `darwin-arm64` builds and no
`darwin-amd64` ones — the `amd64` assets sitting beside them are Linux — so an Intel
Mac has no bundled bridges apart from iMessage, whose CI produces a universal binary.
A universal app would not fix it either: an x86 app slice still has no x86 bridges
behind it.

Rather than let that ship, `npm run package -- --arch=x64` and
`npm run bridges:fetch -- --arch=x64` both refuse. An Intel build packages, installs
and opens perfectly well, and has no messaging in it — the kind of failure nobody
notices until a user reports it.

Supporting Intel properly means building the bridges from source for `amd64` at
package time: a Go toolchain, libsignal and libolm for the two that need them, and
shipping binaries with no upstream checksum to verify against. That is a decision
about what FlareAI ships, not a build flag, which is why nothing does it quietly.

**Telegram needs credentials.** The bridge ships without an `api_id`/`api_hash` pair;
first-run setup asks for one (from <https://my.telegram.org/apps>) and records it in
that bridge's config. Until then the bridge is held back rather than started broken.

**iMessage needs Full Disk Access.** Its bridge reads `~/Library/Messages/chat.db`,
which macOS blocks (`operation not permitted`) until FlareAI is granted Full Disk
Access in System Settings → Privacy & Security. Without it the bridge exits at
startup and the Hub reports iMessage as not answering.

To prove the fleet end to end after fetching, `npx tsx scripts/smoke-bridges.mts`
starts the embedded homeserver and every bridge, then checks each one answers its
provisioning API — the same route the app drives logins through.

### Storage providers

The Drive reads and writes through pluggable backends: a folder on this Mac, Google
Drive, Dropbox, OneDrive, and any S3-compatible bucket. Settings → Drive connects
them, shows each one's quota, and sets the order new files are saved in — FlareAI
writes to the first backend in that order it can reach.

Each cloud provider is confined to its own folder rather than the whole account:
Google Drive uses the `drive.file` scope, Dropbox and OneDrive use their app-folder
permissions, and S3 takes an optional prefix. Refresh tokens and the S3 secret key
go into the same OS-encrypted credential store as the model provider keys.

The three OAuth providers need client credentials, which are read from the
environment and never committed. A build without them reports that provider as
unavailable rather than offering a button that could only fail:

```sh
FLAREAI_GOOGLE_DRIVE_CLIENT_ID=... FLAREAI_GOOGLE_DRIVE_CLIENT_SECRET=... \
FLAREAI_DROPBOX_CLIENT_ID=... \
FLAREAI_ONEDRIVE_CLIENT_ID=... \
npm start
```

Register each app as a **desktop/native** client with the redirect URI
`http://127.0.0.1:47665/drive/callback`. The port is fixed because Dropbox and
Microsoft match redirect URIs exactly. Public clients that issue no secret (the
usual case for native apps) can omit the `_CLIENT_SECRET` variable — every flow uses
PKCE regardless. S3 needs no build-time configuration; its bucket, region, endpoint
and keys are entered in Settings → Drive.

`FLAREAI_MODEL` uses `provider/model` format. Credentials are resolved by `pi-ai`; environment credentials are suitable for development until the settings UI and operating-system credential store are added.

Skills are discovered from `~/.flareai/skills`, `~/.agents/skills`, bundled locations, and explicitly configured locations. MCP servers use the conventional JSON `mcpServers` shape in the app data directory's `mcp.json`, with stdio and Streamable HTTP transports supported. FlareAI watches this file for changes and reloads MCP connections automatically; changes made during an agent run are applied after it settles and are available to the next prompt in the same chat.

Durable memory uses a Codex Desktop-style local Markdown vault under the app data directory's `memories` folder. `memory_summary.md` supplies compact always-on context, `MEMORY.md` is the searchable registry, explicit memories live as reviewable notes under `extensions/ad_hoc/notes`, and completed turns are recorded under `rollout_summaries`. Existing SQLite memories are imported once; automatic context compaction remains separate in SQLite.

Chronicle is an opt-in, local-only recent-screen context layer under the app data directory's `chronicle` folder. It stores change-aware JPEG frames instead of continuous video, writes a lightweight searchable `timeline.md`, backs off on battery or unchanged screens, pauses while locked, idle, or thermally constrained, and enforces rolling 24-hour and 768 MB retention limits. Memory-vault information and the Chronicle toggle are grouped together under the Memory tab in Options.
