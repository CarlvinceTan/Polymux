<script module lang="ts">
  export type QueuedMessage = {
    id: string;
    text: string;
    files: File[];
  };
</script>

<script lang="ts">
  export let items: QueuedMessage[] = [];
  export let onSteer: (id: string) => void = () => {};
  export let onEdit: (id: string) => void = () => {};
  export let onDelete: (id: string) => void = () => {};
  export let onReorder: (sourceId: string, targetId: string) => void = () => {};

  let draggedId: string | null = null;
  let dropId: string | null = null;

  function startDrag(event: DragEvent, id: string): void {
    draggedId = id;
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function dragOver(event: DragEvent, id: string): void {
    event.preventDefault();
    dropId = id;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function drop(event: DragEvent, targetId: string): void {
    event.preventDefault();
    const sourceId = draggedId ?? event.dataTransfer?.getData('text/plain');
    if (sourceId) onReorder(sourceId, targetId);
    clearDrag();
  }

  function clearDrag(): void {
    draggedId = null;
    dropId = null;
  }
</script>

<section class="queued-messages" aria-label="Queued messages" data-visible-limit="4">
  <div class="queued-message-scroll" role="list">
    {#each items as item (item.id)}
      <div
        role="listitem"
        class:drop-target={dropId === item.id && draggedId !== item.id}
        class="queued-message-row"
        ondragover={(event) => dragOver(event, item.id)}
        ondrop={(event) => drop(event, item.id)}
      >
        <button
          class="queue-drag-handle"
          type="button"
          draggable="true"
          aria-label={`Reorder queued message: ${item.text}`}
          ondragstart={(event) => startDrag(event, item.id)}
          ondragend={clearDrag}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7" cy="6" r="1"/><circle cx="13" cy="6" r="1"/><circle cx="7" cy="10" r="1"/><circle cx="13" cy="10" r="1"/><circle cx="7" cy="14" r="1"/><circle cx="13" cy="14" r="1"/></svg>
        </button>

        <span class="queue-state" aria-hidden="true">
          <svg viewBox="0 0 20 20"><path d="M5 15 15 5m0 0H8m7 0v7"/></svg>
        </span>

        {#if item.files.length}
          <span class="queue-attachment" title={item.files[0].name}>
            {#if item.files[0].type.startsWith('image/')}
              <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m5 14 3.5-3 2.5 2 2-2 2 3"/></svg>
            {:else}
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3h5l3 3v11H6z"/><path d="M11 3v4h4"/></svg>
            {/if}
          </span>
        {/if}

        <span class="queue-copy">{item.text || 'Review attached files'}</span>

        <div class="queue-actions">
          <button class="queue-steer" type="button" onclick={() => onSteer(item.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 15 15 5m0 0H8m7 0v7"/></svg>
            <span>Steer</span>
          </button>
          <button type="button" aria-label="Edit queued message" onclick={() => onEdit(item.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5 3 3-8 8H4.5v-3z"/><path d="m11 6 3 3"/></svg>
          </button>
          <button type="button" aria-label="Delete queued message" onclick={() => onDelete(item.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10M8 6V4h4v2m-6 0 1 11h6l1-11M9 9v5m2-5v5"/></svg>
          </button>
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .queued-messages {
    width: 100%;
    margin-bottom: 8px;
    border: 1px solid var(--neutral-200, #e5e5e5);
    border-radius: 16px;
    padding: 8px;
    background: rgb(255 255 255 / 98%);
    box-shadow: 0 8px 26px rgb(26 28 28 / 9%);
    backdrop-filter: blur(14px);
  }

  .queued-message-scroll {
    max-height: 160px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--neutral-300, #d4d4d4) transparent;
  }

  .queued-message-row {
    position: relative;
    height: 40px;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 12px;
    padding: 0 8px;
    color: var(--neutral-900, #171717);
    transition: background-color 140ms ease, box-shadow 140ms ease;
  }

  .queued-message-row:hover,
  .queued-message-row:focus-within {
    background: var(--neutral-50, #fafafa);
  }

  .queued-message-row.drop-target {
    box-shadow: inset 0 2px var(--neutral-500, #737373);
  }

  .queue-drag-handle {
    position: absolute;
    z-index: 1;
    left: 8px;
    width: 18px;
    height: 28px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 7px;
    padding: 0;
    background: var(--neutral-50, #fafafa);
    color: var(--neutral-400, #a3a3a3);
    opacity: 0;
    cursor: grab;
    transition: opacity 120ms ease, color 120ms ease, background-color 120ms ease;
  }

  .queue-drag-handle:active { cursor: grabbing; }

  .queued-message-row:hover .queue-drag-handle,
  .queued-message-row:focus-within .queue-drag-handle {
    opacity: 1;
  }

  .queue-drag-handle:hover,
  .queue-drag-handle:focus-visible {
    outline: none;
    background: var(--neutral-100, #f5f5f5);
    color: var(--neutral-700, #404040);
  }

  .queue-state {
    width: 18px;
    height: 24px;
    display: grid;
    flex: none;
    place-items: center;
    color: var(--neutral-400, #a3a3a3);
    opacity: 1;
    transition: opacity 120ms ease;
  }

  .queued-message-row:hover .queue-state,
  .queued-message-row:focus-within .queue-state {
    opacity: 0;
  }

  .queue-attachment {
    width: 30px;
    height: 30px;
    display: grid;
    flex: none;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--neutral-200, #e5e5e5);
    border-radius: 7px;
    background: var(--neutral-100, #f5f5f5);
    color: var(--neutral-600, #525252);
  }

  .queue-copy {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    line-height: 1.35;
  }

  .queue-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    color: var(--neutral-500, #737373);
  }

  .queue-actions button {
    height: 28px;
    min-width: 28px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 8px;
    padding: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .queue-actions button:hover,
  .queue-actions button:focus-visible {
    outline: none;
    background: var(--neutral-100, #f5f5f5);
    color: var(--neutral-900, #171717);
  }

  .queue-actions .queue-steer {
    display: inline-flex;
    gap: 5px;
    padding: 0 8px;
    font-size: 12px;
  }

  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .queue-drag-handle svg circle {
    fill: currentColor;
    stroke: none;
  }

  @media (hover: none) {
    .queue-drag-handle { display: none; }
    .queue-state { opacity: 1 !important; }
  }
</style>
