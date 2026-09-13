<script lang="ts">
  import Icon from '../../shared/components/Icon.svelte';
  import {t} from '../../../i18n';

  export let src: string;
  export let name = 'Voice message';
  export let fallbackDuration: number | null = null;
  export let onError: (event: Event) => void = () => {};

  let audio: HTMLAudioElement;
  let playing = false;
  let currentTime = 0;
  let duration = validTime(fallbackDuration) ? fallbackDuration! : 0;

  /** A stable voice-shaped trace keeps message rows visually quiet while the
   * real recording remains in the native media element underneath. */
  const WAVEFORM = [
    7, 12, 9, 17, 11, 6, 14, 20, 12, 8, 16, 10, 19, 13,
    7, 15, 21, 11, 8, 17, 12, 6, 14, 18, 9, 13, 7, 16,
  ];

  function validTime(value: number | null | undefined): value is number {
    return Number.isFinite(value) && (value ?? 0) >= 0;
  }

  function clock(value: number): string {
    const seconds = Math.max(0, Math.floor(validTime(value) ? value : 0));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function readMetadata(): void {
    if (validTime(audio?.duration)) duration = audio.duration;
  }

  function readTime(): void {
    currentTime = validTime(audio?.currentTime) ? audio.currentTime : 0;
  }

  async function togglePlayback(): Promise<void> {
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (audio.ended || (duration > 0 && currentTime >= duration - .02)) {
      audio.currentTime = 0;
      currentTime = 0;
    }
    try {
      await audio.play();
    } catch {
      playing = false;
    }
  }

  function seek(event: Event): void {
    if (!audio) return;
    const next = Number((event.currentTarget as HTMLInputElement).value);
    if (!validTime(next)) return;
    audio.currentTime = next;
    currentTime = next;
  }

  $: rangeMax = duration > 0 ? duration : Math.max(1, currentTime);
  $: progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  $: shownTime = currentTime > 0 && currentTime < duration ? currentTime : duration;
</script>

<div class="voice-message" role="group" aria-label={name} data-playing={playing}>
  <audio
    class="voice-message-native"
    bind:this={audio}
    preload="metadata"
    {src}
    aria-hidden="true"
    onloadedmetadata={readMetadata}
    ondurationchange={readMetadata}
    ontimeupdate={readTime}
    onplay={() => playing = true}
    onpause={() => playing = false}
    onended={() => playing = false}
    onerror={onError}
  ></audio>
  <button
    type="button"
    class="voice-message-play"
    aria-label={playing ? $t('hub.pauseRecording') : $t('hub.playRecording')}
    onclick={() => void togglePlayback()}
  >
    <Icon name={playing ? 'pause' : 'play'} size={13} />
  </button>
  <span class="voice-message-timeline" style:--voice-progress={`${progress * 100}%`}>
    <span class="voice-message-waveform" aria-hidden="true">
      <span class="voice-message-bars voice-message-track">
        {#each WAVEFORM as height}<i style:height={`${height}px`}></i>{/each}
      </span>
      <span class="voice-message-bars voice-message-value">
        {#each WAVEFORM as height}<i style:height={`${height}px`}></i>{/each}
      </span>
    </span>
    <input
      type="range"
      min="0"
      max={rangeMax}
      step="0.01"
      value={currentTime}
      aria-label={$t('hub.seekRecording')}
      oninput={seek}
    />
  </span>
  <span class="voice-message-time">{clock(shownTime)}</span>
</div>

<style>
  .voice-message { width: 220px; max-width: 100%; height: 32px; display: flex; align-items: center; gap: 8px; color: inherit; }
  .voice-message-native { display: none; }
  .voice-message-play { width: 22px; height: 22px; display: grid; flex: none; place-items: center; border: 0; border-radius: 0; padding: 0; background: transparent; color: inherit; cursor: pointer; opacity: .82; transition: opacity 120ms ease; }
  .voice-message-play:hover { opacity: 1; }
  .voice-message-play:focus-visible { outline: 1px solid currentColor; outline-offset: 2px; }
  .voice-message-timeline { position: relative; min-width: 68px; height: 26px; flex: 1; display: block; }
  .voice-message-waveform { position: absolute; inset: 0; display: block; overflow: hidden; }
  .voice-message-bars { position: absolute; inset: 0; display: flex; align-items: center; gap: 2px; }
  .voice-message-bars i { min-width: 1px; flex: 1; border-radius: 999px; background: currentColor; }
  .voice-message-track { opacity: .22; }
  .voice-message-value { opacity: .82; clip-path: inset(0 calc(100% - var(--voice-progress)) 0 0); }
  .voice-message-timeline input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; opacity: 0; }
  .voice-message-timeline:has(input:focus-visible) { border-radius: 3px; outline: 1px solid currentColor; outline-offset: 2px; }
  .voice-message-time { min-width: 29px; flex: none; opacity: .66; font-size: 10.5px; font-variant-numeric: tabular-nums; line-height: 1; text-align: right; }
  @media (prefers-reduced-motion: reduce) { .voice-message-play { transition: none; } }
</style>
