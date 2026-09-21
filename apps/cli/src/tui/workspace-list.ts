import {SelectList, truncateToWidth, visibleWidth} from '@earendil-works/pi-tui';
import {clean, selectTheme, theme} from './view.js';
import type {Choice} from './workspace-ui.js';

const inline = (text: string) => clean(text).replace(/\s+/g, ' ').trim();

/** Midas's compact, bounded rows with a stable right-aligned status column. */
export class WorkspaceList extends SelectList {
  constructor(private readonly choices: Choice[], private readonly rows = 8) {
    super(choices, rows, selectTheme);
  }
  override render(width: number): string[] {
    if (width <= 0) return [];
    const selected = Math.max(0, this.choices.findIndex(c => c.value === this.getSelectedItem()?.value));
    const start = Math.max(0, Math.min(selected - Math.floor(this.rows / 2), this.choices.length - this.rows));
    if (!this.choices.length) return [theme.muted(truncateToWidth('No matches', width, '…'))];
    const statusWidth = Math.min(Math.floor(width / 3), Math.max(0, ...this.choices.map(c => visibleWidth(inline(c.status ?? '')))));
    const lines = this.choices.slice(start, start + this.rows).map((choice, i) => {
      const active = start + i === selected;
      const prefix = active ? '→ ' : '  ';
      const status = truncateToWidth(inline(choice.status ?? ''), statusWidth, '…');
      const available = Math.max(0, width - 2 - (statusWidth ? statusWidth + 2 : 0));
      const label = truncateToWidth(inline(choice.label), available, '…');
      const spare = available - visibleWidth(label) - 2;
      const description = spare > 3 && choice.description ? '  ' + truncateToWidth(inline(choice.description), spare, '…') : '';
      const text = label + description;
      const filler = ' '.repeat(Math.max(0, width - 2 - visibleWidth(text) - visibleWidth(status)));
      return truncateToWidth((active ? theme.accent(prefix + label) : theme.text(prefix + label))
        + theme.muted(description + filler + status), width, '');
    });
    if (this.choices.length > this.rows) lines.push(theme.dim(truncateToWidth(`${selected + 1}/${this.choices.length}`, width, '')));
    return lines;
  }
}
