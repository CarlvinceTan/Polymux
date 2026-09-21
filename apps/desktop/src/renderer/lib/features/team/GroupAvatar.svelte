<script lang="ts">
  import type {BotDto} from '@polymux/protocol';
  import TeamAvatar from './TeamAvatar.svelte';
  import {bloubActivityForTeamStatus, bloubExpressionForTeamStatus} from './bloub/expression';
  import {groupAvatarLayout} from './groupAvatarLayout';

  export let members: BotDto[] = [];
  export let size = 38;
  export let label = '';
  export let animated = true;
  export let showActivity = true;
  /** The person reading the group, drawn first so the stack reads as "you and
   * them". Only the group's own surfaces pass this; the drawer and the chat
   * pane stay about the bots. */
  export let self: {name: string; avatarUrl: string | null} | null = null;

  $: layout = groupAvatarLayout(members.length + (self ? 1 : 0));
  $: tiles = members.slice(0, Math.max(0, layout.visibleCount - (self ? 1 : 0)));
  $: tile = Math.round(size * layout.tileScale);
  $: overflowCount = Math.max(0, members.length - tiles.length);
  let selfFailed = false;
  $: if (self?.avatarUrl) selfFailed = false;
  $: selfUrl = self?.avatarUrl && !selfFailed ? self.avatarUrl : '';
  $: selfInitial = (self?.name.trim() ?? '').charAt(0).toUpperCase();

</script>

<span
  class:single={layout.kind === 'single'}
  class:pair={layout.kind === 'pair'}
  class:triple={layout.kind === 'triple'}
  class:quad={layout.kind === 'quad'}
  class="team-group-avatar"
  style:width={`${size}px`}
  style:height={`${size}px`}
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
>
  {#if self}
    <span class="team-group-avatar-person" style:--group-avatar-index={0} style:--group-avatar-tile={`${tile}px`}>
      <span class="team-group-avatar-self" style:width={`${tile}px`} style:height={`${tile}px`}>
        {#if selfUrl}
          <img src={selfUrl} alt="" draggable="false" width={tile} height={tile} onerror={() => selfFailed = true}/>
        {:else}
          <span class="team-group-avatar-initial">{selfInitial}</span>
        {/if}
      </span>
    </span>
  {/if}
  {#each tiles as member, index (member.id)}
    <span class="team-group-avatar-person" style:--group-avatar-index={index + (self ? 1 : 0)} style:--group-avatar-tile={`${tile}px`}>
      <TeamAvatar
        avatar={member.avatar}
        expression={bloubExpressionForTeamStatus(member.status, member.preview)}
        activity={showActivity ? bloubActivityForTeamStatus(member.status) : 'idle'}
        size={tile}
        {animated}
        paper="var(--team-group-surface,var(--app-bg))"
      />
    </span>
  {/each}
  {#if overflowCount}<i>+{overflowCount}</i>{/if}
</span>

<style>
  .team-group-avatar{position:relative;display:block;flex:none;isolation:isolate}.team-group-avatar-person{position:absolute;width:var(--group-avatar-tile);height:var(--group-avatar-tile);display:grid;place-items:center;border:0;background:transparent}
  .single .team-group-avatar-person{inset:0}.pair .team-group-avatar-person:nth-child(1){top:0;left:0;z-index:2}.pair .team-group-avatar-person:nth-child(2){right:0;bottom:0;z-index:1}
  .triple .team-group-avatar-person:nth-child(1){top:0;left:50%;z-index:3;transform:translateX(-50%)}.triple .team-group-avatar-person:nth-child(2){bottom:0;left:0;z-index:2}.triple .team-group-avatar-person:nth-child(3){right:0;bottom:0;z-index:1}
  .quad .team-group-avatar-person:nth-child(1){top:0;left:0;z-index:4}.quad .team-group-avatar-person:nth-child(2){top:0;right:0;z-index:3}.quad .team-group-avatar-person:nth-child(3){bottom:0;left:0;z-index:2}.quad .team-group-avatar-person:nth-child(4){right:0;bottom:0;z-index:1}
  .team-group-avatar-self{display:grid;place-items:center;overflow:hidden;border-radius:21%;background:var(--neutral-200);color:var(--neutral-700);font-size:calc(var(--group-avatar-tile) * .42);font-weight:600;line-height:1}
  .team-group-avatar-self img{width:100%;height:100%;object-fit:cover}
  i{position:absolute;z-index:5;right:-3px;bottom:-3px;min-width:18px;height:18px;display:grid;place-items:center;border:2px solid var(--team-group-surface,var(--app-bg));border-radius:10px;background:var(--neutral-800);color:var(--app-bg);font-size:10px;font-style:normal;font-weight:700;line-height:1}
</style>
