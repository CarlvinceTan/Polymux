<script lang="ts">
  import PromptInput from './PromptInput.svelte';
  import type {ReasoningEffort} from '@flareai/protocol';

  export let greeting = 'What can I help with?';
  export let subtitle = 'Ask a question, attach a file, or start with your voice.';
  export let placeholder = 'Ask anything';
  export let active = false;
  export let speechModeEnabled = true;
  export let dictationAutoStopSeconds: number | null = 6;
  export let showComposer = true;
  export let onSend: (text: string, files: File[], asGoal: boolean, immediate: boolean) => void = () => {};
  export let onStop: () => void = () => {};
  export let onVoice: () => void = () => {};
  export let reasoning: ReasoningEffort = 'medium';
  export let onReasoningChange: (value: ReasoningEffort) => void = () => {};
  export let insertion: {id: string; text: string} | null = null;
  export let onInsertionApplied: () => void = () => {};

  /**
   * Centres the composer itself on the viewport rather than the whole stack, by
   * measuring the offset instead of guessing it, so the alignment holds at any
   * width. The push is limited by the room left below so nothing is pushed out
   * of view on a short viewport.
   */
  function centreComposer(node: HTMLElement) {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const prompt = node.querySelector<HTMLElement>('.flareai-prompt');
      if (!prompt) return;
      node.style.setProperty('--welcome-offset', '0px');
      const promptRect = prompt.getBoundingClientRect();
      const stackRect = node.getBoundingClientRect();
      const viewportCentre = window.innerHeight / 2;
      const ideal = viewportCentre - (promptRect.top + promptRect.height / 2);
      const roomBelow = window.innerHeight - stackRect.bottom - 8;
      node.style.setProperty('--welcome-offset', `${Math.round(Math.max(0, Math.min(ideal, roomBelow)))}px`);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    // Measured straight away so the composer is centred on first paint, then
    // refined once layout settles.
    measure();
    schedule();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(node);
    window.addEventListener('resize', schedule);

    return {
      destroy() {
        if (frame) cancelAnimationFrame(frame);
        observer?.disconnect();
        window.removeEventListener('resize', schedule);
      },
    };
  }
</script>

<div class="welcome-chat-pane" use:centreComposer>
  <div class="welcome-heading">
    <!-- Document-relative, not root-relative: the packaged app is loaded over
         file://, where a leading slash resolves against the filesystem root
         rather than the bundle and the mark silently fails to load. -->
    <img class="brand-mark" src="flareai.svg" alt="FlareAI"/>
    <h1>{greeting}</h1>
    <p>{subtitle}</p>
  </div>
  {#if showComposer}
    <PromptInput variant="welcome" {active} {speechModeEnabled} {dictationAutoStopSeconds} {placeholder} {onSend} {onStop} {onVoice} {reasoning} {onReasoningChange} {insertion} {onInsertionApplied}/>
  {/if}
</div>
