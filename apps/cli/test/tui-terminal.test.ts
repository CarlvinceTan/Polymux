import assert from "node:assert/strict";
import test from "node:test";
import xterm from "@xterm/headless";
import {
  Container,
  ScrollView,
  Text,
  TuiAltScreen,
  VStack,
  visibleWidth,
  type Terminal,
} from "@earendil-works/pi-tui";
import { installContentSelection, markContent } from "../src/tui/content.js";
import { PromptEditor } from "../src/tui/editor.js";
import { RowView, theme, selectTheme } from "../src/tui/view.js";
import type { RunEventDto } from "@polymux/protocol";
import { runTui } from "../src/tui/index.js";
import type { HostClient } from "../src/tui/session.js";

class TestTerminal implements Terminal {
  screen = new xterm.Terminal({ cols: 90, rows: 28, allowProposedApi: true });
  input: (data: string) => void = () => {};
  resize: () => void = () => {};
  stopped = false;
  copied = "";
  get columns() {
    return this.screen.cols;
  }
  get rows() {
    return this.screen.rows;
  }
  kittyProtocolActive = false;
  start(input: (data: string) => void, resize: () => void) {
    this.input = input;
    this.resize = resize;
  }
  stop() {
    this.stopped = true;
  }
  async drainInput() {}
  write(data: string) {
    const copy = data.match(/\x1b\]52;c;([^\x07]*)\x07/);
    if (copy) this.copied = Buffer.from(copy[1], "base64").toString();
    this.screen.write(data);
  }
  moveBy(lines: number) {
    this.write(`\x1b[${Math.abs(lines)}${lines < 0 ? "A" : "B"}`);
  }
  hideCursor() {
    this.write("\x1b[?25l");
  }
  showCursor() {
    this.write("\x1b[?25h");
  }
  clearLine() {
    this.write("\x1b[2K");
  }
  clearFromCursor() {
    this.write("\x1b[J");
  }
  clearScreen() {
    this.write("\x1b[2J");
  }
  setTitle(_title: string) {}
  setProgress(_active: boolean) {}
  async text() {
    await new Promise<void>((resolve) => this.screen.write("", resolve));
    return Array.from(
      { length: this.rows },
      (_, i) =>
        this.screen.buffer.active.getLine(i)?.translateToString(true) ?? "",
    ).join("\n");
  }
}

test(
  "mouse selection omits box chrome and gutters, preserves indentation, and targets the rounded editor",
  { timeout: 10000 },
  async () => {
    const terminal = new TestTerminal();
    let copied = "";
    const tui = new TuiAltScreen(terminal, true, undefined, {
      copyOnSelect: false,
      copySelection: async (text) => {
        copied = text;
        return true;
      },
    });
    installContentSelection(tui);
    const body = new Container();
    // Enough content to exercise document selection after scrolling, not just screen coordinates.
    body.addChild(
      new Text(
        Array.from({ length: 35 }, (_, i) => `Earlier ${i}`).join("\n"),
        1,
        0,
      ),
    );
    body.addChild(
      new RowView({ id: "u", kind: "user", text: "Hello 项目" }, () => {}),
    );
    body.addChild({
      invalidate() {},
      render(width) {
        return new Text("  keep indentation", 1, 0)
          .render(width)
          .map((line) => markContent(line, 1));
      },
    });
    const scroll = new ScrollView(body, {
      primary: true,
      follow: "end",
      scrollbar: "hidden",
    });
    const editor = new PromptEditor(
      tui,
      { borderColor: theme.purple, selectList: selectTheme },
      { paddingX: 1 },
      () => 1,
    );
    const root = new VStack([
      { component: scroll, grow: 1, basis: 0 },
      { component: editor, shrink: 0 },
    ]);
    tui.setLayoutRoot(root);
    tui.setFocus(editor);
    const frame = async () => {
      tui.requestRender();
      await new Promise((resolve) => setTimeout(resolve, 35));
      return (await terminal.text()).split("\n");
    };
    const mouse = (button: number, x: number, y: number, release = false) =>
      terminal.input(`\x1b[<${button};${x + 1};${y + 1}${release ? "m" : "M"}`);
    const select = async (x1: number, y1: number, x2: number, y2: number) => {
      mouse(0, x1, y1);
      mouse(32, x2, y2);
      mouse(0, x2, y2, true);
      assert.equal(await tui.copyActiveSelectionToClipboard(), true);
      return copied;
    };
    tui.start();
    try {
      let lines = await frame();
      const user = lines.findIndex((line) => line.includes("Hello 项目"));
      assert.ok(user > 0);
      assert.equal(await select(0, user - 1, 89, user + 1), "Hello 项目");
      assert.equal(await select(89, user + 1, 0, user - 1), "Hello 项目");
      assert.equal(await select(8, user, 11, user), "项目");
      lines = await frame();
      const code = lines.findIndex((line) => line.includes("keep indentation"));
      assert.equal(await select(0, code, 89, code), "  keep indentation");

      editor.setText("hello 项目");
      lines = await frame();
      const input = lines.findIndex((line) => line.includes("hello 项目"));
      mouse(0, 8, input);
      mouse(0, 8, input, true);
      terminal.input("X");
      assert.equal(editor.getText(), "hello X项目");
      await frame();
      assert.equal(await select(0, input, 89, input), "hello X项目");
      // Copying the border alone has no active content.
      mouse(0, 0, input - 1);
      mouse(32, 89, input - 1);
      mouse(0, 89, input - 1, true);
      assert.equal(tui.hasActiveSelection(), false);

      terminal.screen.resize(24, 18);
      terminal.resize();
      lines = await frame();
      assert.ok(
        lines.some((line) => line.startsWith("╭") && line.endsWith("╮")),
      );
      assert.ok(lines.some((line) => line.includes("hello X项目")));
      for (const length of [0, 1, 4, 19, 20, 21]) {
        editor.setText("a".repeat(length));
        await frame();
        let borders = 0;
        for (let row = 0; row < terminal.rows; row++) {
          const cell = terminal.screen.buffer.active.getLine(row)?.getCell(23);
          if (cell?.getChars() === "│") {
            borders++;
            let inverted = 0;
            for (let column = 0; column < 24; column++)
              if (
                terminal.screen.buffer.active
                  .getLine(row)
                  ?.getCell(column)
                  ?.isInverse()
              )
                inverted++;
            assert.ok(
              inverted <= 1,
              "only the cursor cell may be inverted, never the trailing padding",
            );
            assert.equal(
              cell.isInverse(),
              0,
              "cursor must not highlight the right border",
            );
          }
        }
        assert.ok(borders > 0);
      }
      for (const width of [1, 2, 3, 8, 24])
        for (const line of editor.render(width))
          assert.ok(visibleWidth(line) <= width);
    } finally {
      tui.stop();
      terminal.screen.dispose();
    }
  },
);

test(
  "fullscreen terminal handles streaming, expansion, slash commands, pickers, resizing and exit",
  { timeout: 10000 },
  async () => {
    const terminal = new TestTerminal();
    const events: RunEventDto[] = [];
    const requests: Array<{ method: string; args: any[] }> = [];
    const configuration = {
      model: "test/model",
      reasoning: "medium",
      contextWindow: 10000,
      skills: ["control"],
      mcps: [] as string[],
    };
    let running = false;
    const client: HostClient = {
      async call<T>(method: string, args: any[] = []): Promise<T> {
        requests.push({ method, args });
        switch (method) {
          case "conversations.messages":
            return [] as T;
          case "runs.configuration":
            return configuration as T;
          case "runs.active":
            return [] as T;
          case "runs.start":
            running = true;
            return { runId: "run" } as T;
          case "runs.updates":
            return {
              events: events.filter((event) => event.sequence > args[1]),
              draft: running
                ? { turn: 1, text: "Streaming answer", timestamp: Date.now() }
                : null,
            } as T;
          case "runs.cancel":
            running = false;
            events.push({
              runId: "run",
              conversationId: "chat",
              sequence: 3,
              timestamp: Date.now(),
              type: "run.cancelled",
              payload: {},
            });
            return null as T;
          case "models.list":
            return [{ provider: "test", id: "model", name: "Test model" }] as T;
          case "runs.configure":
            Object.assign(configuration, args[1]);
            return configuration as T;
          default:
            throw new Error(`Unexpected method ${method}`);
        }
      },
    };
    const app = runTui(
      client,
      { id: "chat", title: "Terminal test" },
      terminal,
    );
    const until = async (pattern: RegExp) => {
      for (let i = 0; i < 100; i++) {
        const text = await terminal.text();
        if (pattern.test(text)) return text;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail(`Missing ${pattern}\n${await terminal.text()}`);
    };
    const send = (text: string) => {
      terminal.input(text);
      terminal.input("\r");
    };
    try {
      await until(/Terminal test/);
      assert.match(await terminal.text(), /1 skills • 0 mcps/);
      send("Hello");
      await until(/Hello/);
      const promptRow = (await terminal.text())
        .split("\n")
        .findIndex((line) => line.includes("Hello"));
      terminal.input("draft preserved");
      terminal.input(`\x1b[<0;1;${promptRow + 1}M`);
      terminal.input(`\x1b[<32;90;${promptRow + 1}M`);
      terminal.input(`\x1b[<0;90;${promptRow + 1}m`);
      terminal.input("\x03");
      assert.equal(terminal.copied, "Hello");
      terminal.copied = "";
      terminal.input("\x18");
      assert.equal(
        terminal.copied,
        "Hello",
        "Ctrl+X copies the selection before the last response",
      );
      await until(/draft preserved/);
      // Clear the draft through normal editing before exercising slash commands.
      terminal.input("\x15");
      events.push({
        runId: "run",
        conversationId: "chat",
        sequence: 1,
        timestamp: Date.now(),
        type: "message.reasoning.delta",
        payload: { turn: 1, delta: "Reasoning detail" },
      });
      await until(/Streaming answer/);
      terminal.input("\x14");
      await until(/Reasoning detail/);
      send("/queue");
      await until(/No queued follow-ups/);
      assert.equal(
        requests.filter((request) => request.method === "runs.start").length,
        1,
      );
      send("Follow up");
      await until(/1 queued/);
      terminal.input("\x1b");
      for (let i = 0; running && i < 50; i++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(running, false);
      send("/clear-queue");
      await new Promise((resolve) => setTimeout(resolve, 300));
      send("/model");
      await until(/Test model/);
      terminal.input("\r");
      await until(/Ctrl\+T thinking/);
      assert.ok(
        requests.some((request) => request.method === "runs.configure"),
      );
      terminal.screen.resize(38, 18);
      terminal.resize();
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.match(await terminal.text(), /mcps/);
      send("/exit");
      await app;
      await terminal.text();
      assert.equal(terminal.stopped, true);
      assert.equal(terminal.screen.buffer.active.type, "normal");
    } finally {
      terminal.input("\x03");
      await app;
      terminal.screen.dispose();
    }
  },
);

test(
  "pi-style login keeps secrets out of the screen and supports settings, hotkeys and cancellation",
  { timeout: 15000 },
  async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const root = await mkdtemp(path.join(tmpdir(), "polymux-tui-dialog-"));
    const terminal = new TestTerminal();
    const calls: Array<{ method: string; args: any[] }> = [];
    const auth: Array<Record<string, any>> = [];
    const configuration = {
      model: "test/one",
      reasoning: "medium",
      contextWindow: 10000,
      skills: [] as string[],
      mcps: [] as string[],
    };
    let signedIn = false;
    const client: HostClient = {
      async call<T>(method: string, args: any[] = []): Promise<T> {
        calls.push({ method, args });
        if (method === "conversations.messages" || method === "runs.active")
          return [] as T;
        if (method === "runs.configuration") return configuration as T;
        if (method === "runs.configure") {
          Object.assign(configuration, args[1]);
          return configuration as T;
        }
        if (method === "models.list")
          return [
            { provider: "test", id: "one", name: "One" },
            { provider: "test", id: "two", name: "Two" },
          ] as T;
        throw new Error(`Unexpected ${method}`);
      },
    };
    const app = runTui(client, { id: "test", title: "Dialog test" }, terminal, {
      settingsHome: root,
      cwd: root,
      account: async <T>(value: Record<string, any>) => {
        auth.push(value);
        if (value.action === "login") signedIn = true;
        if (value.action === "provider.save") return { ok: true } as T;
        return {
          available: true,
          signedIn,
          profile: signedIn ? { email: "fixture@example.test" } : null,
          device: { registered: true, error: null },
          connectedDevices: [],
        } as T;
      },
    });
    const until = async (pattern: RegExp) => {
      for (let i = 0; i < 100; i++) {
        const text = await terminal.text();
        if (pattern.test(text)) return text;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail(`Missing ${pattern}\n${await terminal.text()}`);
    };
    const send = (text: string) => {
      terminal.input(text);
      terminal.input("\r");
    };
    try {
      await until(/Dialog test/);
      send("/login email");
      await until(/Email/);
      send("fixture@example.test");
      await until(/Password/);
      terminal.input("never-visible-password");
      await until(/•••/);
      assert.doesNotMatch(await terminal.text(), /never-visible-password/);
      terminal.input("\r");
      await until(/Signed in as fixture@example.test/);
      assert.equal(
        auth.find((value) => value.action === "login")?.password,
        "never-visible-password",
      );
      send("/login openrouter");
      await until(/OpenRouter API key/);
      send("API key");
      await until(/Enter.*key/i);
      terminal.input("fixture-provider-secret");
      await until(/•••/);
      assert.doesNotMatch(await terminal.text(), /fixture-provider-secret/);
      terminal.input("\r");
      await until(/Signed in to OpenRouter/i);
      assert.equal(
        auth.find((value) => value.action === "provider.save")?.credential.key,
        "fixture-provider-secret",
      );
      assert.equal(
        calls.filter((call) => call.method === "runs.start").length,
        0,
      );
      terminal.input("draft to clear");
      terminal.input("\x03");
      await until(/Press Ctrl\+C again/);
      assert.equal(terminal.stopped, false);
      assert.doesNotMatch(await terminal.text(), /draft to clear/);
      send("/thinking high");
      await until(/High/);
      terminal.input("\x1b[Z");
      await until(/Xhigh/);
      terminal.input("\x10");
      await until(/Two/);
      send("/settings");
      await until(/Quiet startup/);
      terminal.input("Quiet startup");
      terminal.input("\r");
      await until(/Settings saved/);
      assert.equal(
        JSON.parse(await readFile(path.join(root, "settings.json"), "utf8"))
          .quietStartup,
        true,
      );
      send("/login email"); // Already signed in returns without a password dialog.
      await until(/Signed in as fixture@example.test/);
      send("/login openrouter");
      await until(/OpenRouter API key/);
      send("API key");
      await until(/Enter.*key/i);
      terminal.input("\x1b");
      await until(/cancelled/i);
      send("/exit");
      await app;
      assert.equal(terminal.stopped, true);
    } finally {
      terminal.input("\x1b");
      terminal.input("\x04");
      await app;
      terminal.screen.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "customised terminal walks shell cards, context exclusion, Working, speed and cancellation",
  { timeout: 15000 },
  async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(tmpdir() + "/polymux-tui-walkthrough-");
    const terminal = new TestTerminal();
    const events: RunEventDto[] = [];
    const submitted: string[] = [];
    let draft: { turn: number; text: string; timestamp: number } | null = null;
    const configuration = {
      model: "test/model",
      reasoning: "medium",
      contextWindow: 10000,
      skills: [] as string[],
      mcps: [] as string[],
    };
    const client: HostClient = {
      async call<T>(method: string, args: any[] = []): Promise<T> {
        switch (method) {
          case "conversations.messages":
          case "runs.active":
            return [] as T;
          case "runs.configuration":
            return configuration as T;
          case "runs.start":
            submitted.push(args[0].text);
            return { runId: "run" } as T;
          case "runs.updates":
            return {
              events: events.filter((e) => e.sequence > args[1]),
              draft,
            } as T;
          case "runs.cancel":
            draft = null;
            events.push({
              runId: "run",
              conversationId: "chat",
              sequence: 100,
              timestamp: Date.now(),
              type: "run.cancelled",
              payload: {},
            });
            return null as T;
          default:
            throw new Error(`Unexpected ${method}`);
        }
      },
    };
    const app = runTui(
      client,
      { id: "chat", title: "Customisations walkthrough" },
      terminal,
      { cwd: root, settingsHome: root },
    );
    const send = (text: string) => {
      terminal.input("\x15");
      terminal.input(text);
      terminal.input("\r");
    };
    const until = async (pattern: RegExp) => {
      for (let i = 0; i < 150; i++) {
        const text = await terminal.text();
        if (pattern.test(text)) return text;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail(`Missing ${pattern}\n${await terminal.text()}`);
    };
    const snapshots: Record<string, string> = {};
    try {
      await until(/Customisations walkthrough/);
      send("! printf included-marker");
      await until(/Exit 0/);
      send("!! printf excluded-marker");
      await until(/✓ !! printf excluded-marker/);
      snapshots.shell = await terminal.text();
      send("! cd /");
      await until(/✓ ! cd \//);
      await until(/Shell: \//);
      send("! sleep 30");
      await until(/! sleep 30/);
      terminal.input("\x1b");
      await until(/Exit 130/);
      send("!important");
      await until(/Working/);
      assert.equal(submitted.length, 1);
      assert.match(submitted[0], /included-marker/);
      assert.doesNotMatch(submitted[0], /excluded-marker/);
      assert.match(submitted[0], /!important$/);
      snapshots.working = await terminal.text();
      assert.ok(
        snapshots.working.indexOf("Working") <
          snapshots.working.indexOf("Enter to queue"),
      );
      events.push({
        runId: "run",
        conversationId: "chat",
        sequence: 1,
        timestamp: 10000,
        type: "model.started",
        payload: { turn: 1, model: { provider: "test", id: "model" } },
      });
      for (let i = 0; i < 6; i++) {
        draft = {
          turn: 1,
          text: "Streaming answer " + "x".repeat(i * 38),
          timestamp: 11000 + i * 250,
        };
        await new Promise((resolve) => setTimeout(resolve, 280));
      }
      await until(/\d+ t\/s/);
      snapshots.streaming = await terminal.text();
      assert.doesNotMatch(snapshots.streaming, /Working/);
      send("/stop");
      await until(/Ctrl\+T thinking/);
      snapshots.cancelled = await terminal.text();
      assert.doesNotMatch(snapshots.cancelled, /Working/);
      if (process.env.POLYMUX_TUI_EVIDENCE)
        await writeFile(
          process.env.POLYMUX_TUI_EVIDENCE,
          JSON.stringify(snapshots, null, 2),
        );
      send("/exit");
      await app;
    } finally {
      if (!terminal.stopped) {
        send("/exit");
        await app;
      }
      terminal.screen.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);

for (const failStart of [false, true]) {
  test(
    `manual shell context is reserved during a ${failStart ? "failed" : "successful"} pending send`,
    { timeout: 10000 },
    async () => {
      const { mkdtemp, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const root = await mkdtemp(tmpdir() + "/polymux-tui-context-");
      const terminal = new TestTerminal();
      const submitted: string[] = [];
      let completedRun = "";
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const client: HostClient = {
        async call<T>(method: string, args: any[] = []): Promise<T> {
          if (method === "conversations.messages" || method === "runs.active")
            return [] as T;
          if (method === "runs.configuration")
            return { reasoning: "medium", skills: [], mcps: [] } as T;
          if (method === "runs.start") {
            submitted.push(args[0].text);
            if (submitted.length === 1) {
              await pending;
              if (failStart) throw new Error("Fixture send failed");
            }
            return { runId: `run-${submitted.length}` } as T;
          }
          if (method === "runs.updates")
            return {
              events:
                args[0] === completedRun
                  ? [
                      {
                        runId: completedRun,
                        conversationId: "chat",
                        sequence: 1,
                        timestamp: Date.now(),
                        type: "run.completed",
                        payload: {},
                      },
                    ]
                  : [],
              draft: null,
            } as T;
          throw new Error(`Unexpected ${method}`);
        },
      };
      const app = runTui(
        client,
        { id: "chat", title: "Context race" },
        terminal,
        { cwd: root, settingsHome: root },
      );
      const send = (text: string) => {
        terminal.input("\x15");
        terminal.input(text);
        terminal.input("\r");
      };
      const until = async (predicate: (screen: string) => boolean) => {
        for (let i = 0; i < 150; i++) {
          if (predicate(await terminal.text())) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.fail(`Condition timed out\n${await terminal.text()}`);
      };
      try {
        await until((screen) => screen.includes("Context race"));
        send("! printf earlier-marker");
        await until((screen) => screen.includes("✓ ! printf earlier-marker"));
        send("first prompt");
        await until(() => submitted.length === 1);
        send("queued prompt");
        send("! printf newer-marker");
        await until((screen) => screen.includes("✓ ! printf newer-marker"));
        release();
        if (failStart) {
          await until((screen) => screen.includes("Fixture send failed"));
          send("retry prompt");
          await until(() => submitted.length === 2);
          assert.match(
            submitted[1],
            /earlier-marker[\s\S]*newer-marker[\s\S]*retry prompt$/,
          );
        } else {
          completedRun = "run-1";
          await until(() => submitted.length === 2);
          assert.equal(submitted[1], "queued prompt");
        }
        if (!failStart) send("next prompt");
        completedRun = "run-2";
        await until(() => submitted.length === 3);
        if (failStart) assert.equal(submitted[2], "queued prompt");
        else {
          assert.match(submitted[2], /newer-marker[\s\S]*next prompt$/);
          assert.doesNotMatch(submitted[2], /earlier-marker/);
        }
        assert.match(submitted[0], /earlier-marker/);
        assert.doesNotMatch(submitted[0], /newer-marker/);
      } finally {
        release();
        send("/exit");
        await app;
        terminal.screen.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}

for (const interruption of ["conversation change", "stop", "escape"]) {
  test(
    `manual shell setup aborts on ${interruption}`,
    { timeout: 10000 },
    async (t) => {
      const { ManualShell } = await import("../src/tui/manual-shell.js");
      const { mkdtemp, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const root = await mkdtemp(tmpdir() + "/polymux-tui-shell-switch-");
      const terminal = new TestTerminal();
      let restoring = false;
      let executions = 0;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      t.mock.method(ManualShell.prototype, "restore", async () => {
        restoring = true;
        await pending;
      });
      t.mock.method(ManualShell.prototype, "run", async () => {
        executions++;
        return { exitCode: 0, cancelled: false };
      });
      const client: HostClient = {
        async call<T>(method: string): Promise<T> {
          if (method === "conversations.messages" || method === "runs.active")
            return [] as T;
          if (method === "runs.configuration")
            return { reasoning: "medium", skills: [], mcps: [] } as T;
          if (method === "conversations.create")
            return { id: "other", title: "Other conversation" } as T;
          throw new Error(`Unexpected ${method}`);
        },
      };
      const app = runTui(
        client,
        { id: "chat", title: "Original conversation" },
        terminal,
        { cwd: root, settingsHome: root },
      );
      const send = (text: string) => {
        terminal.input("\x15");
        terminal.input(text);
        terminal.input("\r");
      };
      const until = async (predicate: (screen: string) => boolean) => {
        for (let i = 0; i < 150; i++) {
          if (predicate(await terminal.text())) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.fail(`Condition timed out\n${await terminal.text()}`);
      };
      try {
        await until((screen) => screen.includes("Original conversation"));
        send("! printf original-shell");
        await until(() => restoring);
        if (interruption === "conversation change") {
          send("/new Other conversation");
          await until((screen) => screen.includes("Other conversation"));
        } else if (interruption === "escape") terminal.input("\x1b");
        else send("/stop");
        release();
        await until((screen) =>
          screen.includes(
            interruption !== "conversation change"
              ? "Shell command cancelled"
              : "Conversation changed",
          ),
        );
        assert.equal(executions, 0);
      } finally {
        release();
        send("/exit");
        await app;
        terminal.screen.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}
