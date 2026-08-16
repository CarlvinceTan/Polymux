<script module lang="ts">
  /** `icon` is optional per option; a list that sets it on none looks exactly
   * as it did before. The glyph name is reached for inline because the
   * instance script below imports `Icon` as a value under the same name. */
  export type MenuOption = {
    value: string;
    label: string;
    icon?: import('svelte').ComponentProps<import('./Icon.svelte').default>['name'];
  };
</script>

<script lang="ts">
  import {tick, type ComponentProps} from 'svelte';
  import Icon from './Icon.svelte';

  /**
   * A choice, in the app's own dropdown rather than the platform's.
   *
   * A native `<select>` renders with the operating system's own chevron and
   * inset, which sits tight against the edge and matches nothing else here.
   * This is the same `flareai-dropdown-menu` shell every other menu uses.
   */
  export let options: MenuOption[] = [];
  export let value: string;
  export let label: string;
  export let onChange: (value: string) => void = () => {};
  /** Widens the trigger where the values are long. */
  export let wide = false;
  /** A glyph before the label, for a trigger that names a place. */
  export let icon: ComponentProps<Icon>['name'] | null = null;
  /**
   * Renders the trigger as a label rather than a field: no border, no chevron,
   * and a grey highlight only on hover.
   *
   * For a menu that sits inside other content — a breadcrumb, say — where a
   * field outline and a chevron would announce a form control in the middle of
   * something that is not one. The menu itself is unchanged; only the way it is
   * opened reads differently.
   */
  export let plain = false;

  let open = false;
  let wrap: HTMLElement;
  let trigger: HTMLButtonElement;

  $: current = options.find((option) => option.value === value)?.label ?? '';
  /** The trigger wears the chosen option's own glyph where the options carry
   * one, so it names what is selected rather than the menu it came from. */
  $: triggerIcon = options.find((option) => option.value === value)?.icon ?? icon;

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

<div bind:this={wrap} class:wide class:plain class="select-menu">
  <button
    bind:this={trigger}
    type="button"
    class="select-menu-trigger"
    class:plain
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    onclick={toggle}
  >
    {#if triggerIcon}<span class="select-menu-icon"><Icon name={triggerIcon} size={16} strokeWidth={1.5}/></span>{/if}
    <span>{current}</span>
    <!-- A plain trigger is a label, and a label wears no chevron. -->
    {#if !plain}<Icon name="chevron" size={11}/>{/if}
  </button>
  {#if open}
    <div class="flareai-dropdown-menu select-menu-list" role="menu" aria-label={label}>
      {#each options as option (option.value)}
        <button
          type="button"
          class="flareai-dropdown-item"
          role="menuitemradio"
          aria-checked={option.value === value}
          onclick={() => choose(option.value)}
        >
          {#if option.icon}<span class="select-menu-icon"><Icon name={option.icon} size={16} strokeWidth={1.5}/></span>{/if}
          <span>{option.label}</span>
          {#if option.value === value}<Icon name="check" size={13}/>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
