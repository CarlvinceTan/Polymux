<script lang="ts">
  import {tick} from 'svelte';

  type MenuOption = {
    value: string;
    label: string;
  };

  export let options: MenuOption[];
  export let value: string;
  export let label: string;
  export let wide = false;

  let open = false;
  let wrap: HTMLElement;
  let trigger: HTMLButtonElement;

  $: current = options.find((option) => option.value === value)?.label ?? '';

  async function toggle(): Promise<void> {
    open = !open;
    if (!open) return;

    await tick();
    wrap?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }

  function choose(next: string): void {
    value = next;
    open = false;
    trigger?.focus();
  }

  function keydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      open = false;
      trigger?.focus();
    }
  }

  function dismiss(event: MouseEvent): void {
    if (open && !wrap?.contains(event.target as Node)) open = false;
  }
</script>

<svelte:window onkeydown={keydown} onclick={dismiss}/>

<div bind:this={wrap} class="menu" class:wide>
  <button
    bind:this={trigger}
    type="button"
    class="menu-trigger"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    onclick={toggle}
  >
    <span>{current}</span>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 6 4 4 4-4"/>
    </svg>
  </button>

  {#if open}
    <div class="menu-list" role="menu" aria-label={label}>
      {#each options as option (option.value)}
        <button
          type="button"
          class="menu-item"
          role="menuitemradio"
          aria-checked={option.value === value}
          onclick={() => choose(option.value)}
        >
          <span>{option.label}</span>
          {#if option.value === value}
            <svg class="check" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m3 8 3 3 7-7"/>
            </svg>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .menu {
    position: relative;
    flex: none;
  }

  .wide .menu-trigger {
    min-width: 118px;
  }

  .menu-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    height: 30px;
    border: 1px solid var(--neutral-200, #e5e5e5);
    border-radius: 9px;
    padding: 0 10px 0 11px;
    background: #fff;
    color: var(--neutral-800, #262626);
    cursor: pointer;
    font: inherit;
    font-size: 12.5px;
  }

  .menu-trigger:hover,
  .menu-trigger[aria-expanded='true'] {
    border-color: var(--neutral-400, #a3a3a3);
    color: var(--neutral-950, #0a0a0a);
  }

  .menu-trigger > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 12px;
    height: 12px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.6;
  }

  .menu-trigger > svg {
    color: var(--neutral-500, #737373);
  }

  .menu-list {
    position: absolute;
    z-index: 93;
    top: calc(100% + 5px);
    right: 0;
    min-width: 100%;
    width: max-content;
    max-width: 220px;
    padding: 4px;
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 4px 12px rgb(0 0 0 / 6%);
    outline: 1px solid rgb(236 236 236 / 70%);
    animation: menu-in 120ms ease-out;
  }

  .menu-item {
    width: 100%;
    min-height: 28px;
    display: flex;
    align-items: center;
    gap: 7px;
    border: 0;
    border-radius: 8px;
    padding: 7px 8px;
    background: transparent;
    color: var(--neutral-700, #404040);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    line-height: 1.3;
    text-align: left;
  }

  .menu-item:hover,
  .menu-item:focus-visible {
    background: var(--neutral-50, #fafafa);
    color: var(--neutral-950, #0a0a0a);
    outline: none;
  }

  .check {
    width: 13px;
    height: 13px;
    margin-left: auto;
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }
</style>
