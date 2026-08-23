<script module lang="ts">
  import type {TaskCardDto, TaskCardStatus} from '@polymux/protocol';

  export type TaskCard = TaskCardDto;

  export function unreadTasksCount(items: TaskCard[]): number {
    return items.filter((c) => c.status === 'done' && !c.reviewed).length;
  }
</script>

<script lang="ts">
  import Icon from '../../shared/components/Icon.svelte';
  import TaskGlyph from '../../shared/components/TaskGlyph.svelte';
  import ScheduleView, {describeFrequency, formatScheduleTime, type ScheduleFrequency, type ScheduleItem, type ScheduleRun} from './ScheduleView.svelte';
  import {t, type MessageKey} from '../../../i18n';

  interface Props {
    items?: TaskCard[];
    error?: string;
    onDismissError?: () => void;
    onCreateCard?: (title: string, detail?: string) => void;
    onUpdateCard?: (id: string, patch: Partial<TaskCard>) => void;
    onDeleteCard?: (id: string) => void;
    onMarkRead?: (id: string) => void;
    onRecycleCard?: (id: string) => void;
    schedules?: ScheduleItem[];
    scheduleError?: string;
    onDismissScheduleError?: () => void;
    onOpenScheduleRun?: (item: ScheduleItem, run?: ScheduleRun) => void;
    onMarkScheduleRead?: (item: ScheduleItem) => void;
    onToggleSchedule?: (item: ScheduleItem) => void;
    onSaveSchedule?: (input: {title: string; prompt: string; frequency: ScheduleFrequency}, id: string | null) => void;
    onDeleteSchedule?: (item: ScheduleItem) => void;
    onRunSchedule?: (item: ScheduleItem) => void;
  }

  let {
    items = [],
    error = '',
    onDismissError = () => {},
    onCreateCard = () => {},
    onUpdateCard = () => {},
    onDeleteCard = () => {},
    onMarkRead = () => {},
    onRecycleCard = () => {},
    schedules = [],
    scheduleError = '',
    onDismissScheduleError = () => {},
    onOpenScheduleRun = () => {},
    onMarkScheduleRead = () => {},
    onToggleSchedule = () => {},
    onSaveSchedule = () => {},
    onDeleteSchedule = () => {},
    onRunSchedule = () => {},
  }: Props = $props();

  let composerValue = $state('');
  let composerOpen = $state(false);
  let composerDetail = $state('');
  let composerRecurring = $state(false);
  let scheduleEditor = $state<ScheduleItem | 'new' | null>(null);
  let draggedId = $state<string | null>(null);
  let dragOverColumn = $state<TaskCardStatus | null>(null);

  type Column = {key: TaskCardStatus; label: MessageKey};
  const columns: Column[] = [
    {key: 'todo', label: 'tasks.todo'},
    {key: 'in_progress', label: 'tasks.inProgress'},
    {key: 'done', label: 'tasks.done'},
  ];

  const cardsByColumn = (status: TaskCardStatus) =>
    items.filter((c) => c.status === status).sort((a, b) => a.order - b.order);

  const schedulesByColumn = (status: TaskCardStatus) => schedules.filter((item) => {
    if (item.status === 'running') return status === 'in_progress';
    if (item.frequency.kind === 'once' && item.status === 'done') return status === 'done';
    return status === 'todo';
  });

  function submitCard(): void {
    const title = composerValue.trim();
    if (!title) return;
    if (composerRecurring) {
      scheduleEditor = 'new';
      return;
    }
    onCreateCard(title, composerDetail.trim() || undefined);
    composerValue = '';
    composerDetail = '';
    composerOpen = false;
  }

  function composerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitCard();
    } else if (event.key === 'Escape') {
      composerOpen = false;
      composerValue = '';
    }
  }

  function dragStart(event: DragEvent, id: string): void {
    draggedId = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  }

  function dragOver(event: DragEvent, column: TaskCardStatus): void {
    event.preventDefault();
    dragOverColumn = column;
  }

  function dragLeave(): void {
    dragOverColumn = null;
  }

  function drop(event: DragEvent, column: TaskCardStatus): void {
    event.preventDefault();
    dragOverColumn = null;
    if (!draggedId) return;
    const card = items.find((c) => c.id === draggedId);
    if (card && card.status !== column) {
      onUpdateCard(draggedId, {status: column, owner: undefined, reviewed: column === 'done' ? false : card.reviewed});
    }
    draggedId = null;
  }

  function dragEnd(): void {
    draggedId = null;
    dragOverColumn = null;
  }

  let contextMenuCard = $state<TaskCard | null>(null);
  let contextMenuPos = $state({x: 0, y: 0});

  function openContextMenu(event: MouseEvent, card: TaskCard): void {
    event.preventDefault();
    contextMenuCard = card;
    contextMenuPos = {x: event.clientX, y: event.clientY};
  }

  function closeContextMenu(): void {
    contextMenuCard = null;
  }
</script>

<svelte:window onclick={closeContextMenu}/>

{#if scheduleEditor}
  <ScheduleView
    items={schedules}
    error={scheduleError}
    onDismissError={onDismissScheduleError}
    onOpenItem={onOpenScheduleRun}
    onMarkRead={onMarkScheduleRead}
    onToggleItem={onToggleSchedule}
    onSave={onSaveSchedule}
    onDeleteItem={onDeleteSchedule}
    onRunItem={onRunSchedule}
    composeOnMount
    composerItem={scheduleEditor === 'new' ? undefined : scheduleEditor}
    composerSeed={scheduleEditor === 'new' ? {title: composerValue, prompt: composerDetail} : undefined}
    onComposerClose={() => { scheduleEditor = null; composerOpen = false; composerValue = ''; composerDetail = ''; composerRecurring = false; }}
  />
{:else}
<div class="tasks-view">
  {#if error}
    <div class="tasks-error" role="alert">
      <span>{error}</span>
      <button type="button" onclick={onDismissError}><Icon name="close" size={14}/></button>
    </div>
  {/if}

  <div class="tasks-toolbar">
    <h2 class="tasks-title">{$t('workspace.tasks')}</h2>
    <button type="button" class="tasks-add-btn" aria-label={$t('tasks.addTask')} onclick={() => composerOpen = !composerOpen}>
      <Icon name="plus" size={16}/>
    </button>
  </div>

  {#if composerOpen}
    <div class="tasks-composer">
      <input
        type="text"
        class="tasks-composer-input"
        placeholder={$t('tasks.addTask')}
        bind:value={composerValue}
        onkeydown={composerKeydown}
      />
      <input
        type="text"
        class="tasks-composer-input"
        placeholder={$t('schedule.instruction')}
        bind:value={composerDetail}
        onkeydown={composerKeydown}
      />
      <label class="tasks-recurring-toggle">
        <input type="checkbox" bind:checked={composerRecurring}/>
        <Icon name="clock" size={14}/>
        <span>{$t('schedule.frequency')}</span>
      </label>
      <button type="button" class="tasks-composer-submit" disabled={!composerValue.trim()} onclick={submitCard}>
        <Icon name="plus" size={14}/>
      </button>
    </div>
  {/if}

  <div class="tasks-columns">
    {#each columns as col (col.key)}
      {@const cards = cardsByColumn(col.key)}
      {@const scheduled = schedulesByColumn(col.key)}
      <div
        class="tasks-column"
        class:drag-over={dragOverColumn === col.key}
        role="list"
        aria-label={$t(col.label)}
        ondragover={(e) => dragOver(e, col.key)}
        ondragleave={dragLeave}
        ondrop={(e) => drop(e, col.key)}
      >
        <div class="tasks-column-header">
          <span class="tasks-column-title">{$t(col.label)}</span>
          <span class="tasks-column-count">{cards.length + scheduled.length}</span>
        </div>
        <div class="tasks-column-cards">
          {#each cards as card (card.id)}
            <div
              class="tasks-card"
              class:dragging={draggedId === card.id}
              draggable="true"
              role="listitem"
              ondragstart={(e) => dragStart(e, card.id)}
              ondragend={dragEnd}
              oncontextmenu={(e) => openContextMenu(e, card)}
            >
              <div class="tasks-card-content">
                {#if card.status === 'in_progress'}
                  <TaskGlyph id={card.id} status="active" label={card.owner ?? ''}/>
                {/if}
                <span class="tasks-card-title">{card.title}</span>
                {#if card.status === 'done' && !card.reviewed}
                  <span class="tasks-unread" aria-label={$t('tasks.unread')}></span>
                {/if}
              </div>
              {#if card.detail}
                <p class="tasks-card-detail">{card.detail}</p>
              {/if}
            </div>
          {/each}
          {#each scheduled as item (`schedule-${item.id}`)}
            <button type="button" class="tasks-card tasks-schedule-card" onclick={() => scheduleEditor = item}>
              <div class="tasks-card-content">
                <Icon name="clock" size={14}/>
                <span class="tasks-card-title">{item.title}</span>
                {#if item.unread}<span class="tasks-unread" aria-label={$t('schedule.unread')}></span>{/if}
              </div>
              <p class="tasks-card-detail">{describeFrequency(item.frequency)}</p>
              {#if item.nextRunAt !== undefined}
                <p class="tasks-card-next">{$t('schedule.columnNextRun')}: {formatScheduleTime(item.nextRunAt)}</p>
              {/if}
            </button>
          {/each}
          {#if cards.length === 0 && scheduled.length === 0}
            <p class="tasks-column-empty">{$t('tasks.empty')}</p>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  {#if contextMenuCard}
    {@const card = contextMenuCard}
    <div class="polymux-dropdown-menu tasks-context-menu" role="menu" style="left: {contextMenuPos.x}px; top: {contextMenuPos.y}px;">
      {#if card.status === 'done' && !card.reviewed}
        <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => { onMarkRead(card.id); closeContextMenu(); }}>
          <Icon name="check" size={14}/><span>{$t('tasks.markReviewed')}</span>
        </button>
      {/if}
      {#if card.status === 'done'}
        <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => { onRecycleCard(card.id); closeContextMenu(); }}>
          <Icon name="reload" size={14}/><span>{$t('tasks.recycleCard')}</span>
        </button>
      {/if}
      <button type="button" class="polymux-dropdown-item destructive" role="menuitem" onclick={() => { onDeleteCard(card.id); closeContextMenu(); }}>
        <Icon name="trash" size={14}/><span>{$t('tasks.deleteCard')}</span>
      </button>
    </div>
  {/if}
</div>
{/if}
