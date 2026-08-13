<script module lang="ts">
  export type TooltipAlignment = 'start' | 'center' | 'end';
</script>

<script lang="ts">
  import {onMount, tick} from 'svelte';

  let tooltip: HTMLDivElement;
  let target: HTMLButtonElement | null = null;
  let label = '';
  let left = 0;
  let top = 0;
  let visible = false;

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {destroy: () => node.remove()};
  }

  function tooltipLabel(button: HTMLButtonElement): string {
    const setting = button.getAttribute('data-tooltip');
    if (setting === '' || setting === 'none') return '';
    if (!button.querySelector(':scope > svg') || button.querySelector(':scope > span')) return '';
    return button.getAttribute('data-tooltip-label') || button.getAttribute('aria-label') || '';
  }

  function tooltipLeft(
    targetRect: DOMRect,
    tooltipWidth: number,
    viewportWidth: number,
    alignment: TooltipAlignment,
  ): number {
    const margin = 8;
    const ideal = alignment === 'start'
      ? targetRect.left
      : alignment === 'end'
        ? targetRect.right - tooltipWidth
        : targetRect.left + (targetRect.width - tooltipWidth) / 2;
    return Math.max(margin, Math.min(ideal, viewportWidth - tooltipWidth - margin));
  }

  function tooltipTop(targetRect: DOMRect, tooltipHeight: number, viewportHeight: number): number {
    const margin = 8;
    const gap = 7;
    const above = targetRect.top - tooltipHeight - gap;
    if (above >= margin) return above;
    return Math.min(targetRect.bottom + gap, viewportHeight - tooltipHeight - margin);
  }

  async function show(button: HTMLButtonElement): Promise<void> {
    const nextLabel = tooltipLabel(button);
    if (!nextLabel) return;
    target = button;
    label = nextLabel;
    visible = false;
    await tick();
    if (target !== button || !tooltip) return;

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
    const focusIn = (event: FocusEvent) => {
      const button = buttonFrom(event);
      if (button) void show(button);
    };
    const focusOut = (event: FocusEvent) => hide(buttonFrom(event) ?? undefined);
    const dismiss = () => hide();

    document.addEventListener('pointerover', pointerOver, true);
    document.addEventListener('pointerout', pointerOut, true);
    document.addEventListener('focusin', focusIn, true);
    document.addEventListener('focusout', focusOut, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);

    return () => {
      document.removeEventListener('pointerover', pointerOver, true);
      document.removeEventListener('pointerout', pointerOut, true);
      document.removeEventListener('focusin', focusIn, true);
      document.removeEventListener('focusout', focusOut, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  });
</script>

{#if label}
  <div
    use:portal
    bind:this={tooltip}
    class:visible
    class="tooltip"
    role="tooltip"
    style:left={`${left}px`}
    style:top={`${top}px`}
  >{label}</div>
{/if}

<style>
  .tooltip {
    pointer-events: none;
    position: fixed;
    z-index: 1000;
    box-sizing: border-box;
    width: max-content;
    max-width: calc(100vw - 16px);
    overflow: hidden;
    border: 1px solid var(--neutral-200, #e5e5e5);
    border-radius: 7px;
    padding: 6px 8px;
    background: #fff;
    color: var(--neutral-700, #404040);
    box-shadow: 0 4px 12px rgb(0 0 0 / 6%);
    opacity: 0;
    transform: translateY(-2px);
    transition: opacity 150ms ease, transform 150ms ease;
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tooltip.visible {
    opacity: 1;
    transform: translateY(0);
  }

  @media (prefers-reduced-motion: reduce) {
    .tooltip { transition: none; }
  }
</style>
