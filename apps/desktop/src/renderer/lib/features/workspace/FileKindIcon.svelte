<script lang="ts">
  import type {IdeEntryDto} from '@polymux/protocol';
  import {FILE_KIND_GLYPH_SIZE, FILE_KIND_GLYPH_STROKE_WIDTH} from '../../shared/layout/iconSizing';
  import {catppuccinIconId} from './fileKind';
  import {catppuccinMark} from './catppuccinSvgs';

  /** Official Catppuccin vscode-icons (MIT). Drawn smaller than the 16px slot so
   * edge-to-edge 16-viewBox art matches Lucide's inset 24-viewBox folder/file. */

  let {
    name,
    kind,
    open = false,
  }: {
    name: string;
    kind: IdeEntryDto['kind'];
    open?: boolean;
  } = $props();

  const id = $derived(catppuccinIconId(name, kind, open));
  const mark = $derived(catppuccinMark(id));
</script>

<svg
  class="file-kind"
  width={FILE_KIND_GLYPH_SIZE}
  height={FILE_KIND_GLYPH_SIZE}
  viewBox={mark.viewBox}
  fill="none"
  stroke-width={FILE_KIND_GLYPH_STROKE_WIDTH}
  overflow="visible"
  shape-rendering="geometricPrecision"
  aria-hidden="true"
  data-icon={id}
>{@html mark.inner}</svg>

<style>
  .file-kind {
    display: block;
    box-sizing: content-box;
    flex: none;
    flex-shrink: 0;
    overflow: visible;
    --vscode-ctp-rosewater: #dc8a78;
    --vscode-ctp-flamingo: #dd7878;
    --vscode-ctp-pink: #ea76cb;
    --vscode-ctp-mauve: #8839ef;
    --vscode-ctp-red: #d20f39;
    --vscode-ctp-maroon: #e64553;
    --vscode-ctp-peach: #fe640b;
    --vscode-ctp-yellow: #df8e1d;
    --vscode-ctp-green: #40a02b;
    --vscode-ctp-teal: #179299;
    --vscode-ctp-sky: #04a5e5;
    --vscode-ctp-sapphire: #209fb5;
    --vscode-ctp-blue: #1e66f5;
    --vscode-ctp-lavender: #7287fd;
    --vscode-ctp-text: #4c4f69;
    --vscode-ctp-overlay1: #8c8fa1;
  }

  :global(:root[data-theme='dark']) .file-kind {
    --vscode-ctp-rosewater: #f5e0dc;
    --vscode-ctp-flamingo: #f2cdcd;
    --vscode-ctp-pink: #f5c2e7;
    --vscode-ctp-mauve: #cba6f7;
    --vscode-ctp-red: #f38ba8;
    --vscode-ctp-maroon: #eba0ac;
    --vscode-ctp-peach: #fab387;
    --vscode-ctp-yellow: #f9e2af;
    --vscode-ctp-green: #a6e3a1;
    --vscode-ctp-teal: #94e2d5;
    --vscode-ctp-sky: #89dceb;
    --vscode-ctp-sapphire: #74c7ec;
    --vscode-ctp-blue: #89b4fa;
    --vscode-ctp-lavender: #b4befe;
    --vscode-ctp-text: #cdd6f4;
    --vscode-ctp-overlay1: #7f849c;
  }
</style>
