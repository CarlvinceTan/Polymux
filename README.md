# Midas

Midas is a lean, local-first desktop agent built with Electron and TypeScript.

## Backend

- `core` owns the provider-neutral agent loop, streaming events, cancellation, steering, and tool execution.
- `agent` adds Midas policy: layered prompts, Pi-compatible skills, file-backed local memory, goals, compaction, and simple subagents.
- `inference` is a thin adapter over `pi-ai`.
- `tools` provides only `read`, `bash`, `edit`, and `write` by default, plus MCP connections.
- `storage` persists chats, runs, replayable events, goals, compaction summaries, artifacts, and references in SQLite.
- `protocol` defines and validates the secure Electron main/preload API.

There is no project layer, plugin/team system, or approval UI in the backend.

## Development

```sh
npm install
MIDAS_MODEL=openai/gpt-5.6-terra npm start
```

Other useful commands:

```sh
npm run check
npm run test:backend
npm run test:ui
npm run package
npm run make
```

`MIDAS_MODEL` uses `provider/model` format. Credentials are resolved by `pi-ai`; environment credentials are suitable for development until the settings UI and operating-system credential store are added.

Skills are discovered from `~/.midas/skills`, `~/.agents/skills`, bundled locations, and explicitly configured locations. MCP servers use the conventional JSON `mcpServers` shape in the app data directory's `mcp.json`, with stdio and Streamable HTTP transports supported. Midas watches this file for changes and reloads MCP connections automatically; changes made during an agent run are applied after it settles and are available to the next prompt in the same chat.

Durable memory uses a Codex Desktop-style local Markdown vault under the app data directory's `memories` folder. `memory_summary.md` supplies compact always-on context, `MEMORY.md` is the searchable registry, explicit memories live as reviewable notes under `extensions/ad_hoc/notes`, and completed turns are recorded under `rollout_summaries`. Existing SQLite memories are imported once; automatic context compaction remains separate in SQLite.

Chronicle is an opt-in, local-only recent-screen context layer under the app data directory's `chronicle` folder. It stores change-aware JPEG frames instead of continuous video, writes a lightweight searchable `timeline.md`, backs off on battery or unchanged screens, pauses while locked, idle, or thermally constrained, and enforces rolling 24-hour and 768 MB retention limits. Memory-vault information and the Chronicle toggle are grouped together under the Memory tab in Options.
