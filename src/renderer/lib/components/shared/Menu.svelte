<script module lang="ts">
  export type MenuOption = {value: string; label: string};
</script>

<script lang="ts">
  import {tick} from 'svelte';
  import Icon from './Icon.svelte';

  /**
   * A choice, in the app's own dropdown rather than the platform's.
   *
   * A native `<select>` renders with the operating system's own chevron and
   * inset, which sits tight against the edge and matches nothing else here.
   * This is the same `polymux-dropdown-menu` shell every other menu uses.
   */
  export let options: MenuOption[] = [];
  export let value: string;
  export let label: string;
  export let onChange: (value: string) => void = () => {};
  /** Widens the trigger where the values are long. */
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
    onChange(next);
    open = false;
    trigger?.focus();
  }

  function keydown(event: KeyboardEvent): void {
    // The menu is the innermost thing open, so it takes the Escape rather than
    // letting the surface underneath close.
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    }
  }

  function dismiss(event: MouseEvent): void {
    if (open && !wrap?.contains(event.target as Node)) open = false;
  }
</script>

<svelte:window onkeydown={keydown} onclick={dismiss}/>

<div bind:this={wrap} class:wide class="select-menu">
  <button
    bind:this={trigger}
    type="button"
    class="select-menu-trigger"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    onclick={toggle}
  >
    <span>{current}</span><Icon name="chevron" size={11}/>
  </button>
  {#if open}
    <div class="polymux-dropdown-menu select-menu-list" role="menu" aria-label={label}>
      {#each options as option (option.value)}
        <button
          type="button"
          class="polymux-dropdown-item"
          role="menuitemradio"
          aria-checked={option.value === value}
          onclick={() => choose(option.value)}
        >
          <span>{option.label}</span>
          {#if option.value === value}<Icon name="check" size={13}/>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
