# FlareAI

FlareAI is a desktop agent built with Electron and TypeScript, designed around the
idea that one agent should be able to work with you throughout a session. Its core
capabilities include **Hub**, a central communication layer supporting around 17
platforms, including email; **Drive**, a virtual filesystem backed by local and
popular cloud storage; **Schedule**, for creating cron jobs; **Browser**, with both
external and in-app browsing; **Workspace**, a tabbed interface for accessing every
core feature; and a fast, grep-based **Memory** system, complemented by **Chronicle**
for understanding your computer-use history.

The Main Agent uses a **Ledger** to delegate work to parallel Task Agents, either
through deliberate task design or by allowing agents to take ownership themselves.
This keeps more context with the Main Agent for better delegation and long-running
work, while keeping the interface as low-friction as possible. Basic mode offers a
simple plug-and-play experience; Advanced mode exposes additional configuration for
those who want more control.

FlareAI is desktop-only for now. This is an intentional starting point: a local
environment offers an agent broad capabilities with fewer restrictions, while the
architecture can be extended to a web or cloud-backed deployment later.

**Apple Silicon Mac only for now.** The Hub and its bridge fleet have currently only
been tested when compiled for `darwin-arm64`.

## Backend

- `core` owns the provider-neutral agent loop, streaming events, cancellation, steering, and tool execution.
- `agent` adds FlareAI policy: layered prompts, Pi-compatible skills, file-backed local memory, goals, compaction, and simple subagents.
- `inference` is a thin adapter over `pi-ai`.
- `tools` provides only `read`, `bash`, `edit`, and `write` by default, plus MCP connections.
- `storage` persists chats, runs, replayable events, goals, compaction summaries, artifacts, and references in SQLite.
- `protocol` defines and validates the secure Electron main/preload API.

There is no project layer, team system, or approval UI in the backend, which is
the intended design for simplicity of use.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup instructions, development commands,
bridge binaries, storage providers, skills, MCP, and memory details.
