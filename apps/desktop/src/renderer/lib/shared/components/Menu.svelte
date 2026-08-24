<script module lang="ts">
  /** `icon` is optional per option; a list that sets it on none looks exactly
   * as it did before. The glyph name is reached for inline because the
   * instance script below imports `Icon` as a value under the same name. */
  export type MenuOption = {
    value: string;
    label: string;
    icon?: import('svelte').ComponentProps<import('./Icon.svelte').default>['name'];
    /**
     * A storage provider's own mark instead of a glyph, so two Google accounts
     * in one list are recognisable as Google before their addresses are read.
     * Takes precedence over `icon` where both are set.
     */
    provider?: import('@polymux/protocol').DriveProviderId;
  };
</script>

<script lang="ts">
  import {tick, type ComponentProps} from 'svelte';
  import Icon from './Icon.svelte';
  import DriveProviderLogo from './DriveProviderLogo.svelte';

  /**
   * A choice, in the app's own dropdown rather than the platform's.
   *
   * A native `<select>` renders with the operating system's own chevron and
   * inset, which sits tight against the edge and matches nothing else here.
   * This is the same `polymux-dropdown-menu` shell every other menu uses.
   */
  export let options: MenuOption[] = [];
  export let value = '';
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
  /**
   * Several choices at once. `values` holds the chosen ones and `onToggle`
   * reports each change; the menu stays open, because picking two days means
   * two clicks and reopening between them is busywork. The trigger reads from
   * `summary`, since only the caller knows how to phrase a set — "Mo and Th"
   * is a sentence, not a list of labels glued together.
   */
  export let values: string[] | null = null;
  /**
   * Takes the trigger's click instead of opening the list. For a menu standing
   * in for the root of a path: once you are inside a subfolder that root is
   * somewhere to go back to, and going back is what clicking it should do.
   */
  export let onTriggerClick: (() => void) | null = null;
  export let onToggle: (value: string) => void = () => {};
  export let summary = '';

  $: multiple = values !== null;

  let open = false;
  let wrap: HTMLElement;
  let trigger: HTMLButtonElement;
  let list: HTMLElement;
  /** The height the list is held to so it scrolls instead of running off. */
  let listMaxHeight: number | null = null;

  /** How close the list may come to the window edge. */
  const EDGE_MARGIN = 8;

  $: current = multiple ? summary : options.find((option) => option.value === value)?.label ?? '';
  /** The trigger wears the chosen option's own glyph where the options carry
   * one, so it names what is selected rather than the menu it came from. */
  $: triggerIcon = options.find((option) => option.value === value)?.icon ?? icon;
  $: triggerProvider = options.find((option) => option.value === value)?.provider;

  async function toggle(): Promise<void> {
    if (onTriggerClick) {
      open = false;
      onTriggerClick();
      return;
    }
    open = !open;
    if (!open) return;
    // Cleared before the list is measured, so a cap left by a previous open
    // is not mistaken for the list's natural height.
    listMaxHeight = null;
    await tick();
    place();
    wrap?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }

  /**
   * Keeps the list on screen. It always opens downwards from the trigger —
   * a menu that sometimes appears above and sometimes below is harder to
   * follow than one that is always in the same place — so where the room runs
   * out the list is held to what is left and scrolls inside it.
   */
  function place(): void {
    if (!trigger || !list) return;
    const rect = trigger.getBoundingClientRect();
    // The rendered height, not the content height: a long list is already
    // capped to a few rows by the stylesheet and scrolls within that, so what
    // has to fit is the box, not everything inside it.
    const wanted = list.getBoundingClientRect().height;
    const below = window.innerHeight - rect.bottom - EDGE_MARGIN - 5;
    if (wanted <= below) return;
    // Only ever shrinks: an inline max-height outranks the stylesheet's row
    // cap, so handing it a large number would make the list taller than it is
    // ever meant to be rather than shorter.
    listMaxHeight = Math.min(Math.round(wanted), Math.max(120, Math.floor(below)));
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
    aria-haspopup={onTriggerClick ? undefined : 'menu'}
    aria-expanded={onTriggerClick ? undefined : open}
    aria-label={label}
    onclick={toggle}
  >
    {#if triggerProvider}
      <span class="select-menu-icon"><DriveProviderLogo provider={triggerProvider} size={16}/></span>
    {:else if triggerIcon}
      <span class="select-menu-icon"><Icon name={triggerIcon} size={16} strokeWidth={1.5}/></span>
    {/if}
    <span>{current}</span>
    <!-- A plain trigger is a label, and a label wears no chevron. -->
    {#if !plain}<Icon name="chevron" size={11}/>{/if}
  </button>
  {#if open}
    <div
      bind:this={list}
      class="polymux-dropdown-menu select-menu-list"
      style:max-height={listMaxHeight === null ? null : `${listMaxHeight}px`}
      role="menu"
      aria-label={label}
    >
      {#each options as option (option.value)}
        {@const checked = multiple ? values!.includes(option.value) : option.value === value}
        <button
          type="button"
          class="polymux-dropdown-item"
          role={multiple ? 'menuitemcheckbox' : 'menuitemradio'}
          aria-checked={checked}
          onclick={() => multiple ? onToggle(option.value) : choose(option.value)}
        >
          {#if option.provider}
            <span class="select-menu-icon"><DriveProviderLogo provider={option.provider} size={16}/></span>
          {:else if option.icon}
            <span class="select-menu-icon"><Icon name={option.icon} size={16} strokeWidth={1.5}/></span>
          {/if}
          <span>{option.label}</span>
          {#if checked}<Icon name="check" size={13}/>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
