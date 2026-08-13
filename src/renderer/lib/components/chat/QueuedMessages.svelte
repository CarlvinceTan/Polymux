<script module lang="ts">
  export type QueuedMessage = {
    id: string;
    text: string;
    files?: Array<{name: string; type: string}>;
  };
</script>

<script lang="ts">
  import Icon from '../shared/Icon.svelte';

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
          data-tooltip="none"
          ondragstart={(event) => startDrag(event, item.id)}
          ondragend={() => { draggedId = null; dropId = null; }}
        ><Icon name="grip" size={16}/></button>
        <span class="queue-state" aria-hidden="true"><Icon name="steer" size={17}/></span>
        {#if item.files?.length}
          <span class="queue-attachment" title={item.files[0].name}><Icon name={item.files[0].type.startsWith('image/') ? 'image' : 'file'} size={14}/></span>
        {/if}
        <span class="queue-copy">{item.text || 'Review attached files'}</span>
        <div class="queue-actions">
          <button class="queue-steer" type="button" onclick={() => onSteer(item.id)}><Icon name="steer" size={16}/><span>Steer</span></button>
          <button type="button" aria-label="Edit queued message" onclick={() => onEdit(item.id)}><Icon name="edit" size={16}/></button>
          <button type="button" aria-label="Delete queued message" onclick={() => onDelete(item.id)}><Icon name="trash" size={16}/></button>
        </div>
      </div>
    {/each}
  </div>
</section>
