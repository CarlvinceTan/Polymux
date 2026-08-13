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
  let recognition: SpeechRecognitionLike | null = null;
  let dictationListening = false;
  let dictationError = '';
  let dictationBase = '';
  let dictationFinal = '';

  interface SpeechRecognitionResultLike {
    readonly isFinal: boolean;
    readonly 0: {transcript: string};
  }

  interface SpeechRecognitionEventLike extends Event {
    readonly resultIndex: number;
    readonly results: ArrayLike<SpeechRecognitionResultLike>;
  }

  interface SpeechRecognitionErrorLike extends Event {
    readonly error: string;
  }

  interface SpeechRecognitionLike {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
  }

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

  function recognitionConstructor(): (new () => SpeechRecognitionLike) | undefined {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  }

  function stopDictation(): void {
    recognition?.abort();
    recognition = null;
    dictationListening = false;
  }

  async function toggleDictation(): Promise<void> {
    if (dictationListening) {
      stopDictation();
      return;
    }
    const permission = await api.permissions.request('microphone');
    if (permission !== 'granted') {
      dictationError = 'Microphone access is off. Enable it in System Settings.';
      return;
    }
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      dictationError = 'Dictation is not available in this build.';
      return;
    }
    dictationBase = draft && !draft.endsWith(' ') ? `${draft} ` : draft;
    dictationFinal = '';
    dictationError = '';

    const next = new Constructor();
    next.continuous = true;
    next.interimResults = true;
    next.lang = 'en-AU';
    next.onstart = () => dictationListening = true;
    next.onend = () => dictationListening = false;
    next.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) dictationFinal += result[0].transcript;
        else interim += result[0].transcript;
      }
      draft = `${dictationBase}${dictationFinal}${interim}`;
      editor?.setText(draft);
    };
    next.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      dictationListening = false;
      dictationError = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone permission is blocked. Allow microphone access and try again.'
        : event.error === 'audio-capture'
          ? 'No microphone was found. Connect one and try again.'
          : 'Dictation stopped unexpectedly. Try again.';
    };
    recognition = next;
    next.start();
  }

  onMount(() => {
    window.addEventListener('dragenter', windowDragEnter);
    window.addEventListener('dragover', windowDragOver);
    window.addEventListener('dragleave', windowDragLeave);
    window.addEventListener('drop', windowDrop);
    return () => {
      stopDictation();
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
      class:active={dictationListening}
      type="button"
      aria-pressed={dictationListening}
      data-tooltip-label={dictationListening ? 'Stop listening' : 'Voice dictation'}
      onclick={() => void toggleDictation()}
    >
      <span class="dictation-mark">
        {#if dictationListening}<span class="dictation-ping" aria-hidden="true"></span>{/if}
        <Icon name="mic" size={14}/>
      </span>
      <span>{dictationListening ? 'LISTENING' : 'VOICE'}</span>
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
