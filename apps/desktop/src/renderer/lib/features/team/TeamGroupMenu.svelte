<script lang="ts">
  import type {BotDto, TeamGroupDto} from '@polymux/protocol';
  import {tick} from 'svelte';
  import {t} from '../../../i18n';
  import {scrollFade} from '../../shared/scrollFade';
  import Icon from '../../shared/components/Icon.svelte';
  import {MENU_EDGE_MARGIN, clampToMenuEdge} from '../../shared/layout/menuPlacement';
  import TeamAvatar from './TeamAvatar.svelte';
  import {teamGroupMembers, teamGroupName} from './groupName';

  /** The group's own surfaces: rename the chat and add or remove members,
   * opened from the group identity in the title bar. */
  export let group: TeamGroupDto;
  export let bots: BotDto[] = [];
  export let anchor: {left: number; bottom: number; width: number} | null = null;
  export let busy = false;
  export let onRename: (name: string) => void = () => {};
  export let onMembers: (memberIds: string[]) => void = () => {};
  export let onClose: () => void = () => {};

  let panel: HTMLDivElement | null = null;
  let nameInput: HTMLInputElement | null = null;
  let adding = false;
  let query = '';
  let left = 0;
  let top = 0;
  let placed = false;
  let name = group.name;
  let committedName = group.name;

  $: members = teamGroupMembers(group, bots);
  $: autoName = teamGroupMembers(group, bots).map((member) => member.name).join(', ');
  $: needle = query.trim().toLowerCase();
  $: candidates = bots.filter((member) => !group.memberIds.includes(member.id)
    && (!needle || member.name.toLowerCase().includes(needle)));

  /** Kept at body level so viewport coordinates stay viewport coordinates and
   * the title bar's overflow and backdrop-filter cannot clip it. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {destroy: () => node.remove()};
  }

  function place(): void {
    if (!panel || !anchor) return;
    const {width, height} = panel.getBoundingClientRect();
    left = clampToMenuEdge(anchor.left, width, window.innerWidth);
    top = clampToMenuEdge(anchor.bottom + 6, height, window.innerHeight);
    placed = true;
  }

  $: if (panel && anchor && !placed) void Promise.resolve().then(place);

  function commitName(): void {
    const next = name.trim();
    if (next === committedName.trim()) return;
    committedName = name;
    onRename(next);
  }

  function removeMember(id: string): void {
    onMembers(group.memberIds.filter((memberId) => memberId !== id));
  }

  function addMember(id: string): void {
    query = '';
    adding = false;
    onMembers([...group.memberIds, id]);
  }

  function startAdding(): void {
    adding = true;
    void tick().then(() => panel?.querySelector<HTMLInputElement>('.team-group-menu-search input')?.focus());
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  /** Whichever control opened the panel keeps focus when it goes away. */
  function mounted(node: HTMLDivElement) {
    node.querySelector<HTMLInputElement>('input')?.focus({preventScroll: true});
    return {};
  }
</script>

<svelte:window on:resize={() => onClose()} on:keydown={keydown}/>

{#if anchor}
  <div use:portal class="team-group-shade" role="presentation" onpointerdown={() => onClose()} onwheel={() => onClose()}></div>
  <div
    use:portal
    use:mounted
    bind:this={panel}
    class:placed
    class="team-group-menu"
    role="dialog"
    aria-label={teamGroupName(group, bots)}
    tabindex="-1"
    style="left: {left}px; top: {top}px"
    onkeydown={keydown}
  >
    <label class="team-group-menu-name">
      <span>{$t('team.renameChat')}</span>
      <input
        bind:this={nameInput}
        bind:value={name}
        autocomplete="off"
        placeholder={autoName || $t('team.newChat')}
        aria-label={$t('team.renameChat')}
        onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitName(); nameInput?.blur(); } }}
        onblur={commitName}
      />
    </label>

    <div class="team-group-menu-members">
      <span class="team-group-menu-title">{$t('team.members')}</span>
      <div class="team-group-menu-list" use:scrollFade>
        {#each members as member (member.id)}
          <div class="team-group-menu-member">
            <TeamAvatar avatar={member.avatar} expression="neutral" activity="idle" size={26} animated={false} paper="var(--app-surface)" label={`${member.name} avatar`}/>
            <span>{member.name}</span>
            <button
              type="button"
              aria-label={`${$t('team.remove')} ${member.name}`}
              data-tooltip="none"
              disabled={busy || group.memberIds.length < 2}
              onclick={() => removeMember(member.id)}
            ><Icon name="close" size={12}/></button>
          </div>
        {/each}
      </div>

      {#if adding}
        <div class="team-group-menu-search">
          <Icon name="search" size={13}/>
          <input bind:value={query} type="text" placeholder={$t('team.addMember')} aria-label={$t('team.addMember')} autocomplete="off" spellcheck="false"/>
        </div>
        <div class="team-group-menu-list" use:scrollFade>
          {#each candidates as member (member.id)}
            <button type="button" class="team-group-menu-member team-group-menu-candidate" aria-label={`${$t('team.add')} ${member.name}`} onclick={() => addMember(member.id)}>
              <TeamAvatar avatar={member.avatar} expression="neutral" activity="idle" size={26} animated={false} paper="var(--app-surface)" label={`${member.name} avatar`}/>
              <span>{member.name}</span>
              <Icon name="plus" size={13}/>
            </button>
          {:else}
            <p class="team-group-menu-empty" role="status">{$t('team.noBotsFound')}</p>
          {/each}
        </div>
      {:else if bots.some((member) => !group.memberIds.includes(member.id))}
        <button type="button" class="team-group-menu-add" disabled={busy} onclick={startAdding}>
          <Icon name="plus" size={14}/><span>{$t('team.addMember')}</span>
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .team-group-shade{position:fixed;z-index:181;inset:0}
  .team-group-menu{position:fixed;z-index:182;width:min(300px,calc(100vw - 32px));max-height:min(420px,calc(100vh - 40px));box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:12px;overflow:hidden;border:1px solid var(--neutral-200);border-radius:14px;background:var(--app-surface);color:var(--neutral-900);box-shadow:0 18px 50px rgba(0,0,0,.24);opacity:0}
  .team-group-menu.placed{opacity:1}
  .team-group-menu-name{display:block}
  .team-group-menu-name>span,.team-group-menu-title{display:block;margin-bottom:6px;color:var(--secondary);font-size:11px;font-weight:600}
  .team-group-menu-name input{width:100%;height:32px;box-sizing:border-box;border:1px solid var(--neutral-250,var(--neutral-300));border-radius:8px;padding:0 9px;outline:none;background:var(--app-bg);color:var(--neutral-900);font:inherit;font-size:12px}
  .team-group-menu-name input::placeholder{color:var(--neutral-400)}
  .team-group-menu-name input:focus-visible{border-color:var(--focus-ring);box-shadow:0 0 0 1px var(--focus-ring)}
  .team-group-menu-members{min-height:0;display:flex;flex-direction:column}
  .team-group-menu-list{min-height:0;overflow-y:auto;scrollbar-width:none}
  .team-group-menu-list::-webkit-scrollbar{display:none}
  .team-group-menu-member{min-height:38px;display:flex;align-items:center;gap:9px;border-radius:9px;padding:3px 4px 3px 6px;color:var(--neutral-800);font-size:12.5px}
  .team-group-menu-member>span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .team-group-menu-member>button{width:24px;height:24px;display:grid;place-items:center;flex:none;border:0;border-radius:7px;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer}
  .team-group-menu-member>button:hover{color:var(--neutral-900)}
  .team-group-menu-member>button:disabled{opacity:.35;cursor:default}
  .team-group-menu-candidate{width:100%;border:0;background:transparent;font:inherit;cursor:pointer;text-align:left}
  .team-group-menu-candidate:hover{background:var(--neutral-100)}
  .team-group-menu-candidate :global(svg){color:var(--neutral-500)}
  .team-group-menu-search{display:flex;align-items:center;gap:8px;height:30px;margin-top:6px;border:1px solid var(--neutral-250,var(--neutral-300));border-radius:8px;padding:0 9px;background:var(--app-bg);color:var(--neutral-500)}
  .team-group-menu-search input{min-width:0;flex:1;border:0;padding:0;background:transparent;color:var(--neutral-900);font:inherit;font-size:12px;outline:0}
  .team-group-menu-search input::placeholder{color:var(--neutral-400)}
  .team-group-menu-add{display:flex;align-items:center;gap:9px;min-height:34px;border:0;border-radius:9px;padding:0 6px;background:transparent;color:var(--neutral-600);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
  .team-group-menu-add:hover{color:var(--neutral-950)}
  .team-group-menu-empty{margin:0;padding:12px 6px;color:var(--neutral-400);font-size:12px;text-align:center}
  @media (prefers-reduced-motion:no-preference){.team-group-menu{transition:opacity .12s ease}}
</style>
