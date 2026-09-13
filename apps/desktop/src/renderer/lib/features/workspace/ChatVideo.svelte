<script lang="ts">
  import Icon from '../../shared/components/Icon.svelte';
  import {t} from '../../../i18n';
  export let src: string;
  export let name: string;
  export let onOpen: (state: {position: number; playing: boolean; opener: HTMLButtonElement}) => void;
  export let expanded = false;
  export let initialPosition = 0;
  export let resume = false;
  export let onDimensions: (ratio: number) => void = () => {};
  export let onError: (event: Event) => void;
  let player: HTMLVideoElement;
  let paused = true;
  let started = expanded || initialPosition > 0;
  let ended = false;
  let hovered = false;
  let focused = false;
  let duration = 0;
  let position = 0;
  function ready(): void {
    duration = Number.isFinite(player.duration) ? player.duration : 0;
    onDimensions(player.videoWidth / player.videoHeight || 1);
    ended = duration > 0 && initialPosition >= duration;
    if (duration && initialPosition > 0) player.currentTime = Math.min(initialPosition, duration);
    if (resume) void player.play().catch(() => paused = true);
  }
  async function toggle(): Promise<void> {
    if (!player.paused) player.pause();
    else { try { if (ended) player.currentTime = 0; await player.play(); } catch { paused = true; } }
  }
  function seek(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(duration) && duration > 0) player.currentTime = Math.min(duration, Math.max(0, value));
  }
</script>

<div role="group" aria-label={name} class="hub-chat-video" class:expanded class:overlay-visible={paused || hovered || focused}
  onpointerenter={() => hovered = true} onpointerleave={() => hovered = false}
  onfocusin={(event) => focused = (event.target as HTMLElement).matches(':focus-visible')}
  onfocusout={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) focused = false; }}>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={player} class="hub-view-bubble-video" {src} aria-label={name} playsinline preload="metadata"
    onplay={() => { paused = false; started = true; ended = false; }} onpause={() => paused = true} onended={() => { paused = true; ended = true; }}
    onloadedmetadata={ready}
    ondurationchange={() => duration = Number.isFinite(player.duration) ? player.duration : 0}
    ontimeupdate={() => position = player.currentTime} onerror={onError}></video>
  <button class="hub-chat-video-toggle" type="button" aria-label={ended ? $t('hub.replayVideo') : paused ? $t('hub.playVideo') : $t('hub.pauseVideo')}
    onclick={() => void toggle()}>
    <span class="hub-chat-video-play"><Icon name={ended ? 'reload' : paused ? 'play' : 'pause'} size={24}/></span>
  </button>
  {#if started}
  {#if !expanded}
  <button class="hub-chat-video-expand" type="button" aria-label={$t('hub.previewVideo')}
    onclick={(event) => { const playing = !player.paused; player.pause(); onOpen({position: player.currentTime, playing, opener: event.currentTarget}); }}><Icon name="expand" size={15}/></button>
  {/if}
  <input class="hub-chat-video-seek" type="range" min="0" max={duration || 1} step="0.01" value={position}
    disabled={!duration} aria-label={$t('hub.videoPosition')} oninput={seek}/>
  {/if}
</div>

<style>
  .hub-chat-video { --media-control-foreground: #fff; position: relative; width: fit-content; max-width: 100%; }
  .hub-chat-video.expanded { width: 100%; }
  .expanded .hub-view-bubble-video { width: 100%; max-width: 100%; max-height: none; }
  button { position: absolute; border: 0; padding: 0; color: var(--media-control-foreground); background: transparent; cursor: pointer; }
  .hub-chat-video-toggle { inset: 0; display: grid; place-items: center; width: 100%; }
  .hub-chat-video-play { display: grid; place-items: center; filter: drop-shadow(0 1px 4px #000); }
  .hub-chat-video-expand { top: 8px; right: 8px; display: grid; place-items: center; filter: drop-shadow(0 1px 4px #000); }
  .hub-chat-video-seek { position: absolute; bottom: 6px; left: 8px; width: calc(100% - 16px); margin: 0; accent-color: white; cursor: pointer; }
  .hub-chat-video-play, .hub-chat-video-expand, .hub-chat-video-seek { opacity: 0; transition: opacity 150ms ease; }
  .hub-chat-video-expand, .hub-chat-video-seek { pointer-events: none; }
  .overlay-visible .hub-chat-video-play, .overlay-visible .hub-chat-video-expand, .overlay-visible .hub-chat-video-seek { opacity: 1; pointer-events: auto; }
  @media (prefers-reduced-motion: reduce) { .hub-chat-video-play, .hub-chat-video-expand, .hub-chat-video-seek { transition: none; } }
</style>
