# Development

## Setup and commands

```sh
npm install
FLAREAI_MODEL=openai/gpt-5.6-luna npm run isolate
npm start                 # ordinary user profile
npm run new:start         # temporary empty profile
npm run new:onboarding    # temporary profile in onboarding mode
npm run onboarding        # ordinary profile in onboarding mode

npm run check
npm run test
npm run test:ui
npm run package
npm run make
```

## Bridge binaries

Messaging runs through mautrix bridges that FlareAI supervises itself — no Docker, no
Synapse. The binaries are not in git; fetch them before packaging:

```sh
npm run bridges
```

This downloads the pinned bridge binaries into `resources/bridges/`, verifies their checksums,
and includes them automatically when packaging. Most bridges work without additional
setup beyond connecting them in the Hub.

There are a few exceptions:

- **Telegram** requires an `api_id`/`api_hash` pair from
  <https://my.telegram.org/apps>, which first-run setup stores in its configuration.
- **iMessage** requires Full Disk Access so its bridge can read
  `~/Library/Messages/chat.db`.
- **WeChat** uses a custom bridge created for FlareAI.

To prove the fleet end to end after fetching, `npx tsx scripts/smoke-bridges.mts`
starts the embedded homeserver and every bridge, then checks each one answers its
provisioning API — the same route the app drives logins through.

## Storage providers

Drive supports local storage, Google Drive, Dropbox, OneDrive, and S3-compatible
buckets. Connect providers and choose their priority in **Settings → Drive**;
FlareAI saves files to the first available provider. Cloud credentials are scoped to
app folders where supported and stored in the OS-encrypted credential store.

OAuth providers require client IDs in a local, git-ignored `.env` file:

```sh
cp .env.example .env
```

`FLAREAI_MODEL` uses `provider/model` format. Credentials are resolved by `pi-ai`;
environment credentials are suitable for development until the settings UI and
operating-system credential store are added.

## Skills and MCP

Skills are discovered from `~/.flareai/skills`, `~/.agents/skills`, bundled locations,
and explicitly configured locations. MCP servers use the conventional JSON
`mcpServers` shape in `~/.flareai/mcp.json`, with stdio and Streamable HTTP transports
supported. FlareAI watches this file for changes and reloads MCP connections
automatically; changes made during an agent run are applied after it settles and are
available to the next prompt in the same chat.

## Memory

Durable memory uses a Codex Desktop-style local Markdown vault under the app data
directory's `memories` folder. `memory_summary.md` supplies compact always-on context,
`MEMORY.md` is the searchable registry, explicit memories live as reviewable notes
under `extensions/ad_hoc/notes`, and completed turns are recorded under
`rollout_summaries`. Existing SQLite memories are imported once; automatic context
compaction remains separate in SQLite.

ComputerHistory is an opt-in, local-only recent-screen context layer under the app data
directory's `computer-history` folder. It stores change-aware JPEG frames instead of
continuous video, writes a lightweight searchable `timeline.md`, backs off on battery
or unchanged screens, pauses while locked, idle, or thermally constrained, and enforces
rolling 24-hour and 768 MB retention limits. Memory-vault controls live under
General, while the independent Computer History feature has its own Options tab.
