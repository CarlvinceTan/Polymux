# Polymux — Build Plan

> Formerly Luce.

An AI assistant and a team of agents: an iOS/macOS SwiftUI app backed by a Go
server on a mac mini.

This plan records the implemented baseline and the target for the next stages.
Reconciled with the source on 10 Oct 2026; implementation status is not a claim
that every feature has passed a live end-to-end evaluation. Status tags:

- **Decided** — locked, build to it.
- **Proposed** — a recommendation I've made that you haven't confirmed yet.

The decisions table distinguishes confirmed choices from proposals. Section 6
orders the remaining work; section 7 lists the choices still needing approval.
Stages 6A/6B and the memory/integration/proactivity slice were subsequently
authorized and implemented. Broader helpers, calendar/event routines and
deployment remain proposals. Verification limits are recorded in section 6.

---

## 1. Product shape

A messenger-style chat app where the "people" are persistent agents — each with
its own memory, history, and scheduled routines.

- **North star:** always-on agents that keep working while the app is closed, run
  routines on a schedule or event, and report back. The reference is Rakazo
  (open-source Grok Bot alternative) and xAI's Grok Bot: persistent bots with
  per-bot conversations, memory, routines, and history, shared vs. isolated
  compute, and subagent delegation.
- **Current baseline:** persistent reactive chat, replay/offline cache, agent
  profiles, direct and group conversations, attachments, inline HTML cards,
  search, and an Apple voice pipeline, plus scoped execution state, safe creation
  intros, group handoffs, asynchronous peer deliveries, scoped durable memory,
  history retrieval, open work, background reviews and fixed-interval routines.
- **Next-stage priority:** agent behaviour, not Rakazo UI parity. Improve how
  agents establish their identity at creation, interact with peers, take turns
  in groups, and communicate their actual activity through Polymux's animations.
- **UI boundary (D35):** preserve the current Polymux shell, conversation list,
  avatars, headers, bubbles, composer, panels, and HTML presentation. Rakazo is
  a behavioural reference, not a requirement to copy its screens or every
  feature. New behaviour should use these existing surfaces.

### Device pairing (implemented slice; signed-device acceptance pending)

- Fresh-device setup must start with the Polymux client installation, not assume
  SSH, Cua Driver, a daemon, or separately installed MCP tools already exist.
- Ship one self-contained `Polymux.app`: the control helper and GUI runtime are
  signed nested components inside that bundle, not separate applications,
  globally installed CLIs, or binaries copied into the user's home directory.
  Pairing authenticates the server/device; commands/files and native GUI access
  remain separately enabled capabilities. SSH is an optional route.
- On first connection/pairing, check permissions for the enabled capabilities
  and guide the user through missing macOS grants as part of connection setup.
  Native GUI control needs Accessibility and Screen Recording; request file/
  folder access only where required, not blanket Full Disk Access by default.
  Advertise control as ready only after fresh permission and runtime checks.
- Reconnects reuse existing grants without repeated prompts. Recheck after the
  user returns from System Settings or a required relaunch; revoked permission
  must make the affected capability unavailable without disabling ordinary chat.
  Pairing cannot grant OS permissions, bypass Cua approvals, or replace an
  existing daemon's permission profile. Reuse compatible existing installations
  only after checking their ownership and authority.
- Before promising bundled distribution, verify Cua licensing, signed packaging,
  permission attribution, and companion lifecycle. App-closed control needs an
  explicitly enabled login item referencing the bundle-contained helper, not a
  second installation. Disable/disconnect must stop owned control processes,
  unregister the login item, and revoke pairing. Removing the app removes its
  executables; deletion of preferences, Keychain entries, and retained user data
  needs an explicit cleanup choice. Never remove independently installed tools.
  A network connection alone does not prove the control runtime is available.
- Implemented 2026-10-10: one-use enrollment bound to an existing agent and
  separately selected capabilities, a pinned-TLS outbound device channel,
  Keychain credentials, server-side revocation, serialized calls without replay,
  direct-chat/voice tool routing, connection-time onboarding, and live local
  readiness checks. The macOS build embeds Cua Driver 0.34.1 and an explicitly
  registered, windowless companion entry in the same Polymux executable. A local
  process lock prevents competing foreground/background controllers. See
  `CONTROL.md` for enrollment, ownership, cleanup and verification commands.
- The existing SSH/Cua route remains an optional preconfigured route. No service
  deployment, pairing of real devices, new OS grants, or changes to an existing
  Cua installation were performed for this implementation. Release gates remain
  pairing/control on a clean signed Mac without SSH/Cua installed, missing/
  denied/granted and revoked permissions, login-item approval and app-closed
  reconnect, and cleanup without affecting independent components. Unsigned
  builds and synthetic tests are not proof of those OS-owned behaviours.
- Verification: the full shuffled Go race suite and vet, Swift suite including
  22 control tests with the required pinned-TLS fixture, 39 focus checks,
  code generation, bundle containment checks, and unsigned macOS/iOS Simulator
  builds pass. The isolated enrollment/capability layout was visually checked.
  TLS leaves renew under a stable private pin; canceled calls drain before
  ownership changes, and helper failure/revocation removes native readiness.
  Existing live-provider suites remain gated; signed permission attribution,
  companion launch/reopen and clean-install lifecycle remain acceptance checks.

### Panes

- **SidePane** — the current flat conversation list, containing agent direct
  chats and group chats, with search, filters, and ordering. The original
  `Home` / `Assistant` / `Team` hierarchy is superseded, not unfinished work.
- Each agent has **one primary direct conversation**, and can also participate
  in group conversations (D5). No nested thread browser.
- **ChatPane** — that conversation.
- Desktop shows **exactly these two columns** (D4); the ChatPane content sits in
  a centered, max-width column (D12).

Every agent has a **stable identity token** (`agentID`). The name is just a
display label — mutable, non-unique, never a key. Custom animated avatars are
now an intentional part of Polymux's identity and activity feedback (section 4.2).

### Decisions

| # | Decision | Status |
| --- | --- | --- |
| D1 | Stable `agentID` token as identity; mutable names and custom animated avatars are display, never routing keys | Decided |
| D2 | Smart search scoped to the active conversation; hybrid lexical + vector, fused with RRF | Decided |
| D3 | Embeddings run server-side, not on-device | Decided |
| D4 | Desktop = 2 columns (SidePane + ChatPane); compact = push stack | Decided |
| D5 | One primary direct conversation per agent, plus group participation; no dedicated memory/routine management UI | Decided |
| D6 | Wire contract is JSON Schema in `contracts/`, codegen both sides | Decided |
| D7 | HTTP + SSE for chat and agent events; cloud live speech uses a server WebSocket relay so provider keys remain server-owned | Decided |
| D8 | UI targets the newest iOS/macOS (iOS 27 / macOS 27 today) | Decided |
| D9 | No shell `grep`; FTS5 is the lexical side | Decided |
| D10 | Composer uses `TextField(axis:.vertical)` + `lineLimit(1...7)` | Decided |
| D11 | Official Xcode project, checked in (`Polymux.xcodeproj`) | Decided |
| D12 | ChatPane content is a centered column with a max width | Decided |
| D13 | Durable event log + cursor replay are core, not optional | Decided |
| D14 | Persistent agents remain the target; next-stage priorities are interaction and state feedback, with the remaining sequence proposed in section 6 | Decided |
| D15 | Voice is full-duplex barge-in behind a swappable STT/TTS/LLM provider interface | Decided |
| D16 | Preserve current rows: avatar, name/time/active dot, preview/unread pill; groups use stacked avatars | Decided |
| D17 | Unread counts assistant messages after `lastReadSeq`; `active` aggregates executing replies, not network availability; richer activity is separate | Decided |
| D18 | Search spans text + media: extracted media text feeds FTS5 and the fused `EmbeddingGemma 2` vector index | Decided |
| D19 | Server is the source of truth; the app keeps a storage-optimised local cache with an offline lexical search fallback | Decided |
| D20 | Message bubbles are plain rounded rectangles: user right-aligned, agent left-aligned, no tails | Decided |
| D21 | `ChatStatus` inline status row; today it renders the date separator between bubble groups | Decided |
| D22 | Preserve the current avatar header: direct-chat name and muted role; group title and member avatars | Decided |
| D23 | No visible scroll bars anywhere; lists scroll with indicators hidden | Decided |
| D24 | Progressive timestamps (`10.00 am` → `Yesterday` → weekday → `dd/mm` → `31 Dec 2025`); weeks run Mon–Sun | Decided |
| D25 | Apple silicon only (macOS 27 dropped Intel) | Decided |
| D26 | Media in messages renders inline and is playable (image viewer, video + audio players), no autoplay | Decided |
| D27 | Non-media attachments render as a file row and are downloadable (save/share, Quick Look where supported) | Decided |
| D28 | Native-first: use SwiftUI / Apple framework components; build custom only where none exists | Decided |
| D29 | Agent runtime is PiG embedded in-process; mirror Rakazo's upstream-Pi usage in idiomatic Go | Decided |
| D30 | Polymux owns agent definitions; a PiG `coding.Session` is scoped to `(agentID, conversationID)`, with direct and group contexts separated | Decided |
| D31 | App↔server networking uses Tailscale; no app-level token (tailnet interface binding + ACLs are the access control) | Decided |
| D32 | Use PiG core (`coding`, `agent`, `ai`) + `mcp`; custom composition/tools; use `durable` for documents/tasks when integrated, not as a second chat loop | Decided |
| D33 | Memory follows Rakazo's pattern: scoped versioned documents + save/recall/forget tools + capped context injection, stored in `durable` documents behind a provider interface | Decided |
| D34 | Indexing is owned by the Go server: it spawns `llama-server` for embeddings and shells out to `media-text` for OCR and transcription; no Python sidecar | Decided |
| D35 | Keep Polymux's current UI; selectively adopt Rakazo agent behaviour, not UI or exhaustive feature parity | Decided |
| D36 | Animations must reflect actual agent activity; reuse the full existing animation vocabulary with meaningful state/event mappings | Decided |
| D37 | Group replies: explicit mentions select responders, `@everyone` selects all, otherwise an explicit group lead responds and can hand off | Decided |
| D38 | Keep PiG JSONL for model context and Polymux SQLite for product history; retain current scoped session persistence | Decided |
| D39 | Search vectors use 512 dimensions, matching the current implementation | Decided |
| D40 | Permission decisions use current user requests and revisable learned preferences, asking in ordinary text when needed; no mandatory approval UI or exact confirmation command | Decided |
| P1 | Agent creation sends one tool-free introduction that states how it read its role and asks for what it needs, then waits unless an initial task was explicitly supplied. A deterministic, token-free first-run card ("What do you want me on first?") is offered once per untouched direct chat | Decided |
| P2 | Replace prose-triggered peer handoffs with ID-addressed tools and persisted causal run/delivery records | Proposed |
| P3 | Isolated agent memory by default; user/shared/group disclosure is explicit, not automatic across conversations | Proposed |
| P4 | Ephemeral helpers inherit narrower capabilities and bounded budgets; persistent agent creation is a distinct operation | Proposed |

---

## 2. Architecture

| Layer | Path | Notes |
| --- | --- | --- |
| Swift app | `apps/Polymux` | SwiftUI, iOS + macOS |
| Swift libraries | `packages/` | Shared UI, client, models, and the `media-text` extraction tool |
| Wire contract | `contracts/` | JSON Schema source of truth; generated Swift and Go types |
| Go server | `apps/server` | Agent loop via PiG SDK; owns search and spawns the embedding server |
| Embedding server | `llama-server` (llama.cpp) | Child process of the server; text embeddings over `/v1/embeddings` |
| Model artifacts | `models/` | git-lfs (create when needed) |

- App targets the newest iOS/macOS (D8: iOS 27 / macOS 27 today) so on-device
  Foundation Models, apfel, and the current Speech APIs are available.
- **Apple silicon only** (D25) — macOS 27 dropped Intel support; the mac mini
  server is M-series.
- Go modules are wired by `go.work`; there is no root module. Build with
  `go build -tags sqlite_fts5 github.com/CarlvinceTan/polymux/apps/...`.
- Swift libraries are declared by the root `Package.swift`.
- State: `@Observable` stores; no TCA unless you ask for it. One store per
  feature, not one god object.
- The chat UI is a **renderer of the contract stream**. Nail the schema before
  building views (D6, Phase 1).
- The server owns a **durable, ordered event log per conversation** (monotonic
  `seq`) plus a catch-up endpoint (D13). Live delivery is one channel; history is
  replayed from the log on reconnect.
- Server components: agent registry, FIFO chat workers, group coordinator, event
  log, conversation store, attachments, and search index. Chat workers already
  run independently of the app connection. Bounded reviews and fixed-duration
  routine scheduling now feed those same workers; see the proactivity slice below.

### Agent runtime — PiG (D29, D30)

Embed **PiG v0.4.1** (`github.com/MichaelKinsy/PiG`) through its public `coding`
SDK, behind `apps/server/internal/agentruntime`. The pinned implementation,
not an example from an older Pi release, is the API reference.

- One process-wide `coding.Services`; each opened scoped session owns a
  `coding.Runtime` and `coding.Session`. Sessions are opened lazily.
- `Definition` persists the agent's model, prompt, builtin tool names, and MCP
  configuration and trusted Markdown skill paths. `Role` is a display label, not the system prompt. A blank
  prompt uses Polymux's plain-text assistant fallback.
- The wrapper currently exposes `Send`, `Abort`, `Path`, and `Close`. PiG's
  steering, follow-up, compaction, and other controls are SDK possibilities,
  not already exposed Polymux features.
- `SendContent` is synchronous. A synchronous `Session.Subscribe` translates
  `agent.MessageUpdateEvent` / `ai.TextDeltaEvent` and
  `agent.ToolExecutionStartEvent`; the separate `Events()` channel is drained.
  Tool start/end and scoped activity updates drive the native activity reducer.
- Builtin tools are selected explicitly through `ActiveBuiltinTools`.
  API-created agents receive read/write/edit/bash/find/ls after their tool-free
  introduction; seeded agents retain their configured selection. Ordinary and
  automatic turns retain configured capabilities. Every replying agent receives
  Polymux's `show_html` extra tool, except private review output uses `finish_review`.
  Builtin selection is not a policy gate for MCP or extra tools.
- MCP supports stdio and Streamable HTTP, with `server__tool` names and
  text/image/structured results. Direct-chat `manage_integrations` registers or
  removes connections for the next turn. Per-tool selection and MCP OAuth remain later.
- `ResourceLoader: coding.NoResources` and `SkipExtensionTools: true` are
  deliberate today. Explicitly configured skill files are loaded with a bounded
  body; ambient project/home discovery and prompt templates remain disabled.
  Repository development skills are not automatically agent capabilities.
- Direct JSONL lives under `<dataDir>/<agentID>/sessions`; group JSONL under
  `<dataDir>/groups/<conversationID>/<agentID>/sessions`. Saved paths resume
  context. Prompt edits reopen the relevant session on its next turn.
- Model credentials/settings currently come from shared PiG services and its
  default agent directory. Sessions for the same agent share its workspace;
  separate transcripts do not provide filesystem or credential isolation.

**Packages used (D32):** core `coding`, `agent`, `ai`, plus `mcp`. Composition
and tools are **custom-built**, the way Rakazo built its own domain layer on top
of Pi; PiG's higher-level packages are used only where they earn it.

| Concern | Decision |
| --- | --- |
| Agent composition | custom: Polymux agent registry (role, model, prompt, tools) |
| Tools / integrations | custom `agent.AgentTool` + `mcp` client |
| Routines / tasks | Polymux SQLite queue today; PiG `durable` checkpointed tasks remain later |
| Memory documents | PiG `durable` documents, behind a Polymux provider |
| App state, event log, search | custom SQLite (`polymux.db`), not `durable` |

Custom tools implement `agent.AgentTool`; Polymux owns their policy, routing, and
product effects. PiG owns model execution. Use public packages only; no shelling
out to `pig`, importing its `internal`, or adding a terminal UI to the server.

**Persistence ownership is settled for this stage (D38):** PiG JSONL is the
model transcript; `polymux.db` owns app-facing history, events, profiles, and search.
Memory uses `<dataDir>/memory/<agentID>/memory.sqlite`, with hashed conversation
keys and lazy PiG durable sessions. There is no second authoritative chat database.
The client never sees PiG types. Do not add a third authoritative chat transcript
or migrate to `NoSession` while adding agent behaviour.

**Durable integration needs an explicit adapter:** PiG `durable/harness` is a
separate conversation/task harness, not a cron plugin for `coding.Session`.
Document persistence, revisions, deletion and restart are proven in adapter tests;
custom checkpointed task phases remain unimplemented. Polymux still owns
cron/timezones, trigger routing, permissions, and delivery. Map Polymux string IDs
to durable's IDs and scopes deliberately. Cross-database publication needs
idempotent receipts/outbox reconciliation, not an assumed atomic transaction.

Idiomatic Go:

- Embed in-process; do **not** shell out to the `pig` binary.
- Keep the existing direct-chat actors and sequential group coordinator.
  Serialize sends per scoped session; add explicit global/per-agent limits and
  resource locks where separate conversations share tools or a workspace.
  Group membership is not a new security or compute boundary.
- Thread `context.Context`; constructor returns `(*Runtime, error)`; no
  package-level globals; `log/slog`; `errgroup` for cross-agent fan-out.
- Pin the PiG version behind our own interface so a pre-stable upgrade doesn't
  ripple through the app.
- Future checkpointed tasks can use PiG's `durable` (D32); product state stays Polymux-owned.

PiG runs with the server's OS permissions and provides no sandbox. Tailscale
protects ingress, not tool execution. Arbitrary bash can bypass path-level tool
restrictions; do not describe the current local runtime as isolated.

### Behavioural reference: Rakazo, not a literal port

Reference snapshot: [Rakazo `62ab90b`](https://github.com/elie222/rakazo/tree/62ab90b09418367a059e9f6c6f09d4cb530dbdd7).
Its current `packages/adapters/src/pi-runtime.ts` uses Pi's lower-level `Agent`,
while its executor owns identity, context, tools, approvals, runs, and routing.
JSONL recording is optional there. The old `createAgentSession()` mapping is not
an exact description of this snapshot; Polymux keeps its chosen `coding.Session`
integration rather than chasing Rakazo's internal API choices.

Useful patterns: a tool-free creation intro, truthful capability inventories,
ID-addressed peer messages, bounded group handoffs, distinct ephemeral helpers
and persistent agents, scoped memory, and durable run outcomes. Rakazo also
supports HTML artifacts through `attach_file`; Polymux's dedicated `show_html`
tool and inline renderer are intentional, not a parity exception to remove.

Not required: Rakazo's dashboard, computer viewer, artifact browser, group UI
styling, cloud sandbox catalogue, integration marketplace, or every builtin tool.

### Memory (Stage 6D, D33; scope policy proposed)

Follow Rakazo's memory pattern, but store locally instead of in a cloud provider:

- **Versioned documents**, each `{ scope, ownerID, path, content, revision,
  updatedAt }`. Polymux scopes are agent-private, user/shared, and group. These are
  product scopes mapped by the provider, not PiG's native scope enum.
- **Proposed default (P3):** private agent memory stays private. Direct chats
  can use explicitly permitted user memory; groups receive group/shared memory,
  not private direct-chat history or memory merely because an agent is a member.
- **Agent tools**: `save_memory` / `recall_memory` / `forget_memory` — the agent
  writes and reads its own memory.
- **Context injection**: per turn, load permitted documents newest-first into a
  UTF-8-safe, size-capped `<durable_memory>` block (proposed ceiling: 32 KiB),
  including scope/revision/source. Contents are **data, not instructions**;
  this warning does not replace enforced scope and tool permissions.
- **Storage**: PiG `durable` documents (SQLite, revisions) behind a pluggable
  `MemoryProvider` interface; external providers (Supermemory / Serenity) optional
  later. No cloud dependency by default.
- **No dedicated management UI** (D5): remember, recall, correct, and forget
  through chat. Keep memory separate from history retrieval, reusable skills,
  and an open-work scratchpad. A memory claim is not proof that a task exists.

### HTML output (implemented)

`show_html` publishes immutable HTML attachments as part of an active reply,
with tool-call-derived idempotency, validated size/dimensions, searchable visible
text, and atomic message/event publication. The app renders them in an isolated,
nonpersistent WKWebView with restricted networking/navigation and no privileged
agent-action bridge. Preserve this boundary. Card action callbacks, persistent
card state, arbitrary generated-file publishing, and artifact versioning are
separate proposals, not required for coordination or animation feedback.

### Connectivity (D31)

Assume **Tailscale**: the app reaches the mac mini over a private tailnet, which
is the network boundary (WireGuard-encrypted, no public exposure, no TLS certs to
manage). Configure the server's tailnet host once and have the app connect to it.

**No app-level token** (D31). Access control is the tailnet:

- Bind the server to the **tailnet interface only** (never `0.0.0.0`), so the LAN
  can't bypass Tailscale.
- Scope access with **Tailscale ACLs** to your devices.
- Accepted residual gaps: any process on an enrolled device, and anything local
  on the mac mini, can reach the server.
- Keep a hook for a token or Tailscale Serve identity if the tailnet is ever
  shared or exposed beyond it.

### Client cache & offline (D19)

- The server is the **source of truth** (the event log). The app keeps a
  **storage-optimised local replica** keyed by `seq`, so it renders instantly and
  survives offline.
- Cache text + metadata locally. Keep media as URLs + thumbnails and fetch full
  media on demand; LRU-evict cached media under disk pressure.
- Local store: `LocalCache` uses `CSQLite` directly with FTS5 for **offline
  lexical search**, including cached extracted attachment text. No GRDB or
  offline semantic index. Downloaded media has a 200 MiB recency-evicted cache.
- On reconnect, replay events after the last cached `seq` (same catch-up
  endpoint); queue offline sends and flush them on reconnect.

### Streaming events (implemented)

```text
message.start        -> seq, id, role, agentID
message.delta        -> seq, id, text fragment
message.tool_call    -> seq, id, name (arguments redacted)
message.attachment   -> seq, id, kind, url, thumbnailURL
message.error        -> seq, id, code, message
message.done         -> seq, id, usage
agent.presence       -> seq, agentID, active
run.start            -> seq, runID, scoped snapshot
run.update           -> seq, runID, scoped snapshot
run.done             -> seq, runID, terminal snapshot
tool.start/done      -> seq, runID, tool ID/name/status
peer.delivery        -> seq, parent run, delivery receipt
group.handoff        -> seq, parent run, target ID
```

Every event carries `seq` and `conversationID`, which is what makes replay and
catch-up work. `Message.seq` is its immutable start sequence, not the latest
delta's sequence. Current restart recovery terminates streaming replies as
interrupted and retains queued jobs; it does not resume interrupted tool work.

**Stage 6A/6B implementation:** a general execution contract is used for ordinary
messages, creation intros, and peer work. Routines remain a later-stage consumer:

- `Run`: `id`, `jobID`, `agentID`, `conversationID`, `trigger`, `sourceMessageID`,
  optional `routineID` / `parentRunID`, attempt, timestamps, status, activity,
  bounded summary, outcome/error, and relevant child/tool IDs.
- Status: `queued`, `running`, `waiting_input`, `waiting_peer`, `completed`,
  `failed`, `cancelled`, `interrupted`. Activity describes running work:
  `preparing`, `generating`, `tool`, `rendering`, or `handoff`.
- Typed events: `run.start/update/done`, `tool.start/update/done`, and
  `peer.delivery` / `group.handoff`, correlated by stable run/tool/delivery IDs.
  The schema generates both clients; `tool.update` is reserved for future progress.
- Persist current activity snapshots alongside the event log. Offline/reconnect
  readback restores state without guessing from an unfinished text bubble.
  A waiting run is not typing; an interrupted run is not still running.
- Product events contain redacted metadata, not reasoning text, credentials,
  full HTML source, or unbounded tool outputs. `show_html` activity can be
  reported without exposing its arguments.

These payloads are defined in `contracts/polymux.schema.json`. `waiting_input` is
represented but no new approval flow is introduced in this slice.

### Core types (current)

```text
Agent    -> id, name, role, model, active, avatar
Thread   -> id, agentID, agentIDs[], leadAgentID, runs[], title, lastReadSeq, lastSeq, unreadCount, lastMessage
Message  -> id, threadID, agentID, role, parts[], seq, status, replyToID, reply, mentions[]
Routine  -> contract-only placeholder; trigger details still need design
Run      -> durable scoped execution, source/job identity, status, activity, tools, outcome
```

The app resolves `agentID` through the agent registry; names refresh without
breaking references. `GET /threads/:id/events?after=seq` replays the log. Unread
counts assistant messages after `lastReadSeq`, not deltas, tool calls, or status
events. `Agent.active` currently means at least one executing reply anywhere
for that agent. It cannot identify which group member is typing in this chat.

### Components (native-first, D28)

Prefer SwiftUI / Apple framework components; build custom only where nothing
suitable exists.

| Need | Native component |
| --- | --- |
| Two-column shell | `NavigationSplitView` |
| SidePane list | `List` (`.listStyle(.sidebar)` on macOS) |
| Agent row | `List` row from `HStack` / `VStack` primitives |
| Unread pill | `Text` + `.background(.capsule)` |
| Presence dot | `Circle` |
| Search field + results | `.searchable`, `List` |
| Composer | `TextField(axis:.vertical)` + `.lineLimit(1...7)` |
| Photo / video pick | `PhotosPicker` (PhotosUI) |
| File pick | `.fileImporter` |
| Camera capture | `UIImagePickerController` on iOS; AVFoundation capture on macOS |
| Video playback | Native AVKit player views/controllers |
| Audio playback | `AVPlayer` / `AVAudioPlayer` |
| Image display | `AsyncImage` |
| Image / file preview + zoom | SwiftUI `.quickLookPreview` |
| Save / share / download | `ShareLink`, `.fileExporter` |
| Scroll behavior | `.scrollIndicators(.hidden)`, `.defaultScrollAnchor(.bottom)` |

Existing custom pieces include the voice overlay/orb, `ProgressiveTime`,
`AvatarKit` animation engine, and isolated HTML cards. Preserve them; this
component inventory is not an instruction to rebuild the current UI.

---

## 3. Navigation

### Desktop (regular width) — D4

`NavigationSplitView` with **two columns**:

1. **SidePane** — the flat direct/group conversation list as implemented.
2. **ChatPane**.

### Compact width — D4

Same model, pushed: SidePane (list) → chat, full-screen. Back and search live in
the chat toolbar.

- Back button: shown only when the SidePane is pushed (drive from
  `columnVisibility` / size class, not a platform check).
- Search button: always top-right. Opens smart search **scoped to the current
  conversation** (section 5).
- Preserve the current custom avatar header and its native toolbar integration
  (D22); direct chats show name/role, groups show title/member avatars.

### SidePane

Agents and groups remain contacts in Polymux's current messaging layout, without
nested conversations or Rakazo-specific navigation.

- Width is user-adjustable with a comfortable default; remember the last width.
- Rows are direct chats and group chats, with the existing search, All/Unread/
  Active filters, recent/name ordering, and creation/editing controls. Do not
  restore the superseded `Home` / `Assistant` / `Team` layout.
- **Scrollable, but no scroll bar (D23):** the list scrolls with scroll
  indicators hidden (`.scrollIndicators(.hidden)`). No visible chrome.
- **Agent row (two lines):**
  - Avatar beside the text; groups use the existing overlapping avatar stack.
  - Line 1: name/title, relative timestamp, and green dot when active.
  - Line 2: last-message preview, truncated with `…`, and unread count pill.
- **Activity** (green dot) and **unread** are independent. Active means working,
  not online/reachable. Network availability is a separate client concern.
- Time format (D24) is progressive, Messages-style: `10.00 am` (today) →
  `Yesterday` → `Monday` (this week) → `dd/mm` (this year) → `31 Dec 2025` (other
  years). Weeks run **Monday to Sunday**.
- No Home/dashboard is required. Usage accounting can exist server-side without
  adding a product surface.
- Memory and routines have no dedicated UI; routine results and conversational
  management arrive in the agent's existing chat.

---

## 4. ChatPane

Content is a **centered column with a max width** (D12) — target ~720pt, so the
transcript and composer keep a comfortable reading measure instead of stretching
across a wide Mac window. On narrow widths the column simply fills. The toolbar
stays pane-wide; transcript and composer share the column.

### 4.1 Conversation

- Infinite, messaging-style, multi-media, oldest→newest with newest pinned to
  bottom.
- Bubbles remain plain **rounded rectangles**: user right-aligned, agent
  left-aligned, no tails (D20). Preserve current group author labels rather than
  adding Rakazo-style message chrome.
- **`ChatStatus` component (D21):** a status row rendered inline in the
  conversation. For now it acts only as the **date separator** — inserted when
  there's a gap between groups of bubbles, marking the start of that group. It's
  the intended home for other in-conversation activity later. Format:
  - `Today 12.45 pm`
  - `Yesterday 12.45 pm`
  - `Monday 12.45 pm` (same week, Mon–Sun)
  - `31 Dec, 12.45 pm` (same year)
  - `31 Dec 2025, 12.45 pm` (previous years)
- **Media renders inline and is playable (D26):**
  - Images — thumbnail in the bubble; tap opens a zoomable full-screen viewer.
  - Video — inline player with play/pause and a scrubber; expand to full screen;
    poster frame comes from the server.
  - Audio — a playable row: play/pause + scrubber (`AVPlayer`). The amplitude
    waveform is **optional**; without it there's no custom component.
  - Playback is user-initiated (no autoplay). Media lazy-loads; only visible items
    fetch bytes.
- **Other files (D27):** non-media attachments render as a file row (icon, name,
  size) and are downloadable — save/share to Files, with Quick Look preview where
  the system supports it (e.g. PDF).
- `LazyVStack` with stable IDs; paged history loaded on scroll-up.
- `.defaultScrollAnchor(.bottom)`; streaming deltas must not invalidate the whole
  list.
- Scrolls with **no visible scroll bar** (D23, `.scrollIndicators(.hidden)`).
- Optimistic send: show the bubble immediately, reconcile on `message.start`,
  surface retry on error.
- Messages are **plain text**, rendered as a person would type — no markdown or
  code-block parsing. (Code formatting, if ever wanted, is a later addition.)
- Message/part quotations and jump-to-source are implemented and stay. HTML
  cards are attachments, not a reason to change ordinary text rendering.

### 4.2 Identity (D1)

- **Identity is the stable `agentID` token**, not the name. The token is the
  primary key for threads, routing, search, and storage. The name is a mutable
  display label: non-unique, changeable, never used as a key.
- Display includes the existing animated avatar, editable shape/colour/resting
  expression, and name. Keep the preview in the list and muted role in the
  direct-chat header. The original name-only/no-avatar rule is superseded.
- **Disambiguation:** names aren't unique, so never rely on the name alone to
  tell two agents apart. Preserve the current duplicate-name role/short-ID
  detail and truncation. Mention chips carry stable IDs; avatar colour is
  customizable and cannot be relied on as unique identity.

### 4.3 Composer (D10)

- `TextField(axis: .vertical)` with `.lineLimit(1...7)`: grows, then scrolls
  internally, no visible scroller. Do **not** use `TextEditor` — it exposes an
  `NSScrollView` scroller on macOS.
- Attachment previews sit in a container above the text, animated on insert.
- `+` button, bottom-left: `File`, `Photo`, `Camera`.
- Send/voice slot: speech button fades out as content grows; up-arrow send button
  takes the slot. Simplest robust version: reserve the slot and cross-fade with
  `withAnimation`.
- This slot is mic when empty and send with text/attachments, never agent
  pause/stop, including during running or queued work. `ComposerView` has no
  execution-state or cancellation inputs; upload/photo loading retains a spinner.
- Tapping the mic presents the voice UI (section 4.4).
- Attachments: upload to server, store bytes + thumbnail, reference by URL in the
  contract.

### 4.4 Voice (implemented private pipeline and live transport; evaluation still pending)

Apple STT/TTS, voice provider protocols, VAD/activity, echo-cancelled audio,
interruption states, sentence-streamed playback, and latency timestamps exist.
Finalized STT turns go to a text spokesperson; the full-duplex alternative uses
Gemini native audio. Both consult workers through the private voice endpoint;
typed chat remains separate. Partial transcript preview is not wired to
speculative LLM work. There is no on-device LLM, and the planned comparative latency
evaluation has not been completed. Voice evaluation is an independent follow-up,
not a gate preventing the next agent-behaviour stage.

**Target feel: Siri** — specifically the new Siri AI in iOS 27, which is the bar.
Hands-free, interruptible, continuous — you speak, it answers, you can talk over
it and it stops and listens.

- Keep STT, LLM, TTS behind a **swappable provider interface** so the pipeline can
  be on-device or server/cloud without changing the UI (D15).
- Current default: Apple SpeechAnalyzer STT, a text spokesperson, and Apple TTS.
  Live native audio is the alternative. Both spokespersons represent the selected
  agent/group, handle casual speech themselves, and consult workers with their
  configured capabilities in isolated private turns. No private speech enters
  typed chat/history unless a worker deliberately publishes through its tools.
- **Invocation:** mic button in the composer today; wake word ("Hey Polymux") is a
  later option. When active, present a **Siri-style voice overlay** — live
  transcript, animated waveform/orb, and a clear cancel affordance.
- **Full-duplex evaluation:** exercise the implemented VAD, echo cancellation,
  and listening/thinking/speaking/interrupted state machine with real audio.
- **Stage overlap:** sentence-streamed TTS exists; speculative partial-STT
  execution is deferred and needs cancellation/side-effect rules first.
- **Latency eval before committing:** measure time-to-first-audio and
  time-to-first-word for on-device vs. server round-trip. On LAN the deciding
  factor is TTS first-byte and LLM TTFT, not transport.
- Cloud text and native-audio requests now use `/speech/text` and `/speech/live`
  server relays (D7). Provider keys never return to clients.
- Keep the existing voice orb/overlay. Voice listening/speaking is client-local
  provider state; server run activity remains authoritative for agent work.

Global settings are server-owned: theme, saved sidebar width, speech mode,
provider/model/voice choices, and spokesperson instructions. `/settings` returns
revisioned snapshots; atomic per-field patches preserve other clients' unrelated
edits. Clients poll every three seconds, finish pending settings writes, and
refresh before opening voice. Failed writes roll back without automatic replay;
the Settings Retry action resends only the failed fields. Active
voice sessions keep their existing options until reopened. Keys are write-only,
stored in the server's owner-only `settings.json`, and reported only by provider
presence. Settings and speech routes reject browser-origin requests and rely on
the existing private-tailnet boundary, not additional client authentication.

Agent profiles and full avatar designs persist on the server, including canonical
default designs for newly created agents and agents previously missing a design. Avatar
drafts are now connection-scoped and no longer persisted in global device
defaults or backfilled over a server's missing avatar. Accepted avatar writes
update sidebar refresh guards. Only the bootstrap server address stays in
device preferences. Old local speech settings and keys are not imported; set
the speech key once after updating the server. Real multi-device/native-audio
timing and provider billing behaviour remain live-evaluation follow-ups.

Settings verification passes: restart persistence, write-only key handling,
concurrent field patches, stale-response guards, failed-write rollback/explicit
retry, window-close draining, committed voice setup, and connection-scoped avatar
caches. Mock HTTP/WebSocket providers cover server
model/voice enforcement, audio-frame relay, sanitized billing failures, and
shutdown cleanup. The rebuilt macOS settings panel was visually checked against
an isolated local fixture; server changes reached theme, voice mode, and saved
sidebar width without relaunching. Codegen, Go vet/shuffled race tests, standalone
module checks, Swift tests, native focus checks, and unsigned macOS/iOS Simulator
builds pass. The normal app/server processes have not been replaced or restarted.

### 4.5 State-driven animation (D36)

`ActivityStore` maps scoped runs and live delivery events for rows, headers,
group stacks and typing feedback. `StatePlayback` handles cue identity and
static/live timing, while demo sequences remain editor-only. `AvatarKit` has
15 states in `packages/AvatarKit/Sources/AvatarKit/States.swift`; do not replace
that engine or add a different visual language.

**Decided direction:** semantic execution state drives live animation. Go sends
activity/events, not `AvatarKit.StateID`. Swift maps those to the existing
animations in one presentation reducer, reused by rows, headers, group stacks,
and typing feedback. A general `active` boolean or a timer is insufficient.

**Current mapping**, covering the existing vocabulary without pretending every
animation is a separate backend state:

| Semantic state or event | Existing animation | Playback |
| --- | --- | --- |
| Ready, no work | `idle` | Resting expression/cursor behaviour |
| Agent creation/initialization | `egg` | Until ready or creation fails |
| First introduction/new participant attention | `wide` | Brief transition, then actual activity |
| Preparing/generating a reply | `thinking` | Three-dot motif while composing; match inline typing dots |
| Tool execution | `swirl` | Activity motif while a tool is running |
| Rendering structured/HTML output | `hexagon` | While the output is being prepared |
| Waiting for delegated work | `orbit` | While a recorded child/dependency is pending |
| Peer/group handoff dispatched | `comet` | One transition tied to a delivery event |
| Artifact/result published | `burst` | One completion cue, never per token |
| Ordinary reply completion/acknowledgement | `wink` | Brief cue, then idle |
| New unread result | `notify` | Unread indicator; entrance cue only for a new live result |
| Waiting for user input/approval | `alert` | Attention state, no typing dots |
| Failed/blocked execution | `exclaim` | Visible issue state with accessible reason |
| Disconnected transport | `idle` | Keep the resting avatar; remote activity is unknown, not asleep |
| Sleep motif | `sleep` | Editor preview only until an explicit agent rest state exists |
| Voice playback | `play` | Only while the local TTS provider is speaking |

Rules:

- Key activity by `(conversationID, agentID, runID)`. A member working in a
  different chat must not look like it is typing in this group. Keep aggregate
  agent activity available for the existing global active filter/dot.
- Derive generating/tool/waiting states from real runtime boundaries. Do not
  infer private reasoning or emotion from assistant prose; no chain-of-thought
  text needs to leave the server. Tool start **and end** are required.
- Typing begins during actual reply preparation/generation, including before
  the first token; it ends or changes on tool execution, wait, stop, failure,
  handoff, or completion. Pending jobs show queued, not typing. Retain feedback
  during gaps after streamed text has appeared.
- Live activity takes precedence over decorative/user sequences. Full catalogue
  playback remains an editor preview, not the live agent's status. Idle cosmetic
  variants must not falsely advertise typing, failure, or a notification.
- Priority: disconnection/blocked or waiting-input state, then scoped live work,
  then a fresh completion/unread cue, then idle. Distinguish unavailable
  transport from proof the remote agent stopped. A new run preempts an old
  terminal cue; an older `run.done` cannot reset a newer active run. User Stop
  returns to idle without a success/failure celebration; interrupted work keeps
  an explicit interruption reason rather than appearing to finish successfully.
- Restore current state after replay/relaunch without replaying old winks,
  bursts, introductions, or handoff animations. Repeated event IDs/`seq` are
  idempotent. Completion cues are presentation, not persisted work status.
- Use existing morph timings/minimum durations for smooth transitions, but do
  not delay a stop/error to finish an animation. Finite motifs may repeat only
  while their associated activity is live; they are not a completion timer.
- Preserve Reduce Motion, Animate avatar, visibility, and scene-phase handling.
  Disabled motion gets a readable static pose/status; offscreen loops stop.
  Never make animation the only way to learn that an agent needs attention.

Acceptance: create → intro → idle; prepare → dots → tool → dots → done;
handoff → peer activity; child wait → result; user wait; cancel/error;
multiple group members; another conversation active; replay/relaunch; reduced
motion. These are deterministic reducer/engine tests plus native visual checks,
not a slideshow of every animation on each turn.

---

## 5. Smart Search (D2, D3, D9, D18, D34)

Scope: **the active direct or group conversation**. Search is not global: it
queries that conversation's text and media, not private chats of its members or
the filesystem. The UI and server retrieval exist; exposing scoped retrieval
as an agent tool is proposed in Stage 6C.

Implemented: FTS5/BM25 plus exact cosine retrieval, parallel retrievers, RRF
(`k=60`), **512-dimensional** vectors, optional embedding/extraction providers,
and local cached-text FTS5. No chunking, utterance segmentation, video content
extraction, keyframe indexing, or reranker yet. Without an embedder lexical
search works, but indexing currently reports an error instead of a clean
lexical-only-ready state; correcting that is a follow-up, not a reason to
rebuild search before agent behaviour.

Text, attachment names/extracted text, and HTML visible text are searchable.
Image/audio content needs the extractor; video playback exists but video content
indexing is deferred. Both retrievers operate on the same text-normalized input.

### Index (one SQLite file on the server)

- `messages` — source of truth, written from the event log.
- `messages_fts` — FTS5 + BM25 lexical side (the "grep"; no shell grep in v1).
- `media_index` — combined extracted attachment text per message.
- `media_vectors` — `sqlite-vec` embeddings of the message text plus its
  extracted media text.

### How media becomes searchable

Two layers, both fed at ingest:

1. **Text-normalized** — image → OCR; audio → transcript; HTML → visible text.
   This feeds FTS5. Video audio/keyframe extraction is later work.
2. **Embeddings** — the configured text endpoint embeds message text plus
   extracted attachment text in one vector space. A text query retrieves media
   through that text; pixels/audio are not directly embedded by the current
   pipeline. The configured model identifier is qualified below.

The text-normalized layer still feeds the lexical side; the embeddings are what
make media semantically searchable.

### Ingest pipeline (target; qualifications above)

1. A message or attachment enters with an indexing state (`pending` → `ready`).
2. Extract text per modality, chunk (respect message/utterance boundaries). A
   message mixing text and attachments embeds as one text input: the message
   text followed by each attachment's extracted text.
3. Insert into FTS5; compute embeddings and insert into the vector table.
4. Video is downsampled to keyframes; audio segmented by utterance.
5. Re-embed on edit. Search never blocks on `pending`; it returns results with
   media marked as still indexing.

### Query pipeline

1. Run both retrievers in parallel, filtered to the conversation:
   - **Lexical:** FTS5 `MATCH` ranked by `bm25()`.
   - **Semantic:** embed the query, k-NN over the indexed vectors.
2. Fuse with **reciprocal rank fusion** (`Σ 1/(k + rank)`) — BM25 and cosine
   aren't comparable, so combine ranks, not raw scores.
3. Resolve hits to messages/attachments and the existing result previews. Do
   not add waveform/keyframe search UI solely to match the original mock target.

### Staying fast

- Embeddings computed once at ingest, never at query time (except the query).
- Use the implemented 512 dimensions. Reranking remains deferred.
- Scope is small: per-conversation candidate sets are hundreds to thousands, so
  exact k-NN is fine — no ANN index needed yet.

### Model/runtime configuration

- `cmd/server/main.go` requests `google/embeddinggemma-2` and truncates/normalizes
  to 512 dimensions. The actual endpoint/GGUF must be verified in a live search
  evaluation; a configured model name is not proof of its version, multimodal
  support, or retrieval quality. The original model-size/context/quality claims
  are not acceptance criteria until verified against the selected artifact.
- Runtime (D3, D34): the Go server spawns `llama-server` (llama.cpp) on a
  private loopback port with `--embeddings`, waits for `/health`, and points the
  embedder at it. `POLYMUX_LLAMA` names the binary, `POLYMUX_EMBED_MODEL` the GGUF
  (unset uses llama.cpp's bundled EmbeddingGemma download), and `POLYMUX_EMBED_URL`
  points at an already-running OpenAI-compatible endpoint instead.
- Extraction (D34): the `media-text` CLI does OCR through Vision and audio
  transcription through the current Speech APIs. Build it with
  `swift build --product media-text` and point `POLYMUX_EXTRACTOR` at it. The
  server runs it per attachment, off the request path.
- Either provider is optional. With no embedder search is lexical only; with
  no extractor, media is stored without searchable text. Both are local: the
  spawned model/extractor run on the mac mini (D25). A configured external
  `POLYMUX_EMBED_URL` can egress; locality depends on the chosen endpoint.
- Accepted trade-off: media is searchable through extracted text, not through
  its pixels or audio directly.

### Deferred

- Query routing and a reranker are not v1.
- Video indexing is the heaviest; images + audio transcripts land first.
- Direct multimodal embeddings require a separately verified model/runtime;
  the current pipeline embeds extracted text and makes no encoder/runtime claim.

### Offline

When the server is unreachable, search falls back to the **local lexical index**
(FTS5 over the cached conversation, D19), including extracted attachment text
already cached. New media extraction and semantic retrieval require the server.
Attachment preparation also currently runs before agent replies and can delay
them, despite being off the HTTP request path.

---

## 6. Phases

Each stage ends in a demonstrable slice. Stages 6A/6B are implemented under the
subsequent user request; 6C–6F remain proposed, not part of this implementation.

### Implemented baseline

| Original phase | Source status | Remaining qualification |
| --- | --- | --- |
| 0 — Foundations | Schema/codegen, PiG wrapper, synchronized Xcode project, iOS/macOS 27 targets | `Routine` remains a placeholder; scoped `Run` is implemented |
| 1 — Reactive chat | Durable events, FIFO jobs, SSE/replay, cache/outbox, stop | Running turns become interrupted on restart, not resumed |
| 2 — Navigation | Current direct/group list, profiles, avatars, filters, unread/activity | Intentional UI changes supersede the original hierarchy/name-only rules |
| 3 — Composer/media | Attachments, camera, playback, downloads, quotations, HTML cards | HTML has no privileged action bridge or artifact versioning |
| 4 — Search | Hybrid scoped retrieval and offline FTS5 | Provider quality/degraded indexing and richer media processing remain |
| 5 — Voice | Apple voice pipeline and interruption/timing machinery | Comparative latency/audio-state evaluation and partial-STT overlap remain |

### Stage 6A — Execution state and live animation (implemented)

Verified on 9 Oct 2026: contract generation check, all Go packages with the race
detector, 58 PolymuxKit tests, 15 AvatarKit tests, 14 native voice tests, and
macOS/iOS Simulator builds. Live GUI animation timing and real-model coordination are not visually
or end-to-end verified by these checks.

- SQLite schema 4 stores run snapshots, correlated tool events and deliveries.
  Streamed text is coalesced at 40 ms/2 KiB; the first fragment is immediate.
- Shared presentation uses the existing animation catalogue, scoped by agent
  and conversation, with three-dot typing, voice playback, offline/replay
  suppression, and authoritative snapshot reconciliation.
- Author-aware TTS uses the new `VoiceSession` interface from the parallel voice
  work. Shutdown/interruption clears speaking; unrelated live-provider audio
  does not impersonate a group member. Pickers respect offline connectivity.
- Stop covers preparation and opening; `stop?queued=1` also withdraws queued
  work. Queued withdrawal and job/run cleanup are transactional. Interrupted
  work never automatically retries tool effects.

- Generalize `Run` and typed events as described in section 2; use runs for
  normal chat too, not only routines. Track source messages, attempts, tools,
  terminal outcomes, and current scoped activity.
- Extend `agentruntime` with the minimum lifecycle notifications needed:
  preparation/generation, tool start/end/error, completion, cancellation.
  Leave reasoning contents private. Do not expose every PiG control at once.
- Install cancellation before attachment preparation/session opening so Stop
  covers the entire turn. Define Stop-current versus withdraw-queued work;
  do not silently turn cancellation into retry or clear unrelated work.
- Implement the shared Swift activity/presentation reducer and section 4.5's
  animation mapping. Preserve current surfaces and the `AvatarKit` renderer.
- Reconcile state on restart/reconnect: interrupted ordinary chat is terminal
  until an explicit retry; retain queued jobs. Detect ambiguous tool effects
  rather than blindly reissuing the model prompt.
- Bound event payloads and assess per-delta full-snapshot writes before adding
  high-frequency tool progress. Coalesce presentation updates without losing
  durable event order; retention/compaction must preserve catch-up correctness.

**Milestone:** an ordinary tool-using chat visibly transitions dots → tool work
→ dots → completion; Stop/error/relaunch restore the correct state, including
in groups, without changing the app's layout.

### Stage 6B — Creation, identity, and group interaction (implemented)

- Creation queues one tool-free intro before an optional initial task. Configured
  identity, time, scope and available capabilities are supplied to PiG.
- Explicit mention IDs are frozen at acceptance; `@everyone` and lead routing
  recheck current membership. Ambiguous name mentions are rejected, and lead
  selection persists across reordering and renaming.
- Removed picker selections require reselection instead of silently retargeting
  by name; the API rejects stale explicit selections before acceptance.
- `handoff_agent` replaces prose-triggered delegation and ends the source stage.
  One reply per member, duplicate-pending-target rejection and shared budgets
  bound each sequential group chain.
- `message_agent` queues requests/questions in fresh peer sessions with explicit
  bounded context. Results/status do not wake peers; requests cannot recursively
  delegate. Sources wait for durable, idempotent receipts; Stop/deletion closes
  their affected work without withdrawing unrelated user jobs.
- Limits: four global execution slots, one per agent, ten-minute turns/group
  chains, 32 tools per turn, 64 per chain, 64 KiB reply/128 KiB chain text.
  PiG output is capped at 4096 tokens per generation. Full cost accounting,
  durable memory, helpers and routines remain later-stage scope.

The original acceptance scope follows; proposal labels describe its planning
origin rather than additional work beyond the implementation above.

**Creation and first turn (P1):**

- Keep existing agent/profile/avatar CRUD. Build the runtime prompt from the
  stored name/role/prompt plus Polymux's behaviour policy, conversation scope,
  time context, and truthful available capabilities. Never treat the display
  role as an instruction substitute or imply unavailable tools.
- Create the stable identity/direct conversation and persist a `created` run
  idempotently. Proposed: one brief introduction explaining the agent's role,
  with **all tools disabled**, including MCP and `show_html`. Creation is not
  permission to browse, run shell commands, schedule jobs, or spawn peers.
- An explicitly supplied first task is a separate queued conversational run.
  Messages arriving during the intro wait and are answered afterward; they do
  not steer the intro. On failure preserve the editable agent and show the
  failed run, rather than inventing a successful greeting.
- Existing agents do not greet again on server/app restart or profile edits.
  Profile/config changes take effect at a safe next-turn boundary across that
  agent's scoped sessions.

**Group turns (D37, implementation details proposed):**

- Keep existing group creation/editing, membership limits, shared transcript,
  author labels, and separate member sessions. Today replies are sequential;
  preserve that initially rather than introducing concurrent bubble arbitration.
- Persist `leadAgentID`, validated against current membership. Initialize
  existing groups from their current first-member default once; reorder/rename
  does not silently change the lead. If the lead leaves, persist an explicit
  replacement policy (proposed: next remaining member); an empty group cannot
  dispatch work.
- Explicit mention IDs select members; `@everyone` selects all; an unaddressed
  user message selects the lead. A plain `@name` must resolve unambiguously;
  duplicate/renamed display labels cannot accidentally wake the wrong agent.
- Proposed `handoff_agent` tool takes a target ID and task, records a visible
  causal handoff, then ends the source's stage. Mere prose/quoting an `@name`
  must not dispatch work. Do not keep the old text-scanning trigger once the
  structured path lands; Polymux is pre-release.
- Preserve a bounded chain: proposed at most one reply per member per source
  user turn, no self-handoff/back-and-forth acknowledgements, and a chain-wide
  time/tool/token budget. Membership changes are rechecked before dispatch.
- Give members roster IDs/names/roles and bounded shared history as data.
  Never silently import another member's prompt, private history, or memory.
  Late user messages are a new turn, not permission to mix causality.

**Peer interaction outside groups (P2):**

- Proposed `message_agent` sends an ID-addressed, idempotent envelope with
  request/result/question/status intent, source/target, parent run, and bounded
  context. Requests can wake a peer; FYI/acknowledgements must not create loops.
- Delivery is async, not a synchronous wait on another agent actor. Results
  correlate with the original request; silence or a handoff is not completion.
- In a group, hand work to a current member in the same shared conversation,
  not a hidden private DM. Cross-conversation disclosure must be explicit.

**Milestone:** create an agent and get one safe intro; in an existing group,
mentions/lead route correctly and an ID-addressed handoff produces one peer
response with correct animations, even after rename, membership change, or
delivery replay.

### Stage 6C — Capabilities and integrations

- Extend the Polymux definition/configuration path for model, tool policy, MCP
  selection, and curated skill references. Current profile PATCH edits only
  name/role/prompt. Reuse existing administration surfaces where suitable;
  a new tools dashboard is not a prerequisite.
- Keep a Polymux-owned capability catalogue. Distinguish builtin coding tools,
  Polymux tools, MCP tools, and procedural skills; include only genuinely available
  capabilities. Filter authorization at execution as well as advertisement.
- Add scoped `search_history` / `read_history` tools over existing retrieval,
  with message citations and bounded neighbouring context. Group retrieval
  cannot search member DMs. D9 restricts product search, not a selected PiG
  coding tool's filesystem-search capability.
- Load curated `SKILL.md` descriptions first and bodies on demand, with Polymux
  ownership/trust boundaries. Do not enable ambient project/home resources
  merely by removing `NoResources`; skill text cannot grant tool permissions.
  Only explicitly registered files are active; text cannot grant OS permissions.
- Improve MCP with per-agent/per-tool selection, stable names, timeouts,
  health/error handling, and result limits. Add OAuth only for a real selected
  integration that needs it; no broad connector marketplace requirement.
- Questions and sparse progress use ordinary chat or `finish_review` notices.
  Permission decisions follow D40, not an exact-request approval gate. Durable
  task metadata describes a wait without pausing independent work. This is not
  a sandbox or a programmatic guarantee that models will follow preferences.
- Preserve `show_html` as safe output. General generated-file publication or
  web/GUI tools should be added for concrete workflows, not tool-count parity.

**Milestone:** an agent truthfully discovers its tools/skills, retrieves an older
decision from its current chat, uses a selected integration, and returns text
or an HTML card. Unauthorized/unavailable capabilities fail clearly.

### Stage 6D — Memory, open work, and durable integration

- First make a bounded PiG v0.4.1 integration spike: durable SQLite/document
  revisions, Polymux ID/scope mapping, a custom task calling the existing runtime,
  restart handling, and idempotent receipt publication. No second model loop.
  If the adapter cannot satisfy D30/D32/D38, reopen that decision before building
  memory/routines around a competing harness.
- Implement the D33 memory provider and save/recall/forget tools with P3's
  scope policy, revision/conflict handling, byte caps, correction and deletion.
  Start with bounded document lookup/lexical recall; semantic recall can reuse
  the optional embedder without becoming a required cloud dependency.
- Add a separate persisted open-work scratchpad: open/parked/done items,
  bounded per-turn context, and list/add/update/complete/remove operations.
  These are facts about unfinished work, not automatically scheduled tasks.
- Provide a truthful catalogue of active tools, skills, open work, and later
  routines, so stale memory does not masquerade as an executable workflow.

**Milestone:** an agent remembers and corrects a preference across restart,
forgets it on request, and retains an unfinished task. A group cannot recall
that private fact unless its disclosure scope explicitly allows it.

**Memory/integration slice (implemented 2026-10-10):**

- Use PiG durable for stable documents, not a replacement model harness. Polymux's
  adapter adds exact opaque revision checks because v0.4.1 has no public native
  document-edit CAS API. Creating requires an empty revision; edits/forget require
  the recalled current revision. Limits are 64 documents per agent/conversation,
  4 KiB text each, and 32 KiB bounded JSON for context/recall.
- `save_memory`, `recall_memory`, `forget_memory` carry source-message/run evidence
  and timestamps. Private chat/group scopes stay separate; creation and peer
  requests cannot use private memory, history or scratchpad tools. Current-only
  durable bases avoid keeping previous active document deltas. Forget removes
  active memory, not chat/JSONL, SQLite forensic traces, WAL or backups.
- `recall_history` retrieves completed user/assistant messages in the current
  conversation after checking current membership. It returns IDs, authors,
  timestamps and exclusive-before sequence pagination, 24 messages maximum,
  4 KiB each/16 KiB text total. Lexical queries reuse escaped FTS5; recent
  unindexed messages can be missing. No embeddings/provider call is required.
- `manage_integrations` persists builtin CLI capabilities, MCP definitions and
  existing trusted skill paths from the agent's direct chat. Changes take effect
  next turn. Prefer CLI plus a skill for occasional work and MCP for frequent
  structured calls. Missing MCP/skill access is reported without claiming success.
  Degraded MCP sessions are reopened next turn while retaining their transcript;
  setup edits preserve live presence and same-command environment configuration.
- Ordinary and automatic turns can use configured external capabilities. Normal
  text and revisable explicit/inferred preferences guide whether to ask first;
  no compulsory confirmation phrase is required. Automatic turns cannot recurse
  into scheduling/delegation. Tools retain server OS authority; transcript scope
  is not filesystem/credential isolation, and preferences are not security gates.
- `track_work` records `waiting_for=user` or `dependency` only on a parked item.
  A stage asking the user can finish with outcome `waiting_input` and an `alert`
  avatar, freeing its execution slot. Later independent work runs normally;
  the model reopens/completes/removes the blocked item after an ordinary answer.
  This is task metadata, not a global paused agent or a dedicated approval flow.
- Live peer dispatches produce one source-scoped `comet`; same-run tool updates
  do not erase it. Live notice entrances animate and restart for a new cue identity;
  replayed unread indicators stay static. Introductions do not rearm or hide tools.
  Disconnected avatars retain their resting identity rather than collapsing to
  the `sleep` motif. `sleep` remains available in the editor, not fabricated idle state.
- Verification covers memory reopen/conflict/forget/privacy, history completion/
  pagination/revocation, persisted setup, configured automatic tools, conversational
  routine activation, nonblocking waits, deletion cleanup/retry and cue playback.
  Codegen, Go vet/shuffled race tests, standalone module dependency checks, Swift
  tests and unsigned macOS/iOS Simulator builds pass. Live-model initiative,
  selected real integrations, running-server cadence and native visual/audio timing
  still need end-to-end evaluation. No daemon deployment or iOS push was added.

### Stage 6E — Helpers and persistent teammates

- Proposed `run_subagent`: a short-lived child run/session with explicit input,
  a structured result receipt, parent ownership, and no new list contact/chat.
  Do not share a busy parent `coding.Session` or inherit its entire transcript.
- Begin with depth one, bounded concurrency, a shared parent budget and
  deadline, cancellation propagation, and a narrower tool/memory profile.
  Children cannot create peers, recurse, or bypass the parent's approvals.
- Proposed `spawn_agent` is different: an idempotent persistent agent with its
  own identity, primary chat, definition, workspace, and memory. Creation alone
  does not imply an initial task or automatic membership in existing groups.
  Track who created it; destructive lifecycle tools cannot act on arbitrary
  user-created peers. Keep the existing user-controlled deletion workflow.
- Child/peer failures, cancellation, and incomplete results must be explicit.
  Persist ownership and receipts so replay cannot spawn a duplicate teammate
  or report a child as successful merely because its transport ended.

**Milestone:** a parent delegates one bounded research task, reflects waiting
and child progress in its animation, receives a result, and cancels the child
when stopped. Creating a persistent teammate produces exactly one contact.

### Stage 6F — Routines and always-on execution

**Initial proactivity slice (implemented 2026-10-09, extended above on 2026-10-10):** the user's follow-up expands the
6A/6B batch to useful initiative, automatic reviews, and chat-managed routines.
Rakazo was rechecked at `2c54c2b6827cc8988cc0ad9c904748db22710eff`:
`packages/core/src/bot-messages.ts` asks bots to continue independent work and
relay substantive peer results, while `packages/adapters/src/schedule-tools.ts`
and its scratchpad tools supply scheduled work and unfinished-work context.
This inspection did not establish a Grok-like idle work-discovery loop there.
Polymux adds its own bounded review behaviour rather than claiming source parity.

**Richer routines comparison:** Rakazo's inspected scheduling tools support
five-field cron plus timezone-aware next fires, elapsed presets and one-shot/
delayed work. [Grok Bot's FAQ](https://docs.x.ai/grok-bot/faq) describes a routine
as a workflow assigned to one Bot, running on a schedule or supported event,
with skills describing how to perform it and cloud execution continuing while
the app is closed. This is distinct from [Grok Tasks](https://grok.com/tasks).
Polymux now runs tool-using one-shot and recurring workflows with optional
wall-clock/DST-correct daily or weekly schedules; calendar cron expressions and
external event triggers remain later work.

- Normal turns take initiative within the user's task and have `track_work`
  for a capped agent/conversation-scoped open/parked/done scratchpad. It is not
  general memory and cannot cross private/group scopes.
- A direct-chat task enables a four-hour review cadence. Initial tasks and
  existing direct chats with user history are included; creation alone is not.
  Reviews use bounded recent chat/open-work data in fresh ephemeral PiG sessions.
  They do not reuse or overwrite ordinary chat JSONL.
- Reviews get two minutes/eight tool calls. `finish_review` chooses a useful
  notice or silence. Ordinary generated review text never streams into chat;
  missing decisions and identical consecutive notices stay quiet. Failed runs
  remain inspectable. Avatar activity stays truthful without reply typing dots
  or completion celebrations for quiet reviews.
- Correlated durable request/question receipts queue one source `follow_up`
  after all peers finish and the source ends, including explicit failure context.
  Replay cannot queue another continuation. FYI/status messages, cancellation,
  introductions and continuation turns cannot recursively wake more peers.
  A durably completed source stage retains its peer wait across restart; running
  ambiguous peer work is interrupted and its failure receipt still reaches it.
  Later direct user turns receive bounded automatic/receipt results as quoted
  context, so references to an automatic recommendation remain meaningful.
- `manage_routines` creates, proposes, activates, lists and cancels immutable
  one-shot reminders or fixed elapsed-time recurring routines in the owner's
  direct chat. The model can activate after an ordinary answer, or create active
  work requested by the user. The optional `confirm routine <id>` chat shortcut
  remains; pending proposals expire after 24 hours. A trusted client can also
  create an active routine via `POST /agents/{id}/routines`.
- Start times are RFC3339 instants with explicit offsets, normalized to UTC.
  Intervals are 0 (once) or 60–31536000 seconds. A routine may name an IANA
  timezone; with a whole-day interval the local wall-clock time is preserved
  across DST, so a daily 09:00 reminder stays at 09:00. Shorter intervals stay
  fixed elapsed time, and calendar cron/event triggers remain later work.
- SQLite schema 5 persists schedules, review settings and open work. A 15-second
  server tick atomically queues stable occurrence IDs and advances schedules.
  Missed fires coalesce; active/queued work prevents overlapping automatic turns.
  Busy agents are excluded before the bounded scheduling batch, and active/pending
  routines stay discoverable ahead of old cancelled/finished routine history.
  Cancellation withdraws queued occurrences and stops an executing routine.
  Claimed ambiguous turns are interrupted, never automatically retried.
- Automatic reviews, routines and receipt follow-ups retain configured builtin,
  MCP and integration-skill capabilities plus bounded memory/history/open-work
  context. Scheduling/delegation recursion stays disabled, and an unattended turn
  cannot reconfigure its own MCP/skill/CLI surface: `manage_integrations`,
  `manage_triggers`, `manage_routines`, `message_agent` and `handoff_agent` all
  require a direct user turn, so a review cannot widen its own capabilities.
- Parked and interrupted tasks are re-surfaced with each user turn, so work
  waiting on an answer cannot be silently forgotten. Review notices are deduplicated
  against a bounded window of recent findings rather than only the last one, and
  pausing proactivity withdraws queued reviews and cancels running ones. A definite
  push delivery failure retries with bounded backoff; an ambiguous send never does.
  Settled delivery rows and feed entries older than retention are pruned. Unavailable integration
  access must be reported truthfully. Peer requests cannot read or modify the
  target's private scratchpad, memory or history.
- `pause proactivity` and `resume proactivity` control reviews independently of
  explicit routines. `GET/PATCH /agents/{id}/proactivity` expose cadence (one
  hour to seven days); routine list/create/cancel endpoints and Swift client
  methods expose the same server state without a new management screen.
- This slice extends the existing SQLite product job queue and PiG `SendContent`,
  not a second harness. Durable documents are now implemented, but this is not
  completion of the full 6D/6F checkpoint/cron design.
  Server availability is required. It does not add iOS push notifications.
- Verified with schema/codegen checks, `go vet`, uncached shuffled Go race tests,
  `env -u POLYMUX_LIVE_URL swift test`, and unsigned macOS/iOS Simulator builds.
  Regressions cover approval, quiet/deduplicated output, peer scratchpad isolation,
  restart continuation, cancellation, coalescing, scheduler fairness, active-routine
  discovery, UTC offsets, automatic-result context and native cache/animation replay.
  Live-model initiative, real-time cadence and native visual timing remain unverified.

- Use the proven durable adapter for task/checkpoint persistence. Add Polymux's
  routine definition: owner/target conversation, prompt, enabled state,
  schedule/trigger details, timezone, next fire, overlap/missed-run policy,
  limits, and cancellation/retry semantics.
- Start with one-shot reminders and recurring time schedules; external event
  triggers follow for selected integrations. Proposed defaults: no overlap,
  coalesce missed recurring fires, and stable `(routineID, scheduledAt)` keys.
  Make timezone/DST behaviour explicit and test it with an injected clock.
- Routine work is its own run, not a user conversational turn. User messages
  queue independently rather than steering a scheduled prompt. Output arrives
  in the target's ordinary chat; no routine management page is needed.
- Provide create/list/cancel through agent tools/chat. Prevent routine-triggered
  recursive scheduling/spawning unless separately authorized. Delivery, limits,
  approvals, and effect receipts apply while the app is closed too.
- Define recovery at checkpoints; external effects are not exactly-once merely
  because a job is durable. Never auto-retry an ambiguous write. Publish each
  outcome/message once across the durable/product database boundary.
- A supervised server must actually be running on the mac mini. Local client
  unread/catch-up works on reconnect; remote iOS push notifications are a
  separate transport/product decision, not supplied by SSE or the scheduler.

**Milestone:** close the app, execute a scheduled task, restart the server,
reconnect, and see one correctly attributed outcome with no duplicate action
or delivery. Cancelled routines do not fire and failures stay inspectable.

### Verification gates for implementation

- Schema/codegen checks before Go/Swift changes; deterministic activity and
  animation reducer tests for every mapped state/event and precedence rule.
- Fake-provider runtime tests covering tool cycles, empty replies, timeout,
  session reopen, stop during preparation, and terminal/replay ordering.
- Group tests: duplicate names, explicit lead, mentions, handoff loops,
  membership edits, context isolation, late messages, and group-wide stop.
- Fault-injection tests around job claims, peer delivery, approvals/effects,
  task checkpoints, and cross-database outcome publication.
- Memory scope/revision/UTF-8 cap/forget tests; helper ownership/budget/cancel
  tests; routine clock/DST/missed-fire/overlap tests.
- Schedule/quoting/bounding edge cases borrowed from Rakazo's behavioural suites
  (invalid routine inputs, quoted-reply delimiter escaping, rune-safe output
  truncation, and an omitted empty memory block) where Polymux has the same seam.
  UI-level Playwright parity is not portable to Polymux's native client.
- First-run card coverage: one post per untouched chat, withheld after a user
  turn, answer recorded with its deterministic acknowledgment, unknown and
  repeated answers refused, and a dismissed card staying quiet.
- Autonomy guards: an unattended turn is refused `manage_integrations`,
  `manage_triggers`, `manage_routines`, `message_agent` and `handoff_agent`;
  a parked task re-surfaces on the next user turn; a review notice stays quiet
  within its bounded recent window and becomes reportable once evicted; pausing
  withdraws queued reviews; a failed push retries with backoff and then stops
  while an ambiguous one never does; a zoned daily routine keeps its local time
  across a DST transition.
- Existing Go tests use `sqlite_fts5` and race detection; isolate PiG's default
  config/auth directory for fake-provider tests. Swift cache/outbox/reconnect
  coverage must continue passing. Native visual checks preserve the current
  UI on both platforms, including Reduce Motion and offscreen animation pause.

---

## 7. Open decisions (need your call)

Already settled: keep Polymux's current UI (D35); state-linked animations (D36);
mentions + explicit group lead (D37). Source-established choices now recorded:
scoped PiG JSONL persistence (D30/D38), 512-dimensional search (D39), and
image/audio extraction before video content indexing.

Before implementation, confirm the next slice and its relevant proposals:

1. **Order/scope:** recommended 6A state/animations, then 6B creation/group/peer
   behaviour. Do not make voice evaluation or exhaustive tool parity a gate.
   The full 6A–6F roadmap is not one implementation batch.
2. **Creation intro (P1):** one automatic, short tool-free greeting, or remain
   silent until the first user message? Proposed: greet once, then idle.
3. **Coordination details (P2):** structured ID-addressed handoff/peer tools,
   one reply per group member per source turn initially, and explicit lead
   reassignment when membership changes. D37's reply selection is confirmed;
   these limits and management details are proposed.
4. **Animation mapping:** confirm/refine section 4.5's proposed meanings,
   completion cues, and treatment of idle custom sequences. The requirement
   to reflect real state is decided; the exact presentation table is not.
5. **Memory disclosure (P3):** isolated agent-private memory plus explicit
   shared/group scopes, rather than automatically injecting user/private facts
   into every group. Decide user-memory permissions and retained data on delete.
6. **First workflows/tools:** choose the actual research/coding/integration
   workflows to support. Proposed core: history recall, curated skills, selected
   MCP, peer coordination, and existing HTML output; web/GUI/file-output tools
   are added for a concrete need, not because Rakazo exposes them.
7. **Autonomy boundary (P4):** when may agents create persistent teammates,
   schedule recurring work, or change reusable skills? Proposed: explicit user
   request/approval, inherited narrower permissions, bounded resources, no
   recursive self-expansion. Start on the current trusted host; a strong sandbox
   or per-agent credentials requires a separate design. Unrestricted bash cannot
   be contained by memory warnings or tool-advertisement filters.
8. **Voice provider:** keep the implemented Apple cascade while evaluating
   latency/barge-in; choose any on-device LLM or cloud speech-to-speech route
   after that evaluation (D15).

The durable adapter's fit and crash/publication guarantees are engineering
validation gates, not assumptions that `durable` solves every product policy.

## 8. Non-goals & deferrals

- Rakazo UI parity, a redesigned shell, Home/usage dashboard, computer viewer,
  artifact browser, or dedicated memory/routine/open-work management screens.
- Multiple independent direct conversations per agent; existing groups stay
  supported and their behaviour is explicitly in the next-stage scope.
- Every Rakazo tool/provider/integration, a marketplace, hosted multi-tenancy,
  or a catalogue of Docker/cloud compute providers.
- Per-agent compute sandboxes/credential isolation until separately designed;
  current scoped sessions are not an OS security boundary.
- Arbitrary ambient PiG extension/resource discovery, autonomous skill edits,
  or unbounded peer spawning/delegation.
- Privileged HTML-to-agent action callbacks, persistent card state, and artifact
  versioning until separately approved.
- Wake word, speculative partial-STT execution, and new voice providers before
  the audio/latency evaluation.
- Remote push delivery while the iOS app is closed; scheduled work can run on
  the server and catch up later without claiming remote notification support.
- On-device embeddings; cross-conversation/global product search; offline
  semantic retrieval; new media extraction while offline.
- Video content/keyframe indexing, reranking, and query classification.

Source anchors for the next implementation:

- Runtime/composition: `apps/server/internal/agentruntime/runtime.go`, `mcp.go`;
  [PiG v0.4.1](https://github.com/MichaelKinsy/PiG/tree/v0.4.1).
- Existing execution/group/HTML: `apps/server/internal/server/server.go`,
  `group.go`, `html.go`; persistence/recovery: `apps/server/internal/store/`.
- Wire/cache: `contracts/polymux.schema.json`,
  `packages/PolymuxKit/Sources/PolymuxKit/ChatStore.swift`, `SidebarStore.swift`.
- Presentation: `apps/Polymux/Sources/Views/ShellView.swift`, `ChatPane.swift`,
  `apps/Polymux/Sources/Avatar/`, and `packages/AvatarKit/Sources/AvatarKit/States.swift`.
