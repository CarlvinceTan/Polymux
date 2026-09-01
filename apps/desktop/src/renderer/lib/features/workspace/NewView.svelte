<script lang="ts">
  import Icon from '../../shared/components/Icon.svelte';
  import {t} from '../../../i18n';
  import type {Visit} from './visitHistory';

  type NewViewKind = 'browser' | 'drive' | 'calendar' | 'hub' | 'tasks' | 'phone';

  export let openKinds: ReadonlySet<string> = new Set();
  export let historySuggestions: Visit[] = [];
  export let onChoose: (kind: NewViewKind) => void = () => {};
  export let onOpenUrl: (url: string, title: string) => void = () => {};
  export let usableFavicon: (favicon: string | null | undefined) => string | null = () => null;
</script>

<div class="workspace-launcher">
  <p class="workspace-launcher-heading">{$t('workspace.open')}</p>
  <div class="workspace-launcher-rows">
    <button type="button" class="workspace-launcher-row" onclick={() => onChoose('browser')}><Icon name="globe" size={16}/><span>{$t('workspace.browser')}</span></button>
    {#if !openKinds.has('drive')}
      <button type="button" class="workspace-launcher-row" onclick={() => onChoose('drive')}><Icon name="drive" size={16}/><span>{$t('workspace.drive')}</span></button>
    {/if}
    {#if !openKinds.has('calendar')}
      <button type="button" class="workspace-launcher-row" onclick={() => onChoose('calendar')}><Icon name="calendar" size={16}/><span>{$t('workspace.calendar')}</span></button>
    {/if}
    {#if !openKinds.has('hub')}
      <button type="button" class="workspace-launcher-row" onclick={() => onChoose('hub')}><Icon name="chat" size={16}/><span>{$t('workspace.hub')}</span></button>
    {/if}
    {#if !openKinds.has('tasks')}
      <button type="button" class="workspace-launcher-row" onclick={() => onChoose('tasks')}><Icon name="tasks" size={16}/><span>{$t('workspace.tasks')}</span></button>
    {/if}
    {#if !openKinds.has('phone')}
      <button type="button" class="workspace-launcher-row" onclick={() => onChoose('phone')}><Icon name="phone" size={16}/><span>{$t('workspace.phone')}</span></button>
    {/if}
  </div>
  {#if historySuggestions.length}
    <p class="workspace-launcher-heading">{$t('workspace.recent')}</p>
    <div class="workspace-launcher-rows">
      {#each historySuggestions as visit (visit.url)}
        <button type="button" class="workspace-launcher-row" onclick={() => onOpenUrl(visit.url, visit.title)}>
          <span class="tab-favicon">
            {#if usableFavicon(visit.favicon)}<img src={visit.favicon} alt="" draggable="false"/>{:else}<Icon name="globe" size={16}/>{/if}
          </span>
          <span>{visit.title}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
