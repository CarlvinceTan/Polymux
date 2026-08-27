<script lang="ts">
  import {onMount} from 'svelte';
  import type {MarketplacePluginDto, McpServerDto, PluginDto, PluginViewDto, SkillDto} from '@polymux/protocol';
  import {polymuxApi} from '../../api/polymux';
  import Icon from '../../shared/components/Icon.svelte';

  export let onOpenView: (view: PluginViewDto) => void = () => {};
  type Section = 'all' | 'skills' | 'mcp' | 'plugins' | 'views';
  type Row = {id: string; name: string; description: string; section: Exclude<Section, 'all'>; installed: boolean; payload?: MarketplacePluginDto | PluginViewDto};

  const api = polymuxApi();
  const labels: Record<Section, string> = {all: 'All', skills: 'Skills', mcp: 'MCPs', plugins: 'Plugins', views: 'Views'};
  const icons = {skills: 'sparkles', mcp: 'mcp', plugins: 'puzzle', views: 'panel'} as const;
  let section: Section = 'all';
  let query = '';
  let loading = true;
  let error = '';
  let installing = '';
  let skills: SkillDto[] = [];
  let mcp: McpServerDto[] = [];
  let plugins: PluginDto[] = [];
  let catalog: MarketplacePluginDto[] = [];
  let views: PluginViewDto[] = [];

  $: installedPluginIds = new Set(plugins.map((plugin) => plugin.id));
  $: rows = <Row[]>[
    ...skills.map((skill) => ({id: `skill:${skill.name}`, name: skill.displayName || skill.name, description: skill.description, section: 'skills' as const, installed: true})),
    ...mcp.map((server) => ({id: `mcp:${server.id}`, name: server.name, description: server.description || '', section: 'mcp' as const, installed: true})),
    ...plugins.map((plugin) => ({id: `plugin:${plugin.id}`, name: plugin.name, description: plugin.description, section: 'plugins' as const, installed: true})),
    ...catalog.filter((entry) => !installedPluginIds.has(entry.id)).map((entry) => ({id: `catalog:${entry.id}`, name: entry.name, description: entry.description, section: 'plugins' as const, installed: false, payload: entry})),
    ...views.map((view) => ({id: `view:${view.id}`, name: view.name, description: view.description, section: 'views' as const, installed: true, payload: view})),
  ];
  $: visibleRows = rows.filter((row) => {
    if (section !== 'all' && row.section !== section) return false;
    const text = query.trim().toLowerCase();
    return !text || `${row.name} ${row.description} ${row.section}`.toLowerCase().includes(text);
  });

  onMount(() => void refresh());

  async function refresh(): Promise<void> {
    loading = true;
    error = '';
    try {
      [skills, mcp, plugins, views] = await Promise.all([api.skills.list(), api.mcp.list(), api.plugins.list(), api.plugins.views()]);
      try {
        catalog = await api.plugins.browse('');
      } catch (reason) {
        // Installed capabilities stay useful when a remote marketplace is
        // offline; browsing is the only section that degrades.
        catalog = [];
        error = reason instanceof Error ? reason.message : String(reason);
      }
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      loading = false;
    }
  }

  async function activate(row: Row): Promise<void> {
    if (row.section === 'views' && row.payload) return onOpenView(row.payload as PluginViewDto);
    if (row.section !== 'plugins' || row.installed || !row.payload) return;
    installing = row.id;
    try {
      plugins = await api.plugins.install((row.payload as MarketplacePluginDto).id);
      views = await api.plugins.views();
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      installing = '';
    }
  }
</script>

<section class="marketplace-view" aria-label="Marketplace">
  <header>
    <div class="marketplace-search"><Icon name="search" size={14}/><input bind:value={query} type="search" aria-label="Search marketplace" placeholder="Search marketplace"/></div>
    <nav aria-label="Marketplace categories">
      {#each Object.keys(labels) as key}<button type="button" class:active={section === key} onclick={() => section = key as Section}>{labels[key as Section]}</button>{/each}
    </nav>
  </header>
  <div class="marketplace-results">
    {#if loading}<p class="marketplace-empty">Loading marketplace…</p>
    {:else if error && !rows.length}<p class="marketplace-empty">{error}</p>
    {:else}
      {#if error}<p class="marketplace-error">{error}</p>{/if}
      {#each visibleRows as row (row.id)}
        <article>
          <span class="marketplace-mark"><Icon name={icons[row.section]} size={16}/></span>
          <span class="marketplace-copy"><strong>{row.name}</strong><small>{row.description || labels[row.section]}</small></span>
          {#if row.section === 'views'}<button type="button" onclick={() => void activate(row)}>Open</button>
          {:else if row.section === 'plugins' && !row.installed}<button type="button" disabled={!!installing} onclick={() => void activate(row)}>{installing === row.id ? 'Installing' : 'Install'}</button>
          {:else}<span class="marketplace-status">Installed</span>{/if}
        </article>
      {:else}<p class="marketplace-empty">No matches</p>{/each}
    {/if}
  </div>
</section>

<style>
  .marketplace-view{display:flex;flex-direction:column;min-height:100%;color:var(--text-primary)}
  header{padding:16px 18px 10px;border-bottom:1px solid var(--border-subtle)}
  .marketplace-search{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-subtle)}
  input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:inherit;font:inherit}
  nav{display:flex;gap:18px;margin-top:12px;overflow:auto;scrollbar-width:none} nav::-webkit-scrollbar{display:none}
  nav button{padding:0 0 7px;border:0;border-bottom:1px solid transparent;background:none;color:var(--text-secondary);font:inherit} nav button.active{border-color:currentColor;color:var(--text-primary)}
  .marketplace-results{display:flex;flex:1;flex-direction:column;overflow:auto;padding:8px 18px 18px;scrollbar-width:none}.marketplace-results::-webkit-scrollbar{display:none}
  article{display:flex;align-items:center;gap:8px;min-height:48px;border-bottom:1px solid var(--border-subtle)}
  .marketplace-mark{display:flex;flex:0 0 20px;align-items:center;justify-content:center;color:var(--text-secondary)}
  .marketplace-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px}.marketplace-copy strong,.marketplace-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.marketplace-copy strong{font-size:13px;font-weight:550}.marketplace-copy small,.marketplace-status{color:var(--text-secondary);font-size:11px}
  article button{border:0;background:none;color:var(--text-primary);font:inherit;font-size:12px}article button:hover{color:var(--accent)}
  .marketplace-empty{display:flex;flex:1;align-items:center;justify-content:center;color:var(--text-secondary);font-size:12px}.marketplace-error{margin:8px 0;color:var(--danger);font-size:12px}
</style>
