<script lang="ts">
  import {afterUpdate, onMount} from 'svelte';
  import type {ChatReactionDto} from '@polymux/protocol';
  import Icon from '../../shared/components/Icon.svelte';
  import {avatarInitial} from './avatarFallback';

  export let reactions: ChatReactionDto[] = [];
  export let onreact: (key: string) => void = () => {};

  let root: HTMLSpanElement;
  let normal: HTMLSpanElement;
  let compact = false;
  let brokenAvatars = new Set<string>();
  let measureFrame = 0;

  function countLabel(count: number): string {
    return count > 99 ? '99+' : String(count);
  }

  function totalCount(items: ChatReactionDto[]): number {
    return items.reduce((total, reaction) => total + Math.max(0, reaction.count), 0);
  }

  function reactionLabel(reaction: ChatReactionDto): string {
    const people = reaction.reactors?.map((reactor) => reactor.name).filter(Boolean) ?? [];
    const names = people.length > 0 && people.length === reaction.count
      ? `: ${people.join(', ')}`
      : '';
    return `${reaction.key}, ${reaction.count} ${reaction.count === 1 ? 'reaction' : 'reactions'}${names}`;
  }

  function canShowReactors(reaction: ChatReactionDto): boolean {
    return reaction.count > 0 && reaction.count <= 3 && reaction.reactors?.length === reaction.count;
  }

  function markAvatarBroken(id: string): void {
    brokenAvatars = new Set(brokenAvatars).add(id);
  }

  /**
   * The full reaction strip is kept in the DOM as its own measuring plate.
   * When it no longer fits between the bubble's trailing edge and the thread
   * edge, the visible plate swaps to the compact emoji stack. This responds to
   * both drawer resizing and reactions arriving after the message rendered.
   */
  function measure(): void {
    if (!root || !normal) return;
    const row = root.closest<HTMLElement>('.hub-view-bubble-row');
    const bubble = root.closest<HTMLElement>('.hub-view-bubble');
    if (!row || !bubble) return;
    const rowBox = row.getBoundingClientRect();
    const bubbleBox = bubble.getBoundingClientRect();
    const available = Math.max(44, bubbleBox.right - rowBox.left - 20);
    root.style.width = `${available}px`;

    const style = getComputedStyle(normal);
    const gap = Number.parseFloat(style.columnGap || style.gap) || 0;
    const chips = [...normal.children] as HTMLElement[];
    const needed = chips.reduce((width, chip) => width + chip.getBoundingClientRect().width, 0)
      + Math.max(0, chips.length - 1) * gap;
    const nextCompact = needed > available + .5;
    if (compact !== nextCompact) compact = nextCompact;
  }

  function queueMeasure(): void {
    cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(measure);
  }

  afterUpdate(queueMeasure);

  onMount(() => {
    const row = root.closest<HTMLElement>('.hub-view-bubble-row');
    const observer = new ResizeObserver(queueMeasure);
    if (row) observer.observe(row);
    observer.observe(normal);
    queueMeasure();
    return () => {
      cancelAnimationFrame(measureFrame);
      observer.disconnect();
    };
  });
</script>

<span class="hub-view-reactions" class:compact bind:this={root}>
  <!-- This remains measurable in compact mode, but is removed from the
       accessibility tree and pointer path while the emoji stack is visible. -->
  <span
    class="hub-view-reactions-normal"
    class:measure-only={compact}
    aria-hidden={compact}
    bind:this={normal}
  >
    {#each reactions as reaction (reaction.key)}
      <button
        type="button"
        class="hub-view-reaction"
        class:mine={Boolean(reaction.mineEventId)}
        aria-label={reactionLabel(reaction)}
        tabindex={compact ? -1 : 0}
        onclick={() => onreact(reaction.key)}
      >
        <span class="hub-view-reaction-emoji" aria-hidden="true">{reaction.key}</span>
        {#if canShowReactors(reaction)}
          <span class="hub-view-reaction-avatars" aria-hidden="true">
            {#each reaction.reactors!.slice(0, 3) as reactor (reactor.id)}
              {@const avatarKey = `${reaction.key}:${reactor.id}`}
              {#if reactor.avatarUrl && !brokenAvatars.has(avatarKey)}
                <img
                  class="hub-view-reaction-avatar"
                  src={reactor.avatarUrl}
                  alt=""
                  loading="lazy"
                  onerror={() => markAvatarBroken(avatarKey)}
                />
              {:else}
                {@const initial = avatarInitial(reactor.name)}
                <span class="hub-view-reaction-avatar placeholder">
                  {#if initial}{initial}{:else}<Icon name="user" size={7} />{/if}
                </span>
              {/if}
            {/each}
          </span>
        {:else}
          <span class="hub-view-reaction-count" aria-hidden="true">{countLabel(reaction.count)}</span>
        {/if}
      </button>
    {/each}
  </span>

  {#if compact}
    <span class="hub-view-reactions-compact">
      <span class="hub-view-reaction-emoji-stack">
        {#each reactions.slice(0, 3) as reaction (reaction.key)}
          <button
            type="button"
            class="hub-view-reaction-emoji-button"
            class:mine={Boolean(reaction.mineEventId)}
            aria-label={reactionLabel(reaction)}
            onclick={() => onreact(reaction.key)}
          >{reaction.key}</button>
        {/each}
      </span>
      <span class="hub-view-reaction-count">{countLabel(totalCount(reactions))}</span>
    </span>
  {/if}
</span>
