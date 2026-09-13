import { ManualShell, shellInput } from "./manual-shell.js";
import { RateDisplay } from "./rate-display.js";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { polymuxHome } from "../paths.js";
import type { AccountRequest, Status } from "../auth.js";
import { editPrompt } from "./external-editor.js";
import { PromptEditor } from "./editor.js";
import { installContentSelection, markContent, rowPadding } from "./content.js";
import { login } from "./login.js";
import {
  loadTuiSettings,
  saveTuiSettings,
  appKeys,
  type TuiSettings,
} from "./settings.js";
import { promisify } from "node:util";
import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Input,
  CURSOR_MARKER,
  getKeybindings,
  setKeybindings,
  type Keybinding,
  ProcessTerminal,
  ScrollView,
  SelectList,
  Text,
  TuiAltScreen,
  VStack,
  matchesKey,
  fuzzyFilter,
  type Component,
  type Terminal,
} from "@earendil-works/pi-tui";
import { contentText } from "./transcript.js";
import type { MessageDto } from "@polymux/protocol";
import { ChatSession, type HostClient } from "./session.js";
import {
  RowView,
  SubagentGroup,
  align,
  clean,
  location,
  modelLabel,
  thinkingLabel,
  selectTheme,
  theme,
  tokens,
  spinner,
} from "./view.js";

export const commands = [
  ["login", "Sign in to Polymux or a model provider"],
  ["logout", "Sign out of Polymux or a model provider"],
  ["account", "Account and device-link status"],
  ["settings", "Configure the terminal"],
  ["thinking", "Set thinking level"],
  ["scoped-models", "Choose models for Ctrl+P cycling"],
  ["resume", "Resume a conversation"],
  ["name", "Rename this conversation"],
  ["session", "Conversation information"],
  ["fork", "Branch from a previous user message"],
  ["tree", "Navigate conversation history"],
  ["clone", "Duplicate this conversation"],
  ["copy", "Copy the last answer"],
  ["export", "Export conversation as Markdown"],
  ["reload", "Reload terminal settings and Host conversation"],
  ["editor", "Edit the prompt in your external editor"],
  ["hotkeys", "Keyboard shortcuts"],
  ["mcp", "MCP connection status"],
  ["devices", "Connected devices"],
  ["bots", "Choose a Polymux bot"],
  ["help", "Commands"],
  ["chats", "Switch conversation"],
  ["new", "New conversation"],
  ["model", "Choose model"],
  ["reasoning", "Choose reasoning effort"],
  ["thoughts", "Expand thinking"],
  ["tools", "Expand tool details"],
  ["stop", "Cancel run"],
  ["steer", "Send input to the active run"],
  ["queue", "Show pending follow-ups"],
  ["clear-queue", "Discard pending follow-ups"],
  ["retry", "Send the next pending follow-up"],
  ["exit", "Exit"],
  ["quit", "Exit"],
].map(([name, description]) => ({ name, description }));

/** One application owns input, transcript, settings and rendering; no extension loader. */
export async function runTui(
  client: HostClient,
  initial?: { id: string; title: string },
  terminal: Terminal = new ProcessTerminal(),
  options: {
    account?: AccountRequest;
    settingsHome?: string;
    cwd?: string;
  } = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const settingsHome = options.settingsHome ?? polymuxHome();
  let loaded = await loadTuiSettings(cwd, settingsHome);
  let settings = loaded.settings;
  const previousKeys = getKeybindings();
  setKeybindings(loaded.keybindings);
  const key = (data: string, action: string) =>
    loaded.keybindings.matches(data, action as Keybinding);
  const tui = new TuiAltScreen(terminal, true, undefined, {
    copyOnSelect: false,
  });
  installContentSelection(tui);
  const body = new Container();
  const scroll = new ScrollView(body, {
    follow: "end",
    primary: true,
    scrollbar: "hidden",
  });
  const editor = new PromptEditor(
    tui,
    { borderColor: theme.purple, selectList: selectTheme },
    {
      paddingX: settings.editorPaddingX,
      autocompleteMaxVisible: settings.autocompleteMaxVisible,
    },
    () => settings.outputPad,
  );
  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(commands, cwd),
  );
  const session = new ChatSession(client, () => refresh());
  const mounted = new Map<string, RowView>();
  let manualShell: ManualShell | undefined;
  let shellConversation = "";
  let shellPending = false;
  let shellCancelled = false;
  const cancelShell = () => {
    shellCancelled = true;
    manualShell?.cancel();
  };
  const shellContext = new Map<string, string[]>();
  let notice = "";
  let branch = "";
  const lifecycle = new AbortController();
  let closed = false;
  let suspended = false;
  let selecting = false;
  let cancelPicker: (() => void) | undefined;
  let expandedThoughts = !settings.hideThinkingBlock;
  let expandedTools = settings.expandTools;
  let authController: AbortController | undefined;
  let lastClear = 0;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const close = () => {
    closed = true;
    lifecycle.abort();
    cancelShell();
    session.detach();
    authController?.abort();
    cancelPicker?.();
    finish();
  };
  const rateDisplay = new RateDisplay();
  let rateTranscript = session.transcript;
  let rateModel = "";
  const footer: Component = {
    invalidate() {},
    render(width) {
      const padding = rowPadding(settings.outputPad, width);
      width = Math.max(1, width - padding * 2);
      const config = session.configuration;
      const transcript = session.transcript;
      const context =
        transcript.contextTokens === null
          ? "-- (--%)"
          : `${tokens(transcript.contextTokens)} (${transcript.contextWindow ? Math.round((transcript.contextTokens * 100) / transcript.contextWindow) + "%" : "--%"})`;
      const model =
        config.model?.split("/").slice(1).join("/") || "Choose model";
      return [
        theme.dim(
          align(
            manualShell &&
              shellConversation === session.conversation?.id &&
              manualShell.cwd !== cwd
              ? `Shell: ${location(manualShell.cwd)}`
              : `${location(cwd)}${branch ? ` (${branch})` : ""}`,
            `${modelLabel(model)} • ${thinkingLabel(config.reasoning)}`,
            width,
          ),
        ),
        theme.dim(
          align(
            `${config.skills.length} skills • ${config.mcps.length} mcps`,
            `${String(rateDisplay.value === null ? "--" : rateDisplay.value).padStart(3)} t/s • ${context}`,
            width,
          ),
        ),
      ].map((line) =>
        markContent(" ".repeat(padding) + line + " ".repeat(padding), padding),
      );
    },
  };
  const status: Component = {
    invalidate() {},
    render(width) {
      const padding = rowPadding(settings.outputPad, width);
      const inner = Math.max(1, width - padding * 2);
      const state = session.loading
        ? "Loading conversation…"
        : session.busy
          ? "Starting…"
          : session.transcript.status === "running"
            ? "Enter to queue • /steer to redirect • Esc to stop"
            : "/help • Ctrl+T thinking • Ctrl+O tools";
      return [
        ...notice
          .split("\n")
          .slice(1, 7)
          .flatMap((line) =>
            new Text(clean(line), padding, 0)
              .render(width)
              .map((line) => markContent(line, padding)),
          ),
        markContent(
          " ".repeat(padding) +
            theme.dim(
              align(
                notice.split("\n")[0] || state,
                session.queue.length ? `${session.queue.length} queued` : "",
                inner,
              ),
            ),
          padding,
        ),
      ];
    },
  };
  const header: Component = {
    invalidate() {},
    render(width) {
      const padding = rowPadding(settings.outputPad, width);
      return [
        markContent(
          " ".repeat(padding) +
            theme.accent(
              align(
                "Polymux",
                session.conversation?.title ?? "Conversations",
                Math.max(1, width - padding * 2),
              ),
            ),
          padding,
        ),
        "",
      ];
    },
  };
  const root = new VStack([
    { component: header, shrink: 0 },
    { component: scroll, grow: 1, basis: 0, minSize: 1 },
    { component: status, shrink: 0 },
    { component: editor, shrink: 1, minSize: 3, maxSize: 10 },
    { component: footer, shrink: 0 },
  ]);
  tui.setLayoutRoot(root);
  tui.setFocus(editor);

  function refresh(): void {
    if (closed || suspended) return;
    body.clear();
    if (!session.transcript.rows.length) {
      body.addChild({
        invalidate() {},
        render(width) {
          if (settings.quietStartup) return [];
          const lines = [""];
          for (const [title, names] of [
            ["Skills", session.configuration.skills],
            ["MCPs", session.configuration.mcps],
          ] as const) {
            if (names.length)
              lines.push(
                theme.error(title),
                ...[...names].sort().map((name) => theme.dim(clean(name))),
                "",
              );
          }
          const padding = rowPadding(settings.outputPad, width);
          return lines.flatMap((line) =>
            new Text(line, padding, 0)
              .render(width)
              .map((line) => markContent(line, padding)),
          );
        },
      });
    }
    const ids = new Set(session.transcript.rows.map((row) => row.id));
    for (const id of mounted.keys()) if (!ids.has(id)) mounted.delete(id);
    let subagents: SubagentGroup | undefined;
    for (const row of session.transcript.rows) {
      let view = mounted.get(row.id);
      if (!view || view.row !== row) {
        row.expanded =
          row.kind === "thought"
            ? expandedThoughts
            : row.kind === "tool"
              ? expandedTools
              : false;
        view = new RowView(
          row,
          () => tui.requestRender(),
          Date.now,
          () => settings.outputPad,
        );
        mounted.set(row.id, view);
      }
      if (row.toolName === "subagent") {
        if (!subagents) {
          subagents = new SubagentGroup([], () => settings.outputPad);
          body.addChild(subagents);
        }
        subagents.addTask(view);
      } else {
        subagents = undefined;
        body.addChild(view);
      }
    }
    if (
      session.busy ||
      (session.transcript.status === "running" && session.transcript.working)
    )
      body.addChild({
        invalidate() {},
        render(width) {
          const padding = rowPadding(settings.outputPad, width);
          return new Text(
            theme.accent(spinner(Date.now(), 120)) +
              " " +
              theme.yellow("Working"),
            padding,
            0,
          )
            .render(width)
            .map((line) => markContent(line, padding));
        },
      });
    tui.requestRender();
  }
  function toggle(kind: "thought" | "tool"): void {
    if (kind === "thought") expandedThoughts = !expandedThoughts;
    else expandedTools = !expandedTools;
    for (const row of session.transcript.rows)
      if (row.kind === kind)
        row.expanded = kind === "thought" ? expandedThoughts : expandedTools;
    tui.requestRender();
  }
  async function pick(
    title: string,
    items: Array<{ value: string; label: string; description?: string }>,
  ): Promise<string | undefined> {
    if (selecting || closed) return;
    selecting = true;
    let list = new SelectList(items, 8, selectTheme);
    const filter = new Editor(tui, {
      borderColor: theme.purple,
      selectList: selectTheme,
    });
    filter.onChange = (text) => {
      const next = new SelectList(
        fuzzyFilter(
          items,
          text,
          (item) => `${item.label} ${item.description ?? ""} ${item.value}`,
        ),
        8,
        selectTheme,
      );
      next.onSelect = list.onSelect;
      next.onCancel = list.onCancel;
      list = next;
      tui.requestRender();
    };
    const panel = new Container();
    panel.addChild(new Text(theme.accent(title), 1, 1));
    panel.addChild(filter);
    panel.addChild({
      invalidate() {},
      render: (width) => list.render(width),
      handleInput: (data) => list.handleInput(data),
      handleMouse: (event) => list.handleMouse(event),
    });
    const overlay = tui.showOverlay(panel, {
      width: "85%",
      maxHeight: "80%",
      anchor: "center",
    });
    tui.setFocus(filter);
    return await new Promise((resolve) => {
      const settle = (value?: string) => {
        unsubscribe();
        overlay.hide();
        selecting = false;
        cancelPicker = undefined;
        tui.setFocus(editor);
        resolve(value);
      };
      cancelPicker = () => settle();
      const unsubscribe = tui.addInputListener((data) => {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
          settle();
          return { consume: true };
        }
        if (
          matchesKey(data, "up") ||
          matchesKey(data, "down") ||
          matchesKey(data, "enter")
        ) {
          list.handleInput(data);
          return { consume: true };
        }
      });
      list.onSelect = (item) => settle(item.value);
      list.onCancel = () => settle();
    });
  }
  async function prompt(
    title: string,
    secret = false,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (selecting || closed || signal?.aborted) return;
    selecting = true;
    const input = new Input();
    if (secret)
      input.render = (width) => [
        theme.dim(
          "•".repeat(
            Math.min(
              Array.from(input.getValue()).length,
              Math.max(0, width - 2),
            ),
          ),
        ) +
          CURSOR_MARKER +
          " ",
      ];
    const panel = new Container();
    panel.addChild(new Text(theme.accent(clean(title)), 1, 1));
    panel.addChild(input);
    const overlay = tui.showOverlay(panel, {
      width: "85%",
      maxHeight: "70%",
      anchor: "center",
    });
    tui.setFocus(input);
    return await new Promise((resolve) => {
      let settled = false;
      const settle = (value?: string) => {
        if (settled) return;
        settled = true;
        input.setValue("");
        unsubscribe();
        overlay.hide();
        selecting = false;
        cancelPicker = undefined;
        signal?.removeEventListener("abort", cancel);
        tui.setFocus(editor);
        resolve(value);
      };
      const cancel = () => settle();
      cancelPicker = cancel;
      signal?.addEventListener("abort", cancel, { once: true });
      const unsubscribe = tui.addInputListener((data) => {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
          settle();
          return { consume: true };
        }
      });
      input.onSubmit = (value) => settle(value);
      input.onEscape = cancel;
    });
  }
  async function updateSettings(value: Partial<TuiSettings>) {
    // Explicit changes win over the project setting that supplied the old value.
    const file = await readFile(loaded.projectFile, "utf8")
      .then(() => loaded.projectFile)
      .catch(() => loaded.globalFile);
    await saveTuiSettings(value, file);
    settings = { ...settings, ...value };
    expandedThoughts = !settings.hideThinkingBlock;
    expandedTools = settings.expandTools;
    editor.setPaddingX(settings.editorPaddingX);
    editor.setAutocompleteMaxVisible(settings.autocompleteMaxVisible);
    for (const row of session.transcript.rows) {
      if (row.kind === "thought") row.expanded = expandedThoughts;
      if (row.kind === "tool") row.expanded = expandedTools;
    }
    refresh();
  }
  async function cycleThinking() {
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    await session.configure({
      reasoning:
        levels[
          (levels.indexOf(session.configuration.reasoning) + 1) % levels.length
        ],
    });
  }
  async function cycleModel(direction: number) {
    const models =
      await client.call<Array<{ provider: string; id: string }>>("models.list");
    const available = models.map((model) => `${model.provider}/${model.id}`);
    const scoped = settings.scopedModels.length
      ? settings.scopedModels.filter((model) => available.includes(model))
      : available;
    if (!scoped.length) throw new Error("No models available.");
    const index = scoped.indexOf(session.configuration.model ?? "");
    await session.configure({
      model: scoped[(index + direction + scoped.length) % scoped.length],
    });
  }
  function requireConversation() {
    if (!session.conversation) throw new Error("Start a conversation first.");
    return session.conversation;
  }
  async function authenticate(value: string) {
    if (!options.account)
      throw new Error("Sign-in requires the local Polymux Host.");
    authController = new AbortController();
    const abortPrompt = () => cancelPicker?.();
    authController.signal.addEventListener("abort", abortPrompt);
    try {
      notice = await login(
        options.account,
        {
          signal: authController.signal,
          pick,
          prompt,
          notify(message) {
            notice = clean(message);
            refresh();
          },
        },
        value || undefined,
      );
    } finally {
      authController.signal.removeEventListener("abort", abortPrompt);
      authController = undefined;
    }
  }
  async function chooseConversation(): Promise<void> {
    const chats = await session.conversations();
    const bots =
      await client.call<Array<{ conversationId: string; name: string }>>(
        "team.list",
      );
    const items = [
      { value: "__new__", label: "New conversation" },
      ...chats.map((chat) => ({ value: chat.id, label: clean(chat.title) })),
      ...bots.map((bot) => ({
        value: bot.conversationId,
        label: clean(bot.name),
        description: "Bot",
      })),
    ];
    const id = await pick("Conversations", items);
    if (!id) return;
    if (id === "__new__") await newConversation();
    else
      await session.open({
        id,
        title: items.find((item) => item.value === id)!.label,
      });
  }
  async function newConversation(title = "Assistant"): Promise<void> {
    if (session.busy || session.loading || session.queue.length)
      throw new Error("Wait for pending input before creating a conversation.");
    const chat = await client.call<{ id: string; title: string }>(
      "conversations.create",
      [title],
    );
    await session.open(chat);
  }
  async function command(text: string): Promise<void> {
    if (authController && !["/exit", "/quit", "/stop"].includes(text))
      throw new Error("Finish or cancel sign-in first.");
    const [name, ...rest] = text.split(/\s+/);
    const value = rest.join(" ");
    switch (name) {
      case "/login":
        if (rest.length > 1)
          throw new Error(
            "Use /login and enter credentials in the private dialog.",
          );
        await authenticate(value);
        return;
      case "/logout": {
        if (!options.account)
          throw new Error("Sign-out requires the local Host.");
        const providers = await options.account<Array<{ providerId: string }>>({
          action: "provider.list",
        });
        const selected =
          value ||
          (await pick("Logout", [
            { value: "polymux", label: "Polymux account" },
            ...providers.map((provider) => ({
              value: provider.providerId,
              label: provider.providerId,
            })),
          ]));
        if (!selected) return;
        if (selected === "polymux") {
          await options.account({ action: "logout" });
          notice = "Signed out of Polymux";
        } else {
          const result = await options.account<{
            environmentConfigured: boolean;
          }>({ action: "provider.delete", provider: selected });
          notice = `Signed out of ${selected}${result.environmentConfigured ? " · Host environment credentials are still configured" : ""}`;
        }
        return;
      }
      case "/account": {
        if (!options.account)
          throw new Error("Account status requires the local Host.");
        const status = await options.account<Status>({
          action: value === "sync" ? "sync" : "status",
        });
        notice = status.signedIn
          ? `Signed in as ${status.profile?.email || "Polymux account"}${status.device.error ? ` · ${status.device.error}` : ""}`
          : "Signed out · /login polymux";
        return;
      }
      case "/hotkeys":
        await pick(
          "Keyboard shortcuts",
          Object.entries(appKeys).map(([id, definition]) => ({
            value: id,
            label: loaded.keybindings.getKeys(id as Keybinding).join(" / "),
            description: definition.description,
          })),
        );
        return;
      case "/settings": {
        const selected = await pick("Settings", [
          {
            value: "model",
            label: "Model",
            description: session.configuration.model ?? "Choose model",
          },
          {
            value: "thinking",
            label: "Thinking",
            description: session.configuration.reasoning,
          },
          {
            value: "hideThinkingBlock",
            label: "Thinking expanded",
            description: String(!settings.hideThinkingBlock),
          },
          {
            value: "expandTools",
            label: "Tools expanded",
            description: String(settings.expandTools),
          },
          {
            value: "quietStartup",
            label: "Quiet startup",
            description: String(settings.quietStartup),
          },
          {
            value: "outputPad",
            label: "Output padding",
            description: String(settings.outputPad),
          },
          {
            value: "editorPaddingX",
            label: "Editor padding",
            description: String(settings.editorPaddingX),
          },
          {
            value: "scoped-models",
            label: "Scoped models",
            description: `${settings.scopedModels.length || "All"}`,
          },
        ]);
        if (!selected) return;
        if (["model", "thinking", "scoped-models"].includes(selected)) {
          await command(`/${selected}`);
          return;
        }
        if (selected === "outputPad")
          await updateSettings({ outputPad: settings.outputPad ? 0 : 1 });
        else if (selected === "editorPaddingX")
          await updateSettings({
            editorPaddingX: settings.editorPaddingX ? 0 : 1,
          });
        else {
          const field = selected as
            "hideThinkingBlock" | "expandTools" | "quietStartup";
          await updateSettings({ [field]: !settings[field] });
        }
        notice = "Settings saved";
        return;
      }
      case "/scoped-models": {
        const models =
          await client.call<
            Array<{ provider: string; id: string; name: string }>
          >("models.list");
        const selected = await pick("Models for Ctrl+P · select to toggle", [
          { value: "__all__", label: "Use all models" },
          ...models.map((model) => {
            const id = `${model.provider}/${model.id}`;
            return {
              value: id,
              label: `${settings.scopedModels.includes(id) ? "✓ " : "  "}${model.name}`,
              description: id,
            };
          }),
        ]);
        if (selected)
          await updateSettings({
            scopedModels:
              selected === "__all__"
                ? []
                : settings.scopedModels.includes(selected)
                  ? settings.scopedModels.filter((model) => model !== selected)
                  : [...settings.scopedModels, selected],
          });
        return;
      }
      case "/name": {
        const chat = requireConversation();
        const title = value || (await prompt("Conversation name"));
        if (title) {
          await client.call("conversations.rename", [chat.id, title]);
          chat.title = title;
        }
        return;
      }
      case "/session": {
        const chat = requireConversation();
        notice = `${chat.title} · ${chat.id}\n${session.configuration.model ?? "No model"} · ${session.configuration.reasoning}\n${session.transcript.rows.length} transcript rows · ${session.transcript.status}\n${settingsHome}`;
        return;
      }
      case "/tree": {
        const rows = session.transcript.rows;
        const selected = await pick(
          "Conversation history",
          rows.map((row) => ({
            value: row.id,
            label: clean(row.text).split("\n")[0].slice(0, 120),
            description: row.kind,
          })),
        );
        if (selected) {
          let offset = 0;
          for (const row of rows) {
            if (row.id === selected) break;
            offset += mounted.get(row.id)?.render(terminal.columns).length ?? 0;
          }
          scroll.scrollTo(offset, { disableFollow: true });
        }
        return;
      }
      case "/fork": {
        if (
          session.busy ||
          session.transcript.status === "running" ||
          session.queue.length
        )
          throw new Error("Wait for pending work before forking.");
        const chat = requireConversation();
        const messages = await client.call<MessageDto[]>(
          "conversations.messages",
          [chat.id],
        );
        const choices = messages.filter((message) => message.role === "user");
        const id = await pick(
          "Fork from a prompt",
          choices.map((message) => ({
            value: message.id,
            label: clean(contentText(message.content)).slice(0, 120),
          })),
        );
        if (!id) return;
        const fork = await client.call<{ id: string; title: string }>(
          "conversations.fork",
          [chat.id, id],
        );
        await session.open(fork);
        editor.setText(
          contentText(choices.find((message) => message.id === id)!.content),
        );
        return;
      }
      case "/clone": {
        if (
          session.busy ||
          session.transcript.status === "running" ||
          session.queue.length
        )
          throw new Error("Wait for pending work before cloning.");
        const copy = await client.call<{ id: string; title: string }>(
          "conversations.duplicate",
          [requireConversation().id],
        );
        await session.open(copy);
        return;
      }
      case "/editor": {
        suspended = true;
        tui.stop();
        try {
          editor.setText(await editPrompt(editor.getText(), lifecycle.signal));
        } finally {
          suspended = false;
          if (!closed) {
            tui.start();
            tui.setFocus(editor);
            refresh();
          }
        }
        return;
      }
      case "/copy": {
        const text = [...session.transcript.rows]
          .reverse()
          .find((row) => row.kind === "assistant")?.text;
        if (!text) throw new Error("No answer to copy.");
        terminal.write(
          `\x1b]52;c;${Buffer.from(clean(text)).toString("base64")}\x07`,
        );
        notice = "Answer sent to terminal clipboard";
        return;
      }
      case "/export": {
        const chat = requireConversation();
        const file = path.resolve(cwd, value || `polymux-${chat.id}.md`);
        const transcript = session.transcript.rows
          .filter((row) => ["user", "assistant"].includes(row.kind))
          .map(
            (row) =>
              `## ${row.kind === "user" ? "You" : "Polymux"}\n\n${clean(row.text)}`,
          )
          .join("\n\n");
        await writeFile(file, `# ${clean(chat.title)}\n\n${transcript}\n`, {
          flag: "wx",
          mode: 0o600,
        });
        notice = `Exported ${file}`;
        return;
      }
      case "/reload": {
        if (options.account)
          await options.account({ action: "resources.reload" });
        loaded = await loadTuiSettings(cwd, settingsHome);
        settings = loaded.settings;
        setKeybindings(loaded.keybindings);
        editor.setPaddingX(settings.editorPaddingX);
        editor.setAutocompleteMaxVisible(settings.autocompleteMaxVisible);
        expandedThoughts = !settings.hideThinkingBlock;
        expandedTools = settings.expandTools;
        mounted.clear();
        if (session.conversation) await session.open(session.conversation);
        notice = "Reloaded settings, keybindings and Host conversation";
        return;
      }
      case "/mcp": {
        if (!options.account)
          throw new Error("MCP status requires the local Host.");
        const servers = await options.account<
          Array<{ id: string; status: string; error?: string }>
        >({ action: "resources.status" });
        if (!servers.length) {
          notice = "No MCP servers configured";
          return;
        }
        await pick(
          "MCPs",
          servers.map((server) => ({
            value: server.id,
            label: server.id,
            description: server.error || server.status,
          })),
        );
        return;
      }
      case "/devices": {
        if (!options.account)
          throw new Error("Device status requires the local Host.");
        const { connectedDevices } = await options.account<Status>({
          action: "status",
        });
        if (!connectedDevices.length) {
          notice = "No devices connected · /login polymux";
          return;
        }
        await pick(
          "Devices",
          connectedDevices.map((device) => ({
            value: device.deviceName,
            label: device.deviceName,
          })),
        );
        return;
      }
      case "/bots": {
        const bots =
          await client.call<Array<{ conversationId: string; name: string }>>(
            "team.list",
          );
        const id = await pick(
          "Bots",
          bots.map((bot) => ({ value: bot.conversationId, label: bot.name })),
        );
        if (id)
          await session.open({
            id,
            title: bots.find((bot) => bot.conversationId === id)!.name,
          });
        return;
      }
      case "/exit":
      case "/quit":
        close();
        return;
      case "/help":
        notice = commands.map((command) => `/${command.name}`).join("  ");
        return;
      case "/thoughts":
        toggle("thought");
        return;
      case "/tools":
        toggle("tool");
        return;
      case "/stop":
        authController?.abort();
        cancelShell();
        cancelPicker?.();
        await session.cancel();
        return;
      case "/resume":
      case "/chats":
        await chooseConversation();
        return;
      case "/new":
        await newConversation(value || "Assistant");
        return;
      case "/queue":
        notice = session.queue.join(" • ") || "No queued follow-ups";
        return;
      case "/clear-queue":
        session.queue = [];
        return;
      case "/retry": {
        if (session.busy || session.transcript.status === "running")
          throw new Error("Wait for the active run.");
        const next = session.queue.shift();
        if (next)
          try {
            await session.submit(next);
          } catch (error) {
            session.queue.unshift(next);
            throw error;
          }
        return;
      }
      case "/steer":
        if (!value || session.transcript.status !== "running")
          throw new Error("Usage: /steer MESSAGE during a run");
        await client.call("runs.steer", [session.transcript.runId, value]);
        session.transcript.rows.push({
          id: `steer:${Date.now()}`,
          kind: "user",
          text: value,
        });
        return;
      case "/model": {
        const models =
          await client.call<
            Array<{ provider: string; id: string; name: string }>
          >("models.list");
        const selected =
          value ||
          (await pick(
            "Model",
            models.map((model) => ({
              value: `${model.provider}/${model.id}`,
              label: model.name,
              description: `${model.provider}/${model.id}`,
            })),
          ));
        if (selected) await session.configure({ model: selected });
        return;
      }
      case "/thinking":
      case "/reasoning": {
        const selected =
          value ||
          (await pick(
            "Reasoning",
            ["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(
              (value) => ({ value, label: value }),
            ),
          ));
        if (selected) await session.configure({ reasoning: selected });
        return;
      }
      default:
        throw new Error(`Unknown command ${name}. Use /help.`);
    }
  }
  const report = (error: unknown) => {
    notice = clean(error instanceof Error ? error.message : String(error));
    refresh();
  };
  async function submit(text: string) {
    const input = shellInput(text);
    if (!input) {
      if (shellPending)
        throw new Error("Wait for the shell command to finish.");
      const id = session.conversation?.id ?? "";
      const context = shellContext.get(id) ?? [];
      // Reserve this batch before sending or queueing; another command may
      // finish while the Host accepts this prompt.
      shellContext.delete(id);
      try {
        await session.submit(
          context.length ? `${context.join("\n\n")}\n\n${text}` : text,
        );
      } catch (error) {
        if (context.length)
          shellContext.set(id, [...context, ...(shellContext.get(id) ?? [])]);
        throw error;
      }
      return;
    }
    if (
      authController ||
      session.loading ||
      shellPending ||
      manualShell?.running
    )
      throw new Error("Wait for the current operation to finish.");
    const conversation = session.conversation;
    if (!conversation) throw new Error("Choose a conversation first.");
    const transcript = session.transcript;
    shellPending = true;
    shellCancelled = false;
    try {
      if (!manualShell || shellConversation !== conversation.id) {
        manualShell = new ManualShell(cwd, settingsHome, conversation.id);
        shellConversation = conversation.id;
        await manualShell.restore();
      }
      if (closed) return;
      if (shellCancelled) {
        notice = "Shell command cancelled";
        return;
      }
      if (session.loading || session.transcript !== transcript)
        throw new Error(
          "Conversation changed while preparing the shell command. Submit it again.",
        );
      const row: import("./transcript.js").TranscriptRow = {
        id: `shell:${Date.now()}`,
        kind: "tool",
        manualShell: true,
        text: `${input.excluded ? "!!" : "!"} ${input.command}`,
        detail: "",
        status: "running",
        startedAt: Date.now(),
      };
      transcript.rows.push(row);
      refresh();
      try {
        const result = await manualShell.run(input.command, (text) => {
          row.detail = ((row.detail ?? "") + text).slice(-64000);
          refresh();
        });
        row.status = result.cancelled
          ? "cancelled"
          : result.exitCode === 0
            ? "completed"
            : "failed";
        row.detail += `\nExit ${result.exitCode}`;
        if (!input.excluded) {
          const context = shellContext.get(conversation.id) ?? [];
          context.push(`Manual shell command: ${input.command}\n${row.detail}`);
          shellContext.set(conversation.id, context);
        }
      } catch (error) {
        row.status = "failed";
        row.detail = String(error);
        throw error;
      } finally {
        row.endedAt = Date.now();
      }
    } finally {
      shellPending = false;
      refresh();
    }
  }
  editor.onChange = (text) => {
    editor.borderColor = /^!!?\s/.test(text.trimStart())
      ? theme.accent
      : theme.purple;
  };
  editor.onSubmit = (text) => {
    text = text.trim();
    if (!text) return;
    editor.setText("");
    if (!/^\/(?:login|logout)\b/.test(text)) editor.addToHistory(text);
    notice = "";
    void (text.startsWith("/") ? command(text) : submit(text))
      .catch((error) => {
        if (!text.startsWith("/")) editor.setText(text);
        report(error);
      })
      .finally(refresh);
  };
  const unsubscribe = tui.addInputListener((data) => {
    if (selecting || suspended) return;
    if (
      !authController &&
      tui.hasActiveSelection() &&
      (key(data, "tui.input.copy") || key(data, "app.message.copy"))
    ) {
      void tui.copyActiveSelectionToClipboard().catch(report);
      return { consume: true };
    }
    if (key(data, "app.clear")) {
      if (!authController && tui.hasActiveSelection()) {
        void tui.copyActiveSelectionToClipboard().catch(report);
        return { consume: true };
      }
      if (authController) {
        authController.abort();
        return { consume: true };
      }
      if (!editor.getText() && Date.now() - lastClear < 500) close();
      else {
        editor.setText("");
        notice = "Press Ctrl+C again to exit";
        lastClear = Date.now();
        tui.requestRender();
      }
      return { consume: true };
    }
    if (key(data, "app.editor.external")) {
      void command("/editor").catch(report).finally(refresh);
      return { consume: true };
    }
    if (key(data, "app.model.select")) {
      void command("/model").catch(report).finally(refresh);
      return { consume: true };
    }
    if (key(data, "app.thinking.cycle")) {
      void cycleThinking().catch(report);
      return { consume: true };
    }
    if (
      key(data, "app.model.cycleForward") ||
      key(data, "app.model.cycleBackward")
    ) {
      void cycleModel(key(data, "app.model.cycleBackward") ? -1 : 1).catch(
        report,
      );
      return { consume: true };
    }
    if (key(data, "app.message.dequeue")) {
      const queued = session.queue.pop();
      if (queued) {
        if (editor.getText()) session.queue.push(editor.getText());
        editor.setText(queued);
        refresh();
      }
      return { consume: true };
    }
    if (key(data, "app.message.copy")) {
      void command("/copy").catch(report).finally(refresh);
      return { consume: true };
    }
    if (key(data, "app.exit") && !editor.getText()) {
      close();
      return { consume: true };
    }
    if (key(data, "app.thinking.toggle")) {
      toggle("thought");
      return { consume: true };
    }
    if (key(data, "app.tools.expand")) {
      toggle("tool");
      return { consume: true };
    }
    if (key(data, "app.interrupt")) {
      authController?.abort();
      cancelShell();
      void session.cancel().catch(report);
      return { consume: true };
    }
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  let animation: ReturnType<typeof setInterval> | undefined;
  const stop = close;
  try {
    tui.start();
    process.once("SIGTERM", stop);
    void promisify(execFile)("git", ["branch", "--show-current"], {
      cwd,
      timeout: 1500,
    })
      .then((result) => {
        branch = clean(result.stdout.trim());
        refresh();
      })
      .catch(() => {});
    await Promise.race([
      initial ? session.open(initial) : newConversation(),
      done,
    ]);
    if (closed) return;
    refresh();
    timer = setInterval(() => {
      void session.poll().catch(report);
    }, 250);
    animation = setInterval(() => {
      if (
        rateTranscript !== session.transcript ||
        rateModel !== session.transcript.model
      ) {
        rateDisplay.reset();
        rateTranscript = session.transcript;
        rateModel = session.transcript.model;
      }
      const rateChanged = rateDisplay.step(session.transcript.rate);
      if (
        !suspended &&
        (rateChanged ||
          manualShell?.running ||
          session.busy ||
          session.transcript.status === "running" ||
          session.transcript.rows.some(
            (row) => row.childRunId && !row.childSettled,
          ))
      )
        tui.requestRender();
    }, 25);
    await done;
  } finally {
    close();
    if (timer) clearInterval(timer);
    if (animation) clearInterval(animation);
    process.removeListener("SIGTERM", stop);
    unsubscribe();
    tui.stop();
    setKeybindings(previousKeys);
  }
  if (session.conversation)
    process.stdout.write(`Resume: polymux chat ${session.conversation.id}\n`);
  if (session.queue.length)
    process.stdout.write(
      `${session.queue.length} unsent follow-up(s):\n${session.queue.map(clean).join("\n")}\n`,
    );
}
