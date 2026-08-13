<script lang="ts">
  import InlineChip, {
    type InlineChipItem,
    type SubmittedChip,
  } from './InlineChip.svelte';

  type PromptAttachment = InlineChipItem & {
    file: File;
  };

  export let active = false;
  export let placeholder = 'Ask anything';
  export let variant: 'default' | 'welcome' = 'default';
  export let onSend: (text: string, files: File[]) => void;
  export let onStop: () => void = () => {};
  export let onVoice: () => void = () => {};
  export let onOptions: () => void = () => {};

  let draft = '';
  let attachments: PromptAttachment[] = [];
  let editor: InlineChip;
  let fileInput: HTMLInputElement;
  let expanded = false;
  let fileDragActive = false;

  $: hasContent = draft.trim().length > 0 || attachments.length > 0;

  function removeAttachment(id: string): void {
    attachments = attachments.filter((attachment) => attachment.id !== id);
  }

  function submit(text: string, ordered: SubmittedChip[]): void {
    if (!text.trim() && !ordered.length) return;

    const byId = new Map(attachments.map((attachment) => [attachment.id, attachment.file]));
    const files = ordered
      .map((attachment) => byId.get(attachment.id))
      .filter((file): file is File => Boolean(file));

    onSend(text.trim(), files);
    draft = '';
    attachments = [];
    editor.clear();
  }

  function primaryAction(): void {
    if (active) onStop();
    else if (hasContent) editor.submit();
  }

  export function prefill(text: string, files: File[] = []): void {
    attachments = files.map((file) => {
      const id = crypto.randomUUID();
      return {
        id,
        localId: id,
        name: file.name,
        status: 'done' as const,
        progress: 100,
        file,
      };
    });
    draft = text;
    editor.setText(text);
  }

  function chooseFiles(): void {
    fileInput.click();
  }

  function addFiles(files: Iterable<File>): void {
    const next = Array.from(files).map((file) => {
      const id = crypto.randomUUID();
      return {
        id,
        localId: id,
        name: file.name,
        status: 'done' as const,
        progress: 100,
        file,
      };
    });
    if (next.length) attachments = [...attachments, ...next];
  }

  function selected(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    addFiles(input.files ?? []);
    input.value = '';
  }

  function isFileDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files')
      || Boolean(event.dataTransfer?.files.length);
  }

  function dragEnter(event: DragEvent): void {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    fileDragActive = true;
  }

  function dragOver(event: DragEvent): void {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    fileDragActive = true;
  }

  function dragLeave(event: DragEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as HTMLElement).contains(next)) fileDragActive = false;
  }

  function drop(event: DragEvent): void {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    fileDragActive = false;
    addFiles(event.dataTransfer?.files ?? []);
  }
</script>

<div
  class:welcome={variant === 'welcome'}
  class:file-drag-active={fileDragActive}
  class="prompt-input"
  role="group"
  aria-label="Message composer"
  ondragenter={dragEnter}
  ondragover={dragOver}
  ondragleave={dragLeave}
  ondrop={drop}
>
  <input
    bind:this={fileInput}
    class="visually-hidden"
    name="prompt-attachments"
    type="file"
    multiple
    tabindex="-1"
    aria-hidden="true"
    onchange={selected}
  />

  <div class:expanded class:raised={hasContent} class="prompt-shell">
    <div class="editor-slot">
      <InlineChip
        bind:this={editor}
        value={draft}
        chips={attachments}
        {placeholder}
        disabled={active}
        onChange={(text) => draft = text}
        onSubmit={submit}
        onRemove={removeAttachment}
        onExpanded={(value) => expanded = value}
      />
    </div>

    <button
      type="button"
      class="primary"
      aria-label={active ? 'Stop response' : 'Send message'}
      disabled={!active && !hasContent}
      onclick={primaryAction}
    >
      {#if active}
        <span class="stop-icon"></span>
      {:else}
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 15V5m0 0L6 9m4-4 4 4"/>
        </svg>
      {/if}
    </button>
  </div>

  <div class="prompt-toolbar">
    <button type="button" onclick={chooseFiles}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="m7.5 10.5 4.8-4.8a2.1 2.1 0 0 1 3 3l-6.4 6.4a3.5 3.5 0 0 1-5-5l6.2-6.2"/>
      </svg>
      <span>ATTACH</span>
    </button>
    <button type="button" onclick={onVoice}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="7" y="3" width="6" height="10" rx="3"/>
        <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2m-3 0h6"/>
      </svg>
      <span>VOICE</span>
    </button>
    <button type="button" onclick={onOptions}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 6h8m3 0h1M4 14h1m3 0h8M12 4v4M5 12v4"/>
      </svg>
      <span>OPTIONS</span>
    </button>
  </div>
</div>

<style>
  .prompt-input {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    padding-top: 6px;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .prompt-shell {
    position: relative;
    width: 100%;
    min-height: 52px;
    display: flex;
    align-items: center;
    border-radius: 16px;
    padding: 8px;
    background: #e8e8e8;
    transition: background-color 150ms ease, box-shadow 150ms ease;
  }

  .welcome .prompt-shell {
    min-height: 60px;
    border-radius: 18px;
    padding: 12px;
  }

  .prompt-shell.expanded { align-items: flex-start; }

  .prompt-shell:focus-within,
  .prompt-shell.raised {
    background: var(--neutral-50, #fafafa);
    outline: 1px solid rgb(217 217 217 / 80%);
    box-shadow: 0 0 0 1px rgb(236 236 236 / 90%);
  }

  .file-drag-active .prompt-shell {
    background: var(--neutral-50, #fafafa);
    outline: 1px solid var(--neutral-400, #a3a3a3);
    box-shadow: 0 0 0 3px rgb(10 10 10 / 6%);
  }

  .editor-slot {
    min-width: 0;
    flex: 1;
    padding-right: 49px;
    padding-left: 8px;
  }

  .welcome .editor-slot { padding-left: 8px; }

  .primary {
    position: absolute;
    top: 50%;
    right: 8px;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 8px;
    padding: 0;
    background: var(--neutral-950, #0a0a0a);
    color: #fff;
    transform: translateY(-50%);
    cursor: pointer;
    transition: opacity 150ms ease;
  }

  .welcome .primary { right: 12px; }
  .prompt-shell.expanded .primary { top: auto; bottom: 8px; transform: none; }
  .welcome .prompt-shell.expanded .primary { bottom: 12px; }
  .primary:hover { opacity: 0.9; }

  .primary:disabled {
    opacity: 0.25;
    cursor: default;
  }

  .primary svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .stop-icon {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    background: currentColor;
  }

  .prompt-toolbar {
    width: 100%;
    display: flex;
    justify-content: center;
    gap: 32px;
    color: var(--neutral-500, #737373);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    line-height: 1.25;
  }

  .prompt-toolbar button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 0;
    padding: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
  }

  .prompt-toolbar button:hover { color: var(--neutral-900, #171717); }

  .prompt-toolbar svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  @media (max-width: 640px) {
    .editor-slot { padding-left: 4px; }
  }
</style>
