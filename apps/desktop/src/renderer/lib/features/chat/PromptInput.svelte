<script lang="ts">
  import {onMount} from 'svelte';
  import {readableError} from '../../shared/errors';
  import {flareaiApi} from '../../api/flareai';
  import type {ModelDto, ReasoningEffort} from '@flareai/protocol';
  import Icon from '../../shared/components/Icon.svelte';
  import InlineChip, {type InlineChipItem, type SubmittedChip} from './InlineChip.svelte';
  import ProviderLogo from '../../shared/components/ProviderLogo.svelte';
  import {t, translate} from '../../../i18n';

  export let active = false;
  export let speechModeEnabled = true;
  /** Basic mode leaves the model to whichever provider is configured, so the
   * picker has nothing to ask and is left out of the option strip. */
  export let advancedMode = false;
  export let onOpenPlugins: () => void = () => {};
  /** Seconds of silence that end dictation, or null to listen until pressed again. */
  export let dictationAutoStopSeconds: number | null = 6;
  /** Empty means the default prompt, which follows the language. */
  export let placeholder = '';
  export let variant: 'default' | 'welcome' = 'default';
  /** `immediate` sends past the queue and steers a run that is already going. */
  export let onSend: (text: string, files: File[], asGoal: boolean, immediate: boolean) => void;
  export let onStop: () => void = () => {};
  export let onVoice: () => void = () => {};
  export let reasoning: ReasoningEffort = 'medium';
  export let onReasoningChange: (value: ReasoningEffort) => void = () => {};
  /** Text to drop into the draft, keyed so the same request applies once. */
  export let insertion: {id: string; text: string} | null = null;
  export let onInsertionApplied: () => void = () => {};

  const api = flareaiApi();

  type Attachment = InlineChipItem & {file: File};

  let draft = '';
  let attachments: Attachment[] = [];
  let editor: InlineChip;
  let fileInput: HTMLInputElement;
  let expanded = false;
  let goalEnabled = false;
  let fileDragActive = false;

  $: reasoningEffortOptions = [
    {value: 'off' as ReasoningEffort, label: $t('reasoning.off')},
    {value: 'low' as ReasoningEffort, label: $t('reasoning.low')},
    {value: 'medium' as ReasoningEffort, label: $t('reasoning.medium')},
    {value: 'high' as ReasoningEffort, label: $t('reasoning.high')},
  ];
  /** Models that always think but take no effort level: neither pi-ai nor the
      models.dev catalogue records adjustable levels, so the exceptions live
      here and the menu offers them a single Default. */
  const fixedEffortModels = [/-reasoner\b/, /^grok-4(?!.*mini)/, /-pro\b/];
  let modelMenuOpen = false;
  let modelWrap: HTMLDivElement;
  /** Only models whose provider is configured — the ones a run can actually
      use — reach the menu. */
  let availableModels: ModelDto[] = [];
  let modelsLoaded = false;
  let modelSearch = '';
  let searchField: HTMLInputElement;
  /** The row whose reasoning submenu is showing, keyed provider/id. */
  let openModelKey = '';
  /** Where that submenu sits, in pixels from the menu's top. */
  let openModelTop = 0;

  const modelKey = (model: ModelDto): string => `${model.provider}/${model.id}`;
  const adjustable = (model: ModelDto): boolean =>
    model.reasoning && !fixedEffortModels.some((pattern) => pattern.test(model.id));

  // Dictation writes into the draft; speech mode is the primary button instead.
  // Recording happens here, but recognition runs locally in the main process
  // (whisper.cpp): the Web Speech API needs Google's cloud recogniser, which
  // Electron does not ship, so it always failed mid-session.
  // The button no longer waits on any of it: pressing it settles the label in
  // the same tick, and each press owns a session so a transcript still landing
  // from the last one cannot write over the next.
  type Dictation = {
    /** Where this session's text sits in the draft — the caret at press time. */
    start: number;
    /** What the last pass wrote there, so the next one revises that span rather
        than appending a second copy of the same sentence. */
    written: string;
    chunks: Blob[];
    stream: MediaStream | null;
    recorder: MediaRecorder | null;
    /** Recording is over: stop feeding this session audio. */
    closed: boolean;
    /** The recorder flushed its last slice; release once the queue drains. */
    drained: boolean;
    pending: boolean;
    running: boolean;
    /** Tears down the silence watch; null when nothing is being watched. */
    listen: (() => void) | null;
  };
  /** How often a slice is cut and handed to a transcription pass. */
  const SLICE_INTERVAL = 600;
  /** How often the level is sampled while listening. */
  const LEVEL_INTERVAL = 100;
  /** Speech has to clear the room's own noise by this much, in dB. Rooms differ
   * far more than voices do, so the bar is set against a floor that follows the
   * room rather than at a fixed level. */
  const VOICE_MARGIN = 12;
  /** …but never treat the near-silence of a muted or dead mic as speech. */
  const VOICE_FLOOR = -55;
  /** The session taking audio, or null when the button reads VOICE. */
  let recording: Dictation | null = null;
  /** The newest session, recording or not — it alone may write to the draft. */
  let owner: Dictation | null = null;
  let dictationListening = false;
  let dictationError = '';

  $: hasContent = draft.length > 0 || attachments.length > 0;
  /** Content is always sendable; with an empty composer the button offers to
      stop a run, and otherwise it opens speech mode. */
  $: primary = (hasContent ? 'send' : active ? 'stop' : speechModeEnabled ? 'mic' : 'send') as 'send' | 'stop' | 'mic';
  $: chips = attachments.map(({file: _file, ...chip}) => chip);
  $: openModel = modelMenuItems.find((model) => modelKey(model) === openModelKey) ?? null;
  /** The selected model leads the list so the current choice is visible without
      scrolling; the rest keep their original order. */
  $: modelMenuItems = availableModels
    .filter((model) => {
      const query = modelSearch.trim().toLowerCase();
      return !query || `${model.name} ${model.provider}`.toLowerCase().includes(query);
    })
    .sort((a, b) => Number(b.selected) - Number(a.selected));
  $: applyInsertion(insertion);

  let appliedInsertionId = '';

  function applyInsertion(next: {id: string; text: string} | null): void {
    if (!next || next.id === appliedInsertionId) return;
    appliedInsertionId = next.id;
    draft = draft ? `${draft} ${next.text}` : next.text;
    editor?.setText(draft);
    onInsertionApplied();
  }

  async function primaryAction(): Promise<void> {
    if (primary === 'stop') onStop();
    else if (primary === 'mic') {
      const permission = await api.permissions.request('microphone');
      if (permission === 'granted') onVoice();
      else dictationError = translate('dictation.noPermission');
    }
    else editor?.submit();
  }

  function submit(text: string, ordered: SubmittedChip[], immediate = false): void {
    const trimmed = text.trim();
    const ids = new Set(ordered.map((chip) => chip.id));
    const files = attachments.filter((attachment) => ids.has(attachment.id)).map((attachment) => attachment.file);
    if (!trimmed && !files.length) return;
    onSend(trimmed, files.length ? files : attachments.map((attachment) => attachment.file), goalEnabled, immediate);
    goalEnabled = false;
    draft = '';
    attachments = [];
    editor?.setText('');
  }

  function removeAttachment(id: string): void {
    attachments = attachments.filter((attachment) => attachment.id !== id);
  }

  /** Levels when the model takes them, otherwise the one state it is fixed at:
      Default for an always-on reasoner, None for a model that never thinks. */
  function effortsFor(model: ModelDto): Array<{value: ReasoningEffort; label: string}> {
    return adjustable(model)
      ? reasoningEffortOptions
      : [{value: reasoning, label: model.reasoning ? $t('reasoning.default') : $t('reasoning.none')}];
  }

  /** A menu row and a submenu option are both 28px tall, and the submenu adds
      its 4px padding twice plus the Reasoning heading. */
  const MENU_ROW_HEIGHT = 28;
  const SUBMENU_CHROME = 28;

  /** How close a submenu may come to the window edge before it slides back in. */
  const SUBMENU_MARGIN = 8;

  /**
   * Opens a row's submenu and lines its top up with that row, measured against
   * the menu because the submenu hangs outside the scrolling list.
   *
   * The submenu is taller than a row, so a row low in the list would hang it
   * off the bottom of the window. Alignment is therefore kept only while it
   * fits: past that the submenu slides up to rest against the edge, the way a
   * native menu does, rather than running off the screen.
   */
  function openRow(model: ModelDto, row: HTMLElement): void {
    openModelKey = modelKey(model);
    const menu = row.closest('.model-menu');
    if (!menu) return;
    const menuTop = menu.getBoundingClientRect().top;
    const submenuHeight = SUBMENU_CHROME + effortsFor(model).length * MENU_ROW_HEIGHT;
    const lowest = window.innerHeight - SUBMENU_MARGIN - submenuHeight;
    const wanted = row.getBoundingClientRect().top - 4;
    openModelTop = Math.max(SUBMENU_MARGIN, Math.min(wanted, lowest)) - menuTop;
  }

  /** One choice settles both halves — which model runs and how hard it thinks —
      so picking a level closes the menu and its submenu together. */
  async function chooseModel(model: ModelDto, value: ReasoningEffort): Promise<void> {
    closeModelMenu();
    if (!model.selected) {
      try {
        await api.models.select(model.provider, model.id);
        availableModels = availableModels.map((item) => ({...item, selected: item === model}));
      } catch {
        // Leaving the selection where it was is the whole recovery: the model
        // list reloads the next time the menu opens.
        modelsLoaded = false;
      }
    }
    if (value !== reasoning) onReasoningChange(value);
  }

  function closeModelMenu(): void {
    modelMenuOpen = false;
    openModelKey = '';
    modelSearch = '';
  }

  async function toggleModelMenu(): Promise<void> {
    if (modelMenuOpen) {
      closeModelMenu();
      return;
    }
    modelMenuOpen = true;
    openModelKey = '';
    modelSearch = '';
    if (!modelsLoaded) {
      try {
        const [models, providers] = await Promise.all([api.models.list(), api.providers.list()]);
        const configured = new Set(providers.filter((provider) => provider.configured).map((provider) => provider.id));
        availableModels = models.filter((model) => model.custom || configured.has(model.provider));
        modelsLoaded = true;
      } catch {
        availableModels = [];
      }
    }
    // The search takes the caret so typing filters straight away.
    await Promise.resolve();
    searchField?.focus();
  }

  function dismissModelMenu(event: MouseEvent): void {
    const target = event.target as Node;
    // A control the click itself removed — the clear button going away with the
    // text it cleared — is no longer inside anything, so containment would read
    // it as an outside click and close the menu under the user.
    if (!target.isConnected) return;
    if (modelMenuOpen && !modelWrap?.contains(target)) closeModelMenu();
  }

  function modelMenuKeydown(event: KeyboardEvent): void {
    if (modelMenuOpen && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (openModelKey) openModelKey = '';
      else closeModelMenu();
    }
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

  /** Synchronous on purpose: the label and the ping settle in this tick, and
      the mic is acquired afterwards. */
  function toggleDictation(): void {
    if (dictationListening) {
      stopDictation();
      return;
    }
    dictationListening = true;
    dictationError = '';
    const next: Dictation = {
      // Dictation adds to the composer, so it starts where the caret is and
      // leaves the text on either side of it alone.
      start: editor?.caret() ?? draft.length,
      written: '',
      chunks: [],
      stream: null,
      recorder: null,
      closed: false,
      drained: false,
      pending: false,
      running: false,
      listen: null,
    };
    recording = next;
    owner = next;
    void openRecorder(next).catch(() => abandonRecorder(next, translate('dictation.startFailed')));
  }

  /** Hands the mic back and leaves the clip transcribing in the background, so
      the label returns to VOICE without waiting for whisper.cpp. */
  function stopDictation(): void {
    const session = recording;
    dictationListening = false;
    recording = null;
    if (!session) return;
    endCapture(session);
    // No recorder yet means the mic never opened, so there is nothing to flush.
    if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
    else releaseRecorder(session);
  }

  /** Unmount path: drop the clip instead of transcribing it. */
  function cancelDictation(): void {
    const session = recording;
    owner = null;
    recording = null;
    dictationListening = false;
    if (!session) return;
    endCapture(session);
    if (session.recorder) {
      session.recorder.onstop = null;
      if (session.recorder.state !== 'inactive') session.recorder.stop();
    }
    releaseRecorder(session);
  }

  /** Marks a session finished capturing: the watcher stops, and later audio and
      timers can no longer act on it. */
  function endCapture(session: Dictation): void {
    session.closed = true;
    session.listen?.();
    session.listen = null;
  }

  function releaseRecorder(session: Dictation): void {
    session.stream?.getTracks().forEach((track) => track.stop());
    session.stream = null;
    session.chunks = [];
  }

  async function openRecorder(session: Dictation): Promise<void> {
    const permission = await api.permissions.request('microphone');
    if (session.closed) return;
    if (permission !== 'granted') {
      abandonRecorder(session, translate('dictation.noPermission'));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
    } catch {
      abandonRecorder(session, translate('dictation.noMicrophone'));
      return;
    }
    session.stream = stream;
    // Stopped while the mic was being handed over: nothing was captured, so
    // drop the stream rather than record into a session nobody is watching.
    if (session.closed) {
      releaseRecorder(session);
      return;
    }
    const next = new MediaRecorder(stream);
    next.ondataavailable = (event) => {
      if (!event.data.size) return;
      session.chunks.push(event.data);
      void transcribeRecording(session);
    };
    next.onstop = () => {
      session.drained = true;
      void transcribeRecording(session);
    };
    session.recorder = next;
    // Each data slice extends the same WebM recording. Re-running local
    // Whisper over the accumulated clip lets the draft show partial results
    // without depending on a cloud streaming recogniser.
    //
    // The cadence is what dictation latency mostly is: a word spoken just after
    // a slice boundary waits this long before any pass can see it. Partials run
    // against a resident model in ~110ms, so the slice is the floor, not the
    // engine.
    next.start(SLICE_INTERVAL);
    try {
      watchForSilence(session, stream);
    } catch {
      // No level metering available: dictation still records, and the button
      // stays the way to end it.
    }
  }

  /** Stops listening once the room has been quiet for the configured window.
      Whatever was said before the silence is still transcribed, so this only
      spares the user from pressing the button again after they trail off. */
  function watchForSilence(session: Dictation, stream: MediaStream): void {
    const limit = dictationAutoStopSeconds;
    if (!limit) return;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    // Starts low so a genuinely quiet room does not have to shout to be heard,
    // and creeps up so a fan or a fridge starting mid-sentence re-baselines.
    let floor = -70;
    // Measured rather than counted in ticks: a throttled window fires the
    // interval late, and the user still expects the window they configured.
    let lastVoice = performance.now();
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const level = 20 * Math.log10(Math.sqrt(sum / samples.length) + 1e-9);
      floor = level < floor ? level : Math.min(floor + 0.15, level);
      if (level > Math.max(floor + VOICE_MARGIN, VOICE_FLOOR)) lastVoice = performance.now();
      else if (performance.now() - lastVoice >= limit * 1000 && recording === session) stopDictation();
    }, LEVEL_INTERVAL);
    session.listen = () => {
      clearInterval(timer);
      source.disconnect();
      void context.close();
    };
    void context.resume();
  }

  function abandonRecorder(session: Dictation, message: string): void {
    releaseRecorder(session);
    if (session.closed) return;
    endCapture(session);
    if (recording === session) {
      recording = null;
      dictationListening = false;
    }
    if (owner === session) dictationError = message;
  }

  async function transcribeRecording(session: Dictation): Promise<void> {
    session.pending = true;
    if (session.running) return;
    session.running = true;
    while (session.pending) {
      session.pending = false;
      const clip = new Blob(session.chunks);
      if (!clip.size) continue;
      // The recorder has flushed, so this pass is the one whose text is kept:
      // it goes through the slower, more careful decode.
      const last = session.drained;
      try {
        const text = await api.dictation.transcribe(await monoWav(clip), last);
        // A later press owns the draft, so anything still arriving from this
        // clip would overwrite what that one is writing.
        if (text && owner === session) spliceTranscript(session, text);
      } catch (error) {
        if (owner === session) dictationError = dictationFailure(error);
      }
    }
    session.running = false;
    if (session.drained) releaseRecorder(session);
  }

  /**
   * Puts this pass's text where the session started, replacing only what the
   * previous pass wrote there. Everything the user typed survives — before the
   * span, after it, or while dictation was running.
   */
  function spliceTranscript(session: Dictation, text: string): void {
    const live = draft;
    let start = session.start;
    // Typing ahead of the span shifts it; find it again rather than write over
    // the characters now sitting at the old offset.
    if (live.slice(start, start + session.written.length) !== session.written) {
      const moved = live.indexOf(session.written);
      start = session.written && moved !== -1 ? moved : live.length;
      if (start === live.length) session.written = '';
    }
    const head = live.slice(0, start);
    const tail = live.slice(start + session.written.length);
    const lead = head && !/\s$/.test(head) ? ' ' : '';
    const trail = tail && !/^\s/.test(tail) ? ' ' : '';
    session.start = start;
    session.written = `${lead}${text}${trail}`;
    draft = `${head}${session.written}${tail}`;
    // The caret belongs at the end of the dictated words, not after the text
    // that was already sitting to their right.
    editor?.setText(draft, head.length + lead.length + text.length);
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
    const message = readableError(error);
    const detail = message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    return detail || translate('dictation.stopped');
  }

  onMount(() => {
    // Fetches the speech-to-text model if setup never got to it — on a machine
    // that already has it this costs nothing, and it means the microphone is
    // ready long before anyone presses it. Failures are the download's to
    // report when dictation is actually used.
    if (speechModeEnabled) void api.dictation.prepare().catch(() => {});
    window.addEventListener('dragenter', windowDragEnter);
    window.addEventListener('dragover', windowDragOver);
    window.addEventListener('dragleave', windowDragLeave);
    window.addEventListener('drop', windowDrop);
    window.addEventListener('click', dismissModelMenu);
    window.addEventListener('keydown', modelMenuKeydown);
    return () => {
      cancelDictation();
      window.removeEventListener('dragenter', windowDragEnter);
      window.removeEventListener('dragover', windowDragOver);
      window.removeEventListener('dragleave', windowDragLeave);
      window.removeEventListener('drop', windowDrop);
      window.removeEventListener('click', dismissModelMenu);
      window.removeEventListener('keydown', modelMenuKeydown);
    };
  });
</script>

<div class:welcome={variant === 'welcome'} class:file-drag-active={fileDragActive} class="flareai-prompt">
  <input bind:this={fileInput} class="visually-hidden" name="prompt-attachments" type="file" multiple tabindex="-1" aria-hidden="true" onchange={selected}/>

  <div class:expanded class:raised={hasContent} class="flareai-prompt-shell">
    <div class="flareai-editor-slot">
      <InlineChip
        bind:this={editor}
        value={draft}
        {chips}
        placeholder={placeholder || $t('composer.placeholder')}
        onChange={(text) => draft = text}
        onSubmit={submit}
        onRemove={removeAttachment}
        onExpanded={(value) => expanded = value}
      />
    </div>
    <button
      type="button"
      data-testid="prompt-primary-button"
      class="flareai-primary"
      aria-label={primary === 'send' ? $t('composer.sendMessage') : primary === 'stop' ? $t('composer.stopAgent') : $t('composer.startSpeechMode')}
      data-tooltip-label={primary === 'send' ? (active ? $t('composer.queueHint') : $t('composer.send')) : primary === 'stop' ? $t('composer.stopAgent') : $t('composer.speechMode')}
      onclick={primaryAction}
    ><Icon name={primary === 'mic' ? 'waveform' : primary} size={primary === 'stop' ? 22 : 18}/></button>
  </div>

  <div class="flareai-prompt-toolbar">
    <button type="button" onclick={chooseFiles}><Icon name="attach" size={14}/><span>{$t('composer.attach')}</span></button>
    <button
      class="dictation-toggle"
      class:active={dictationListening}
      type="button"
      aria-pressed={dictationListening}
      onclick={toggleDictation}
    >
      <span class="dictation-mark">
        {#if dictationListening}<span class="dictation-ping" aria-hidden="true"></span>{/if}
        <Icon name="mic" size={14}/>
      </span>
      <span>{dictationListening ? $t('composer.listening') : $t('composer.voice')}</span>
    </button>
    <button
      class="goal-toggle"
      class:active={goalEnabled}
      type="button"
      aria-label={goalEnabled ? $t('composer.goalOff') : $t('composer.goalOn')}
      aria-pressed={goalEnabled}
      onclick={() => goalEnabled = !goalEnabled}
    ><Icon name="goal" size={14}/><span>{$t('composer.goal')}</span></button>
    {#if !advancedMode}
    <!-- Basic mode has no model selector, and this stands in its place: the
         one surface where what the agent can do is added to or taken away. It
         opens Settings rather than holding a menu of its own — configuring a
         plugin is a page's worth of work, not a dropdown's. -->
    <button type="button" onclick={onOpenPlugins}><Icon name="puzzle" size={14}/><span>{$t('composer.plugins')}</span></button>
    {/if}
    {#if advancedMode}
    <div bind:this={modelWrap} class="prompt-option-wrap">
      <button type="button" aria-haspopup="menu" aria-expanded={modelMenuOpen} onclick={() => void toggleModelMenu()}><Icon name="brain" size={14}/><span>{$t('composer.model')}</span></button>
      {#if modelMenuOpen && modelsLoaded}
        <div class="flareai-dropdown-menu model-menu" role="menu" aria-label={$t('composer.modelOptions')}>
          <div class="model-menu-search">
            <Icon name="search" size={13}/>
            <input
              bind:this={searchField}
              bind:value={modelSearch}
              type="text"
              placeholder={$t('composer.searchModels')}
              aria-label={$t('composer.searchModels')}
              spellcheck="false"
              autocomplete="off"
            />
            {#if modelSearch}
              <button
                type="button"
                class="model-menu-clear"
                aria-label={$t('common.clearSearch')}
                data-tooltip="none"
                onclick={() => { modelSearch = ''; searchField?.focus(); }}
              ><Icon name="close" size={12}/></button>
            {/if}
          </div>
          <div class="model-menu-list" onscroll={() => openModelKey = ''}>
            {#each modelMenuItems as model (modelKey(model))}
              <div class="model-menu-row">
                <button
                  type="button"
                  class="flareai-dropdown-item"
                  class:active={openModelKey === modelKey(model)}
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={openModelKey === modelKey(model)}
                  onmouseenter={(event) => openRow(model, event.currentTarget)}
                  onfocus={(event) => openRow(model, event.currentTarget)}
                  onclick={(event) => openRow(model, event.currentTarget)}
                >
                  <span class="model-menu-mark"><ProviderLogo provider={model.provider} size={14}/></span>
                  <span class="model-menu-name">{model.name}</span>
                  <span class="reasoning-menu-check" aria-hidden="true">
                    {#if model.selected}<Icon name="check" size={13}/>{/if}
                  </span>
                  <span class="model-menu-caret" aria-hidden="true"><Icon name="chevron" size={12}/></span>
                </button>
              </div>
            {:else}
              <p class="model-menu-empty">{$t('composer.noModels')}</p>
            {/each}
          </div>
          <!-- Outside the scroller: a submenu inside it would be clipped by the
               overflow that makes the list scrollable. -->
          {#if openModel}
            <div class="flareai-dropdown-menu model-submenu" role="menu" aria-label={$t('composer.reasoningFor', {model: openModel.name})} style:top={`${openModelTop}px`}>
              <p class="model-submenu-title">{$t('composer.reasoning')}</p>
              {#each effortsFor(openModel) as option (option.value)}
                <button
                  type="button"
                  class="flareai-dropdown-item"
                  role="menuitemradio"
                  aria-checked={openModel.selected && option.value === reasoning}
                  aria-disabled={!adjustable(openModel)}
                  onclick={() => void chooseModel(openModel, option.value)}
                >
                  <span>{option.label}</span>
                  <span class="reasoning-menu-check" aria-hidden="true">
                    {#if openModel.selected && option.value === reasoning}<Icon name="check" size={13}/>{/if}
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
    {/if}
  </div>
  {#if dictationError}<p class="dictation-error" role="alert">{dictationError}</p>{/if}
</div>
