<script lang="ts">
  import {onMount, tick} from 'svelte';
  import {tooltipLeft, tooltipTop, type TooltipAlignment} from '../layout/tooltipPosition';

  let tooltip: HTMLDivElement;
  const targetSelector = 'button, [data-tooltip-overflow]';
  const tooltipId = 'polymux-shared-tooltip';
  let target: HTMLElement | null = null;
  /** The button under the pointer, which outlives the pill: a control that
      stops qualifying mid-hover (its menu opens) has to be able to raise the
      tooltip again when it qualifies once more, without the pointer moving. */
  let hovered: HTMLElement | null = null;
  let label = '';
  let left = 0;
  let top = 0;
  let visible = false;
  let wide = false;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Work handed to a microtask so it runs after the current render finishes.
   *
   * A render that removes the focused or hovered element makes the browser
   * dispatch `focusout` and `pointerout` synchronously, from inside Svelte's
   * own effect teardown. Writing tooltip state there trips Svelte's
   * `state_unsafe_mutation` guard, which aborts the handler halfway and leaves
   * the pill stranded on screen — exactly what locking the vault did. The
   * deferral costs nothing visible and keeps every write outside the render.
   */
  function afterRender(run: () => void): void {
    queueMicrotask(run);
  }

  /** Portaled to the body so the pill is placed against the viewport and cannot
      be clipped by the scrolling conversation column or a panel's overflow. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {destroy: () => node.remove()};
  }

  /** A labelled icon button gets a tooltip; anything that already shows its own
      text, or opts out by name, does not. */
  function tooltipLabel(button: HTMLElement): string {
    const setting = button.getAttribute('data-tooltip');
    if (setting === '' || setting === 'none') return '';
    // A left chevron already carries the universal meaning of going back.
    // Keep its aria-label for assistive technology without repeating it in a
    // hover pill, everywhere the shared Back icon is used.
    if (button.querySelector(':scope > svg[data-icon="back"]')) return '';
    // A button holding its menu open has already said what it does — the menu
    // is on screen, usually right under the pill, so a tooltip would only
    // cover the first item. Applies to every popover trigger in the app.
    if (button.getAttribute('aria-expanded') === 'true') return '';
    const explicit = button.getAttribute('data-tooltip-label');
    if (button.hasAttribute('data-tooltip-overflow')) {
      const text = button.querySelector<HTMLElement>('[data-tooltip-overflow-text]') ?? button;
      return text.scrollWidth > text.clientWidth + 1 ? explicit || text.textContent || '' : '';
    }
    if (explicit) return explicit;
    if (!button.querySelector(':scope > svg') || button.querySelector(':scope > span')) return '';
    return button.getAttribute('aria-label') || '';
  }

  /** A row or rich description needs time to be read without flashing over
      every hover, so the model tooltip waits before appearing. */
  function delayFor(button: HTMLElement): number {
    const value = button.getAttribute('data-tooltip-delay');
    const ms = value === null ? 0 : Number(value);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  /**
   * `settled` says the pointer has demonstrably been still on this button
   * already, so the pause the delay is there to wait for has happened.
   */
  function show(button: HTMLElement, settled = false): void {
    // The startup cover is click-through, so the pointer reaches the app
    // behind it; a pill raised then would float over the brand alone. The
    // pointer is still on the button when the cover lifts, though, and nothing
    // else would bring the name back — so the wait is watched rather than the
    // hover being dropped.
    if (document.documentElement.dataset.startup) return;
    // A button that is leaving the DOM (its view is swapping under the
    // pointer, e.g. locking the vault unmounts its toolbar) must never raise
    // the pill: there is nothing to anchor it to, and the removal observer
    // below would otherwise resurrect it after the hide.
    if (!button.isConnected) {
      return;
    }
    const nextLabel = tooltipLabel(button);
    if (!nextLabel) return;
    if (target === button && label === nextLabel && visible) return;
    if (target && target !== button) hide();
    target = button;
    wide = button.hasAttribute('data-tooltip-wide');
    visible = false;
    const delay = settled ? 0 : delayFor(button);
    if (delay) {
      label = '';
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        label = nextLabel;
        void reveal();
      }, delay);
      return;
    }
    label = nextLabel;
    void reveal();
  }

  async function reveal(): Promise<void> {
    const button = target;
    if (!button) return;
    await tick();
    if (target !== button || !button.isConnected || !tooltip) {
      if (target === button) hide(button);
      return;
    }
    const targetRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const alignment = (button.getAttribute('data-tooltip-align') || 'center') as TooltipAlignment;
    left = tooltipLeft(targetRect, tooltipRect.width, window.innerWidth, alignment);
    top = tooltipTop(targetRect, tooltipRect.height, window.innerHeight);
    visible = true;
    const describedBy = new Set((button.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
    describedBy.add(tooltipId);
    button.setAttribute('aria-describedby', [...describedBy].join(' '));
  }

  function hide(button?: HTMLElement): void {
    if (button && target !== button) {
      return;
    }
    clearTimeout(pendingTimer);
    if (target) {
      const describedBy = (target.getAttribute('aria-describedby') ?? '').split(/\s+/)
        .filter((id) => id && id !== tooltipId).join(' ');
      if (describedBy) target.setAttribute('aria-describedby', describedBy);
      else target.removeAttribute('aria-describedby');
    }
    target = null;
    visible = false;
    label = '';
  }

  function buttonFrom(event: Event): HTMLElement | null {
    return (event.target as Element | null)?.closest<HTMLElement>(targetSelector) ?? null;
  }

  onMount(() => {
    const pointerOver = (event: PointerEvent) => {
      const button = buttonFrom(event);
      if (!button) return;
      afterRender(() => {
        hovered = button;
        void show(button);
      });
    };
    const pointerOut = (event: PointerEvent) => {
      const button = buttonFrom(event);
      const related = event.relatedTarget as Node | null;
      if (!button || button.contains(related)) return;
      afterRender(() => {
        if (hovered === button) hovered = null;
        hide(button);
      });
    };
    const pointerMove = (event: PointerEvent) => {
      if (!target) return;
      const hoveredButton = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(targetSelector) ?? null;
      if (hoveredButton === target) return;
      afterRender(() => {
        hovered = hoveredButton;
        hide();
      });
    };
    const focusIn = (event: FocusEvent) => {
      const button = buttonFrom(event);
      if (!button) return;
      afterRender(() => void show(button));
    };
    // A focused control loses focus as its view unmounts, and that removal is
    // what dispatches this event — see `afterRender`.
    const focusOut = (event: FocusEvent) => {
      const button = buttonFrom(event);
      afterRender(() => hide(button ?? undefined));
    };
    const dismiss = () => afterRender(() => hide());
    // Activating a button usually swaps the view under the pointer, so the
    // target can be gone before any pointerout arrives. Take the pill down on
    // activation rather than waiting for an event that may never come.
    const activate = (event: Event) => {
      const button = buttonFrom(event);
      if (button && target !== button) return;
      afterRender(() => hide());
    };
    // The pill is usually already up when the button is clicked, so opening a
    // menu has to take it down rather than merely stop the next hover from
    // raising it. Watching the opt-out attributes covers that and any other
    // case where a button stops qualifying while it is being pointed at.
    const targetObserver = new MutationObserver(() => {
      afterRender(() => {
        if (target && (!target.isConnected || !tooltipLabel(target))) hide();
        if (hovered && !hovered.isConnected) hovered = null;
        // Closing the menu makes the trigger a plain icon button again; the
        // pointer never left it, so nothing else would bring its name back.
        if (hovered && !target && tooltipLabel(hovered)) void show(hovered);
      });
    });
    // The cover's own lifetime, watched separately: it lives on the root, and
    // its going is the moment a hover held through the opening becomes a
    // tooltip. Same rule as a menu closing under the pointer.
    const coverObserver = new MutationObserver(() => {
      if (document.documentElement.dataset.startup) return;
      coverObserver.disconnect();
      afterRender(() => {
        // Held on the same control for the whole of the opening: the pause has
        // already been made, and asking for it again would start it over.
        if (hovered && !target && tooltipLabel(hovered)) void show(hovered, true);
      });
    });
    if (document.documentElement.dataset.startup)
      coverObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-startup'],
      });
    targetObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributeFilter: ['aria-expanded', 'data-tooltip', 'data-tooltip-label'],
    });
    document.addEventListener('pointerover', pointerOver, true);
    document.addEventListener('pointerout', pointerOut, true);
    document.addEventListener('pointermove', pointerMove, true);
    document.addEventListener('pointerdown', activate, true);
    document.addEventListener('click', activate, true);
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('focusin', focusIn, true);
    document.addEventListener('focusout', focusOut, true);
    document.addEventListener('mouseleave', dismiss);
    document.addEventListener('visibilitychange', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      targetObserver.disconnect();
      coverObserver.disconnect();
      document.removeEventListener('pointerover', pointerOver, true);
      document.removeEventListener('pointerout', pointerOut, true);
      document.removeEventListener('pointermove', pointerMove, true);
      document.removeEventListener('pointerdown', activate, true);
      document.removeEventListener('click', activate, true);
      document.removeEventListener('keydown', dismiss, true);
      document.removeEventListener('focusin', focusIn, true);
      document.removeEventListener('focusout', focusOut, true);
      document.removeEventListener('mouseleave', dismiss);
      document.removeEventListener('visibilitychange', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      // Last, so a state write during teardown cannot skip the listener
      // removal above and leave handlers on the document.
      hide();
    };
  });
</script>

{#if label}
  <div use:portal bind:this={tooltip} id={tooltipId} class:visible class:wide class="shared-tooltip" role="tooltip" style:left={`${left}px`} style:top={`${top}px`}>{label}</div>
{/if}
