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
    document.getElementById(`message-${item.id}`)?.scrollIntoView({behavior: 'smooth', block: 'center'});
  }

  function edgeOpacity(index: number, count: number): number {
    const distance = Math.min(index, count - 1 - index);
    return [0.24, 0.42, 0.64, 0.82][distance] ?? 1;
  }

  /**
   * A bell curve around the pointer: the point under it is widest and fully
   * opaque, its neighbours taper off, and the ends of a long rail stay faint so
   * the whole thing reads as one shape rather than a list of ticks.
   */
  function buildProfiles(nextItems: TimelineItem[], hover: number | null, currentId: string) {
    return nextItems.map((item, index) => {
      const distance = hover === null ? Number.POSITIVE_INFINITY : Math.abs(hover - index);
      const edge = edgeOpacity(index, nextItems.length);
      const restingCurrent = hover === null && item.id === currentId;
      const opacity = restingCurrent
        ? Math.max(edge, 0.78)
        : distance === 0 ? 1 : distance === 1 ? Math.max(edge, 0.82) : distance === 2 ? Math.max(edge, 0.68) : edge;
      return {
        width: hover === null ? item.id === currentId ? 14 : 6 : [26, 20, 14, 9][distance] ?? 6,
        opacity,
        near: distance <= 2,
      };
    });
  }

  onMount(() => {
    // Capture: the conversation column scrolls, and scroll events do not bubble.
    document.addEventListener('scroll', scheduleUpdate, {capture: true, passive: true});
    window.addEventListener('resize', scheduleUpdate);
    scheduleUpdate();
  });

  afterUpdate(scheduleUpdate);

  onDestroy(() => {
    document.removeEventListener('scroll', scheduleUpdate, true);
    window.removeEventListener('resize', scheduleUpdate);
    if (frame) cancelAnimationFrame(frame);
  });
</script>

{#if items.length}
  <nav class:interacting={hoveredIndex !== null} class="timeline-rail" aria-label="Conversation timeline" onmouseleave={() => hoveredIndex = null}>
    {#each items as item, index (item.id)}
      <button
        type="button"
        class:active={activeId === item.id}
        class:hovered={hoveredIndex === index}
        class:near={profiles[index]?.near}
        class="timeline-point"
        aria-label={`Jump to: ${item.title}`}
        aria-current={activeId === item.id ? 'location' : undefined}
        data-tooltip="none"
        onmouseenter={() => hoveredIndex = index}
        onfocus={() => hoveredIndex = index}
        onblur={() => hoveredIndex = null}
        onclick={() => jumpTo(item)}
      >
        <span class="timeline-line" style={`--timeline-width:${profiles[index]?.width ?? 6}px;--timeline-opacity:${profiles[index]?.opacity ?? 1}`}></span>
        <span class="timeline-preview" aria-hidden="true">
          <strong>{item.title}</strong>
          <span>{item.preview}</span>
        </span>
      </button>
    {/each}
  </nav>
{/if}
