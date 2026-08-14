<script lang="ts">
  import {onMount} from 'svelte';
  import {midasApi} from '../../api/midas';
  import Icon from '../shared/Icon.svelte';
  import InlineChip, {type InlineChipItem, type SubmittedChip} from './InlineChip.svelte';

  export let active = false;
  export let speechModeEnabled = true;
  export let placeholder = 'Ask anything';
  export let variant: 'default' | 'welcome' = 'default';
  export let onSend: (text: string, files: File[], asGoal: boolean) => void;
  export let onStop: () => void = () => {};
  export let onVoice: () => void = () => {};
  export let onOptions: () => void = () => {};

  const api = midasApi();

  type Attachment = InlineChipItem & {file: File};

  let draft = '';
  let attachments: Attachment[] = [];
  let editor: InlineChip;
  let fileInput: HTMLInputElement;
  let expanded = false;
  let goalEnabled = false;
  let fileDragActive = false;

  // Dictation writes into the draft; speech mode is the primary button instead.
  // Recording happens here, but recognition runs locally in the main process
  // (whisper.cpp): the Web Speech API needs Google's cloud recogniser, which
  // Electron does not ship, so it always failed mid-session.
  let recorder: MediaRecorder | null = null;
  let recorderStream: MediaStream | null = null;
  let recorderChunks: Blob[] = [];
  let dictationListening = false;
  let dictationTranscribing = false;
  let dictationError = '';
  let dictationBase = '';
  let dictationPending = false;
  let dictationFinishing = false;

  $: hasContent = draft.length > 0 || attachments.length > 0;
  /** Content is always sendable; with an empty composer the button offers to
      stop a run, and otherwise it opens speech mode. */
  $: primary = (hasContent ? 'send' : active ? 'stop' : speechModeEnabled ? 'mic' : 'send') as 'send' | 'stop' | 'mic';
  $: chips = attachments.map(({file: _file, ...chip}) => chip);

  async function primaryAction(): Promise<void> {
    if (primary === 'stop') onStop();
    else if (primary === 'mic') {
      const permission = await api.permissions.request('microphone');
      if (permission === 'granted') onVoice();
      else dictationError = 'Microphone access is off. Enable it in System Settings.';
    }
    else editor?.submit();
  }

  function submit(text: string, ordered: SubmittedChip[]): void {
    const trimmed = text.trim();
    const ids = new Set(ordered.map((chip) => chip.id));
    const files = attachments.filter((attachment) => ids.has(attachment.id)).map((attachment) => attachment.file);
    if (!trimmed && !files.length) return;
    onSend(trimmed, files.length ? files : attachments.map((attachment) => attachment.file), goalEnabled);
    goalEnabled = false;
    draft = '';
    attachments = [];
    editor?.setText('');
  }

  function removeAttachment(id: string): void {
    attachments = attachments.filter((attachment) => attachment.id !== id);
  }

  function chooseFiles(): void {
    fileInput?.click();
  }

  function addFiles(files: Iterable<File>): void {
    const added = Array.from(files).map((file) => {
      const id = crypto.randomUUID();
      return {id, localId: id, name: file.name, status: 'done' as const, progress: 100, file};
    });
    if (added.length) attachments = [...attachments, ...added];
  }

  function selected(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    addFiles(input.files ?? []);
    input.value = '';
  }

  function isFileDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files') || Boolean(event.dataTransfer?.files.length);
  }

  function windowDragEnter(event: DragEvent): void {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    fileDragActive = true;
  }

  function windowDragOver(event: DragEvent): void {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    fileDragActive = true;
  }

  function windowDragLeave(event: DragEvent): void {
    if (!event.relatedTarget) fileDragActive = false;
  }

  function windowDrop(event: DragEvent): void {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    fileDragActive = false;
    addFiles(event.dataTransfer?.files ?? []);
  }

  function stopDictation(): void {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = null;
    dictationListening = false;
  }

  /** Unmount path: drop the clip instead of transcribing it. */
  function cancelDictation(): void {
    if (recorder) recorder.onstop = null;
    stopDictation();
    releaseRecorder();
  }

  function releaseRecorder(): void {
    recorderStream?.getTracks().forEach((track) => track.stop());
    recorderStream = null;
    recorderChunks = [];
    dictationPending = false;
    dictationFinishing = false;
  }

  async function toggleDictation(): Promise<void> {
    if (dictationTranscribing && !dictationListening) return;
    if (dictationListening) {
      stopDictation();
      return;
    }
    const permission = await api.permissions.request('microphone');
    if (permission !== 'granted') {
      dictationError = 'Microphone access is off. Enable it in System Settings.';
      return;
    }
    dictationError = '';
    dictationBase = draft && !draft.endsWith(' ') ? `${draft} ` : draft;
    try {
      recorderStream = await navigator.mediaDevices.getUserMedia({audio: true});
    } catch {
      dictationError = 'No microphone was found. Connect one and try again.';
      return;
    }
    recorderChunks = [];
    dictationPending = false;
    dictationFinishing = false;
    const next = new MediaRecorder(recorderStream);
    next.ondataavailable = (event) => {
      if (!event.data.size) return;
      recorderChunks.push(event.data);
      void transcribeRecording();
    };
    next.onstop = () => {
      dictationListening = false;
      dictationFinishing = true;
      void transcribeRecording();
    };
    recorder = next;
    // Each data slice extends the same WebM recording. Re-running local
    // Whisper over the accumulated clip lets the draft show partial results
    // without depending on a cloud streaming recogniser.
    next.start(2500);
    dictationListening = true;
  }

  async function transcribeRecording(): Promise<void> {
    dictationPending = true;
    if (dictationTranscribing) return;
    dictationTranscribing = true;
    while (dictationPending) {
      dictationPending = false;
      const clip = new Blob(recorderChunks);
      if (!clip.size) continue;
      try {
        const text = await api.dictation.transcribe(await monoWav(clip));
        if (text) {
          draft = `${dictationBase}${text}`;
          editor?.setText(draft);
        }
      } catch (error) {
        dictationError = dictationFailure(error);
      }
    }
    dictationTranscribing = false;
    if (dictationFinishing) releaseRecorder();
  }

  /** whisper.cpp wants mono 16kHz 16-bit PCM; decodeAudioData resamples to the
   * context rate, so the conversion is one render plus a WAV header. */
  async function monoWav(clip: Blob): Promise<ArrayBuffer> {
    const context = new OfflineAudioContext(1, 1, 16000);
    const decoded = await context.decodeAudioData(await clip.arrayBuffer());
    const samples = decoded.getChannelData(0);
    const wav = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const writeAscii = (offset: number, text: string) => {
      for (let index = 0; index < text.length; index += 1) wav.setUint8(offset + index, text.charCodeAt(index));
    };
    writeAscii(0, 'RIFF'); wav.setUint32(4, 36 + samples.length * 2, true); writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
    wav.setUint32(24, 16000, true); wav.setUint32(28, 32000, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
    writeAscii(36, 'data'); wav.setUint32(40, samples.length * 2, true);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      wav.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return wav.buffer;
  }

  function dictationFailure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const detail = message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    return detail || 'Dictation stopped unexpectedly. Try again.';
  }

  onMount(() => {
    window.addEventListener('dragenter', windowDragEnter);
    window.addEventListener('dragover', windowDragOver);
    window.addEventListener('dragleave', windowDragLeave);
    window.addEventListener('drop', windowDrop);
    return () => {
      cancelDictation();
      window.removeEventListener('dragenter', windowDragEnter);
      window.removeEventListener('dragover', windowDragOver);
      window.removeEventListener('dragleave', windowDragLeave);
      window.removeEventListener('drop', windowDrop);
    };
  });
</script>

<div class:welcome={variant === 'welcome'} class:file-drag-active={fileDragActive} class="polymux-prompt">
  <input bind:this={fileInput} class="visually-hidden" name="prompt-attachments" type="file" multiple tabindex="-1" aria-hidden="true" onchange={selected}/>

  <div class:expanded class:raised={hasContent} class="polymux-prompt-shell">
    <div class="polymux-editor-slot">
      <InlineChip
        bind:this={editor}
        value={draft}
        {chips}
        {placeholder}
        onChange={(text) => draft = text}
        onSubmit={submit}
        onRemove={removeAttachment}
        onExpanded={(value) => expanded = value}
      />
    </div>
    <button
      type="button"
      data-testid="prompt-primary-button"
      class="polymux-primary"
      aria-label={primary === 'send' ? 'Send message' : primary === 'stop' ? 'Stop agent' : 'Start speech mode'}
      data-tooltip-label={primary === 'send' ? 'Send' : primary === 'stop' ? 'Stop agent' : 'Speech Mode'}
      onclick={primaryAction}
    ><Icon name={primary === 'mic' ? 'waveform' : primary} size={primary === 'stop' ? 16 : 18}/></button>
  </div>

  <div class="polymux-prompt-toolbar">
    <button type="button" onclick={chooseFiles}><Icon name="attach" size={14}/><span>ATTACH</span></button>
    <button
      class:active={dictationListening || dictationTranscribing}
      type="button"
      aria-pressed={dictationListening}
      aria-busy={dictationTranscribing}
      onclick={() => void toggleDictation()}
    >
      <span class="dictation-mark">
        {#if dictationListening}<span class="dictation-ping" aria-hidden="true"></span>{/if}
        <Icon name="mic" size={14}/>
      </span>
      <span>{dictationListening ? 'LISTENING' : dictationTranscribing ? 'WRITING…' : 'VOICE'}</span>
    </button>
    <button
      class="goal-toggle"
      class:active={goalEnabled}
      type="button"
      aria-label={goalEnabled ? 'Disable goal for next message' : 'Send next message as a goal'}
      aria-pressed={goalEnabled}
      onclick={() => goalEnabled = !goalEnabled}
    ><Icon name="goal" size={14}/><span>GOAL</span></button>
    <button type="button" aria-haspopup="dialog" onclick={onOptions}><Icon name="options" size={14}/><span>OPTIONS</span></button>
  </div>
  {#if dictationError}<p class="dictation-error" role="alert">{dictationError}</p>{/if}
</div>
