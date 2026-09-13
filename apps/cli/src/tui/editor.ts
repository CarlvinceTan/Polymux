import {
  Editor,
  truncateToWidth,
  visibleWidth,
  type EditorOptions,
  type EditorTheme,
  type TUI,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import {
  decoration,
  DECORATION,
  CONTENT_START,
  CONTENT_END,
  markContent,
  rowPadding,
} from "./content.js";

/** Rounded prompt using the same editor, completion and cursor behavior as pi. */
export class PromptEditor extends Editor {
  private requestedPadding: number;
  constructor(
    tui: TUI,
    theme: EditorTheme,
    options: EditorOptions,
    private outputPadding: () => number,
  ) {
    super(tui, theme, options);
    this.requestedPadding = options.paddingX ?? 0;
  }
  override setPaddingX(padding: number): void {
    this.requestedPadding = padding;
    super.setPaddingX(Math.max(padding, this.outputPadding()));
  }
  protected override renderTopBorder(width: number, hidden: number): string {
    return decoration(
      this.borderColor("╭") +
        super.renderTopBorder(width, hidden) +
        this.borderColor("╮"),
    );
  }
  protected override renderBottomBorder(width: number, hidden: number): string {
    return decoration(
      this.borderColor("╰") +
        super.renderBottomBorder(width, hidden) +
        this.borderColor("╯"),
    );
  }
  override render(width: number): string[] {
    // pi's word wrapper needs room for a two-cell grapheme plus its cursor.
    // Lay out safely and clip when the terminal is too narrow for the box.
    const inner = Math.max(3, width - 2);
    const padding = rowPadding(
      Math.max(this.requestedPadding, this.outputPadding()),
      inner - 1,
    );
    super.setPaddingX(padding);
    const lines = super.render(inner);
    const bottom = lines.findIndex(
      (line, i) => i > 0 && line.startsWith(DECORATION),
    );
    return lines.map((line, i) =>
      truncateToWidth(
        line.startsWith(DECORATION)
          ? line
          : i > bottom
            ? " " + markContent(line) + " "
            : this.borderColor("│") +
              " ".repeat(padding) +
              CONTENT_START +
              line.slice(padding).trimEnd() +
              CONTENT_END +
              " ".repeat(
                Math.max(
                  0,
                  inner - padding - visibleWidth(line.slice(padding).trimEnd()),
                ),
              ) +
              // Column slicing can omit the cursor's trailing inverse reset.
              "\x1b[0m" +
              this.borderColor("│"),
        width,
        "",
      ),
    );
  }
  override handleMouse(event: TuiMouseEvent) {
    if (event.width < 5) return undefined;
    if (event.x < 1 || event.x >= event.width - 1) return undefined;
    return super.handleMouse({
      ...event,
      x: event.x - 1,
      width: Math.max(1, event.width - 2),
    });
  }
}
