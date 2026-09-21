import {
  truncateToWidth,
  type Component,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { RowView, clean, duration, theme } from "./view.js";
import { markContent, rowPadding } from "./content.js";
import type { TranscriptRow } from "./transcript.js";

export function groupTranscript(rows: TranscriptRow[]): TranscriptRow[][] {
  const runs: TranscriptRow[][] = [];
  for (const row of rows) {
    if (!runs.length || (row.kind === "user" && !row.id.startsWith("steer:")))
      runs.push([]);
    runs.at(-1)!.push(row);
  }
  return runs;
}

export function activitySummary(rows: TranscriptRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== "tool") continue;
    const name = row.toolName ?? "";
    const category = /^(read|read_file)$/.test(name)
      ? "Read file"
      : /^(bash|shell|exec_command)$/.test(name)
        ? "Ran command"
        : /^(edit|write|write_file|apply_patch)$/.test(name)
          ? "Edited file"
          : /search|grep|glob/.test(name)
            ? "Searched path"
            : name === "subagent"
              ? "Ran task"
              : "Used tool";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return (
    [...counts]
      .map(
        ([label, count]) =>
          label.replace(" ", ` ${count} `) + (count === 1 ? "" : "s"),
      )
      .join(", ") || "Thought through the task"
  );
}

/** Stable disclosures over the existing Host reducer, never a second event store. */
export class TranscriptRunView implements Component {
  rows: TranscriptRow[] = [];
  active = false;
  expanded = false;
  private chains = new Set<string>();
  private views = new Map<string, RowView>();
  private indents = new Map<string, number>();
  private ranges: Array<{
    start: number;
    end: number;
    view?: RowView;
    toggle?: () => void;
  }> = [];
  constructor(
    private refresh: () => void,
    private padding: () => number,
    private expandAll: () => boolean,
    private thoughts: () => boolean,
  ) {}
  invalidate(): void {
    for (const view of this.views.values()) view.invalidate();
  }
  render(width: number): string[] {
    const lines: string[] = [];
    this.ranges = [];
    const header = (label: string, open: boolean, toggle: () => void) => {
      const pad = rowPadding(this.padding(), width);
      this.ranges.push({ start: lines.length, end: lines.length + 1, toggle });
      lines.push(
        markContent(
          " ".repeat(pad) +
            truncateToWidth(
              theme.accent(open ? "− " : "+ ") + theme.muted(clean(label)),
              Math.max(1, width - 2 * pad),
              "…",
            ),
          pad,
        ),
      );
    };
    const rowView = (row: TranscriptRow, indent = 0) => {
      this.indents.set(row.id, indent);
      let view = this.views.get(row.id);
      if (!view || view.row !== row) {
        row.expanded ??=
          row.kind === "thought" ? this.thoughts() : this.expandAll();
        view = new RowView(
          row,
          this.refresh,
          Date.now,
          () => this.padding() + (this.indents.get(row.id) ?? 0),
        );
        this.views.set(row.id, view);
      }
      const start = lines.length;
      lines.push(...view.render(width));
      this.ranges.push({ start, end: lines.length, view });
    };
    const prompt = this.rows[0]?.kind === "user" ? this.rows[0] : undefined;
    if (prompt) rowView(prompt);
    const output = this.rows.filter((row) => row !== prompt);
    const hasActivity = output.some(
      (row) =>
        row.kind === "thought" || (row.kind === "tool" && !row.manualShell),
    );
    const final = [...output]
      .reverse()
      .find((row) => row.kind === "assistant" && row.text.trim());
    const open = this.expanded || this.expandAll();
    if (!this.active && hasActivity) {
      const starts = this.rows.flatMap((row) =>
        row.startedAt === undefined ? [] : [row.startedAt],
      );
      const ends = this.rows.flatMap((row) =>
        row.endedAt === undefined ? [] : [row.endedAt],
      );
      const elapsed =
        starts.length && ends.length
          ? Math.max(...ends) - Math.min(...starts)
          : 0;
      const failed = output.filter(
        (row) => row.status === "failed" || row.status === "cancelled",
      ).length;
      header(
        `Worked${elapsed > 0 ? ` for ${duration(elapsed)}` : ""}${failed ? ` · ${failed} failed or stopped` : ""}`,
        open,
        () => {
          this.expanded = !this.expanded;
        },
      );
    }
    const visible =
      !this.active && hasActivity && !open
        ? output.filter(
            (row) =>
              row === final ||
              row.manualShell ||
              row.kind === "notice" ||
              row.kind === "user",
          )
        : output;
    for (let i = 0; i < visible.length;) {
      const row = visible[i]!;
      if (row.kind !== "thought" && (row.kind !== "tool" || row.manualShell)) {
        rowView(row);
        i++;
        continue;
      }
      const chain: TranscriptRow[] = [];
      while (
        i < visible.length &&
        (visible[i]!.kind === "thought" ||
          (visible[i]!.kind === "tool" && !visible[i]!.manualShell))
      )
        chain.push(visible[i++]!);
      const live = this.active && i === visible.length;
      if (live) {
        for (const item of chain.filter((item) => item.status === "running")
          .length
          ? chain.filter((item) => item.status === "running")
          : chain.slice(-1))
          rowView(item);
        continue;
      }
      if (chain.length === 1) {
        rowView(chain[0]!);
        continue;
      }
      const id = chain[0]!.id;
      const chainOpen = this.chains.has(id) || this.expandAll();
      const failures = chain.filter((item) => item.status === "failed").length;
      header(
        activitySummary(chain) + (failures ? ` · ${failures} failed` : ""),
        chainOpen,
        () => {
          if (this.chains.has(id)) this.chains.delete(id);
          else this.chains.add(id);
        },
      );
      if (chainOpen) for (const item of chain) rowView(item, 2);
    }
    return lines;
  }
  handleMouse(event: TuiMouseEvent) {
    if (event.type !== "click" || event.button !== "left") return;
    const range = this.ranges.find(
      (range) => event.y >= range.start && event.y < range.end,
    );
    if (!range) return;
    if (range.toggle) {
      range.toggle();
      this.refresh();
      return { handled: true };
    }
    return range.view?.handleMouse({
      ...event,
      y: event.y - range.start,
      height: range.end - range.start,
    });
  }
}
