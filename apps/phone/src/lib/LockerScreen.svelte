<script lang="ts">
  import type {
    JsonValue,
    LockerItemDto,
    LockerItemInputDto,
    LockerListDto,
    LockerSecretsDto,
    LockerStatusDto,
    LockerStorageMode,
    LockerStorageResolve,
    LockerTotpDto,
  } from '@polymux/protocol';
  import {
    LockerSelectionGate,
    emptyLockerDraft,
    lockerEditDraft,
    normalizeLockerSaveDraft,
    type LockerDraftKind,
    type LockerSelectionRequest,
  } from '@polymux/protocol';
  import {onDestroy, onMount} from 'svelte';
  import type {AccountStatus} from '@polymux/locker';
  import {phoneAccount as getPhoneAccount} from './account';
  import {createDeviceLocker} from './device-locker';
  import Icon from './Icon.svelte';
  import {isApplePhone, signOutPhoneAccount} from './account';
  import {autoFillEnabled, disableAutoFill, updateAutoFill} from './autofill';
  let autofill = $state(autoFillEnabled());
  let autofillNotice = $state('');

  async function toggleAutoFill() {
    if (busy) return;
    busy = true; error = '';
    try {
      if (autofill) await disableAutoFill();
      else await updateAutoFill(locker.call);
      autofill = autoFillEnabled();
      autofillNotice = autofill ? 'Enable Polymux in Settings → General → AutoFill & Passwords. AutoFill requires your device passcode or biometrics.' : '';
    } catch (cause) { error = readable(cause); }
    finally { busy = false; }
  }

  let {online = false, call}: {
    online?: boolean;
    call?: (method: string, args?: JsonValue[]) => Promise<unknown>;
  } = $props();

  const phoneAccount = getPhoneAccount();
  const locker = createDeviceLocker({
    host: (method, args) => {
      if (!call) throw new Error('Host unavailable');
      return call(method, args);
    },
    online: () => Boolean(online && call),
    cloud: phoneAccount?.cloud ?? null,
  });

  const selectionGate = new LockerSelectionGate();

  let status = $state<LockerStatusDto | null>(null);
  let list = $state<LockerListDto>({groups: [], items: [], trash: []});
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let master = $state('');
  let confirm = $state('');
  let query = $state('');
  let selectedId = $state<string | null>(null);
  let secrets = $state<LockerSecretsDto | null>(null);
  let secretsOwnerId = $state<string | null>(null);
  let loadedRequest: LockerSelectionRequest | null = null;
  let totp = $state<LockerTotpDto | null>(null);
  let showPassword = $state(false);
  let copied = $state('');
  let editing = $state(false);
  let creating = $state<LockerDraftKind | null>(null);
  let draft = $state<LockerItemInputDto>(emptyLockerDraft('password'));
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
  const storage = $derived(status?.sync.storage ?? 'account');
  let pendingDelete = $state(false);
  let account = $state<AccountStatus | null>(null);
  let accountEmail = $state('');
  let accountPassword = $state('');
  let showSignIn = $state(false);

  onMount(() => {
    void (async () => {
      await phoneAccount?.ready;
      account = phoneAccount?.client.status() ?? null;
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
      status = await locker.call('locker.status') as LockerStatusDto;
      if (status.unlocked) await loadList(selectedId);
    } catch (cause) {
      error = readable(cause);
    } finally {
      loading = false;
    }
  }

  async function loadList(keep?: string | null): Promise<void> {
    list = await locker.call('locker.list') as LockerListDto;
    clearSecrets();
    selectedId = keep && list.items.some((item) => item.id === keep) ? keep : list.items[0]?.id ?? null;
    if (selectedId) await loadSecrets(selectedId);
    else clearSecrets();
  }

  async function loadSecrets(id: string): Promise<void> {
    const request = selectionGate.begin(id);
    const revealed = await locker.call('locker.reveal', [id]) as LockerSecretsDto;
    if (!selectionGate.accepts(request, selectedId) || locked) return;
    secrets = revealed;
    secretsOwnerId = id;
    loadedRequest = request;
    totp = revealed.totp;
    armTotp(id, request);
  }

  function armTotp(id: string, request: LockerSelectionRequest): void {
    if (totpTimer) clearInterval(totpTimer);
    if (!list.items.find((item) => item.id === id)?.hasTotp || !selectionGate.accepts(request, selectedId)) return;
    totpTimer = setInterval(() => {
      void locker.call('locker.totp', [id]).then((value) => {
        if (selectionGate.accepts(request, selectedId) && secretsOwnerId === id && !locked)
          totp = value as LockerTotpDto | null;
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
        status = await locker.call('locker.create', [master]) as LockerStatusDto;
      } else {
        status = await locker.call('locker.unlock', [master]) as LockerStatusDto;
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
    status = await locker.call('locker.lock') as LockerStatusDto;
    list = {groups: [], items: [], trash: []};
    editing = false;
    creating = null;
  }

  async function signInAccount(): Promise<void> {
    if (!phoneAccount || busy) return;
    busy = true;
    error = '';
    try {
      const result = await phoneAccount.client.signInWithPassword(accountEmail.trim(), accountPassword);
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
    if (!phoneAccount) return;
    try {
      await lock();
      account = await signOutPhoneAccount() ?? null;
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

  function startCreate(kind: LockerDraftKind): void {
    creating = kind;
    editing = true;
    selectedId = null;
    clearSecrets();
    draft = emptyLockerDraft(kind);
  }

  function startEdit(): void {
    if (!selected || secretsOwnerId !== selected.id || !secrets) return;
    creating = null;
    editing = true;
    draft = lockerEditDraft(selected, secrets);
  }

  async function setStorage(mode: LockerStorageMode, resolve?: LockerStorageResolve): Promise<void> {
    busy = true;
    try {
      status = await locker.call('locker.setStorage', resolve ? [mode, resolve] : [mode]) as LockerStatusDto;
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
      list = await locker.call('locker.remove', [selected.id]) as LockerListDto;
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
      const saved = await locker.call('locker.save', [normalizeLockerSaveDraft(draft) as unknown as JsonValue]) as LockerItemDto;
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
    const text = await locker.call('locker.copy', [selected.id, field, recoveryIndex ?? null]) as string;
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

  function mark(item: LockerItemDto): 'key' | 'lock' {
    return item.hasTotp && !item.hasPassword ? 'lock' : 'key';
  }

  function readable(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }
</script>

<section class="locker-pane" aria-label="Locker">
  {#if loading}
    <div class="locker-empty"><p>Opening Locker…</p></div>
  {:else if locked}
    <div class="locker-empty">
      <Icon name="key" size={42} strokeWidth={1.45} />
      <h2>Locker</h2>
      <form class="locker-gate" onsubmit={(event) => { event.preventDefault(); void submitGate(); }}>
        <label>Master password <input type="password" bind:value={master} autocomplete={status?.exists ? 'current-password' : 'new-password'} /></label>
        {#if !status?.exists}
          <label>Confirm <input type="password" bind:value={confirm} autocomplete="new-password" /></label>
        {/if}
        {#if error}<p class="locker-error">{error}</p>{/if}
        <button type="submit" disabled={busy}>{status?.exists ? 'Unlock' : 'Create locker'}</button>
        {@render storageControl()}
      </form>
      {@render accountControl()}
    </div>
  {:else}
    {#if isApplePhone()}
      <button class="quiet" type="button" disabled={busy} onclick={() => void toggleAutoFill()}>{autofill ? 'Disable AutoFill' : 'Enable password and code AutoFill'}</button>
      {#if autofillNotice}<p role="status">{autofillNotice}</p>{/if}
    {/if}
    <div class="locker-tools">
      <div class="locker-search">
        <Icon name="search" size={17} strokeWidth={1.5} />
        <input type="search" bind:value={query} placeholder="Search locker" aria-label="Search locker" />
      </div>
      <button type="button" class="icon-button" onclick={() => startCreate('password')} aria-label="Add password"><Icon name="plus" size={20} /></button>
      <button type="button" class="icon-button" onclick={() => void lock()} aria-label="Lock"><Icon name="lock" size={18} /></button>
    </div>
    {@render storageControl()}
    {@render accountControl()}
    {#if error}<p class="locker-error pad">{error}</p>{/if}
    {#if editing}
      <form class="locker-editor" onsubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
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
        <div class="locker-actions">
          <button type="submit" disabled={busy}>Save</button>
          <button type="button" class="quiet" onclick={() => { editing = false; creating = null; }}>Cancel</button>
        </div>
        <div class="locker-actions">
          <button type="button" class="quiet" onclick={() => startCreate('totp')}>Authenticator</button>
          <button type="button" class="quiet" onclick={() => startCreate('recovery')}>Recovery codes</button>
          <button type="button" class="quiet" onclick={() => startCreate('passkey')}>Passkey</button>
        </div>
      </form>
    {:else}
      <nav class="locker-list" aria-label="Locker items">
        {#if filtered.length === 0}
          <div class="locker-empty inline">
            <Icon name={query ? 'search' : 'key'} size={36} strokeWidth={1.45} />
            <h2>{query ? 'No matches' : 'Nothing stored yet'}</h2>
          </div>
        {:else}
          {#each filtered as item (item.id)}
            <button type="button" class:selected={item.id === selectedId} class="locker-row" onclick={() => void select(item.id)}>
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
        <article class="locker-detail">
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
          <div class="locker-actions">
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
  <div class="storage" role="radiogroup" aria-label="Storage">
    <button type="button" role="radio" aria-checked={storage === 'local'} class:selected={storage === 'local'} disabled={busy} onclick={() => void setStorage('local')}>This device</button>
    <button type="button" role="radio" aria-checked={storage === 'account'} class:selected={storage === 'account'} disabled={busy} onclick={() => void setStorage('account')}>Account</button>
  </div>
  {#if status?.sync.conflict === 'cloud-exists'}
    <div class="storage">
      <button type="button" class="quiet" disabled={busy} onclick={() => void setStorage('account', 'keep-local')}>Keep this device</button>
      <button type="button" class="quiet" disabled={busy} onclick={() => void setStorage('account', 'keep-cloud')}>Use the account copy</button>
    </div>
  {/if}
{/snippet}

{#snippet accountControl()}
  {#if phoneAccount}
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
  .locker-pane { min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .locker-empty { min-height: 0; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 28px 24px 60px; color: var(--muted-soft); text-align: center; }
  .locker-empty.inline { padding: 36px 18px; }
  .locker-empty h2 { margin: 18px 0 8px; color: var(--ink); font-size: 1.125rem; letter-spacing: -.025em; }
  .locker-empty p { margin: 0; max-width: 22rem; }
  .locker-gate { width: min(280px, 100%); display: flex; flex-direction: column; gap: 10px; margin-top: 16px; text-align: start; }
  .locker-gate label, .locker-editor label { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: .75rem; font-weight: 550; }
  .locker-gate input, .locker-editor input, .locker-editor textarea, .locker-search input { border: 1px solid var(--line); border-radius: 10px; padding: 10px 11px; background: var(--field); color: var(--ink); font: inherit; }
  .locker-gate button, .locker-editor button[type='submit'] { min-height: 44px; border: 0; border-radius: 10px; background: var(--ink); color: var(--surface); font: inherit; font-weight: 650; }
  .locker-error { margin: 0; color: var(--danger); font-size: .8125rem; }
  .locker-error.pad { padding: 0 18px; }
  .locker-tools { display: flex; align-items: center; gap: 6px; padding: 2px 12px 10px; }
  .locker-search { min-width: 0; flex: 1; min-height: 42px; display: flex; align-items: center; gap: 8px; border-radius: 12px; padding: 0 12px; background: var(--bubble); color: var(--muted-soft); }
  .locker-search input { flex: 1; border: 0; padding: 0; background: transparent; }
  .icon-button { width: 42px; height: 42px; display: grid; place-items: center; border: 0; background: transparent; color: var(--ink); }
  .locker-list { min-height: 0; flex: 1; overflow-y: auto; padding: 0 10px; scrollbar-width: none; }
  .locker-list::-webkit-scrollbar { display: none; }
  .locker-row { width: 100%; min-height: 52px; display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center; gap: 10px; border: 0; border-radius: 12px; padding: 8px 10px; background: transparent; color: var(--ink); text-align: start; }
  .locker-row.selected, .locker-row:active { background: var(--row-active); }
  .locker-row span { min-width: 0; display: flex; flex-direction: column; }
  .locker-row strong { overflow: hidden; font-size: .875rem; font-weight: 560; text-overflow: ellipsis; white-space: nowrap; }
  .locker-row small { overflow: hidden; color: var(--muted); font-size: .75rem; text-overflow: ellipsis; white-space: nowrap; }
  .locker-detail { flex: none; max-height: 65%; overflow-y: auto; padding: 10px 18px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--line); scrollbar-width: none; }
  .locker-detail header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .locker-detail h2 { margin: 0; font-size: 1rem; letter-spacing: -.02em; }
  .field { margin: 10px 0 0; }
  .field span { color: var(--muted); font-size: .6875rem; font-weight: 650; }
  .field p { margin: 2px 0 0; word-break: break-all; }
  .field .code { font-variant-numeric: tabular-nums; letter-spacing: .08em; }
  .quiet { border: 0; padding: 0; background: transparent; color: var(--ink); font: inherit; font-size: .8125rem; font-weight: 650; }
  .locker-detail .quiet { min-width: 44px; min-height: 44px; margin-inline-end: 12px; text-align: start; }
  .field small { display: block; margin-top: 4px; color: var(--muted); }
  .locker-editor { min-height: 0; flex: 1; overflow-y: auto; padding: 8px 18px 24px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: none; }
  .locker-actions { display: flex; gap: 16px; }
  .storage { display: flex; justify-content: center; gap: 16px; margin-top: 12px; padding: 0 18px 8px; }
  .storage > button[role='radio'] { border: 0; padding: 0; background: transparent; color: var(--muted-soft); font: inherit; font-size: .8125rem; }
  .storage > button[role='radio'].selected { color: var(--ink); font-weight: 650; }
  .account { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; padding: 0 18px 8px; width: min(280px, 100%); }
  .account label { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: .75rem; font-weight: 550; text-align: start; }
  .account input { border: 1px solid var(--line); border-radius: 10px; padding: 10px 11px; background: var(--field); color: var(--ink); font: inherit; }
  .account button:not(.quiet) { min-height: 44px; border: 0; border-radius: 10px; background: var(--ink); color: var(--surface); font: inherit; font-weight: 650; }
  .account-email { overflow: hidden; color: var(--muted); font-size: .8125rem; text-overflow: ellipsis; white-space: nowrap; }
  .account .quiet { align-self: center; }
</style>
