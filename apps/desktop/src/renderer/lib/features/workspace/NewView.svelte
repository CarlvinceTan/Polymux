<script lang="ts">
  import {tick} from 'svelte';
  import type {ComponentProps} from 'svelte';
  import type {WorkspaceAppDto} from '@polymux/protocol';
  import Icon from '../../shared/components/Icon.svelte';
  import {t} from '../../../i18n';
  import type {Visit} from './visitHistory';

  type NewViewKind = 'browser' | 'drive' | 'calendar' | 'hub' | 'tasks' | 'phone' | 'locker' | 'terminal' | 'ide' | 'usage' | 'finance';
  type IconName = ComponentProps<Icon>['name'];

  export let openKinds: ReadonlySet<string> = new Set();
  export let apps: WorkspaceAppDto[] = [];
  export let pinnedAppIds: string[] = [];
  export let historySuggestions: Visit[] = [];
  export let onChoose: (kind: NewViewKind) => void = () => {};
  export let onChooseApp: (app: WorkspaceAppDto) => void = () => {};
  export let onOpenUrl: (url: string, title: string) => void = () => {};
  export let usableFavicon: (favicon: string | null | undefined) => string | null = () => null;

  const appIcons: Record<string, IconName> = {
    hub: 'chat',
    drive: 'drive',
    tasks: 'tasks',
    calendar: 'calendar',
    phone: 'phone',
    locker: 'key',
    media: 'image',
    terminal: 'terminal',
    ide: 'code',
    finance: 'banknote', usage: 'chart',
  };
  let showingApps = false;
  let moreAppsButton: HTMLButtonElement;
  let appsBackButton: HTMLButtonElement;
  $: launchableApps = apps.filter((app) => app.enabled && app.workspaceKind && !openKinds.has(app.id) && !openKinds.has(app.workspaceKind));
  $: pinnedApps = pinnedAppIds.map((id) => launchableApps.find((app) => app.id === id)).filter((app): app is WorkspaceAppDto => Boolean(app));
  $: moreApps = launchableApps.filter((app) => !pinnedAppIds.includes(app.id));
  $: if (showingApps && moreApps.length === 0) showingApps = false;

  function chooseApp(app: WorkspaceAppDto): void {
    showingApps = false;
    onChooseApp(app);
  }

  async function showApps(): Promise<void> {
    showingApps = true;
    await tick();
    appsBackButton?.focus();
  }

  async function showMainNewTab(): Promise<void> {
    showingApps = false;
    await tick();
    moreAppsButton?.focus();
  }
</script>

<div class="workspace-launcher">
  {#if showingApps}
    <section class="workspace-apps-view" aria-label={$t('workspace.apps')}>
      <header class="workspace-apps-view-header">
        <button bind:this={appsBackButton} type="button" class="workspace-launcher-row workspace-launcher-navigation workspace-apps-back" aria-label={$t('workspace.backToNewTab')} onclick={() => void showMainNewTab()}><Icon name="back" size={16}/><span>{$t('workspace.back')}</span></button>
      </header>
      <div class="workspace-apps-list">
        {#each moreApps as app (app.id)}
          <button type="button" class="workspace-launcher-row" onclick={() => chooseApp(app)}><Icon name={appIcons[app.id] ?? 'panel'} size={16}/><span>{app.name}</span></button>
        {/each}
      </div>
    </section>
  {:else}
    <div class="workspace-launcher-header">
      <p class="workspace-launcher-heading">{$t('workspace.open')}</p>
      {#if moreApps.length}
        <button bind:this={moreAppsButton} type="button" class="workspace-launcher-row workspace-launcher-navigation" aria-label={$t('workspace.moreApps')} onclick={() => void showApps()}><span>{$t('workspace.more')}</span><Icon name="forward" size={11}/></button>
      {/if}
    </div>
    <div class="workspace-launcher-rows">
      <button type="button" class="workspace-launcher-row" onclick={() => onChoose('browser')}><Icon name="globe" size={16}/><span>{$t('workspace.browser')}</span></button>
      {#each pinnedApps as app (app.id)}
        <button type="button" class="workspace-launcher-row" onclick={() => chooseApp(app)}><Icon name={appIcons[app.id] ?? 'panel'} size={16}/><span>{app.name}</span></button>
      {/each}
    </div>
    {#if historySuggestions.length}
      <p class="workspace-launcher-heading">{$t('workspace.recent')}</p>
      <div class="workspace-launcher-rows">
        {#each historySuggestions as visit (visit.url)}
          <button type="button" class="workspace-launcher-row workspace-launcher-recent" onclick={() => onOpenUrl(visit.url, visit.title)}>
            <span class="tab-favicon">
              {#if usableFavicon(visit.favicon)}<img src={visit.favicon} alt="" draggable="false"/>{:else}<Icon name="globe" size={16}/>{/if}
            </span>
            <span class="workspace-launcher-recent-title">{visit.title}</span>
            <span class="workspace-launcher-recent-open" aria-hidden="true"><Icon name="arrow-up-right" size={16}/></span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>
