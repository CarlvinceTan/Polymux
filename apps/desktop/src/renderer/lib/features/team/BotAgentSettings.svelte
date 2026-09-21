<script lang="ts">
  import {onMount, untrack} from 'svelte';
  import type {AcpRegistryEntryDto, AgentSettingsDto, BotAgentSettingsRequest, BotDto, PolymuxApi, UpdateAgentRuntimeRequest} from '@polymux/protocol';
  import Menu from '../../shared/components/Menu.svelte';
  import Icon from '../../shared/components/Icon.svelte';
  import {scrollFade} from '../../shared/scrollFade';
  import {readableError} from '../../shared/errors';

  let {bot, hostId, profileId, api, runtime = $bindable(), onBusy = () => {}}: {
    bot: BotDto | null; hostId: string; profileId: string; api?: PolymuxApi['team'];
    runtime?: UpdateAgentRuntimeRequest; onBusy?: (busy: boolean) => void;
  } = $props();
  let registry = $state<AcpRegistryEntryDto[]>([]);
  let registryLoading = $state(true);
  let registryError = $state('');
  let settings = $state<AgentSettingsDto | null>(null);
  let savedRuntime = $state<UpdateAgentRuntimeRequest | undefined>(untrack(() => bot?.agentRuntime));
  let busy = $state(false);
  let loading = $state(true);
  let error = $state('');
  let custom = $state(false);
  let providerId = $state('');
  let protocol = $state('');
  let baseUrl = $state('');
  let authorization = $state('');
  let registryRevision = 0;
  let alive = true;
  const selected = $derived(selectedRuntime(runtime));
  function selectedRuntime(value: UpdateAgentRuntimeRequest | undefined): string {
    return value?.kind === 'acp' ? registry.find(entry => entry.command === value.command && JSON.stringify(entry.args) === JSON.stringify(value.args ?? []))?.id ?? 'custom' : 'polymux';
  }
  const changed = $derived(JSON.stringify(runtime) !== JSON.stringify(savedRuntime) || Boolean(bot && (hostId !== bot.hostId || profileId !== bot.profileId)));
  const provider = $derived(settings?.providers.find(item => item.id === providerId));
  $effect(() => { onBusy(busy); });
  $effect(() => { void loadRegistry(hostId); });
  onMount(() => { if (bot && api && hostId === bot.hostId && profileId === bot.profileId) void perform({action:'get'}); else loading = false; return () => {alive = false; registryRevision++; onBusy(false);}; });

  async function loadRegistry(host: string) {
    const revision = ++registryRevision;
    if (!api || !host) { registryLoading = false; return; }
    registryLoading = true; registryError = '';
    try { const entries = await api.agentRegistry(host); if (revision === registryRevision) registry = entries; }
    catch (reason) { if (revision === registryRevision) registryError = readableError(reason); }
    finally { if (revision === registryRevision) registryLoading = false; }
  }
  function choose(entry?: AcpRegistryEntryDto) {
    if (busy) return;
    custom = false; error = '';
    runtime = entry ? {kind:'acp', name:entry.name, command:entry.command!, args:entry.args, agentId:entry.id, configId:crypto.randomUUID(), registryEnvironment:entry.environment, config:{}} : {kind:'polymux'};
  }
  function updateArgs(value: string) { if (runtime?.kind === 'acp') runtime = {...runtime,args:value.split('\n').map(arg => arg.trim()).filter(Boolean)}; }
  function chooseCustom() {
    if (busy) return;
    custom = true;
    runtime = {kind:'acp', name:'Custom agent', command:'', args:[], config:{}, configId:crypto.randomUUID()};
  }
  async function perform(request: BotAgentSettingsRequest) {
    if (!bot || !api || busy) return;
    busy = true; error = '';
    try {
      const next = await api.agentSettings(bot.id, request);
      if (!alive) return;
      settings = next.settings; savedRuntime = next.runtime; runtime = next.runtime;
      authorization = '';
    } catch (reason) { if (alive) error = readableError(reason); }
    finally { busy = false; loading = false; }
  }
  function selectProvider(id: string) {
    providerId = id;
    const next = settings?.providers.find(item => item.id === id);
    protocol = next?.apiType ?? next?.supported[0] ?? '';
    baseUrl = next?.baseUrl ?? ''; authorization = '';
  }
</script>

<section class="bot-agent-settings" aria-label="Bot agent settings" aria-busy={busy}>
  <h3>Agent</h3>
  <div class="runtime-grid" class:loading={registryLoading} role="radiogroup" aria-label="Bot agent" aria-busy={registryLoading} use:scrollFade={registry.length}>
    <button type="button" class="runtime-card" role="radio" aria-checked={selected === 'polymux'} disabled={busy} onclick={() => choose()}><span class="runtime-card-icon polymux"><img src="polymux.svg" alt=""/></span><strong>Polymux</strong><small>Built in</small></button>
    {#each registry as entry (entry.id)}
      <button type="button" class="runtime-card" role="radio" aria-label={entry.name} aria-checked={selected === entry.id} disabled={busy || !entry.command} onclick={() => choose(entry)}>
        <span class="runtime-card-icon">{#if entry.icon}<img src={entry.icon} alt=""/>{:else}<Icon name="bot" size={18}/>{/if}</span><strong>{entry.name}</strong><small>{!entry.command ? 'Unavailable' : entry.installed ? 'Installed' : 'ACP'}</small>
      </button>
    {/each}
    <button type="button" class="runtime-card" role="radio" aria-checked={selected === 'custom'} disabled={busy} onclick={chooseCustom}><span class="runtime-card-icon"><Icon name="plus" size={18}/></span><strong>Custom</strong><small>Name and command</small></button>
    {#if registryLoading}{#each Array(6) as _}<div class="runtime-card runtime-placeholder" aria-hidden="true"><span></span><span></span></div>{/each}{/if}
  </div>
  {#if registryLoading}<p class="agent-status" role="status">Loading available agents…</p>{/if}
  {#if registryError}<div class="agent-status" role="alert">{registryError}<button type="button" onclick={() => void loadRegistry(hostId)}>Retry agent list</button></div>{/if}
  {#if runtime?.kind === 'acp' && (custom || selected === 'custom')}
    <div class="agent-fields">
      <label>Name<input bind:value={runtime.name} disabled={busy}/></label>
      <label>Command<input bind:value={runtime.command} disabled={busy} placeholder="codex-acp" spellcheck="false"/></label>
      <label>Arguments<textarea value={(runtime.args ?? []).join('\n')} disabled={busy} placeholder="One argument per line" oninput={event => updateArgs(event.currentTarget.value)} spellcheck="false"></textarea></label>
    </div>
  {/if}
  {#if error}<div class="agent-status" role="alert">{error}<button type="button" disabled={busy} onclick={() => {void loadRegistry(hostId); if (bot && !changed) void perform({action:'get'});}}>Try again</button></div>{/if}
  {#if loading}<p class="agent-status" role="status">Loading agent settings…</p>
  {:else if changed || !bot}<p class="agent-status">Save the bot to configure its agent.</p>
  {:else if runtime?.kind === 'acp' && settings}
    <div class="agent-controls">
      <p class="agent-status">Agent options save automatically for this bot.</p>
      {#if settings.authMethods.length || settings.supportsLogout || settings.authRequired}
        <h4>Authentication</h4>
        {#each settings.authMethods as method (method.id)}<button type="button" class="agent-action" disabled={busy || !method.available} onclick={() => void perform({action:'authenticate', methodId:method.id})}>{method.name}</button>{/each}
        {#if settings.supportsLogout}<button type="button" class="agent-action" disabled={busy} onclick={() => void perform({action:'logout'})}>Sign out</button>{/if}
        {#if settings.authRequired}<small>Sign in to configure this bot’s agent.</small>{/if}
      {/if}
      {#if !settings.authRequired}
        {#each settings.configOptions as option (option.id)}
          <div class="agent-option"><span>{option.name}</span>
            {#if option.type === 'boolean'}<button type="button" role="switch" class="agent-toggle" aria-label={option.name} aria-checked={option.currentValue} disabled={busy} onclick={() => void perform({action:'option',id:option.id,value:!option.currentValue})}><span></span></button>
            {:else}<div class="agent-option-menu" inert={busy}><Menu options={option.options.map(item => ({value:item.value,label:item.name}))} value={option.currentValue} label={option.name} wide floating onChange={value => void perform({action:'option',id:option.id,value})}/></div>{/if}
          </div>
        {/each}
        {#if settings.supportsProviders}
          <h4>Providers</h4>
          <Menu options={settings.providers.map(item => ({value:item.id,label:item.id}))} value={providerId} label="Agent provider" wide floating onChange={selectProvider}/>
          {#if provider}
            <div class="agent-fields">
              <label>Protocol<select bind:value={protocol} disabled={busy}>{#each provider.supported as item}<option value={item}>{item}</option>{/each}</select></label>
              <label>Base URL<input bind:value={baseUrl} disabled={busy} placeholder="https://api.example.com"/></label>
              <label>Authorization<input bind:value={authorization} disabled={busy} type="password" autocomplete="off" placeholder="Bearer …"/></label>
            </div>
            <div class="agent-provider-actions">
              {#if !provider.required}<button type="button" disabled={busy || !provider.baseUrl} onclick={() => void perform({action:'disableProvider',id:providerId})}>Disable provider</button>{/if}
              <button type="button" disabled={busy || !protocol || !baseUrl.trim()} onclick={() => void perform({action:'provider',provider:{id:providerId,apiType:protocol,baseUrl:baseUrl.trim(),...(authorization ? {headers:{Authorization:authorization}} : {})}})}>Save provider</button>
            </div>
          {/if}
        {/if}
        {#if !settings.configOptions.length && !settings.supportsProviders}<p class="agent-status">This agent does not advertise additional options.</p>{/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .bot-agent-settings { min-width:0; margin-top:18px; }
  h3,h4 { margin:0; font-size:13px; font-weight:550; }
  h4 { margin-top:16px; }
  .runtime-grid { max-height:264px; display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); align-content:start; gap:7px; overflow:auto; margin:12px 0; padding:3px; scrollbar-width:none; }
  .runtime-grid.loading { height:264px; }
  .runtime-placeholder { pointer-events:none; }
  .runtime-placeholder span { height:10px; width:65%; border-radius:3px; background:var(--neutral-150,var(--neutral-200)); }
  .runtime-placeholder span:first-child { width:18px; height:18px; margin-bottom:5px; }
  .runtime-grid::-webkit-scrollbar { display:none; }
  .runtime-card { min-width:0; height:82px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:3px; border:1px solid var(--neutral-200); border-radius:10px; padding:9px; background:var(--app-surface); color:var(--neutral-600); cursor:pointer; text-align:left; font:inherit; }
  .runtime-card:hover { border-color:var(--neutral-400); color:var(--neutral-950); }
  .runtime-card:focus-visible { outline:2px solid var(--focus-ring); outline-offset:1px; }
  .runtime-card[aria-checked=true] { border-color:var(--neutral-700); background:var(--neutral-100); color:var(--neutral-950); }
  .runtime-card strong,.runtime-card small { display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .runtime-card strong { font-size:12px; font-weight:550; }
  .runtime-card small,.agent-status,small { color:var(--neutral-500); font-size:11px; }
  .runtime-card-icon { width:18px; height:18px; display:grid; place-items:center; }
  .runtime-card-icon img { width:18px; height:18px; object-fit:contain; }
  :global([data-theme=dark]) .runtime-card-icon img { filter:brightness(0) invert(1); }
  button:disabled { opacity:.5; cursor:default; }
  .agent-fields { display:grid; gap:12px; }
  label { display:flex; flex-direction:column; gap:6px; font-size:12px; }
  input,textarea,select { width:100%; min-width:0; box-sizing:border-box; background:var(--app-surface); color:var(--neutral-950); border:1px solid var(--neutral-200); border-radius:6px; padding:8px; font:inherit; }
  textarea { resize:vertical; min-height:58px; scrollbar-width:none; }
  textarea::-webkit-scrollbar { display:none; }
  .agent-status { margin:12px 0; display:flex; gap:12px; align-items:center; }
  .agent-status[role=alert] { color:var(--status-error-text); }
  .agent-controls { display:flex; flex-direction:column; gap:10px; }
  .agent-option { display:flex; align-items:center; justify-content:space-between; gap:14px; min-width:0; font-size:12px; }
  .agent-option > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .agent-option-menu { min-width:0; max-width:65%; }
  .agent-action,.agent-provider-actions button,.agent-status button { padding:0; border:0; background:none; color:var(--neutral-600); cursor:pointer; font:inherit; text-align:left; }
  .agent-action:hover,.agent-provider-actions button:hover,.agent-status button:hover { color:var(--neutral-950); }
  .agent-provider-actions { display:flex; justify-content:flex-end; gap:16px; font-size:12px; }
  .agent-toggle { width:30px; height:18px; padding:2px; border:0; border-radius:10px; background:var(--neutral-300); flex:none; }
  .agent-toggle span { display:block; width:14px; height:14px; border-radius:50%; background:var(--app-surface); }
  .agent-toggle[aria-checked=true] { background:var(--neutral-900); }
  .agent-toggle[aria-checked=true] span { transform:translateX(12px); }
</style>
