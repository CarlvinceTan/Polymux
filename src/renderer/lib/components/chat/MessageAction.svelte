<script module lang="ts">
  export type MessageActionIcon = 'copy' | 'check' | 'edit' | 'thumb-up' | 'thumb-down';
</script>

<script lang="ts">
  export let icon: MessageActionIcon;
  export let label: string;
  export let active = false;
  export let onAction: () => void;
</script>

<span class="message-action-wrap" title={label}>
  <button
    type="button"
    class:active
    aria-label={label}
    aria-pressed={active || undefined}
    onclick={onAction}
  >
    {#if icon === 'copy'}
      <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="9" height="9" rx="2"/><path d="M13 7V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1"/></svg>
    {:else if icon === 'check'}
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10 3.5 3.5 7.5-8"/></svg>
    {:else if icon === 'edit'}
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5 3 3-8 8H4.5v-3z"/><path d="m11 6 3 3"/></svg>
    {:else if icon === 'thumb-up'}
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 8.5 10 3c1.5.5 1.6 2.2 1.1 3.7L11 7h4.1a1.7 1.7 0 0 1 1.6 2.2l-1.5 5A2.5 2.5 0 0 1 12.8 16H7z"/><path d="M4 8.5h3V16H4z"/></svg>
    {:else}
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 11.5 3 5.5c1.5-.5 1.6-2.2 1.1-3.7L11 13h4.1a1.7 1.7 0 0 0 1.6-2.2l-1.5-5A2.5 2.5 0 0 0 12.8 4H7z"/><path d="M4 4h3v7.5H4z"/></svg>
    {/if}
  </button>
</span>

<style>
  .message-action-wrap {
    position: relative;
    display: inline-flex;
  }

  button {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 6px;
    padding: 0;
    background: transparent;
    color: var(--neutral-400, #a3a3a3);
    cursor: pointer;
    transition: color 150ms ease, background-color 150ms ease;
  }

  button:hover,
  button:focus-visible,
  button.active {
    color: var(--neutral-900, #171717);
  }

  button:hover,
  button:focus-visible {
    background: rgb(229 229 229 / 60%);
    outline: none;
  }

  svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  button.active svg {
    fill: currentColor;
    fill-opacity: 0.12;
  }
</style>
