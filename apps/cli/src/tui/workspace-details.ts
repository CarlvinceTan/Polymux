import {Text, matchesKey, truncateToWidth, type Component} from '@earendil-works/pi-tui';
import {clean, theme} from './view.js';

/** Explicitly bounded, as overlays do not allocate a growing layout viewport. */
export class WorkspaceDetails implements Component {
  private offset = 0;
  private pageSize = 1;
  constructor(private text: string, private rows: () => number) {}
  invalidate() {}
  handleInput(data: string): void {
    if (matchesKey(data, 'up')) this.offset = Math.max(0, this.offset - 1);
    if (matchesKey(data, 'down')) this.offset++;
    if (matchesKey(data, 'pageUp')) this.offset = Math.max(0, this.offset - this.pageSize);
    if (matchesKey(data, 'pageDown')) this.offset += this.pageSize;
  }
  render(width: number): string[] {
    this.pageSize = Math.max(1, this.rows() - 5);
    const lines = new Text(clean(this.text), 1, 0).render(width);
    this.offset = Math.min(this.offset, Math.max(0, lines.length - this.pageSize));
    return [...lines.slice(this.offset, this.offset + this.pageSize), '',
      theme.dim(truncateToWidth(` ↑↓ Scroll · Esc Back${lines.length > this.pageSize ? ` · ${this.offset + 1}/${lines.length}` : ''}`, width, '…'))];
  }
}
