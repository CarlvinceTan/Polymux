<script module lang="ts">
  export type SpeechOrbState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error' | 'ended';
</script>

<script lang="ts">
  import {onDestroy, onMount} from 'svelte';
  import Icon from '../shared/Icon.svelte';
  import {startVoiceOrb, type RealtimeVoiceState, type VoiceOrbHandle} from '../../voice/voiceOrb';

  export let state: SpeechOrbState = 'connecting';
  /** Docked into the conversation rather than filling the window. */
  export let inChat = false;
  export let muted = false;
  export let outputMuted = false;
  export let paused = false;
  export let error = '';
  export let transcript = '';
  export let transcriptRole: 'user' | 'assistant' = 'user';
  export let onToggleChat: () => void = () => {};
  export let onTogglePaused: () => void = () => {};
  export let onToggleMuted: () => void = () => {};
  export let onToggleOutputMuted: () => void = () => {};
  export let onClose: () => void = () => {};

  let orbCanvas: HTMLCanvasElement;
  let orb: VoiceOrbHandle | null = null;

  const statusLabels: Record<SpeechOrbState, string> = {
    connecting: 'Connecting…',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking',
    error: 'Voice is unavailable',
    ended: 'Voice ended',
  };

  $: status = paused ? 'Paused' : statusLabels[state];
  $: orbState = (state === 'ended' ? 'closed' : state) as RealtimeVoiceState;
  $: orb?.setState(orbState, {muted, paused});

  let mounted = true;

  /**
   * The WebGL visualiser is loaded only when voice opens, so its cost is not in
   * the main bundle, and any WebGL failure falls back to the canvas orb rather
   * than leaving voice mode without one.
   */
  async function startOrb(): Promise<void> {
    try {
      const {startThreeVoiceOrb} = await import('../../voice/voiceOrbThree');
      if (!mounted) return;
      orb = startThreeVoiceOrb(orbCanvas, orbState);
    } catch {
      if (mounted) orb = startVoiceOrb(orbCanvas, orbState);
    }
    orb?.setState(orbState, {muted, paused});
  }

  onMount(() => {
    void startOrb();
  });

  onDestroy(() => {
    mounted = false;
    orb?.destroy();
    orb = null;
  });
</script>

<section
  class:muted
  class:paused
  class:in-chat={inChat}
  class:error={state === 'error'}
  class={`speech-orb voice-${state}`}
  aria-label="Realtime voice conversation"
>
  <div class="speech-orb-content">
    <!-- The focused surface is only the orb and its controls; speech state is
         carried by the orb itself. The docked view keeps the compact live
         status, and an error is always spelled out so a failure is never
         silent. -->
    {#if state === 'error'}
      <div class="speech-orb-copy" aria-live="polite">
        <h2>{status}</h2>
        {#if error}<p>{error}</p>{/if}
      </div>
    {:else if inChat || transcript}
      <div class="speech-orb-copy" aria-live="polite">
        <h2>{status}</h2>
        {#if transcript}<blockquote class:assistant={transcriptRole === 'assistant'}>{transcript}</blockquote>{/if}
      </div>
    {:else}
      <span class="visually-hidden" aria-live="polite">{status}</span>
    {/if}

    <div class="voice-orb">
      <canvas bind:this={orbCanvas} aria-hidden="true"></canvas>
    </div>

    <div class="speech-orb-actions">
      <div class="speech-orb-controls" aria-label="Voice controls">
        <button type="button" class:active={paused} aria-label={state === 'error' ? 'Try again' : paused ? 'Start voice' : 'Pause voice'} onclick={onTogglePaused}><Icon name={state === 'error' ? 'reload' : paused ? 'play' : 'pause'} size={18}/></button>
        <button type="button" class:active={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} onclick={onToggleMuted}><Icon name={muted ? 'mic-off' : 'mic'} size={18}/></button>
        <button type="button" class:active={outputMuted} aria-label={outputMuted ? 'Unmute speaker' : 'Mute speaker'} onclick={onToggleOutputMuted}><Icon name={outputMuted ? 'speaker-off' : 'speaker'} size={18}/></button>
        <button type="button" class="voice-exit" aria-label="Exit speech mode" onclick={onClose}><Icon name="close" size={18}/></button>
      </div>
      <button type="button" class="speech-orb-chat-toggle" onclick={onToggleChat}>{inChat ? 'Expand' : 'Minimise'}</button>
    </div>
  </div>
</section>
