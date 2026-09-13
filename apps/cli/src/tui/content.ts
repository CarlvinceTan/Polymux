import {
  sliceByColumn,
  stripTerminalSequences,
  visibleWidth,
  type ScrollView,
  type TuiAltScreen,
} from "@earendil-works/pi-tui";

// Zero-width renderer metadata, never accepted from conversation content.
export const CONTENT_START = "\x1b]777;polymux-content-start\x07";
export const CONTENT_END = "\x1b]777;polymux-content-end\x07";
export const DECORATION = "\x1b]777;polymux-decoration\x07";
export const decoration = (line: string) =>
  DECORATION + CONTENT_START + CONTENT_END + line;
export const rowPadding = (padding: number, width: number) =>
  Math.min(padding, Math.max(0, Math.floor((width - 1) / 2)));

/** Exclude layout padding from selection without stripping code indentation. */
export function markContent(line: string, padding = 0): string {
  const width = visibleWidth(line);
  const start = Math.min(padding, width);
  const end = Math.max(
    start,
    visibleWidth(stripTerminalSequences(line).trimEnd()),
  );
  return (
    sliceByColumn(line, 0, start, true) +
    CONTENT_START +
    sliceByColumn(line, start, end - start, true) +
    CONTENT_END +
    sliceByColumn(line, end, Math.max(0, width - end), true)
  );
}

interface Point {
  row: number;
  col: number;
  boundary?: boolean;
  scrollView?: ScrollView;
}
interface Selection {
  start: Point;
  end: Point;
}
interface Columns {
  start: number;
  end: number;
}
interface SelectionRenderer {
  getSelectionBounds(): Selection | undefined;
  getSelectionSourceLine(point: Point): string;
  getSelectionColumns(
    line: string,
    row: number,
    selection: Selection,
    min?: number,
    max?: number,
  ): Columns;
  getActiveSelectionText(): string | undefined;
}

/**
 * pi-tui 0.85.1 has no content-boundary selection hook. Keep this narrow
 * instance adapter here, covered by real mouse-selection tests. It changes
 * neither the installed library nor other TUI instances. Recheck on upgrades.
 */
export function installContentSelection(tui: TuiAltScreen): void {
  const renderer = tui as unknown as SelectionRenderer;
  for (const name of [
    "getSelectionBounds",
    "getSelectionSourceLine",
    "getSelectionColumns",
    "getActiveSelectionText",
  ] as const)
    if (typeof renderer[name] !== "function")
      throw new Error(`Unsupported terminal renderer: missing ${name}`);
  const originalColumns = renderer.getSelectionColumns.bind(renderer);
  renderer.getSelectionColumns = (line, row, selection, min, max) => {
    const columns = originalColumns(line, row, selection, min, max);
    if (line.includes(DECORATION)) return { start: 0, end: 0 };
    columns.end = Math.min(
      columns.end,
      visibleWidth(stripTerminalSequences(line).trimEnd()),
    );
    for (const match of line.matchAll(
      /\x1b\]777;polymux-content-(start|end)\x07/g,
    )) {
      const column = visibleWidth(line.slice(0, match.index));
      if (match[1] === "start") columns.start = Math.max(columns.start, column);
      else columns.end = Math.min(columns.end, column);
    }
    return columns;
  };
  renderer.getActiveSelectionText = () => {
    const selection = renderer.getSelectionBounds();
    if (!selection) return undefined;
    const lines: string[] = [];
    for (let row = selection.start.row; row <= selection.end.row; row++) {
      const line = renderer.getSelectionSourceLine({ ...selection.start, row });
      if (line.includes(DECORATION)) continue;
      const columns = renderer.getSelectionColumns(line, row, selection);
      lines.push(
        stripTerminalSequences(
          sliceByColumn(
            line,
            columns.start,
            Math.max(0, columns.end - columns.start),
            true,
          ),
        ).trimEnd(),
      );
    }
    return lines.join("\n") || undefined;
  };
}
