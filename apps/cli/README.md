# Polymux CLI

Run `polymux` in a terminal to open the built-in fullscreen interface connected
to your Polymux Host. `polymux tui` opens the same interface explicitly;
`polymux chat TARGET` opens a named bot or conversation. The TUI starts the local
background Host when needed, then starts a new conversation. `/resume` opens
previous conversations. Host logs go to `~/.polymux/host.log`.
The Host must run the matching CLI build to expose configuration and live
updates; rebuilding the client does not upgrade an already-running Host.

The interface owns its One Dark colours, rounded prompt blocks, compact tool
rows, inline thinking, input handling, model settings and two-line footer.
Prompt and message boxes use rounded purple borders without a background fill.
The footer aligns with transcript padding and displays readable model and
thinking names. File paths shorten in the middle, moving to a continuation
line in narrow terminals; MCP rows use `Server: Action` titles and compact results.
It uses `pi-tui` as a terminal rendering library. It does not run pi, load pi
extensions, read personal pi settings, or patch installed packages.

- Enter submits a prompt, or queues a follow-up while a run is active.
- `! COMMAND` runs a local Bash command in a rounded blue card; `!! COMMAND`
  excludes its output from model context. A space after the prefix is required:
  `!important` remains ordinary text. Output from `!` is included with the next
  prompt sent from this terminal. Commands run locally even when the Host is remote.
  `cd` and `cd -` persist independently of the agent workspace, per conversation,
  under `tui-shell/`; the footer shows `Shell:` when the directory differs.
  Esc, `/stop`, and exiting cancel the manual command. Cards and unsent shell
  context last for this terminal session; directory state survives restart.
  Manual shell commands currently require Bash on macOS/Linux.
- Ctrl+C clears the editor; a second press within half a second exits.
  With a mouse selection, Ctrl+C copies it instead. Selection excludes borders
  and layout padding while retaining indentation within the selected content.
  Ctrl+X also copies the active selection before falling back to the last answer.
- Shift+Tab cycles thinking; Ctrl+L selects a model; Ctrl+P cycles scoped models.
- Alt+Up brings the last queued follow-up back into the editor.
- Ctrl+G opens the prompt in `$VISUAL` or `$EDITOR`; Ctrl+X copies the last answer.
- Shift+Enter inserts a newline where the terminal supports it.
- `/steer MESSAGE` redirects the active run immediately.
- Esc or `/stop` cancels the run; queued prompts remain available.
- Click a thinking/tool row to expand it. Ctrl+T and Ctrl+O toggle all thinking
  and tool rows respectively. Expanded tools show a bounded output preview.
  Subagents appear as compact task groups. Their rows follow actual child-run
  completion, failure or cancellation, rather than marking dispatch as finished work.
- `/resume` or `/chats` switches conversations; `/new TITLE` creates one.
- `/name`, `/session`, `/tree`, `/fork`, `/clone`, `/copy`, and `/export` manage history.
  Fork starts a separate Host conversation before the selected prompt, which is
  placed in the editor for revision. Tree navigates this conversation’s transcript.
  Export writes a new Markdown file; existing files are never overwritten.
- `/settings`, `/scoped-models`, `/hotkeys`, and `/reload` configure the interface.
- `/apps` opens the app picker. `/help` is searchable and opens the selected command.
- `/bots` (`/team`) browses bots, conversations, summaries, schedules, model and
  agent settings, computer start/stop, per-device policies, temporary grants,
  import/export, and deletion. Every setting targets the selected bot.
- `/tasks` shows work across conversations, preserving runtime outcomes, queued
  jobs, parent relationships, result previews, and cancellation.
- `/schedules` manages Assistant and bot schedules through the same scheduler
  used by Desktop: recurring times, cron, pause/resume, run now, and history.
- `/hub` reads paginated conversations, opens messages, explicitly marks them
  read, and reviews drafts before sending. `/vault` manages passwords, codes,
  editing, pins, trash, locking, and synchronization status.
- `/usage` keeps All detectable agents, Polymux, Assistant, and Team separate.
  Global discovery runs in a packaged background worker and reports its state.
- `/providers` manages model sign-in and is also available in Settings.
- `/devices` connects and revokes devices, shows invitations, and presents
  approval challenges. `/account` and `/mcp` show local Host status.
- `/model` and `/thinking` (`/reasoning` also works) open searchable pickers. Model choices persist in
  the Host profile, with a separate choice for each conversation. Reasoning is
  remembered per model. An explicit Host model takes precedence.
- `/queue`, `/retry` and `/clear-queue` manage unsent follow-ups. A failed or
  cancelled run never automatically submits the next prompt.
- `/exit`, `/quit`, or Ctrl+D on empty input exits and prints a resume
  command. Exiting leaves Host runs running and prints any unsent follow-ups.

The footer reports resources from the Host. The Host loads native tools, skills
and only the MCPs explicitly listed in its own `mcp.json`. MCP prompts are not
registered as slash commands. `/reload` refreshes Host resources when no runs
are active; `/mcp` shows connection failures separately from configured counts.
Context remains unknown until the provider reports usage. Generation speed is an
estimate from arriving text/reasoning (3.8 characters per token), excluding initial
request waits and exceptional pauses. The display eases toward the measured speed
and holds between tool turns; changing model resets it. Host text arrives as polled
drafts, so this is an estimate of observed streaming, not a server decode metric.
A blue six-frame spinner and yellow `Working` row appears at the transcript tail
while awaiting activity, then disappears when thinking, text, or tools arrive.
It is never saved in conversation history.

Completed messages and activity replay from Host history. Streaming answer
drafts are held only while their run is active; finished messages are durable.
Markdown is rendered in the terminal. Mermaid diagrams render once a message
finishes, matching the personal pi setting. Unsupported or oversized diagrams
keep their source visible.

Noninteractive `polymux` still prints help. `polymux run`, piped `polymux chat`,
and JSON-oriented commands retain their existing output.

## Paired Desktop

`polymux tui --host "DEVICE NAME"` connects to an already paired Host and opens
its real conversations, bots, Tasks, Schedules, Hub, Vault, and Usage. A Host id
can be used instead of its name. Pair the devices first through `/devices`.
The header and resume command identify the selected Host. The CLI never falls
back to a different Host when the requested device is unavailable.

A local Host and Desktop have separate databases. Connecting to Desktop is
required to manage bots stored there. Local shell commands still execute on the
terminal's computer. Account, provider sign-in, and device administration remain
local Host operations; paired RPC does not expose the local administration API.

The TUI uses Midas's compact searchable lists, right-aligned statuses, rounded
panels, and scrollable details. It does not yet cover every Desktop app or action.
See [the parity inventory](../../docs/reviews/tui-parity-2026-09-16.md) for the
remaining functionality and the verification boundary. The headless Host runs
Polymux agents; ACP runtime configuration is available when connected to Desktop.
Unsupported ACP execution fails explicitly on a headless Host.

## Configuration

The default home is `~/.polymux/` on every platform. `POLYMUX_HOME` overrides it.
Existing service definitions with an explicit `POLYMUX_HOME` keep that directory;
use the same override in the terminal when attaching to one of those Hosts.

- `settings.json`: output/editor padding, thinking/tool expansion, quiet startup,
  autocomplete size, and scoped models. `./.polymux/settings.json` overrides the
  user settings for the current project.
- `keybindings.json`: the same `app.*` and `tui.*` key names as pi. The personal
  defaults bind Enter to follow-ups and Enter/Super+Enter to submit.
- `models.json`: declarative custom providers; see `examples/models.json` for
  the personal Aorus gateway. Supports OpenAI completions/responses and Anthropic
  messages. Use `apiKeyEnv` or `/login` for secrets; `apiKey: "local"` is for a
  local gateway that needs no real key. The endpoint is relative to the Host.
- `mcp.json`: explicit `mcpServers` definitions using `command`/`args`/`env` or
  `url`/`headers`, with `enabled: false` to disable a server.
- `skills/`: personal Host skills, alongside existing profile and official skills.
- `config/`: Host environment and encrypted account/model credentials.
- `host/`: the Host database, conversations, device identity, and state.

The interface is purpose-built using pi-tui primitives; there is no pi extension
loader or dependency on the personal pi installation. Polymux Host conversations,
profiles and device execution remain the source of truth. Pi-specific JSONL session
imports, GitHub-gist sharing and pi extension-management commands are not exposed.

## In-prompt sign-in

Type `/login` to choose a model provider or **Polymux account**. Provider sign-in
supports the provider's API-key and OAuth flows, including subscription methods
where provided by pi-ai. `/login openai`, for example, opens the provider flow;
`/login polymux` offers Google, Apple, and email/password for device linking.
Passwords, API keys and pasted authorization codes use private, masked dialogs
and never become conversation messages or editor-history entries. `/logout`
selects the credential to remove. Model credentials persist encrypted on the
Host and refresh there during inference. Host environment credentials remain
available if explicitly configured outside the saved login.

## Account sign-in

`polymux auth` commands run outside the TUI and use the local background Host:

```sh
polymux auth login google
polymux auth login apple
polymux auth login email --email you@example.com
polymux auth status
polymux auth sync
polymux auth logout
```

Email login prompts for a hidden password. Scripts can supply it over stdin
with `--password-stdin`; passwords are not accepted as command arguments.
Google and Apple open the system browser. `--no-browser` prints the sign-in link
without opening it. Both use Supabase PKCE and the same allowed callback as
Desktop: `http://127.0.0.1:47667/auth/callback`. For a remote SSH terminal, forward
that port to the Host computer before opening the link on your local computer.
If another sign-in owns the port, finish it first or use email/password.

The Host encrypts account sessions in `config/account-credentials.json` using
its local administration secret and refreshes them while running. Sign-in
registers this device and discovers reachable devices on the same verified
Supabase account. Device linking failures are reported separately from login;
`auth sync` retries discovery. The Host continues discovery in the background.
`auth status --json` exposes profile and connection state, never session tokens.
Logout signs this Host out, withdraws its account registration and stops further
automatic pairing. Previously approved device connections remain separate grants
and can be revoked with the Devices commands.

CLI builds use the public `POLYMUX_SUPABASE_URL` and
`POLYMUX_SUPABASE_ANON_KEY` from the build environment. The Host can override them
in its `config/host.env`. Use the same Supabase project as Polymux Desktop, with
Google/Apple enabled and the callback allowed. Account commands require a
matching, running Host; they never change the ordinary Desktop account session.

Development: `npm run build:cli`, then `node apps/cli/dist/polymux.mjs`.
Run `npm run test:cli` for CLI, terminal-emulator and Host coverage. Tests use
temporary Host data and scripted responses; no personal model credentials or
ordinary Desktop session are needed.
