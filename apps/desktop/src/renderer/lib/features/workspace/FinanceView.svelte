<script lang="ts">
  import AppSettingsButton from './AppSettingsButton.svelte';
  import {onMount} from 'svelte';
  import {fade} from 'svelte/transition';
  import type {FinanceAccountDto, FinanceTransactionDto} from '@polymux/protocol';
  import {polymuxApi} from '../../api/polymux';
  import Icon from '../../shared/components/Icon.svelte';
  import {scrollFade, scrollFadeX} from '../../shared/scrollFade';
  import {clockTime} from '../../shared/displayTime';

  let {onOpenSettings, settingsOnly = false}: {onOpenSettings?: () => void; settingsOnly?: boolean} = $props();
  const api = polymuxApi();
  let tab = $state<'accounts' | 'payments' | 'access'>('accounts');
  const currentTab = $derived(settingsOnly ? 'access' : tab);
  let connections = $state<Array<{id: string; name: string}>>([]);
  let serverId = $state('');
  let accounts = $state<FinanceAccountDto[]>([]);
  let transactions = $state<FinanceTransactionDto[]>([]);
  let selected = $state('');
  let continuation = $state<string | null>(null);
  let fetchedAt = $state('');
  let loading = $state(false);
  let discovering = $state(true);
  let error = $state('');
  let revision = 0;
  const account = $derived(accounts.find(a => a.id === selected));
  const money = (value: number | null, currency: string) => value === null ? 'Unavailable' : new Intl.NumberFormat(undefined, {style: 'currency', currency}).format(value);
  let transactionsReady = $state(false);
  const activityTotals = $derived.by(() => {
    const relevant = transactions.filter(t => t.currency === account?.currency);
    return {
      incoming: relevant.reduce((sum, t) => sum + Math.max(0, t.amount), 0),
      outgoing: relevant.reduce((sum, t) => sum + Math.max(0, -t.amount), 0),
      otherCurrencies: relevant.length !== transactions.length,
    };
  });
  const transactionGroups = $derived.by(() => {
    const groups = new Map<string, FinanceTransactionDto[]>();
    for (const transaction of transactions) {
      const key = transaction.date.slice(0, 10);
      groups.set(key, [...(groups.get(key) ?? []), transaction]);
    }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
  });
  function dateLabel(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Date unavailable';
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'});
  }
  async function discover() {
    discovering = true;
    try {
      const servers = await api.mcp.list();
      // Only metadata stays in component state; MCP credentials do not.
      connections = servers.filter(s => s.enabled && s.status === 'connected' && s.toolNames.some(n => n.endsWith('__list_accounts')) && s.toolNames.some(n => n.endsWith('__get_transactions'))).map(s => ({id: s.id, name: s.name}));
    } catch { error = 'Could not load bank connections.'; }
    finally { discovering = false; }
  }
  function changeConnection() {
    revision++; transactionsReady = false; accounts = []; transactions = []; selected = ''; continuation = null; fetchedAt = ''; error = ''; loading = false;
  }
  async function refresh() {
    const current = ++revision;
    loading = true; transactionsReady = false; error = ''; accounts = []; transactions = []; selected = ''; continuation = null; fetchedAt = '';
    try {
      const data = await api.finance.read({serverId});
      if (current !== revision) return;
      accounts = data.accounts; fetchedAt = data.fetchedAt;
      if (accounts[0]) await selectAccount(accounts[0].id);
    } catch (e) { if (current === revision) error = e instanceof Error ? e.message : 'Could not read bank accounts.'; }
    finally { if (current === revision) loading = false; }
  }
  async function selectAccount(id: string, more = false) {
    const current = ++revision;
    selected = id; loading = true; error = '';
    const cursor = more ? continuation : null;
    if (!more) { transactionsReady = false; transactions = []; continuation = null; }
    try {
      const data = await api.finance.read({serverId, accountId: id, ...(cursor ? {continuation: cursor} : {})});
      if (current !== revision) return;
      transactions = more ? [...transactions, ...data.transactions] : data.transactions;
      continuation = data.continuation; transactionsReady = true;
    } catch (e) { if (current === revision) error = e instanceof Error ? e.message : 'Could not read transactions.'; }
    finally { if (current === revision) loading = false; }
  }
  onMount(() => { void discover(); return () => { revision++; }; });
</script>

<div class="finance">
  {#if !settingsOnly}<header><h1>Finance</h1><AppSettingsButton name="Finance" onclick={onOpenSettings}/></header>
  <nav aria-label="Finance sections">
    <button class:active={currentTab === 'accounts'} onclick={() => tab = 'accounts'}>Accounts</button>
    <button class:active={currentTab === 'payments'} onclick={() => tab = 'payments'}>Agent cards</button>

  </nav>{/if}
  <div class="finance-content" use:scrollFade>
    {#if currentTab === 'accounts'}
      {#if connections.length}<div class="toolbar">
        <select aria-label="BankMCP connection" bind:value={serverId} onchange={changeConnection} disabled={loading || discovering}>
          <option value="">Choose bank connection</option>
          {#each connections as connection}<option value={connection.id}>{connection.name}</option>{/each}
        </select>
        <button disabled={!serverId || loading} onclick={refresh}>{loading ? 'Reading…' : 'Refresh'}</button>
      </div>{/if}
      {#if error}<p role="alert">{error}</p>{/if}
      {#if accounts.length}
        <section class="card-area" aria-label="Bank accounts">

          <div class="card-rail" use:scrollFadeX>
            {#each accounts as a, index (a.id)}
              <button class="bank-card" class:selected={selected === a.id} data-tone={index % 3} aria-pressed={selected === a.id} onclick={() => selectAccount(a.id)}>
                <span class="card-top"><span class="bank-name">{a.bank || 'Bank account'}</span><span class="currency">{a.currency}</span></span>
                <span class="card-balance">{money(a.booked, a.currency)}</span>
                <span class="card-balance-label">Booked balance</span>
                <span class="card-bottom"><span class="account-name">{a.name}</span><span class="account-type">Account</span></span>
              </button>
            {/each}
          </div>
          <div class="card-caption"><span>{account?.error ?? (account?.balanceDate ? `Balance as of ${account.balanceDate}` : 'Read-only bank connection')}</span><span>Read {clockTime(new Date(fetchedAt))}</span></div>
        </section>
        {#if account}
          <div class="statement-panel"><section class="insights" aria-label="Account summary">
            <div class="insights-heading"><span>Overview</span><small>{continuation ? 'Last 30 days · partial' : 'Last 30 days'}</small></div>
            <div class="metrics">
              <div><span>Available</span><strong>{money(account.available, account.currency)}</strong></div>
              <div><span>Money in</span><strong class="incoming">{transactionsReady ? money(activityTotals.incoming, account.currency) : '—'}</strong></div>
              <div><span>Money out</span><strong>{transactionsReady ? money(activityTotals.outgoing, account.currency) : '—'}</strong></div>
            </div>
            {#if activityTotals.otherCurrencies}<small>Activity totals include {account.currency} only.</small>{/if}
          </section>
          <section class="activity" aria-label="Transactions" aria-busy={loading}>
            <div class="section-heading"><h2>Transactions</h2><span class="muted">{account.name}</span></div>
            {#key selected}
              <div in:fade={{duration: 140}}>
                {#each transactionGroups as [date, rows] (date)}
                  <section class="transaction-group" aria-label={dateLabel(date)}>
                    <h3>{dateLabel(date)}</h3>
                    {#each rows as transaction}
                      <div class="transaction">
                        <span class="transaction-icon" aria-hidden="true"><Icon name={transaction.amount > 0 ? 'plus' : 'arrow-up-right'} size={16}/></span>
                        <div class="transaction-copy"><span>{transaction.description}</span><small>{transaction.status}</small></div>
                        <span class="amount" class:incoming={transaction.amount > 0}>{transaction.amount > 0 ? '+' : ''}{money(transaction.amount, transaction.currency)}</span>
                      </div>
                    {/each}
                  </section>
                {:else}<div class="empty small">{loading ? 'Reading transactions…' : transactionsReady ? 'No transactions in this period' : 'Transactions unavailable'}</div>{/each}
              </div>
            {/key}
            {#if continuation}<button class="load-more" disabled={loading} onclick={() => selectAccount(selected, true)}>{loading ? 'Reading…' : 'Load more transactions'}</button>{/if}
          </section></div>
        {/if}
      {:else}
        <section class="card-area" aria-label="Bank accounts">
          <div class="unconnected-card">
            <div class="card-top"><span class="card-brand">Polymux</span><Icon name="shield" size={18}/></div>
            <div class="empty-card-balance">—</div>
            <span class="card-balance-label">{loading || discovering ? 'Loading accounts…' : 'No account connected'}</span>
            <div class="card-bottom"><span>Bank account</span><button onclick={() => tab = 'access'}>Connect bank <span aria-hidden="true">↗</span></button></div>
          </div>
          <p class="empty-card-caption">Bank accounts · read-only</p>
        </section>
        <div class="statement-panel">
          <section class="insights" aria-label="Account summary unavailable"><div class="insights-heading"><span>Overview</span><small>Last 30 days</small></div><div class="metrics"><div><span>Available</span><strong>—</strong></div><div><span>Money in</span><strong>—</strong></div><div><span>Money out</span><strong>—</strong></div></div></section>
          <section class="activity"><h2>Transactions</h2><div class="empty small"><Icon name="chart" size={20}/><p>{loading || discovering ? 'Loading…' : 'No activity yet'}</p><small>Transactions appear when you connect a bank.</small></div></section>
        </div>
      {/if}
    {:else if currentTab === 'payments'}
      <section class="payment-intro"><div class="agent-card"><span class="card-top"><span class="card-brand">Polymux</span><Icon name="shield" size={18}/></span><strong>Agent card</strong><span>Not issued</span><span class="card-bottom">You set the limits.</span></div></section>
      <div class="statement-panel payment-details"><div class="section-heading"><h2>Agent spending</h2><span class="muted">Not connected</span></div><p class="muted">Give your agent a separate card with a budget you control.</p><div class="payment-row"><span>Provider</span><span>Stripe Issuing</span></div><div class="payment-row"><span>Card & funding</span><span>Setup required</span></div><a class="provider-link" href="https://docs.stripe.com/issuing/agents" target="_blank" rel="noreferrer">View provider requirements ↗</a></div>
    {:else}
      <section class="setup"><h2>Bank connections</h2><p class="muted">Connect a BankMCP server to view your accounts.</p><div class="payment-row"><span>BankMCP</span><span>{connections.length ? `${connections.length} connected` : 'Not connected'}</span></div><div class="connection-actions"><a href="https://github.com/noskillish/bankmcp" target="_blank" rel="noreferrer">Setup guide ↗</a><button disabled={discovering} onclick={discover}>{discovering ? 'Checking…' : 'Check connections'}</button></div><details><summary>Connection details</summary><p>Add your server in Polymux Connections, complete bank consent, then select it in Finance.</p><p>BankMCP currently supports European banks. Additional regions need regional providers.</p><p>Agent access is assigned separately in the agent’s Connections settings. BankMCP cannot make payments.</p></details>{#if error}<p role="alert">{error}</p>{/if}</section>
    {/if}
  </div>
</div>

<style>
  .finance {height:100%;width:100%;min-width:0;min-height:0;display:flex;flex-direction:column;color:var(--on-surface);font-size:13px;background:var(--app-bg);container-type:inline-size}
  header {display:flex;align-items:center;justify-content:space-between;padding:24px 28px 12px;flex-shrink:0}
  h1,h2,h3,p {margin:0}h1 {font-size:19px;font-weight:550;letter-spacing:-.5px}h2 {font-size:13px;font-weight:550}p {line-height:1.6}.muted,small {color:var(--secondary)}small {font-size:11px}
  button,a {font:inherit;color:inherit;border:0;background:none;padding:0;cursor:pointer;text-decoration:none;transition:color .15s}button:hover,a:hover {color:var(--secondary)}button:disabled {color:var(--disabled-text);cursor:default}button:focus-visible,a:focus-visible,summary:focus-visible {outline:2px solid var(--link-text);outline-offset:4px}
  nav {display:flex;gap:24px;padding:0 28px;flex-shrink:0}nav button {font-size:12px;color:var(--secondary);padding:9px 0 12px}nav button.active {color:var(--on-surface);font-weight:550;text-decoration:underline;text-underline-offset:12px;text-decoration-thickness:1px}
   .finance-content {display:block;position:relative;box-sizing:border-box;width:100%;height:auto;flex:1;min-width:0;min-height:0;overflow:auto;scrollbar-width:none;padding:0 28px 28px}.finance-content::-webkit-scrollbar,.card-rail::-webkit-scrollbar {display:none}.finance-content>* {max-width:900px;min-width:0;box-sizing:border-box;margin-left:auto;margin-right:auto}
  .toolbar {display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:20px;font-size:11px}select {font:inherit;border:0;background:var(--app-bg);color:var(--secondary);max-width:75%;min-width:0;padding:4px 0}.toolbar button {color:var(--secondary)}[role='alert'] {color:var(--danger);font-size:12px;margin-top:16px}
  .card-area {padding:28px 0 24px}.card-rail {display:flex;gap:16px;overflow-x:auto;scrollbar-width:none;scroll-snap-type:x proximity;padding:4px 4px 12px}.card-rail:has(>.bank-card:only-child) {justify-content:center}
  .bank-card,.unconnected-card,.agent-card {box-sizing:border-box;width:min(100%,350px);aspect-ratio:1.65;min-width:0;border-radius:14px;padding:22px 24px;display:flex;flex-direction:column;text-align:left;color:#fafaf8;background:radial-gradient(ellipse at 0 0,#505756 0,transparent 65%),linear-gradient(130deg,#303634,#171c1a);box-shadow:0 8px 20px #00000010}
  .bank-card {flex:0 0 min(350px,92%);scroll-snap-align:center;outline:1px solid transparent;outline-offset:3px}.bank-card.selected {outline-color:var(--outline)}.bank-card:hover {color:#fff}.bank-card[data-tone='1'] {background:radial-gradient(ellipse at 0 0,#545966 0,transparent 65%),linear-gradient(130deg,#333944,#20242d)}.bank-card[data-tone='2'] {background:radial-gradient(ellipse at 0 0,#665e51 0,transparent 65%),linear-gradient(130deg,#3d372e,#29251e)}
  .unconnected-card,.agent-card {margin:auto}.card-top,.card-bottom {display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}.card-brand {font-size:13px;font-weight:550;letter-spacing:-.3px}.bank-name,.account-name {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.bank-name {font-size:12px}.currency,.account-type {font-size:10px;flex-shrink:0;opacity:.65}.card-balance,.empty-card-balance {font-size:32px;font-weight:450;letter-spacing:-1px;line-height:1.2;margin-top:28px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card-balance-label {font-size:11px;color:#ffffff8c;margin-top:5px}.card-bottom {font-size:11px;margin-top:auto;padding-top:22px}.card-bottom>span {opacity:.8}.card-bottom button {color:#fff;font-size:11px}.card-bottom button:hover {color:#ffffffb0}.card-bottom button span {margin-left:6px}.empty-card-caption {text-align:center;font-size:11px;color:var(--secondary);margin-top:16px}
  .card-caption {display:flex;justify-content:center;gap:12px;min-width:0;color:var(--secondary);font-size:10px;margin-top:6px}.card-caption span:first-child {overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card-caption span:last-child {flex-shrink:0}
  .statement-panel {border-radius:18px;background:var(--surface-low);overflow:hidden}.insights {padding:20px 24px 22px}.insights-heading,.section-heading {display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}.insights-heading {font-size:12px;font-weight:500;margin-bottom:20px}.insights-heading small {font-weight:400;font-size:10px}.metrics {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.metrics>div {display:flex;flex-direction:column;gap:7px;min-width:0}.metrics span {font-size:10px;color:var(--secondary)}.metrics strong {font-size:19px;line-height:1.25;font-weight:500;letter-spacing:-.5px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.insights>small {display:block;margin-top:12px}.incoming {color:var(--success-text)}
  .activity {margin:0 6px 6px;background:var(--app-bg);border-radius:13px;padding:20px 18px 4px}.section-heading>.muted {font-size:10px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.transaction-group {margin-top:22px}.transaction-group h3 {font-size:10px;font-weight:450;color:var(--secondary);margin-bottom:5px}.transaction {display:flex;gap:8px;align-items:flex-start;padding:13px 0;min-width:0}.transaction-icon {height:18px;flex:0 0 20px;display:flex;align-items:center;color:var(--secondary)}.transaction-copy {display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}.transaction-copy>span {font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.transaction-copy small {font-size:10px}.amount {font-size:12px;line-height:18px;flex-shrink:0;white-space:nowrap;font-variant-numeric:tabular-nums}.load-more {display:block;margin:18px auto;font-size:11px}.empty.small {min-height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--secondary);text-align:center}.empty p {font-size:12px;color:var(--on-surface)}.empty small {font-size:10px}.empty :global(svg) {margin-bottom:4px}
  .payment-intro {padding:32px 0}.agent-card strong {font-size:27px;font-weight:450;letter-spacing:-.7px;margin-top:30px}.agent-card>span:not(.card-top) {font-size:11px;color:#ffffff9c;margin-top:6px}.agent-card .card-bottom {margin-top:auto}.payment-details {padding:24px}.payment-details>p {font-size:12px;margin-top:10px}.payment-row {display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:12px;padding:16px 0}.payment-row span:last-child {color:var(--secondary);text-align:right}.provider-link {display:inline-block;margin-top:12px;font-size:12px}.setup {padding-top:32px}.setup>p {margin-top:10px;font-size:12px}.connection-actions {display:flex;gap:24px;font-size:12px;margin:10px 0 28px}details {font-size:12px;color:var(--secondary)}summary {cursor:pointer}details p {margin-top:14px;max-width:480px}
  @container(max-width:400px){header {padding:20px 18px 10px}nav {padding:0 18px} .finance-content {padding:0 18px 18px}.card-area {padding-top:24px}.bank-card,.unconnected-card,.agent-card {padding:20px;min-height:190px}.insights {padding:18px}.metrics {gap:10px}.metrics strong {font-size:16px}.activity {padding:18px 12px 0}}
  @container(min-width:780px){.card-rail {justify-content:safe center}.card-area {padding-top:36px;padding-bottom:28px}.insights {padding:24px 28px}.activity {padding:24px 22px 8px}.metrics strong {font-size:23px}}
  @container(max-width:340px){.metrics {grid-template-columns:repeat(2,minmax(0,1fr))}.metrics>div:first-child {grid-column:1 / -1}.insights-heading {align-items:flex-start;gap:8px}.insights-heading small {text-align:right}.card-caption {flex-wrap:wrap;gap:4px}.bank-card,.unconnected-card {padding:16px;min-height:180px}.card-balance {font-size:26px}.empty small {max-width:180px}}
  @media(prefers-reduced-motion:reduce){button,a {transition:none}}
</style>
