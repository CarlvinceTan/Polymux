import { terminalMermaid } from "./mermaid.js";
import { decoration, markContent, rowPadding } from "./content.js";
import {
  Markdown,
  Container,
  Text,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import path from "node:path";
import type { TranscriptRow } from "./transcript.js";

const color = (rgb: string) => (text: string) =>
  `\x1b[38;2;${rgb}m${text}\x1b[39m`;
export const theme = {
  text: color("171;178;191"),
  dim: color("92;99;112"),
  muted: color("127;132;142"),
  yellow: color("229;192;123"),
  accent: color("97;175;239"),
  purple: color("198;120;221"),
  success: color("152;195;121"),
  error: color("224;108;117"),
  warning: color("209;154;102"),
};
export const selectTheme = {
  selectedPrefix: theme.accent,
  selectedText: theme.accent,
  description: theme.dim,
  scrollInfo: theme.dim,
  noMatch: theme.dim,
};
export const markdownTheme = {
  heading: theme.error,
  link: theme.accent,
  linkUrl: theme.dim,
  code: theme.success,
  codeBlock: theme.text,
  codeBlockBorder: theme.dim,
  quote: theme.dim,
  quoteBorder: theme.dim,
  hr: theme.dim,
  listBullet: theme.yellow,
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  italic: (s: string) => `\x1b[3m${s}\x1b[23m`,
  strikethrough: (s: string) => `\x1b[9m${s}\x1b[29m`,
  underline: (s: string) => `\x1b[4m${s}\x1b[24m`,
};
export const clean = (s: string) =>
  stripTerminalSequences(s).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
const frames = ["⠋", "⠙", "⠚", "⠴", "⠦", "⠇"];
export const spinner = (now: number, interval = 80) =>
  frames[Math.floor(Math.max(0, now) / interval) % frames.length];
export function modelLabel(name: string): string {
  return name
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}
export const thinkingLabel = (level: string) =>
  level ? level[0].toUpperCase() + level.slice(1) : "Off";
export function duration(ms: number, streaming = false): string {
  if (!streaming && ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = Math.max(
    0,
    streaming ? Math.floor(ms / 1000) : Math.round(ms / 1000),
  );
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export function middle(text: string, width: number): string {
  text = clean(text);
  if (visibleWidth(text) <= width) return text;
  if (width < 3) return truncateToWidth(text, width, "");
  const left = Math.ceil((width - 1) / 2);
  let suffix = "";
  for (const char of Array.from(text).reverse()) {
    if (visibleWidth(char + suffix) > width - left - 1) break;
    suffix = char + suffix;
  }
  return truncateToWidth(text, left, "") + "…" + suffix;
}
export function align(left: string, right: string, width: number): string {
  right = truncateToWidth(clean(right), width, "");
  const space = width - visibleWidth(right);
  if (space < 2) return right;
  left = middle(left, space - 1);
  return (
    left + " ".repeat(width - visibleWidth(left) - visibleWidth(right)) + right
  );
}
export function location(cwd: string, home = homedir()): string {
  const relative = path.relative(home, cwd);
  return !relative
    ? path.resolve(home).endsWith(path.sep)
      ? path.resolve(home)
      : path.resolve(home) + path.sep
    : relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      ? `~${path.sep}${relative}`
      : cwd;
}
export function tokens(n: number): string {
  return n < 1000
    ? String(n)
    : n < 1000000
      ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`
      : `${(n / 1000000).toFixed(1)}M`;
}

export class RowView implements Component {
  private markdown?: Markdown;
  private markdownText?: string;
  private markdownPadding = -1;
  private markdownStatus?: TranscriptRow["status"];
  constructor(
    readonly row: TranscriptRow,
    private refresh: () => void,
    private now = Date.now,
    private padding = () => 1,
  ) {}
  invalidate(): void {}
  render(width: number): string[] {
    const row = this.row;
    if (row.kind === "assistant") {
      const padding = rowPadding(this.padding(), width);
      if (!this.markdown || this.markdownPadding !== padding) {
        this.markdown = new Markdown(
          "",
          padding,
          0,
          markdownTheme,
          {
            color: theme.text,
          },
          {
            transform: (text, available) =>
              terminalMermaid(text, available, row.status === "running"),
          },
        );
        this.markdownPadding = padding;
        this.markdownText = undefined;
      }
      if (this.markdownStatus !== row.status) {
        this.markdown.invalidate();
        this.markdownStatus = row.status;
      }
      if (this.markdownText !== row.text) {
        this.markdown.setText(clean(row.text));
        this.markdownText = row.text;
      }
      return this.markdown
        .render(width)
        .concat("")
        .map((line) => markContent(truncateToWidth(line, width, ""), padding));
    }
    if (row.kind === "user") {
      const inner = Math.max(1, width - 2);
      const padding = rowPadding(this.padding(), inner);
      const lines = new Markdown(clean(row.text), padding, 0, markdownTheme, {
        color: theme.text,
      }).render(inner);
      const rendered = [
        decoration(
          theme.purple("╭" + "─".repeat(Math.max(0, width - 2)) + "╮"),
        ),
        ...lines.map(
          (line) =>
            theme.purple("│") +
            markContent(
              line + " ".repeat(Math.max(0, inner - visibleWidth(line))),
              padding,
            ) +
            theme.purple("│"),
        ),
        decoration(
          theme.purple("╰" + "─".repeat(Math.max(0, width - 2)) + "╯"),
        ),
      ].map((line) => truncateToWidth(line, width, ""));
      rendered[0] = "\x1b]133;A\x07" + rendered[0];
      rendered[rendered.length - 1] += "\x1b]133;B\x07\x1b]133;C\x07";
      return [...rendered, ""];
    }

    if (row.manualShell) {
      const inner = Math.max(1, width - 2);
      const padding = rowPadding(this.padding(), inner);
      const icon =
        row.status === "running"
          ? spinner(this.now(), 120)
          : row.status === "completed"
            ? "✓"
            : "✗";
      const body = new Text(
        theme.text(
          `${icon} ${clean(row.text)}\n${clean(row.detail ?? "")}`.trimEnd(),
        ),
        padding,
        0,
      ).render(inner);
      const shown =
        row.expanded || body.length <= 20
          ? body
          : [body[0], ...body.slice(-19)];
      return [
        decoration(
          theme.accent("╭" + "─".repeat(Math.max(0, width - 2)) + "╮"),
        ),
        ...shown.map(
          (line) =>
            theme.accent("│") +
            markContent(
              line + " ".repeat(Math.max(0, inner - visibleWidth(line))),
              padding,
            ) +
            theme.accent("│"),
        ),
        decoration(
          theme.accent("╰" + "─".repeat(Math.max(0, width - 2)) + "╯"),
        ),
        "",
      ].map((line) => truncateToWidth(line, width, ""));
    }

    if (row.kind === "notice")
      return new Text(
        theme.warning(clean(row.text)),
        rowPadding(this.padding(), width),
        0,
      )
        .render(width)
        .map((line) =>
          markContent(
            truncateToWidth(line, width, ""),
            rowPadding(this.padding(), width),
          ),
        );
    const active = row.status === "running";
    const padding = rowPadding(this.padding(), width);
    const contentWidth = Math.max(1, width - padding * 2);
    const marker = active
      ? theme.accent(
          spinner(
            this.now() - (row.startedAt ?? 0),
            row.kind === "thought" ? 120 : 80,
          ),
        )
      : row.kind === "thought"
        ? theme.warning(row.expanded ? "-" : "+")
        : row.status === "completed"
          ? theme.success("✓")
          : theme.error(row.status === "cancelled" ? "−" : "✗");
    const label =
      row.kind === "thought"
        ? theme.warning(
            `${active ? "Thinking" : "Thought"} for ${duration((row.endedAt ?? this.now()) - (row.startedAt ?? this.now()), active)}`,
          )
        : theme.text(
            middle(
              toolStateLabel(row.text, row.status),
              Math.max(0, width - 4),
            ),
          );
    let status = `${marker} ${label}`;
    if (row.toolName === "subagent") {
      const name = modelLabel((row.agentName ?? "Subagent").replace(/_/g, " "));
      const prefix = `${marker} ${theme.accent(name + ":")} `;
      status =
        prefix +
        theme.dim(
          truncateToWidth(
            clean(row.text).replace(/\s+/g, " "),
            Math.max(0, contentWidth - visibleWidth(prefix)),
            "…",
          ),
        );
    }

    let statusLines = [truncateToWidth(status, contentWidth, "…")];
    if (row.toolPath) {
      const prefix = `${marker} ${theme.text(toolStateLabel(row.text.slice(0, -row.toolPath.length).trimEnd(), row.status))}`;
      const available = contentWidth - visibleWidth(prefix) - 1;
      statusLines =
        available < Math.min(20, visibleWidth(clean(row.toolPath)))
          ? [
              truncateToWidth(prefix, contentWidth, "…"),
              "  " +
                theme.text(middle(row.toolPath, Math.max(0, contentWidth - 2))),
            ]
          : [prefix + " " + theme.text(middle(row.toolPath, available))];
    }
    const isMcp = row.toolName?.includes("__");
    if (isMcp && !active && !row.expanded && row.detail) {
      const title = `${marker} ${theme.text(middle(row.text, Math.max(1, Math.floor(contentWidth * 0.55) - 2)))}`;
      const preview =
        clean(row.detail)
          .split("\n")
          .find((line) => line.trim()) ?? "";
      statusLines = [
        truncateToWidth(
          `${title} → ${theme.muted(preview)}`,
          contentWidth,
          "…",
        ),
      ];
    }
    const lines = statusLines.map((line) =>
      markContent(" ".repeat(padding) + line, padding),
    );
    const detail = row.kind === "thought" ? row.text : row.detail;
    if (detail && (row.expanded || (row.status === "failed" && !isMcp))) {
      const body = clean(detail).trimEnd().split("\n");
      const limit = body.length;
      const preview = row.expanded ? body.slice(0, limit) : body.slice(0, 1);
      const detailPadding = rowPadding(this.padding() + 2, width);
      lines.push(
        ...new Text(theme.muted(preview.join("\n")), detailPadding, 0)
          .render(width)
          .map((line) => markContent(line, detailPadding)),
      );
      if (row.expanded && body.length > limit)
        lines.push(markContent(" ".repeat(padding) + theme.dim("…"), padding));
    }
    return lines.map((line) => truncateToWidth(line, width, ""));
  }
  handleMouse(event: TuiMouseEvent) {
    if (
      event.type !== "click" ||
      event.button !== "left" ||
      !["thought", "tool"].includes(this.row.kind)
    )
      return;
    if (!(this.row.kind === "thought" ? this.row.text.trim() : this.row.detail))
      return;
    this.row.expanded = !this.row.expanded;
    this.refresh();
    return { handled: true };
  }
}

/** Consecutive Host dispatches share a compact header; each worker keeps its own status. */
export class SubagentGroup extends Container {
  constructor(
    readonly tasks: RowView[],
    padding: () => number,
  ) {
    super();
    this.addChild({
      invalidate() {},
      render(width) {
        const active = tasks.some((task) => task.row.status === "running");
        const failed = tasks.some(
          (task) =>
            task.row.status === "failed" || task.row.status === "cancelled",
        );
        const icon = active
          ? theme.accent(spinner(Date.now(), 120))
          : failed
            ? theme.error("✗")
            : theme.success("✓");
        const pad = rowPadding(padding(), width);
        return [
          markContent(
            " ".repeat(pad) +
              truncateToWidth(
                `${icon} ${theme.text(`${active ? "Running Subagents" : "Subagents"} (${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}):`)}`,
                Math.max(1, width - pad * 2),
                "…",
              ),
            pad,
          ),
        ];
      },
    });
  }
  addTask(view: RowView) {
    this.tasks.push(view);
    this.addChild(view);
  }
}

function toolStateLabel(text: string, status: TranscriptRow["status"]): string {
  const verbs: Record<string, [string, string]> = {
    Run: ["Running", "Ran"],
    Read: ["Reading", "Read"],
    Write: ["Writing", "Wrote"],
    Edit: ["Editing", "Edited"],
    Search: ["Searching", "Searched"],
  };
  return text.replace(
    /^\w+/,
    (word) => verbs[word]?.[status === "running" ? 0 : 1] ?? word,
  );
}
