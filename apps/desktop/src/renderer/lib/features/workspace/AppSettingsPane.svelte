<script lang="ts">
  import {onMount} from 'svelte';
  import type {GeneralSettingsDto, WorkspaceAppDto, WorkspaceAppsDto} from '@polymux/protocol';
  import {polymuxApi} from '../../api/polymux';
  import {readableError} from '../../shared/errors';
  import Icon from '../../shared/components/Icon.svelte';
  import {scrollFade} from '../../shared/scrollFade';
  import BrowserTab from '../settings/BrowserTab.svelte';
  import DriveTab from '../settings/DriveTab.svelte';
  import HubSettings from '../settings/HubSettings.svelte';
  import FinanceView from './FinanceView.svelte';
  import VaultSettings from './VaultSettings.svelte';

  let {app, onBack, onAppsChange = () => {}, onGeneralChange = () => {}}: {
    app: WorkspaceAppDto;
    onBack: () => void;
    onAppsChange?: (next: WorkspaceAppsDto) => void;
    onGeneralChange?: (next: GeneralSettingsDto) => void;
  } = $props();
  const api = polymuxApi();
  let apps = $state<WorkspaceAppsDto | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  const pinned = $derived(apps?.pinnedIds.includes(app.id) ?? false);
  const pinLimit = $derived(!pinned && (apps?.pinnedIds.length ?? 0) >= 4);
  onMount(() => { void load(); });
  async function load() {
    loading = true; error = '';
    try { apps = await api.apps.list(); }
    catch (reason) { error = readableError(reason); }
    finally { loading = false; }
  }
  async function togglePin() {
    if (!apps || busy) return;
    busy = true; error = '';
    try {
      // Read current placement before saving, including changes from another tab.
      const current = await api.apps.list();
      const hasPin = current.pinnedIds.includes(app.id);
      if (!hasPin && current.pinnedIds.length >= 4) { apps = current; return; }
      apps = await api.apps.setPinned(hasPin ? current.pinnedIds.filter(id => id !== app.id) : [...current.pinnedIds, app.id]);
      onAppsChange(apps);
    } catch (reason) { error = readableError(reason); }
    finally { busy = false; }
  }
  async function openCalendarAccounts() {
    error = '';
    try { await api.calendar.openAccounts(); }
    catch (reason) { error = readableError(reason); }
  }
</script>

<section class="workspace-app-settings" aria-label={`${app.name} settings`}>
  <header class="app-settings-heading">
    <button type="button" aria-label={`Back to ${app.name}`} onclick={onBack}><Icon name="back" size={16}/></button>
    <h2>{app.name} settings</h2>
  </header>
  {#if error}<div class="app-settings-error" role="alert"><span>{error}</span><button type="button" onclick={load}>Try again</button></div>{/if}
  {#if app.pinnable}
    <div class="app-placement" aria-busy={loading || busy}>
      <span><strong>New tab</strong><small>{pinLimit ? 'Four apps are already pinned.' : 'Show in the New tab shortcuts'}</small></span>
      <button type="button" class="app-pin-toggle" role="switch" aria-label={`Pin ${app.name} to New tab`} aria-checked={pinned} disabled={loading || busy || pinLimit} onclick={togglePin}><span></span></button>
    </div>
  {/if}
  <div class="app-settings-body" use:scrollFade>
    {#if app.id === 'browser'}<BrowserTab {api}/>
    {:else if app.id === 'drive'}<DriveTab {api}/>
    {:else if app.id === 'hub'}<HubSettings {api} {onGeneralChange}/>
    {:else if app.id === 'vault'}<VaultSettings/>
    {:else if app.id === 'finance'}<FinanceView settingsOnly/>
    {:else if app.id === 'calendar'}
      <div class="app-settings-row"><span>Calendar accounts</span><button type="button" onclick={openCalendarAccounts}>Manage accounts…</button></div>
    {/if}
  </div>
</section>

<style>
  .workspace-app-settings { width:100%; max-width:1120px; height:100%; min-width:0; min-height:0; margin-inline:auto; display:flex; flex-direction:column; background:var(--main-panel-background); color:var(--on-surface); container-type:inline-size; }
  .app-settings-heading { display:flex; align-items:center; gap:8px; flex:none; min-height:52px; padding:10px 18px; }
  .app-settings-heading h2 { min-width:0; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:16px; font-weight:550; }
  .app-settings-heading button { width:24px; height:28px; display:grid; place-items:center; flex:none; }
  button { border:0; padding:0; background:none; color:var(--neutral-600); font:inherit; cursor:pointer; }
  button:hover { color:var(--neutral-950); }
  button:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; border-radius:5px; }
  button:disabled { opacity:.5; cursor:default; }
  .app-placement { display:flex; align-items:center; justify-content:space-between; flex:none; gap:16px; margin:0 22px 12px; padding:14px 0; border-bottom:1px solid var(--neutral-200); }
  .app-placement > span { min-width:0; display:flex; flex-direction:column; gap:5px; }
  .app-placement strong { font-size:13px; font-weight:550; }
  .app-placement small { font-size:12px; color:var(--neutral-500); }
  .app-pin-toggle { width:30px; height:18px; border-radius:10px; flex:none; padding:2px; background:var(--neutral-300); }
  .app-pin-toggle span { display:block; width:14px; height:14px; border-radius:50%; background:var(--app-surface); transition:transform .15s; }
  .app-pin-toggle[aria-checked=true] { background:var(--neutral-900); }
  .app-pin-toggle[aria-checked=true] span { transform:translateX(12px); }
  .app-settings-body { flex:1; min-height:0; min-width:0; display:flex; flex-direction:column; overflow:auto; scrollbar-width:none; }
  .app-settings-body::-webkit-scrollbar { display:none; }
  .app-settings-row,.app-settings-error { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:18px 22px; font-size:13px; }
  .app-settings-error { flex:none; color:var(--danger); }
  @container (max-width:600px) {
    .app-settings-body :global(.drive-body), .app-settings-body :global(.browser-body) { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(120px,.4fr) minmax(0,1fr); gap:16px; }
    .app-settings-body :global(.drive-rail), .app-settings-body :global(.browser-rail) { border-right:0; padding-right:4px; }
    .app-settings-body :global(.browser-tab) { padding-left:18px; }
  }
</style>
