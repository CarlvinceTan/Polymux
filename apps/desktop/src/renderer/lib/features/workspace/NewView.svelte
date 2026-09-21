<script lang="ts">
  import type {ComponentProps} from 'svelte';
  import type {WorkspaceAppDto} from '@polymux/protocol';
  import Icon from '../../shared/components/Icon.svelte';
  import {t} from '../../../i18n';
  import type {Visit} from './visitHistory';

  type NewViewKind = 'browser' | 'drive' | 'calendar' | 'hub' | 'tasks' | 'mobile' | 'vault' | 'terminal' | 'ide' | 'usage' | 'finance';
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
    mobile: 'mobile',
    vault: 'key',
    media: 'image',
    terminal: 'terminal',
    ide: 'code',
    finance: 'banknote', usage: 'chart',
  };
  $: launchableApps = apps.filter((app) => app.enabled && app.workspaceKind && !openKinds.has(app.id) && !openKinds.has(app.workspaceKind));
  $: pinnedApps = pinnedAppIds.map((id) => launchableApps.find((app) => app.id === id)).filter((app): app is WorkspaceAppDto => Boolean(app));
  $: unpinnedApps = launchableApps.filter((app) => !pinnedAppIds.includes(app.id));
  $: orderedApps = [...pinnedApps, ...unpinnedApps];

  function chooseApp(app: WorkspaceAppDto): void {
    onChooseApp(app);
  }
</script>

<div class="workspace-launcher">
  <div class="workspace-launcher-header">
    <p class="workspace-launcher-heading">{$t('workspace.open')}</p>
  </div>
  <div class="workspace-launcher-grid">
    <button type="button" class="workspace-launcher-row" onclick={() => onChoose('browser')}><Icon name="globe" size={16}/><span>{$t('workspace.browser')}</span></button>
    {#each orderedApps as app (app.id)}
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
</div>
