<script lang="ts">
  import {Terminal, type ITheme} from '@xterm/xterm';
  import {FitAddon} from '@xterm/addon-fit';
  import {WebglAddon} from '@xterm/addon-webgl';
  import '@xterm/xterm/css/xterm.css';
  import type {TerminalEventDto} from '@polymux/protocol';
  import {polymuxApi} from '../../api/polymux';
  import {onThemeChange} from '../../shared/theme';
  import {readableError} from '../../shared/errors';

  let {sessionId}: {sessionId: string} = $props();

  const api = polymuxApi();
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let error = $state('');

  function attachTerminal(node: HTMLDivElement): () => void {
    const id = sessionId;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(node);
    const webgl = enableWebgl(term);

    let seq = 0;
    let ready = false;
    let disposed = false;
    const pending: TerminalEventDto[] = [];

    const applyEvent = (event: TerminalEventDto) => {
      if (disposed || event.id !== id) return;
      if (!ready) {
        pending.push(event);
        return;
      }
      if (event.seq <= seq) return;
      seq = event.seq;
      if (event.type === 'data') term.write(decodeBase64(event.data));
    };

    const stopTheme = onThemeChange(() => {
      term.options.theme = terminalTheme();
    });
    const unsubscribe = api.terminal.subscribe(applyEvent);
    const resize = () => {
      if (disposed) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      void api.terminal.resize(id, term.cols, term.rows).catch(() => {});
    };
    const observer = new ResizeObserver(() => resize());
    observer.observe(node);
    const dataDisposable = term.onData((data) => {
      if (typeof data !== 'string' || data.length === 0) return;
      void api.terminal.write(id, data).catch(() => {});
    });
    resize();
    void api.terminal.attach(id, term.cols, term.rows).then((attached) => {
      if (disposed) return;
      seq = attached.seq;
      const finish = () => {
        if (disposed) return;
        ready = true;
        for (const event of pending.splice(0)) applyEvent(event);
        status = 'ready';
        requestAnimationFrame(() => {
          if (disposed) return;
          resize();
          term.focus();
        });
      };
      if (attached.replay) term.write(decodeBase64(attached.replay), finish);
      else finish();
    }).catch((reason) => {
      if (disposed) return;
      error = readableError(reason);
      status = 'error';
    });
    node.addEventListener('mousedown', () => term.focus());
    return () => {
      disposed = true;
      observer.disconnect();
      unsubscribe();
      stopTheme();
      dataDisposable.dispose();
      webgl?.dispose();
      term.dispose();
    };
  }

  function enableWebgl(term: Terminal): {dispose: () => void} | undefined {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
      return webgl;
    } catch {
      return undefined;
    }
  }

  function terminalTheme(): ITheme {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    return {
      background: read('--main-panel-background', '#f7f7f7'),
      foreground: read('--neutral-950', '#0a0a0a'),
      cursor: read('--neutral-400', '#bfbfbf'),
      cursorAccent: read('--main-panel-background', '#f7f7f7'),
      selectionBackground: read('--neutral-200', '#e5e5e5'),
    };
  }

  function decodeBase64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
</script>

<div class="terminal-view">
  {#if status !== 'ready'}
    <div class={['terminal-status', status === 'error' && 'error']} role="status">
      {status === 'error' ? error || 'Terminal failed to start' : 'Starting…'}
    </div>
  {/if}
  <div class="terminal-host" {@attach attachTerminal}></div>
</div>

<style>
  .terminal-view {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 8px 12px;
    background: var(--main-panel-background);
    color: var(--neutral-950);
  }
  .terminal-status {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    color: var(--neutral-400);
    font-size: 12px;
    pointer-events: none;
  }
  .terminal-status.error { color: var(--status-error-text); }
  .terminal-host {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .terminal-host :global(.xterm),
  .terminal-host :global(.xterm-viewport),
  .terminal-host :global(.xterm-screen) {
    background: transparent !important;
  }
  .terminal-host :global(.xterm) { height: 100%; }
  .terminal-host :global(.xterm-viewport) {
    overflow-y: auto;
    scrollbar-width: none;
  }
  .terminal-host :global(.xterm-viewport::-webkit-scrollbar),
  .terminal-host :global(.xterm-helpers textarea::-webkit-scrollbar),
  .terminal-host :global(.xterm-scrollable-element > .scrollbar) { display: none; }
  .terminal-host :global(.xterm-helpers textarea) { scrollbar-width: none; }
</style>
