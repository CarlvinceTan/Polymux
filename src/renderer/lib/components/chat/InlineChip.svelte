<script module lang="ts">
  export type ChipStatus = 'pending' | 'uploading' | 'done' | 'error';

  export type InlineChipItem = {
    id: string;
    localId: string;
    name: string;
    status?: ChipStatus;
    progress?: number;
  };

  export type SubmittedChip = {
    id: string;
    name: string;
    position: number;
  };
</script>

<script lang="ts">
  import {afterUpdate, onMount} from 'svelte';

  export let value = '';
  export let chips: InlineChipItem[] = [];
  export let placeholder = '';
  export let ariaLabel = 'Message Midas';
  export let disabled = false;
  export let maxLines = 4;
  export let onChange: (text: string) => void = () => {};
  export let onSubmit: (text: string, chips: SubmittedChip[]) => void = () => {};
  export let onRemove: (id: string) => void = () => {};
  export let onExpanded: (expanded: boolean) => void = () => {};

  let editor: HTMLDivElement;
  let savedRange: Range | null = null;
  let suppressInput = false;
  let lastEmittedText = value;
  let isEmpty = value.length === 0 && chips.length === 0;
  let expanded = false;
  let mounted = false;

  function escapeSelector(text: string): string {
    return globalThis.CSS?.escape ? globalThis.CSS.escape(text) : text.replace(/["\\]/g, '\\$&');
  }

  function walkEditor(onText: (text: string) => void, onChip: (element: HTMLElement) => void): void {
    if (!editor) return;

    function walk(node: Node): void {
      if (node.nodeType === Node.TEXT_NODE) {
        onText(node.textContent ?? '');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const element = node as HTMLElement;
      if (element.hasAttribute('data-chip')) {
        onChip(element);
        return;
      }
      if (element.tagName === 'BR') {
        onText('\n');
        return;
      }

      const block = element.tagName === 'DIV' || element.tagName === 'P';
      for (const child of element.childNodes) walk(child);
      if (block) onText('\n');
    }

    for (const child of editor.childNodes) walk(child);
  }

  function getText(): string {
    let text = '';
    walkEditor((part) => text += part, () => {});
    return text.endsWith('\n') ? text.slice(0, -1) : text;
  }

  function serialize(): {text: string; chips: SubmittedChip[]} {
    let text = '';
    const ordered: SubmittedChip[] = [];

    walkEditor(
      (part) => text += part,
      (element) => {
        const id = element.dataset.id ?? '';
        const name = element.dataset.name ?? '';
        if (id && element.dataset.status === 'done') {
          ordered.push({id, name, position: text.length});
        }
      },
    );

    if (text.endsWith('\n')) text = text.slice(0, -1);
    return {text, chips: ordered};
  }

  function syncEmpty(): void {
    isEmpty = !editor?.querySelector('[data-chip]') && getText().length === 0;
  }

  function updateExpanded(): void {
    if (!editor) return;
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 20;
    const next = editor.scrollHeight > lineHeight + 2;
    if (next !== expanded) {
      expanded = next;
      onExpanded(next);
    }
  }

  function rememberSelection(): void {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor?.contains(range.startContainer)) savedRange = range.cloneRange();
  }

  function placeCursorAtEnd(): void {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedRange = range.cloneRange();
  }

  function paintChip(element: HTMLElement, chip: InlineChipItem): void {
    const status = chip.status ?? 'done';
    element.dataset.id = chip.id;
    element.dataset.localId = chip.localId;
    element.dataset.name = chip.name;
    element.dataset.status = status;
    element.dataset.progress = String(chip.progress ?? 0);
    element.className = `inline-chip status-${status}`;
    element.replaceChildren();

    const name = document.createElement('span');
    name.className = 'inline-chip-name';
    name.textContent = chip.name;
    element.appendChild(name);

    if (status === 'uploading') {
      const progress = document.createElement('span');
      progress.className = 'inline-chip-progress';
      progress.textContent = `${Math.round(chip.progress ?? 0)}%`;
      element.appendChild(progress);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'inline-chip-remove';
    remove.setAttribute('aria-label', `Remove ${chip.name}`);
    remove.textContent = '×';
    remove.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      onRemove(chip.id);
    };
    element.appendChild(remove);
  }

  function createChip(chip: InlineChipItem): HTMLElement {
    const element = document.createElement('span');
    element.dataset.chip = '';
    element.contentEditable = 'false';
    paintChip(element, chip);
    return element;
  }

  function insertChip(chip: HTMLElement): void {
    const selection = window.getSelection();
    if (savedRange && editor.contains(savedRange.startContainer)) {
      savedRange.deleteContents();
      savedRange.insertNode(chip);
      const after = document.createRange();
      after.setStartAfter(chip);
      after.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(after);
      savedRange = after.cloneRange();
    } else {
      editor.appendChild(chip);
      placeCursorAtEnd();
    }
  }

  function reconcileChips(): void {
    if (!editor || !mounted) return;
    const wanted = new Map(chips.map((chip) => [chip.localId, chip]));

    for (const element of editor.querySelectorAll<HTMLElement>('[data-chip]')) {
      const chip = wanted.get(element.dataset.localId ?? '');
      if (chip) paintChip(element, chip);
      else element.remove();
    }

    for (const chip of chips) {
      if (!editor.querySelector(`[data-chip][data-local-id="${escapeSelector(chip.localId)}"]`)) {
        insertChip(createChip(chip));
      }
    }

    syncEmpty();
    updateExpanded();
  }

  function input(): void {
    if (suppressInput) return;
    const text = getText();
    if (text !== lastEmittedText) {
      lastEmittedText = text;
      onChange(text);
    }

    const present = new Set(
      Array.from(editor.querySelectorAll<HTMLElement>('[data-chip]')).map((chip) => chip.dataset.localId),
    );
    for (const chip of chips) if (!present.has(chip.localId)) onRemove(chip.id);
    syncEmpty();
    updateExpanded();
    editor.scrollTop = editor.scrollHeight;
  }

  function keydown(event: KeyboardEvent): void {
    if (!disabled && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function paste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    event.preventDefault();

    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
    input();
  }

  export function clear(): void {
    if (!editor) return;
    suppressInput = true;
    editor.replaceChildren();
    suppressInput = false;
    lastEmittedText = '';
    savedRange = null;
    onChange('');
    syncEmpty();
    updateExpanded();
  }

  export function setText(text: string): void {
    suppressInput = true;
    editor.replaceChildren();
    if (text) editor.appendChild(document.createTextNode(text));
    suppressInput = false;
    lastEmittedText = text;
    savedRange = null;
    onChange(text);
    reconcileChips();
    editor.focus();
    placeCursorAtEnd();
    syncEmpty();
    updateExpanded();
    editor.scrollTop = editor.scrollHeight;
  }

  export function submit(): void {
    const result = serialize();
    onSubmit(result.text, result.chips);
  }

  onMount(() => {
    if (value) editor.appendChild(document.createTextNode(value));
    lastEmittedText = value;
    mounted = true;
    reconcileChips();
    syncEmpty();
    updateExpanded();
  });

  afterUpdate(reconcileChips);
</script>

<div class="inline-editor-wrap">
  <div
    bind:this={editor}
    class:disabled
    class="inline-chip-editor"
    style:max-height={`calc(${maxLines} * 1.5em)`}
    contenteditable={!disabled}
    tabindex={disabled ? -1 : 0}
    role="textbox"
    aria-label={ariaLabel}
    aria-multiline="true"
    aria-disabled={disabled || undefined}
    data-empty={isEmpty || undefined}
    data-placeholder={placeholder}
    oninput={input}
    onkeydown={keydown}
    onpaste={paste}
    onfocus={rememberSelection}
    onblur={rememberSelection}
  ></div>
</div>

<style>
  .inline-editor-wrap { width: 100%; min-width: 0; }

  .inline-chip-editor {
    width: 100%;
    overflow-y: auto;
    background: transparent;
    color: var(--on-surface, #171717);
    font-size: 14px;
    line-height: 1.5;
    word-break: break-word;
    white-space: pre-wrap;
    scrollbar-width: none;
  }

  .inline-chip-editor::-webkit-scrollbar { display: none; }
  .inline-chip-editor:focus { outline: none; }
  .inline-chip-editor.disabled { pointer-events: none; cursor: not-allowed; opacity: 0.5; }

  .inline-chip-editor[data-empty]:not(:focus)::before {
    content: attr(data-placeholder);
    color: var(--secondary, #a3a3a3);
    pointer-events: none;
  }

  :global(.inline-chip) {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 220px;
    min-height: 24px;
    vertical-align: top;
    user-select: none;
    margin-inline: 2px;
    border: 1px solid var(--neutral-200, #e5e5e5);
    border-radius: 7px;
    padding: 1px 3px 1px 7px;
    background: var(--neutral-50, #fafafa);
    color: var(--neutral-700, #404040);
    font-size: 12px;
    line-height: 20px;
  }

  :global(.inline-chip-name) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.inline-chip-progress) { color: var(--neutral-500, #737373); font-size: 10px; }
  :global(.inline-chip.status-error) { border-color: #efb2aa; color: #a5301f; }

  :global(.inline-chip-remove) {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 5px;
    padding: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: 15px;
    line-height: 1;
  }

  :global(.inline-chip-remove:hover) { background: var(--neutral-200, #e5e5e5); }
</style>
