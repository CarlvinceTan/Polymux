<script lang="ts">
  import {onMount, tick} from 'svelte';
  import {tooltipLeft, tooltipTop, type TooltipAlignment} from '../../layout/tooltipPosition';

  let tooltip: HTMLDivElement;
  let target: HTMLButtonElement | null = null;
  let label = '';
  let left = 0;
  let top = 0;
  let visible = false;

  /** Portaled to the body so the pill is placed against the viewport and cannot
      be clipped by the scrolling conversation column or a panel's overflow. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {destroy: () => node.remove()};
  }

  /** A labelled icon button gets a tooltip; anything that already shows its own
      text, or opts out by name, does not. */
  function tooltipLabel(button: HTMLButtonElement): string {
    const setting = button.getAttribute('data-tooltip');
    if (setting === '' || setting === 'none') return '';
    const explicit = button.getAttribute('data-tooltip-label');
    if (explicit) return explicit;
    if (!button.querySelector(':scope > svg') || button.querySelector(':scope > span')) return '';
    return button.getAttribute('aria-label') || '';
  }

  async function show(button: HTMLButtonElement): Promise<void> {
    const nextLabel = tooltipLabel(button);
    if (!nextLabel) return;
    if (target === button && label === nextLabel && visible) return;
    target = button;
    label = nextLabel;
    visible = false;
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
  }

  function hide(button?: HTMLButtonElement): void {
    if (button && target !== button) return;
    target = null;
    visible = false;
    label = '';
  }

  function buttonFrom(event: Event): HTMLButtonElement | null {
    return (event.target as Element | null)?.closest<HTMLButtonElement>('button') ?? null;
  }

  onMount(() => {
    const pointerOver = (event: PointerEvent) => {
      const button = buttonFrom(event);
      if (button) void show(button);
    };
    const pointerOut = (event: PointerEvent) => {
      const button = buttonFrom(event);
      if (!button || button.contains(event.relatedTarget as Node | null)) return;
      hide(button);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!target) return;
      const hoveredButton = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('button') ?? null;
      if (hoveredButton !== target) hide();
    };
    const focusIn = (event: FocusEvent) => {
      const button = buttonFrom(event);
      if (button) void show(button);
    };
    const focusOut = (event: FocusEvent) => hide(buttonFrom(event) ?? undefined);
    const dismiss = () => hide();
    const targetObserver = new MutationObserver(() => {
      if (target && !target.isConnected) hide();
    });
    targetObserver.observe(document.body, {childList: true, subtree: true});
    document.addEventListener('pointerover', pointerOver, true);
    document.addEventListener('pointerout', pointerOut, true);
    document.addEventListener('pointermove', pointerMove, true);
    document.addEventListener('focusin', focusIn, true);
    document.addEventListener('focusout', focusOut, true);
    document.addEventListener('mouseleave', dismiss);
    document.addEventListener('visibilitychange', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      targetObserver.disconnect();
      document.removeEventListener('pointerover', pointerOver, true);
      document.removeEventListener('pointerout', pointerOut, true);
      document.removeEventListener('pointermove', pointerMove, true);
      document.removeEventListener('focusin', focusIn, true);
      document.removeEventListener('focusout', focusOut, true);
      document.removeEventListener('mouseleave', dismiss);
      document.removeEventListener('visibilitychange', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  });
</script>

{#if label}
  <div use:portal bind:this={tooltip} class:visible class="shared-tooltip" role="tooltip" style:left={`${left}px`} style:top={`${top}px`}>{label}</div>
{/if}
