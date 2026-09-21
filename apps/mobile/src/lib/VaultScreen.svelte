<script lang="ts">
  import type {
    JsonValue,
    VaultItemDto,
    VaultItemInputDto,
    VaultListDto,
    VaultSecretsDto,
    VaultStatusDto,
    VaultTotpDto,
  } from '@polymux/protocol';
  import {
    VaultSelectionGate,
    emptyVaultDraft,
    vaultEditDraft,
    normalizeVaultSaveDraft,
    type VaultDraftKind,
    type VaultSelectionRequest,
  } from '@polymux/protocol';
  import {onDestroy, onMount} from 'svelte';
  import type {AccountStatus} from '@polymux/vault';
  import {mobileAccount as getMobileAccount} from './account';
  import {createDeviceVault} from './device-vault';
  import Icon from './Icon.svelte';
  import {isApplePhone, signOutMobileAccount} from './account';
  import {autoFillEnabled, disableAutoFill, updateAutoFill} from './autofill';
  let autofill = $state(autoFillEnabled());
  let autofillNotice = $state('');

  async function toggleAutoFill() {
    if (busy) return;
    busy = true; error = '';
    try {
      if (autofill) await disableAutoFill();
      else await updateAutoFill(vault.call);
      autofill = autoFillEnabled();
      autofillNotice = autofill ? 'Enable Polymux in Settings → General → AutoFill & Passwords. AutoFill requires your device passcode or biometrics.' : '';
    } catch (cause) { error = readable(cause); }
    finally { busy = false; }
  }

  let {online = false, call}: {
    online?: boolean;
    call?: (method: string, args?: JsonValue[]) => Promise<unknown>;
  } = $props();

  const mobileAccount = getMobileAccount();
  const vault = createDeviceVault({
    host: (method, args) => {
      if (!call) throw new Error('Host unavailable');
      return call(method, args);
    },
    online: () => Boolean(online && call),
    cloud: mobileAccount?.cloud ?? null,
  });

  const selectionGate = new VaultSelectionGate();

  let status = $state<VaultStatusDto | null>(null);
  let list = $state<VaultListDto>({groups: [], items: [], trash: []});
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let master = $state('');
  let confirm = $state('');
  let query = $state('');
  let selectedId = $state<string | null>(null);
  let secrets = $state<VaultSecretsDto | null>(null);
  let secretsOwnerId = $state<string | null>(null);
  let loadedRequest: VaultSelectionRequest | null = null;
  let totp = $state<VaultTotpDto | null>(null);
  let showPassword = $state(false);
  let copied = $state('');
  let editing = $state(false);
  let creating = $state<VaultDraftKind | null>(null);
  let draft = $state<VaultItemInputDto>(emptyVaultDraft('password'));
  let totpTimer: ReturnType<typeof setInterval> | undefined;

  const selected = $derived(list.items.find((item) => item.id === selectedId) ?? null);
  const filtered = $derived(
    query.trim()
      ? list.items.filter((item) =>
          [item.title, item.username, item.url, item.groupName].join(' ').toLowerCase().includes(query.trim().toLowerCase()),
        )
      : list.items,
  );
  const locked = $derived(!status?.exists || !status.unlocked);
  const syncOn = $derived((status?.sync.storage ?? 'account') === 'account');
  let pendingDelete = $state(false);
  let account = $state<AccountStatus | null>(null);
  let accountEmail = $state('');
  let accountPassword = $state('');
  let showSignIn = $state(false);

  onMount(() => {
    void (async () => {
      await mobileAccount?.ready;
      account = mobileAccount?.client.status() ?? null;
      await refresh();
    })();
  });

  onDestroy(() => {
    clearSecrets();
  });

  function clearSecrets(): void {
    selectionGate.invalidate();
    loadedRequest = null;
    secretsOwnerId = null;
    secrets = null;
    totp = null;
    if (totpTimer) clearInterval(totpTimer);
    totpTimer = undefined;
  }

  async function refresh(): Promise<void> {
    loading = true;
    error = '';
    try {
      status = await vault.call('vault.status') as VaultStatusDto;
      if (status.unlocked) await loadList(selectedId);
    } catch (cause) {
      error = readable(cause);
    } finally {
      loading = false;
    }
  }

  async function loadList(keep?: string | null): Promise<void> {
    list = await vault.call('vault.list') as VaultListDto;
    clearSecrets();
    selectedId = keep && list.items.some((item) => item.id === keep) ? keep : list.items[0]?.id ?? null;
    if (selectedId) await loadSecrets(selectedId);
    else clearSecrets();
  }

  async function loadSecrets(id: string): Promise<void> {
    const request = selectionGate.begin(id);
    const revealed = await vault.call('vault.reveal', [id]) as VaultSecretsDto;
    if (!selectionGate.accepts(request, selectedId) || locked) return;
    secrets = revealed;
    secretsOwnerId = id;
    loadedRequest = request;
    totp = revealed.totp;
    armTotp(id, request);
  }

  function armTotp(id: string, request: VaultSelectionRequest): void {
    if (totpTimer) clearInterval(totpTimer);
    if (!list.items.find((item) => item.id === id)?.hasTotp || !selectionGate.accepts(request, selectedId)) return;
    totpTimer = setInterval(() => {
      void vault.call('vault.totp', [id]).then((value) => {
        if (selectionGate.accepts(request, selectedId) && secretsOwnerId === id && !locked)
          totp = value as VaultTotpDto | null;
      }).catch(() => {});
    }, 1000);
  }

  async function submitGate(): Promise<void> {
    if (busy) return;
    busy = true;
    error = '';
    try {
      if (!status?.exists) {
        if (master.length < 8) throw new Error('Use at least 8 characters');
        if (master !== confirm) throw new Error('Passwords do not match');
        status = await vault.call('vault.create', [master]) as VaultStatusDto;
      } else {
        status = await vault.call('vault.unlock', [master]) as VaultStatusDto;
      }
      master = '';
      confirm = '';
      await loadList();
    } catch (cause) {
      error = readable(cause);
    } finally {
      busy = false;
    }
  }

  async function lock(): Promise<void> {
    selectedId = null;
    clearSecrets();
    status = await vault.call('vault.lock') as VaultStatusDto;
    list = {groups: [], items: [], trash: []};
    editing = false;
    creating = null;
  }

  async function signInAccount(): Promise<void> {
    if (!mobileAccount || busy) return;
    busy = true;
    error = '';
    try {
      const result = await mobileAccount.client.signInWithPassword(accountEmail.trim(), accountPassword);
      account = result;
      accountPassword = '';
      if (!result.signedIn) {
        error = result.error || 'Could not sign in.';
        return;
      }
      showSignIn = false;
      await refresh();
    } catch (cause) {
      error = readable(cause);
    } finally {
      busy = false;
    }
  }

  async function signOutAccount(): Promise<void> {
    if (!mobileAccount) return;
    try {
      await lock();
      account = await signOutMobileAccount() ?? null;
      showSignIn = false;
    } catch (cause) { error = readable(cause); }
  }

  async function select(id: string): Promise<void> {
    selectedId = id;
    editing = false;
    creating = null;
    error = '';
    clearSecrets();
    await loadSecrets(id);
  }

  function startCreate(kind: VaultDraftKind): void {
    creating = kind;
    editing = true;
    selectedId = null;
    clearSecrets();
    draft = emptyVaultDraft(kind);
  }

  function startEdit(): void {
    if (!selected || secretsOwnerId !== selected.id || !secrets) return;
    creating = null;
    editing = true;
    draft = vaultEditDraft(selected, secrets);
  }

  async function setSyncOn(next: boolean): Promise<void> {
    busy = true;
    try {
      status = await vault.call('vault.setStorage', [next ? 'account' : 'local']) as VaultStatusDto;
      error = '';
    } catch (cause) {
      error = readable(cause);
    } finally {
      busy = false;
    }
  }

  async function removeSelected(): Promise<void> {
    if (!selected) return;
    busy = true;
    try {
      list = await vault.call('vault.remove', [selected.id]) as VaultListDto;
      pendingDelete = false;
      selectedId = list.items[0]?.id ?? null;
      clearSecrets();
      if (selectedId) await loadSecrets(selectedId);
      else clearSecrets();
      error = '';
    } catch (cause) {
      error = readable(cause);
    } finally {
      busy = false;
    }
  }

  async function saveDraft(): Promise<void> {
    if (!draft.title.trim()) {
      error = 'Title is required';
      return;
    }
    busy = true;
    try {
      const saved = await vault.call('vault.save', [normalizeVaultSaveDraft(draft) as unknown as JsonValue]) as VaultItemDto;
      creating = null;
      editing = false;
      error = '';
      await loadList(saved.id);
    } catch (cause) {
      error = readable(cause);
    } finally {
      busy = false;
    }
  }

  async function copy(field: 'password' | 'username' | 'url' | 'totp' | 'recovery', recoveryIndex?: number): Promise<void> {
    if (!selected) return;
    const text = await vault.call('vault.copy', [selected.id, field, recoveryIndex ?? null]) as string;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      error = 'Copy is not available';
      return;
    }
    copied = field === 'recovery' ? `recovery:${recoveryIndex}` : field;
    setTimeout(() => {
      if (copied === (field === 'recovery' ? `recovery:${recoveryIndex}` : field)) copied = '';
    }, 1200);
  }

  function mark(item: VaultItemDto): 'key' | 'lock' {
    return item.hasTotp && !item.hasPassword ? 'lock' : 'key';
  }

  function readable(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }
</script>

<section class="vault-pane" aria-label="Vault">
  {#if loading}
    <div class="vault-empty"><p>Opening Vault…</p></div>
  {:else if locked}
    <div class="vault-empty">
      <Icon name="key" size={42} strokeWidth={1.45} />
      <h2>Vault</h2>
      <form class="vault-gate" onsubmit={(event) => { event.preventDefault(); void submitGate(); }}>
        <label>Master password <input type="password" bind:value={master} autocomplete={status?.exists ? 'current-password' : 'new-password'} /></label>
        {#if !status?.exists}
          <label>Confirm <input type="password" bind:value={confirm} autocomplete="new-password" /></label>
        {/if}
        {#if error}<p class="vault-error">{error}</p>{/if}
        <button type="submit" disabled={busy}>{status?.exists ? 'Unlock' : 'Create vault'}</button>
        {@render storageControl()}
      </form>
      {@render accountControl()}
    </div>
  {:else}
    {#if isApplePhone()}
      <button class="quiet" type="button" disabled={busy} onclick={() => void toggleAutoFill()}>{autofill ? 'Disable AutoFill' : 'Enable password and code AutoFill'}</button>
      {#if autofillNotice}<p role="status">{autofillNotice}</p>{/if}
    {/if}
    <div class="vault-tools">
      <div class="vault-search">
        <Icon name="search" size={17} strokeWidth={1.5} />
        <input type="search" bind:value={query} placeholder="Search vault" aria-label="Search vault" />
      </div>
      <button type="button" class="icon-button" onclick={() => startCreate('password')} aria-label="Add password"><Icon name="plus" size={20} /></button>
      <button type="button" class="icon-button" onclick={() => void lock()} aria-label="Lock"><Icon name="lock" size={18} /></button>
    </div>
    {@render storageControl()}
    {@render accountControl()}
    {#if error}<p class="vault-error pad">{error}</p>{/if}
    {#if editing}
      <form class="vault-editor" onsubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
        <label>Title <input bind:value={draft.title} /></label>
        <label>Username <input bind:value={draft.username} /></label>
        {#if !creating || creating === 'password'}
          <label>Password <input type="password" bind:value={draft.password} autocomplete="off" /></label>
        {/if}
        {#if !creating || creating === 'password' || creating === 'totp'}
          <label>Address <input bind:value={draft.url} /></label>
        {/if}
        {#if !creating || creating === 'totp' || creating === 'password'}
          <label>Authenticator secret <input bind:value={draft.totpSecret} autocomplete="off" /></label>
        {/if}
        {#if creating === 'recovery' || (!creating && editing)}
          <label>Recovery codes
            <textarea rows="5" value={(draft.recoveryCodes ?? []).join('\n')} oninput={(event) => { draft = {...draft, recoveryCodes: event.currentTarget.value.split('\n')}; }}></textarea>
          </label>
        {/if}
        {#if creating === 'passkey' || draft.passkey}
          <label>Passkey site <input bind:value={draft.passkey!.relyingParty} /></label>
          <label>Passkey user <input bind:value={draft.passkey!.username} /></label>
          <label>Credential <input bind:value={draft.passkey!.credentialId} /></label>
          <label>Private key <textarea rows="4" bind:value={draft.passkey!.privateKeyPem}></textarea></label>
        {/if}
        <label>Notes <textarea rows="3" bind:value={draft.notes}></textarea></label>
        <div class="vault-actions">
          <button type="submit" disabled={busy}>Save</button>
          <button type="button" class="quiet" onclick={() => { editing = false; creating = null; }}>Cancel</button>
        </div>
        <div class="vault-actions">
          <button type="button" class="quiet" onclick={() => startCreate('totp')}>Authenticator</button>
          <button type="button" class="quiet" onclick={() => startCreate('recovery')}>Recovery codes</button>
          <button type="button" class="quiet" onclick={() => startCreate('passkey')}>Passkey</button>
        </div>
      </form>
    {:else}
      <nav class="vault-list" aria-label="Vault items">
        {#if filtered.length === 0}
          <div class="vault-empty inline">
            <Icon name={query ? 'search' : 'key'} size={36} strokeWidth={1.45} />
            <h2>{query ? 'No matches' : 'Nothing stored yet'}</h2>
          </div>
        {:else}
          {#each filtered as item (item.id)}
            <button type="button" class:selected={item.id === selectedId} class="vault-row" onclick={() => void select(item.id)}>
              <Icon name={mark(item)} size={18} strokeWidth={1.5} />
              <span>
                <strong>{item.title}</strong>
                {#if item.username}<small>{item.username}</small>{/if}
              </span>
            </button>
          {/each}
        {/if}
      </nav>
      {#if selected}
        <article class="vault-detail">
          <header>
            <h2>{selected.title}</h2>
            <button type="button" class="quiet" disabled={busy || secretsOwnerId !== selected.id || !secrets} onclick={startEdit}>Edit</button>
          </header>
          {#if selected.username}
            <div class="field">
              <span>Username</span>
              <p>{selected.username}</p>
              <button type="button" class="quiet" onclick={() => void copy('username')}>{copied === 'username' ? 'Copied' : 'Copy'}</button>
            </div>
          {/if}
          {#if selected.hasPassword}
            <div class="field">
              <span>Password</span>
              <p>{showPassword ? secrets?.password ?? '••••••••' : '••••••••'}</p>
              <button type="button" class="quiet" onclick={() => showPassword = !showPassword}>{showPassword ? 'Hide' : 'Show'}</button>
              <button type="button" class="quiet" onclick={() => void copy('password')}>{copied === 'password' ? 'Copied' : 'Copy'}</button>
            </div>
          {/if}
          {#if selected.hasTotp && totp}
            <div class="field">
              <span>Authenticator</span>
              <p class="code">{totp.code}</p>
              <small>{totp.remaining}s</small>
              <button type="button" class="quiet" onclick={() => void copy('totp')}>{copied === 'totp' ? 'Copied' : 'Copy'}</button>
            </div>
          {/if}
          {#if selected.notes}
            <div class="field"><span>Notes</span><p>{selected.notes}</p></div>
          {/if}
          {#if secrets?.passkey}
            <div class="field">
              <span>Passkey</span>
              <p>{secrets.passkey.relyingParty}</p>
              {#if secrets.passkey.username}<p>{secrets.passkey.username}</p>{/if}
            </div>
          {/if}
          {#if secrets?.recoveryCodes?.length}
            <div class="field">
              <span>Recovery codes</span>
              {#each secrets.recoveryCodes as code, index (code)}
                <p>
                  {code}
                  <button type="button" class="quiet" onclick={() => void copy('recovery', index)}>{copied === `recovery:${index}` ? 'Copied' : 'Copy'}</button>
                </p>
              {/each}
            </div>
          {/if}
          <div class="vault-actions">
            {#if pendingDelete}
              <button type="button" disabled={busy} onclick={() => void removeSelected()}>Delete</button>
              <button type="button" class="quiet" onclick={() => pendingDelete = false}>Cancel</button>
            {:else}
              <button type="button" class="quiet" onclick={() => pendingDelete = true}>Delete</button>
            {/if}
          </div>
        </article>
      {/if}
    {/if}
  {/if}
</section>

{#snippet storageControl()}
  <div class="storage">
    <button type="button" role="switch" aria-checked={syncOn} class:selected={syncOn} disabled={busy} onclick={() => void setSyncOn(!syncOn)}>Sync to account</button>
  </div>
{/snippet}

{#snippet accountControl()}
  {#if mobileAccount}
    <div class="account">
      {#if account?.signedIn}
        <span class="account-email">{account.profile?.email}</span>
        <button type="button" class="quiet" onclick={() => void signOutAccount()}>Sign out</button>
      {:else if showSignIn}
        <label>Email <input type="email" bind:value={accountEmail} autocomplete="username" /></label>
        <label>Password <input type="password" bind:value={accountPassword} autocomplete="current-password" /></label>
        <button type="button" disabled={busy || !accountEmail.trim() || !accountPassword} onclick={() => void signInAccount()}>Sign in</button>
      {:else}
        <button type="button" class="quiet" onclick={() => showSignIn = true}>Sign in</button>
      {/if}
    </div>
  {/if}
{/snippet}

<style>
  .vault-pane { min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .vault-empty { min-height: 0; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 28px 24px 60px; color: var(--muted-soft); text-align: center; }
  .vault-empty.inline { padding: 36px 18px; }
  .vault-empty h2 { margin: 18px 0 8px; color: var(--ink); font-size: 1.125rem; letter-spacing: -.025em; }
  .vault-empty p { margin: 0; max-width: 22rem; }
  .vault-gate { width: min(280px, 100%); display: flex; flex-direction: column; gap: 10px; margin-top: 16px; text-align: start; }
  .vault-gate label, .vault-editor label { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: .75rem; font-weight: 550; }
  .vault-gate input, .vault-editor input, .vault-editor textarea, .vault-search input { border: 1px solid var(--line); border-radius: 10px; padding: 10px 11px; background: var(--field); color: var(--ink); font: inherit; }
  .vault-gate button, .vault-editor button[type='submit'] { min-height: 44px; border: 0; border-radius: 10px; background: var(--ink); color: var(--surface); font: inherit; font-weight: 650; }
  .vault-error { margin: 0; color: var(--danger); font-size: .8125rem; }
  .vault-error.pad { padding: 0 18px; }
  .vault-tools { display: flex; align-items: center; gap: 6px; padding: 2px 12px 10px; }
  .vault-search { min-width: 0; flex: 1; min-height: 42px; display: flex; align-items: center; gap: 8px; border-radius: 12px; padding: 0 12px; background: var(--bubble); color: var(--muted-soft); }
  .vault-search input { flex: 1; border: 0; padding: 0; background: transparent; }
  .icon-button { width: 42px; height: 42px; display: grid; place-items: center; border: 0; background: transparent; color: var(--ink); }
  .vault-list { min-height: 0; flex: 1; overflow-y: auto; padding: 0 10px; scrollbar-width: none; }
  .vault-list::-webkit-scrollbar { display: none; }
  .vault-row { width: 100%; min-height: 52px; display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center; gap: 10px; border: 0; border-radius: 12px; padding: 8px 10px; background: transparent; color: var(--ink); text-align: start; }
  .vault-row.selected, .vault-row:active { background: var(--row-active); }
  .vault-row span { min-width: 0; display: flex; flex-direction: column; }
  .vault-row strong { overflow: hidden; font-size: .875rem; font-weight: 560; text-overflow: ellipsis; white-space: nowrap; }
  .vault-row small { overflow: hidden; color: var(--muted); font-size: .75rem; text-overflow: ellipsis; white-space: nowrap; }
  .vault-detail { flex: none; max-height: 65%; overflow-y: auto; padding: 10px 18px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--line); scrollbar-width: none; }
  .vault-detail header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .vault-detail h2 { margin: 0; font-size: 1rem; letter-spacing: -.02em; }
  .field { margin: 10px 0 0; }
  .field span { color: var(--muted); font-size: .6875rem; font-weight: 650; }
  .field p { margin: 2px 0 0; word-break: break-all; }
  .field .code { font-variant-numeric: tabular-nums; letter-spacing: .08em; }
  .quiet { border: 0; padding: 0; background: transparent; color: var(--ink); font: inherit; font-size: .8125rem; font-weight: 650; }
  .vault-detail .quiet { min-width: 44px; min-height: 44px; margin-inline-end: 12px; text-align: start; }
  .field small { display: block; margin-top: 4px; color: var(--muted); }
  .vault-editor { min-height: 0; flex: 1; overflow-y: auto; padding: 8px 18px 24px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: none; }
  .vault-actions { display: flex; gap: 16px; }
  .storage { display: flex; justify-content: center; gap: 16px; margin-top: 12px; padding: 0 18px 8px; }
  .storage > button[role='switch'] { border: 0; padding: 0; background: transparent; color: var(--muted-soft); font: inherit; font-size: .8125rem; }
  .storage > button[role='switch'].selected { color: var(--ink); font-weight: 650; }
  .account { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; padding: 0 18px 8px; width: min(280px, 100%); }
  .account label { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: .75rem; font-weight: 550; text-align: start; }
  .account input { border: 1px solid var(--line); border-radius: 10px; padding: 10px 11px; background: var(--field); color: var(--ink); font: inherit; }
  .account button:not(.quiet) { min-height: 44px; border: 0; border-radius: 10px; background: var(--ink); color: var(--surface); font: inherit; font-weight: 650; }
  .account-email { overflow: hidden; color: var(--muted); font-size: .8125rem; text-overflow: ellipsis; white-space: nowrap; }
  .account .quiet { align-self: center; }
</style>
