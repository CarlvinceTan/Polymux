import {truncateToWidth, visibleWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult} from '@earendil-works/pi-tui';
import {decoration, markContent} from './content.js';
import {clean, theme} from './view.js';

/** Same rounded, titled panel treatment as Midas's PanelOverlay. */
export class WorkspaceFrame implements Component {
  constructor(private title: string, private child: Component) {}
  invalidate() {this.child.invalidate?.();}
  handleInput(data: string) {this.child.handleInput?.(data);}
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return event.x >= 2 && event.y >= 1 ? this.child.handleMouse?.({...event, x: event.x - 2, y: event.y - 1}) : undefined;
  }
  render(width: number): string[] {
    if (width < 5) return this.child.render(width).map(line => truncateToWidth(line, width, ''));
    const inner = width - 4;
    const label = truncateToWidth(` ${clean(this.title).replace(/\s+/g, ' ')} `, width - 4, '…');
    const top = decoration(theme.purple('╭─' + label + '─'.repeat(Math.max(0, width - visibleWidth(label) - 3)) + '╮'));
    const rows = this.child.render(inner).map(line => {
      const fitted = truncateToWidth(line, inner, '…');
      return theme.purple('│') + ' ' + markContent(fitted) + ' '.repeat(Math.max(0, inner - visibleWidth(fitted))) + ' ' + theme.purple('│');
    });
    return [top, ...rows, decoration(theme.purple('╰' + '─'.repeat(width - 2) + '╯'))];
  }
}
