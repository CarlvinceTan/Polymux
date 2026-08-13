<script module lang="ts">
  export type SummaryViewSection = 'outputs' | 'references' | 'tasks';
  export type SummaryOutput = {id: string; name: string};
  export type SummaryReference = {id: string; title: string; kind?: 'web' | 'file' | 'other'};
  export type SummaryTask = {id: string; title: string; status: 'pending' | 'active' | 'completed' | 'failed'};

  export type SummaryViewData = {
    outputs: SummaryOutput[];
    references: SummaryReference[];
    tasks: SummaryTask[];
  };
</script>

<script lang="ts">
  export let section: SummaryViewSection;
  export let data: SummaryViewData;
  export let onOpenOutput: (output: SummaryOutput) => void = () => {};
  export let onOpenReference: (reference: SummaryReference) => void = () => {};

  $: title = section[0].toUpperCase() + section.slice(1);
</script>

<div class="summary-view">
  <header><h1>{title}</h1></header>

  <div class="summary-rows">
    {#if section === 'outputs'}
      {#each data.outputs as output (output.id)}
        <button class="summary-row" type="button" onclick={() => onOpenOutput(output)}>
          <span class="row-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20"><path d="M6 3h5l3 3v11H6z"/><path d="M11 3v4h4"/></svg>
          </span>
          <span>{output.name}</span>
        </button>
      {:else}
        <p class="empty">No outputs yet.</p>
      {/each}
    {:else if section === 'references'}
      {#each data.references as reference (reference.id)}
        <button class="summary-row" type="button" onclick={() => onOpenReference(reference)}>
          <span class="row-icon" aria-hidden="true">
            {#if reference.kind === 'web'}
              <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3a11 11 0 0 1 0 14M10 3a11 11 0 0 0 0 14"/></svg>
            {:else}
              <svg viewBox="0 0 20 20"><path d="M6 3h5l3 3v11H6z"/><path d="M11 3v4h4"/></svg>
            {/if}
          </span>
          <span>{reference.title}</span>
        </button>
      {:else}
        <p class="empty">No references yet.</p>
      {/each}
    {:else}
      {#each data.tasks as task (task.id)}
        <div class="summary-row task">
          <span class={`status-dot ${task.status}`} title={task.status}></span>
          <strong>{task.title}</strong>
        </div>
      {:else}
        <p class="empty">No tasks yet.</p>
      {/each}
    {/if}
  </div>
</div>

<style>
  .summary-view {
    height: 100%;
    overflow: auto;
    padding: 28px 30px 40px;
    background: var(--main-panel-background, #fff);
  }

  header {
    max-width: 760px;
    margin: 0 auto 18px;
    border-bottom: 1px solid var(--neutral-200, #e5e5e5);
    padding-bottom: 14px;
  }

  h1 {
    margin: 0;
    color: var(--neutral-950, #0a0a0a);
    font-size: 20px;
    font-weight: 560;
  }

  .summary-rows {
    max-width: 760px;
    margin: 0 auto;
  }

  .summary-row {
    width: 100%;
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 12px;
    border: 0;
    border-bottom: 1px solid var(--neutral-100, #f5f5f5);
    border-radius: 16px;
    padding: 9px 10px;
    background: transparent;
    color: var(--neutral-900, #171717);
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    text-align: left;
  }

  button.summary-row:hover,
  button.summary-row:focus-visible {
    outline: none;
    background: var(--neutral-50, #fafafa);
  }

  .summary-row > span:last-child,
  .summary-row strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-icon {
    width: 30px;
    height: 30px;
    display: grid;
    flex: none;
    place-items: center;
    border-radius: 8px;
    background: var(--neutral-100, #f5f5f5);
    color: var(--neutral-500, #737373);
  }

  svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.4;
  }

  .summary-row.task {
    cursor: default;
  }

  .summary-row.task strong {
    font-size: 14px;
    font-weight: 520;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
    background: var(--neutral-400, #a3a3a3);
  }

  .status-dot.active {
    background: #d9a406;
    box-shadow: 0 0 0 3px rgb(217 164 6 / 18%);
    animation: task-pulse 1.4s ease-in-out infinite;
  }

  .status-dot.completed {
    background: #1f7a4d;
    box-shadow: 0 0 0 3px rgb(31 122 77 / 16%);
  }

  .status-dot.failed {
    background: #a92914;
    box-shadow: 0 0 0 3px rgb(169 41 20 / 16%);
  }

  .empty {
    margin: 40px 10px;
    color: var(--neutral-500, #737373);
    font-size: 13px;
    text-align: center;
  }

  @keyframes task-pulse {
    50% { opacity: 0.55; }
  }

  @media (max-width: 640px) {
    .summary-view { padding: 22px 18px 32px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .status-dot.active { animation: none; }
  }
</style>
