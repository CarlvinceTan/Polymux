<script module lang="ts">
  export type SpeechOrbState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error' | 'ended';
  export type SpeechOrbSize = {width: number; height: number};
</script>

<script lang="ts">
  export let state: SpeechOrbState = 'connecting';
  export let minimised = false;
  export let muted = false;
  export let outputMuted = false;
  export let paused = false;
  export let error = '';
  export let expandedSize: SpeechOrbSize = {width: 760, height: 640};
  export let minimisedSize: SpeechOrbSize = {width: 520, height: 260};
  export let onToggleMinimised: () => void = () => {};
  export let onTogglePaused: () => void = () => {};
  export let onToggleMuted: () => void = () => {};
  export let onToggleOutputMuted: () => void = () => {};
  export let onClose: () => void = () => {};
  export let onResize: (size: SpeechOrbSize, minimised: boolean) => void = () => {};

  let resizing = false;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartSize: SpeechOrbSize = expandedSize;

  $: currentSize = minimised ? minimisedSize : expandedSize;
  $: status = state === 'connecting'
    ? 'Connecting'
    : state === 'listening'
      ? (muted ? 'Microphone muted' : 'Listening')
      : state === 'thinking'
        ? 'Thinking'
        : state === 'speaking'
          ? 'Speaking'
          : state === 'error'
            ? 'Voice unavailable'
            : 'Voice ended';

  function bounds(compact: boolean): {minWidth: number; maxWidth: number; minHeight: number; maxHeight: number} {
    return compact
      ? {minWidth: 320, maxWidth: Math.min(760, window.innerWidth - 24), minHeight: 190, maxHeight: 420}
      : {minWidth: 460, maxWidth: Math.min(1100, window.innerWidth - 24), minHeight: 460, maxHeight: Math.min(900, window.innerHeight - 24)};
  }

  function clampSize(size: SpeechOrbSize, compact: boolean): SpeechOrbSize {
    const limit = bounds(compact);
    return {
      width: Math.min(limit.maxWidth, Math.max(limit.minWidth, size.width)),
      height: Math.min(limit.maxHeight, Math.max(limit.minHeight, size.height)),
    };
  }

  function startResize(event: PointerEvent): void {
    resizing = true;
    resizeStartX = event.clientX;
    resizeStartY = event.clientY;
    resizeStartSize = {...currentSize};
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function dragResize(event: PointerEvent): void {
    if (!resizing) return;
    const next = clampSize({
      width: resizeStartSize.width + event.clientX - resizeStartX,
      height: resizeStartSize.height + event.clientY - resizeStartY,
    }, minimised);
    onResize(next, minimised);
  }

  function stopResize(event: PointerEvent): void {
    if (!resizing) return;
    resizing = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    const step = event.shiftKey ? 32 : 16;
    let next = {...currentSize};
    if (event.key === 'ArrowLeft') next.width -= step;
    else if (event.key === 'ArrowRight') next.width += step;
    else if (event.key === 'ArrowUp') next.height -= step;
    else if (event.key === 'ArrowDown') next.height += step;
    else return;
    onResize(clampSize(next, minimised), minimised);
    event.preventDefault();
  }
</script>

<section
  class:minimised
  class:muted
  class:paused
  class:error={state === 'error'}
  class:resizing
  class={`speech-orb voice-${state}`}
  style:--speech-width={`${currentSize.width}px`}
  style:--speech-height={`${currentSize.height}px`}
  aria-label="Voice conversation"
>
  <div class="speech-content">
    <div class="speech-copy" aria-live="polite">
      <h2>{paused ? 'Paused' : status}</h2>
      {#if state === 'error' && error}<p>{error}</p>{/if}
    </div>

    <div class="orb" aria-hidden="true">
      <span class="orb-glow"></span>
      <span class="orb-body"></span>
      <span class="orb-highlight"></span>
    </div>

    <div class="speech-actions">
      <div class="speech-controls" aria-label="Voice controls">
        <button type="button" class:active={paused} aria-label={paused ? 'Start voice' : 'Pause voice'} onclick={onTogglePaused}>
          {#if paused}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 8 5-8 5z"/></svg>{:else}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10M13 5v10"/></svg>{/if}
        </button>
        <button type="button" class:active={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} onclick={onToggleMuted}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="3" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2"/>{#if muted}<path d="m4 4 12 12"/>{/if}</svg>
        </button>
        <button type="button" class:active={outputMuted} aria-label={outputMuted ? 'Unmute speaker' : 'Mute speaker'} onclick={onToggleOutputMuted}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8h3l4-3v10l-4-3H4zM14 7a4 4 0 0 1 0 6"/>{#if outputMuted}<path d="m4 4 12 12"/>{/if}</svg>
        </button>
        <button type="button" class="voice-exit" aria-label="Exit voice" onclick={onClose}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>
        </button>
      </div>

      <button type="button" class="mode-toggle" onclick={onToggleMinimised}>{minimised ? 'Expand' : 'Minimise'}</button>
    </div>
  </div>

  <button
    type="button"
    class="resize-handle"
    aria-label={`Resize ${minimised ? 'minimised' : 'expanded'} voice view`}
    onpointerdown={startResize}
    onpointermove={dragResize}
    onpointerup={stopResize}
    onpointercancel={stopResize}
    onkeydown={resizeWithKeyboard}
  ><span aria-hidden="true"></span></button>
</section>

<style>
  .speech-orb {
    position: fixed;
    z-index: 1200;
    top: 50%;
    left: 50%;
    width: min(var(--speech-width, 760px), calc(100vw - 24px));
    height: min(var(--speech-height, 640px), calc(100vh - 24px));
    overflow: hidden;
    border: 1px solid rgb(217 225 232 / 75%);
    border-radius: 28px;
    background: radial-gradient(circle at 50% 44%, rgb(35 132 203 / 13%), transparent 34%), linear-gradient(180deg, rgb(255 255 255 / 98%), rgb(247 250 253 / 99%));
    box-shadow: 0 24px 80px rgb(15 31 45 / 16%);
    color: var(--neutral-950, #0a0a0a);
    transform: translate(-50%, -50%);
    transition: width 280ms ease, height 280ms ease, border-radius 280ms ease, top 280ms ease;
  }

  .speech-orb::before { content: ''; pointer-events: none; position: absolute; inset: -20%; background: radial-gradient(circle at 43% 38%, rgb(35 132 203 / 8%), transparent 24%), radial-gradient(circle at 58% 57%, rgb(22 48 79 / 6%), transparent 27%); filter: blur(40px); }
  .speech-orb.minimised { top: auto; bottom: 18px; height: var(--speech-height, 260px); border-radius: 24px; transform: translateX(-50%); }
  .speech-orb.resizing { transition: none; }

  .speech-content { position: relative; z-index: 1; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 36px 24px 26px; }
  .speech-copy { min-height: 42px; text-align: center; }
  .speech-copy h2 { margin: 0; font-size: 18px; font-weight: 580; }
  .speech-copy p { margin: 6px 0 0; color: var(--neutral-500, #737373); font-size: 12px; }

  .orb { position: relative; width: min(58%, 380px); aspect-ratio: 1; flex: none; }
  .orb-glow, .orb-body, .orb-highlight { position: absolute; border-radius: 50%; }
  .orb-glow { inset: 3%; background: radial-gradient(circle, rgb(44 151 226 / 30%), rgb(44 151 226 / 2%) 66%, transparent 72%); filter: blur(18px); animation: breathe 3.6s ease-in-out infinite; }
  .orb-body { inset: 14%; background: radial-gradient(circle at 36% 28%, #bdeaff 0%, #55baf0 27%, #2787c9 53%, #163a65 78%, #0b1b34 100%); box-shadow: inset -18px -24px 42px rgb(5 17 35 / 30%), inset 14px 12px 26px rgb(255 255 255 / 25%), 0 18px 55px rgb(35 132 203 / 28%); animation: orb-shape 5s ease-in-out infinite alternate; }
  .orb-highlight { inset: 22% 31% 48% 24%; background: rgb(255 255 255 / 24%); filter: blur(12px); transform: rotate(-24deg); }
  .voice-listening .orb-body { animation-duration: 3.2s; }
  .voice-thinking .orb-body { animation-duration: 1.8s; filter: saturate(.8); }
  .voice-speaking .orb-body { animation-duration: 1.15s; filter: saturate(1.2); }
  .paused .orb, .muted.voice-listening .orb { opacity: .7; }
  .error .orb { filter: grayscale(.45); opacity: .65; }

  .speech-actions { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .speech-controls { display: flex; align-items: center; justify-content: center; gap: 12px; }
  .speech-controls button { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgb(217 217 217 / 88%); border-radius: 50%; padding: 0; background: rgb(255 255 255 / 82%); color: var(--neutral-700, #404040); cursor: pointer; backdrop-filter: blur(12px); transition: transform 160ms ease, background-color 160ms ease, color 160ms ease; }
  .speech-controls button:nth-child(1), .speech-controls button:nth-child(4) { transform: translateY(-5px); }
  .speech-controls button:nth-child(2), .speech-controls button:nth-child(3) { transform: translateY(3px); }
  .speech-controls button:hover, .speech-controls button:focus-visible, .speech-controls button.active { outline: none; background: #fff; color: var(--neutral-950, #0a0a0a); }
  .speech-controls button.voice-exit { border-color: var(--neutral-950, #0a0a0a); background: var(--neutral-950, #0a0a0a); color: #fff; }
  .speech-controls svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .mode-toggle { border: 0; border-radius: 6px; padding: 4px 6px; background: transparent; color: var(--neutral-500, #737373); cursor: pointer; font-size: 11px; font-weight: 560; }
  .mode-toggle:hover { color: var(--neutral-950, #0a0a0a); }

  .resize-handle { position: absolute; z-index: 4; right: 3px; bottom: 3px; width: 28px; height: 28px; border: 0; padding: 0; background: transparent; cursor: nwse-resize; touch-action: none; }
  .resize-handle span::before, .resize-handle span::after { content: ''; position: absolute; right: 7px; bottom: 7px; width: 9px; height: 1px; background: var(--neutral-400, #a3a3a3); transform: rotate(-45deg); transform-origin: right center; }
  .resize-handle span::after { width: 5px; right: 6px; bottom: 6px; }
  .resize-handle:focus-visible { outline: 2px solid var(--neutral-400, #a3a3a3); outline-offset: -4px; }

  .minimised .speech-content { display: grid; grid-template-columns: 1fr auto 1fr; grid-template-rows: 1fr; gap: 14px; padding: 18px 34px; }
  .minimised .speech-copy { justify-self: end; min-height: 0; }
  .minimised .speech-copy h2 { font-size: 12px; color: var(--neutral-600, #525252); }
  .minimised .speech-copy p { max-width: 130px; }
  .minimised .orb { width: min(150px, 34vw); }
  .minimised .speech-actions { justify-self: start; }
  .minimised .speech-controls { gap: 8px; }
  .minimised .speech-controls button { width: 34px; height: 34px; transform: none; }

  @keyframes breathe { 50% { transform: scale(1.08); opacity: .75; } }
  @keyframes orb-shape { 0% { transform: scale(.96) rotate(-2deg); border-radius: 48% 52% 47% 53%; } 100% { transform: scale(1.03) rotate(2deg); border-radius: 54% 46% 53% 47%; } }

  @media (max-width: 620px) {
    .speech-orb { width: calc(100vw - 16px); height: min(var(--speech-height), calc(100vh - 16px)); border-radius: 22px; }
    .minimised .speech-content { display: flex; padding: 14px 20px; }
    .minimised .speech-copy { min-height: 20px; }
    .minimised .orb { width: 110px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .speech-orb, .orb-glow, .orb-body { animation: none; transition: none; }
  }
</style>
