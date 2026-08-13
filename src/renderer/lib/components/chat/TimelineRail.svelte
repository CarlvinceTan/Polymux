<script module lang="ts">
  export type TimelineItem = {
    id: string;
    title: string;
    preview: string;
  };
</script>

<script lang="ts">
  import {afterUpdate, onDestroy, onMount} from 'svelte';

  export let items: TimelineItem[] = [];

  let activeId = '';
  let hoveredIndex: number | null = null;
  let frame = 0;
  let profiles: Array<{width: number; opacity: number; near: boolean}> = [];

  $: profiles = buildProfiles(items, hoveredIndex, activeId);

  function updateActive(): void {
    frame = 0;
    const targetY = window.innerHeight * 0.36;
    let closest: {id: string; distance: number} | null = null;

    for (const item of items) {
      const anchor = document.getElementById(`message-${item.id}`);
      if (!anchor) continue;
      const distance = Math.abs(anchor.getBoundingClientRect().top - targetY);
      if (!closest || distance < closest.distance) closest = {id: item.id, distance};
    }

    if (closest) activeId = closest.id;
  }

  function scheduleUpdate(): void {
    if (!frame) frame = requestAnimationFrame(updateActive);
  }

  function jumpTo(item: TimelineItem): void {
    activeId = item.id;
    document.getElementById(`message-${item.id}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }

  function edgeOpacity(index: number, count: number): number {
    const distance = Math.min(index, count - 1 - index);
    return [0.24, 0.42, 0.64, 0.82][distance] ?? 1;
  }

  function buildProfiles(nextItems: TimelineItem[], hover: number | null, currentId: string) {
    return nextItems.map((item, index) => {
      const distance = hover === null ? Number.POSITIVE_INFINITY : Math.abs(hover - index);
      const edge = edgeOpacity(index, nextItems.length);
      const restingCurrent = hover === null && item.id === currentId;
      const opacity = restingCurrent
        ? Math.max(edge, 0.78)
        : distance === 0
          ? 1
          : distance === 1
            ? Math.max(edge, 0.82)
            : distance === 2
              ? Math.max(edge, 0.68)
              : edge;

      return {
        width: hover === null ? (item.id === currentId ? 14 : 6) : ([26, 20, 14, 9][distance] ?? 6),
        opacity,
        near: distance <= 2,
      };
    });
  }

  onMount(() => {
    window.addEventListener('scroll', scheduleUpdate, {passive: true, capture: true});
    window.addEventListener('resize', scheduleUpdate);
    scheduleUpdate();
  });

  afterUpdate(scheduleUpdate);

  onDestroy(() => {
    window.removeEventListener('scroll', scheduleUpdate, {capture: true});
    window.removeEventListener('resize', scheduleUpdate);
    if (frame) cancelAnimationFrame(frame);
  });
</script>

{#if items.length}
  <nav
    class:interacting={hoveredIndex !== null}
    class="timeline-rail"
    aria-label="Conversation timeline"
    onmouseleave={() => hoveredIndex = null}
  >
    {#each items as item, index (item.id)}
      <button
        type="button"
        class:active={activeId === item.id}
        class:hovered={hoveredIndex === index}
        class:near={profiles[index]?.near}
        class="timeline-point"
        aria-label={`Jump to: ${item.title}`}
        aria-current={activeId === item.id ? 'location' : undefined}
        onmouseenter={() => hoveredIndex = index}
        onfocus={() => hoveredIndex = index}
        onblur={() => hoveredIndex = null}
        onclick={() => jumpTo(item)}
      >
        <span
          class="timeline-line"
          style={`--timeline-width:${profiles[index]?.width ?? 6}px;--timeline-opacity:${profiles[index]?.opacity ?? 1}`}
        ></span>
        <span class="timeline-preview" aria-hidden="true">
          <strong>{item.title}</strong>
          <span>{item.preview}</span>
        </span>
      </button>
    {/each}
  </nav>
{/if}

<style>
  .timeline-rail {
    position: fixed;
    z-index: 35;
    top: 50%;
    left: var(--timeline-left, 14px);
    width: 26px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    transform: translateY(-50%);
    transition: left 200ms ease;
  }

  .timeline-point {
    position: relative;
    width: 26px;
    height: 7px;
    display: flex;
    align-items: center;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }

  .timeline-line {
    width: var(--timeline-width, 6px);
    height: 2px;
    display: block;
    border-radius: 999px;
    background: var(--neutral-300, #d4d4d4);
    opacity: var(--timeline-opacity, 1);
    transition: width 160ms cubic-bezier(.22, .7, .28, 1), height 150ms ease, background-color 150ms ease, opacity 150ms ease;
  }

  .timeline-point.near .timeline-line {
    background: var(--neutral-500, #737373);
  }

  .timeline-point.active:not(.hovered) .timeline-line {
    height: 3px;
    background: var(--neutral-600, #525252);
  }

  .timeline-point.hovered .timeline-line {
    height: 3px;
    background: var(--neutral-950, #0a0a0a);
    opacity: 1;
  }

  .timeline-preview {
    pointer-events: none;
    position: absolute;
    top: 50%;
    left: calc(100% + 10px);
    width: min(321px, calc(100vw - 76px));
    display: flex;
    flex-direction: column;
    gap: 14px;
    visibility: hidden;
    border: 1px solid var(--neutral-200, #e5e5e5);
    border-radius: 13px;
    padding: 13px 16px 15px;
    background: rgb(255 255 255 / 97%);
    color: var(--neutral-600, #525252);
    box-shadow: 0 8px 30px rgb(26 28 28 / 12%), 0 2px 8px rgb(26 28 28 / 6%);
    opacity: 0;
    transform: translateY(-50%) translateX(-4px);
    transition: opacity 120ms ease, transform 120ms ease;
  }

  .timeline-preview strong {
    overflow: hidden;
    color: var(--neutral-950, #0a0a0a);
    font-size: 14px;
    font-weight: 550;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .timeline-preview > span {
    display: -webkit-box;
    overflow: hidden;
    font-size: 13px;
    line-height: 1.5;
    text-align: left;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }

  .timeline-point:hover .timeline-preview,
  .timeline-point:focus-visible .timeline-preview {
    visibility: visible;
    opacity: 1;
    transform: translateY(-50%) translateX(0);
  }

  @media (max-width: 640px) {
    .timeline-rail { display: none; }
  }
</style>
