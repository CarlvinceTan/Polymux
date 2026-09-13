<script lang="ts">
  import {onDestroy} from 'svelte';
  import Icon from './Icon.svelte';

  export let active = false;
  export let disabled = false;
  export let destination = 'Assistant';
  export let onSend: (text: string, files: File[]) => Promise<void>;
  export let onStop: () => Promise<void>;

  let draft = '';
  let files: File[] = [];
  let fileInput: HTMLInputElement;
  let textarea: HTMLTextAreaElement;
  let sending = false;
  let recording = false;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let error = '';

  $: canSend = Boolean(draft.trim() || files.length) && !disabled && !sending;

  function resize(): void {
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 124)}px`;
  }

  function chooseFiles(event: Event): void {
    const selected = Array.from((event.currentTarget as HTMLInputElement).files ?? []);
    const tooLarge = selected.find((file) => file.size > 12 * 1024 * 1024);
    if (tooLarge) error = `${tooLarge.name} is larger than the 12 MB phone limit.`;
    files = [...files, ...selected.filter((file) => file.size <= 12 * 1024 * 1024)].slice(0, 6);
    fileInput.value = '';
  }

  async function submit(): Promise<void> {
    if (!canSend) return;
    sending = true;
    error = '';
    try {
      await onSend(draft.trim(), files);
      draft = '';
      files = [];
      requestAnimationFrame(resize);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      sending = false;
    }
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  }

  async function toggleRecording(): Promise<void> {
    if (recording) {
      recorder?.stop();
      return;
    }
    error = '';
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
      const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
        .find((type) => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
      chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder?.mimeType || 'audio/webm';
        const extension = type.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(chunks, {type});
        if (blob.size) files = [...files, new File([blob], `voice-${Date.now()}.${extension}`, {type})].slice(0, 6);
        stopStream();
      };
      recorder.start(500);
      recording = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Microphone access was not granted.';
      stopStream();
    }
  }

  function stopStream(): void {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
    recording = false;
  }

  onDestroy(stopStream);
</script>

<div class="composer-wrap">
  {#if error}<div class="composer-error" role="alert">{error}</div>{/if}
  {#if files.length}
    <div class="attachment-strip">
      {#each files as file, index}
        <button type="button" on:click={() => files = files.filter((_, item) => item !== index)} aria-label={`Remove ${file.name}`}>
          <Icon name="file" size={15} />
          <span>{file.name}</span>
          <Icon name="close" size={14} />
        </button>
      {/each}
    </div>
  {/if}
  <div class:recording class="composer">
    <input bind:this={fileInput} class="visually-hidden" type="file" multiple on:change={chooseFiles} />
    <button class="composer-action" type="button" on:click={() => fileInput.click()} disabled={disabled || sending || active} aria-label="Attach files">
      <Icon name="plus" size={22} />
    </button>
    <textarea
      bind:this={textarea}
      bind:value={draft}
      on:input={resize}
      on:keydown={keydown}
      rows="1"
      placeholder={active ? `Add direction for ${destination}` : `Message ${destination}`}
      aria-label={`Message ${destination}`}
      disabled={disabled || sending}
    ></textarea>
    <button
      class="composer-action mic-action"
      class:recording
      type="button"
      on:click={active ? onStop : toggleRecording}
      disabled={disabled || sending}
      aria-label={active ? 'Stop run' : recording ? 'Stop voice recording' : 'Record a voice message'}
    >
      <Icon name={active || recording ? 'stop' : 'mic'} size={20} />
    </button>
    <button class="send-action" type="button" on:click={submit} disabled={!canSend} aria-label={active ? 'Send direction' : 'Send message'}>
      <Icon name="send" size={19} />
    </button>
  </div>
</div>

<style>
  .composer-wrap { padding: 8px 12px calc(env(safe-area-inset-bottom) + 9px); background: linear-gradient(to top, var(--surface) 72%, transparent); }
  .composer { min-height: 52px; display: flex; align-items: flex-end; gap: 2px; padding: 3px; border: 1px solid var(--line-strong); border-radius: 28px; background: var(--field); transition: border-color 150ms ease, box-shadow 150ms ease; }
  .composer:focus-within { border-color: color-mix(in srgb, var(--ink) 42%, var(--line-strong)); box-shadow: 0 7px 24px rgba(0, 0, 0, .08); }
  .composer.recording { border-color: color-mix(in srgb, var(--danger) 55%, var(--line)); }
  textarea { flex: 1; min-width: 0; min-height: 48px; max-height: 124px; resize: none; padding: 12px 5px 10px; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; font-size: 1rem; line-height: 1.42; scrollbar-width: none; }
  textarea::-webkit-scrollbar { display: none; }
  textarea::placeholder { color: var(--muted-soft); }
  .composer-action, .send-action { width: 48px; height: 48px; flex: 0 0 48px; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--muted); }
  .composer-action:active { color: var(--ink); }
  .send-action { background: var(--ink); color: var(--surface); transform: scale(.86); }
  .send-action:disabled { opacity: .22; }
  .mic-action.recording { color: var(--danger); }
  .attachment-strip { display: flex; gap: 6px; overflow-x: auto; padding: 0 3px 7px; scrollbar-width: none; }
  .attachment-strip::-webkit-scrollbar { display: none; }
  .attachment-strip button { max-width: 220px; min-height: 48px; flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 0 9px; border: 0; border-radius: 12px; background: var(--bubble); color: var(--muted); }
  .attachment-strip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .75rem; }
  .composer-error { margin: 0 8px 7px; color: var(--danger); font-size: .75rem; }
</style>
