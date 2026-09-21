<script lang="ts">
  let {onOpenSettings}: {onOpenSettings?: () => void} = $props();
  import {onDestroy, onMount} from 'svelte';
  import type {
    VaultImportStartDto,
    VaultItemDto,
    VaultListDto,
    VaultPasskeyDto,
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
  import {polymuxApi} from '../../api/polymux';
  import {readableError} from '../../shared/errors';
  import Icon from '../../shared/components/Icon.svelte';
  import {MAIN_UI_ICON_SIZE, MAIN_UI_ICON_STROKE_WIDTH} from '../../shared/layout/iconSizing';
  import {scrollFade} from '../../shared/scrollFade';
  import {t} from '../../../i18n';

  const api = polymuxApi();
  const selectionGate = new VaultSelectionGate();
  let status = $state<VaultStatusDto | null>(null);
  let list = $state<VaultListDto>({groups: [], items: [], trash: []});
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let masterPassword = $state('');
  let confirmPassword = $state('');
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
  let pendingDelete = $state(false);
  let importPending = $state<Extract<VaultImportStartDto, {status: 'needs-password'}> | null>(null);
  let importFilePassword = $state('');
  let importNotice = $state('');
  let addOpen = $state(false);
  let menuOpen = $state(false);
    let draft = $state(emptyVaultDraft('password'));

  /** Accounts are grouped by the site they belong to, so every credential for
      one site sits together: passwords, passkeys, codes, recovery codes and
      notes. Items saved without a link fall back to their own group. */
  function siteOf(item: VaultItemDto): string {
    try {
      const host = new URL(item.url.includes('://') ? item.url : `https://${item.url}`).hostname;
      if (host) return host.replace(/^www\./, '');
    } catch {
      // Not a link; fall through to the item's own grouping below.
    }
    // The root group carries the vault's own name, which says nothing about
    // the account; only a group the user chose is worth showing as a heading.
    const group = item.groupName.trim();
    return group && group !== $t('workspace.vault') ? group : $t('vault.ungrouped');
  }
  const biometricReady = $derived(status?.biometric.available === true && status?.biometric.enrolled === true);

  /** Sync is a glance, not a sentence: the icon carries the state. */
  const syncIcon = $derived.by(() => {
    const sync = status?.sync;
    if (!sync) return 'cloud' as const;
    if (sync.state === 'syncing') return 'reload' as const;
    if (sync.state === 'synced') return 'cloud-check' as const;
    if (sync.state === 'error') return 'warning' as const;
    return 'cloud' as const;
  });
  const syncHint = $derived.by(() => {
    const sync = status?.sync;
    if (!sync) return $t('vault.syncOffline');
    if (sync.state === 'syncing') return $t('vault.syncing');
    if (sync.state === 'synced') return $t('vault.synced');
    if (sync.state === 'error') return sync.error || $t('vault.syncError');
    if (sync.storage === 'local') return $t('vault.syncOffHint');
    if (sync.available && !sync.signedIn) return $t('vault.syncHint');
    return $t('vault.syncOffline');
  });

  const selected = $derived(list.items.find((item) => item.id === selectedId) ?? null);
  const filtered = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    const items = needle
      ? list.items.filter((item) =>
          [item.title, item.username, item.url, item.groupName, item.notes]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : list.items;
    const groups = new Map<string, VaultItemDto[]>();
    for (const item of items) {
      const key = siteOf(item);
      const bucket = groups.get(key) ?? [];
      bucket.push(item);
      groups.set(key, bucket);
    }
    return [...groups.entries()];


  });
  const locked = $derived(!status?.exists || !status.unlocked);
  const syncOn = $derived((status?.sync.storage ?? 'account') === 'account');
  const addOptions = $derived([
    {value: 'password', label: $t('vault.addPassword'), icon: 'key' as const},
    {value: 'totp', label: $t('vault.addTotp'), icon: 'clock' as const},
    {value: 'recovery', label: $t('vault.addRecovery'), icon: 'document-text' as const},
    {value: 'passkey', label: $t('vault.addPasskey'), icon: 'shield' as const},
  ]);

  const stopChanged = api.vault.subscribe((next) => {
    status = next;
    if (!next.unlocked) {
      list = {groups: [], items: [], trash: []};
      selectedId = null;
      clearSecrets();
      editing = false;
      creating = null;
      addOpen = false;
      menuOpen = false;
      return;
    }
    // The vault is shared with the CLI, the phone, and Touch ID, so a change
    // made anywhere else has to reach this list too. Comparing the count keeps
    // that from re-reading on every unrelated status ping.
    if (!list.items.length || list.items.length !== next.itemCount) void refreshList(selectedId);
  });

  $effect(() => {
    if (!selected?.hasTotp || locked || secretsOwnerId !== selected.id) return;
    const id = selected.id;
    void refreshTotp(id);
    const timer = setInterval(() => void refreshTotp(id), 1000);
    return () => clearInterval(timer);
  });

  onMount(() => {
    void refreshStatus();
  });

  onDestroy(() => {
    clearSecrets();
    stopChanged();
  });

  function clearSecrets(): void {
    selectionGate.invalidate();
    loadedRequest = null;
    secretsOwnerId = null;
    secrets = null;
    totp = null;
  }

  async function refreshStatus(): Promise<void> {
    try {
      status = await api.vault.status();
      error = '';
      if (status.unlocked) await refreshList(selectedId);
    } catch (reason) {
      error = readableError(reason);
    } finally {
      loading = false;
    }
  }

  async function refreshList(keepId: string | null): Promise<void> {
    list = await api.vault.list();
    const next = keepId && list.items.some((item) => item.id === keepId)
      ? keepId
      : (list.items[0]?.id ?? null);
    await select(next);
  }

  async function createVault(): Promise<void> {
    if (masterPassword.length < 8) {
      error = $t('vault.passwordTooShort');
      return;
    }
    if (masterPassword !== confirmPassword) {
      error = $t('vault.passwordMismatch');
      return;
    }
    busy = true;
    try {
      status = await api.vault.create(masterPassword);
      masterPassword = '';
      confirmPassword = '';
      error = '';
      await refreshList(null);
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }

  async function unlock(): Promise<void> {
    busy = true;
    try {
      status = await api.vault.unlock(masterPassword);
      masterPassword = '';
      error = '';
      await refreshList(null);
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }

  async function unlockBiometric(): Promise<void> {
    busy = true;
    try {
      status = await api.vault.unlockBiometric();
      masterPassword = '';
      error = '';
      await refreshList(null);
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }

  async function lock(): Promise<void> {
    selectedId = null;
    clearSecrets();
    status = await api.vault.lock();
    masterPassword = '';
    confirmPassword = '';
    list = {groups: [], items: [], trash: []};
    editing = false;
    creating = null;
    addOpen = false;
    menuOpen = false;
  }

  function touch(): void {
    if (status?.unlocked) void api.vault.touch();
  }

  async function select(id: string | null): Promise<void> {
    selectedId = id;
    showPassword = false;
    pendingDelete = false;
    editing = false;
    creating = null;
    clearSecrets();
    importPending = null;
    if (id) await loadSecrets(id);
  }

  async function loadSecrets(id: string): Promise<void> {
    const request = selectionGate.begin(id);
    try {
      const revealed = await api.vault.reveal(id);
      if (!selectionGate.accepts(request, selectedId) || locked) return;
      secrets = revealed;
      secretsOwnerId = id;
      loadedRequest = request;
      totp = revealed.totp;
      error = '';
    } catch (reason) {
      if (!selectionGate.accepts(request, selectedId)) return;
      clearSecrets();
      error = readableError(reason);
    }
  }

  async function refreshTotp(id: string): Promise<void> {
    const request = loadedRequest;
    if (!request || secretsOwnerId !== id || !selectionGate.accepts(request, selectedId) || locked) return;
    try {
      const next = await api.vault.totp(id);
      if (selectionGate.accepts(request, selectedId) && secretsOwnerId === id && !locked) totp = next;
    } catch {
      if (selectionGate.accepts(request, selectedId) && secretsOwnerId === id) totp = null;
    }
  }

  function startCreate(kind: string): void {
    addOpen = false;
    const next = kind as VaultDraftKind;
    creating = next;
    editing = true;
    pendingDelete = false;
    selectedId = null;
    clearSecrets();
    draft = emptyVaultDraft(next);
  }

  function startEdit(): void {
    if (!selected || secretsOwnerId !== selected.id || !secrets) return;
    creating = null;
    editing = true;
    pendingDelete = false;
    draft = vaultEditDraft(selected, secrets);
  }

  async function saveDraft(): Promise<void> {
    const title = draft.title.trim();
    if (!title) {
      error = $t('vault.title');
      return;
    }
    busy = true;
    try {
      const payload = normalizeVaultSaveDraft(draft);
      const saved = await api.vault.save(payload);
      creating = null;
      editing = false;
      error = '';
      await refreshList(saved.id);
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }

  async function removeSelected(): Promise<void> {
    if (!selected) return;
    busy = true;
    try {
      await api.vault.remove(selected.id);
      pendingDelete = false;
      error = '';
      await refreshList(null);
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }

  async function copyField(
    field: 'password' | 'username' | 'url' | 'totp' | 'notes' | 'recovery',
    recoveryIndex?: number,
  ): Promise<void> {
    if (!selected) return;
    try {
      await api.vault.copy(selected.id, field, recoveryIndex);
      copied = field === 'recovery' ? `recovery:${recoveryIndex}` : field;
      setTimeout(() => {
        if (copied === (field === 'recovery' ? `recovery:${recoveryIndex}` : field)) copied = '';
      }, 1200);
    } catch (reason) {
      error = readableError(reason);
    }
  }

  async function beginImport(): Promise<void> {
    try {
      const result = await api.vault.importBegin();
      if (result.status === 'cancelled') return;
      if (result.status === 'imported') {
        importNotice = $t('vault.imported', {count: result.imported});
        await refreshList(selectedId);
        return;
      }
      importPending = result;
      importFilePassword = '';
    } catch (reason) {
      error = readableError(reason);
    }
  }

  async function confirmImport(): Promise<void> {
    busy = true;
    try {
      const result = await api.vault.importConfirm(importFilePassword);
      importFilePassword = '';
      importPending = null;
      importNotice = $t('vault.imported', {count: result.imported});
      error = result.problems[0] ?? '';
      await refreshList(selectedId);
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }

  function mark(item: VaultItemDto): 'key' | 'clock' | 'document-text' | 'shield' {
    if (item.hasPasskey) return 'shield';
    if (item.hasTotp && !item.hasPassword) return 'clock';
    if (item.hasRecoveryCodes && !item.hasPassword && !item.hasTotp) return 'document-text';
    return 'key';
  }

  function submitGate(event: SubmitEvent): void {
    event.preventDefault();
    if (status?.exists) void unlock();
    else void createVault();
  }

  async function syncNow(): Promise<void> {
    busy = true;
    try {
      status = await api.vault.sync();
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onclick={(event) => {
    if (addOpen && !(event.target as HTMLElement).closest('.vault-add')) addOpen = false;
    if (menuOpen && !(event.target as HTMLElement).closest('.vault-menu-wrap')) menuOpen = false;
  }}/>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions (touch activity resets vault idle timer) -->
<div class="vault" role="application" aria-label={$t('workspace.vault')} onpointerdown={touch} onkeydown={touch}>
  {#if loading}
    <div class="vault-empty" role="status">{$t('common.loading')}</div>
  {:else if locked}
    <div class="vault-empty vault-locked">
      <Icon name="key" size={56} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
      {#if status?.exists}
        <p class="vault-locked-title">{$t('vault.lockedTitle')}</p>
        <p>{biometricReady ? $t('vault.unlockBiometricHint') : $t('vault.unlockHint')}</p>
        {#if biometricReady}
          <button
            type="button"
            class="vault-touch"
            aria-label={$t('vault.unlockBiometric')}
            disabled={busy}
            onclick={() => void unlockBiometric()}
          >
            <Icon name="fingerprint" size={30} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
          </button>
        {/if}
        <form class="vault-gate" onsubmit={submitGate}>
          <input
            type="password"
            bind:value={masterPassword}
            autocomplete="current-password"
            aria-label={$t('vault.masterPassword')}
            placeholder={$t('vault.enterPassword')}
            disabled={busy}
          />
          {#if error}<p class="vault-error" role="alert">{error}</p>{/if}
          <button type="submit" class="vault-primary" disabled={busy}>
            {$t('vault.unlock')}
          </button>
        </form>
      {:else}
        <p class="vault-locked-title">{$t('workspace.vault')}</p>
        <p>{$t('vault.createHint')}</p>
        <form class="vault-gate" onsubmit={submitGate}>
          <label>
            <span>{$t('vault.masterPassword')}</span>
            <input
              type="password"
              bind:value={masterPassword}
              autocomplete="new-password"
              disabled={busy}
            />
          </label>
          <label>
            <span>{$t('vault.confirmPassword')}</span>
            <input type="password" bind:value={confirmPassword} autocomplete="new-password" disabled={busy}/>
          </label>
          {#if error}<p class="vault-error" role="alert">{error}</p>{/if}
          <button type="submit" class="vault-primary" disabled={busy}>
            {$t('vault.createVault')}
          </button>
        </form>
      {/if}
    </div>
  {:else}
    <div class="vault-toolbar">
      <label class="vault-search">
        <Icon name="search" size={14} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
        <input type="search" bind:value={query} placeholder={$t('vault.search')} aria-label={$t('vault.search')}/>
      </label>
      <div class="vault-add">
        <button
          type="button"
          class="vault-icon"
          aria-label={$t('vault.add')}
          data-tooltip-label={$t('vault.add')}
          aria-haspopup="menu"
          aria-expanded={addOpen}
          onclick={() => addOpen = !addOpen}
        >
          <Icon name="plus" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
        </button>
        {#if addOpen}
          <div class="polymux-dropdown-menu vault-add-menu" role="menu">
            {#each addOptions as option (option.value)}
              <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => startCreate(option.value)}>
                <Icon name={option.icon} size={15} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
                <span>{option.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="vault-menu-wrap">
        <button
          type="button"
          class="vault-icon"
          aria-label={$t('vault.more')}
          data-tooltip-align="end"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onclick={() => menuOpen = !menuOpen}
        >
          <Icon name="more" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
        </button>
        {#if menuOpen}
          <div class="polymux-dropdown-menu vault-menu-panel" role="menu">
            <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => { menuOpen = false; void beginImport(); }}>
              <Icon name="import" size={14} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
              <span>{$t('vault.import')}</span>
            </button>
            <button
              type="button"
              class="polymux-dropdown-item"
              role="menuitem"
              aria-label={syncHint}
              disabled={busy || !status?.sync.signedIn || !syncOn}
              onclick={() => { menuOpen = false; void syncNow(); }}
            >
              <Icon name={syncIcon} size={14} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
              <span>{$t('vault.syncNow')}</span>
            </button>
            {#if onOpenSettings}
              <div class="workspace-menu-divider"></div>
              <button
                type="button"
                class="polymux-dropdown-item"
                role="menuitem"
                aria-label={$t('vault.settings')}
                data-app-settings-button
                onclick={() => { menuOpen = false; onOpenSettings?.(); }}
              >
                <Icon name="settings" size={14} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
                <span>{$t('vault.settings')}</span>
              </button>
            {/if}
            <div class="workspace-menu-divider"></div>
            <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => { menuOpen = false; void lock(); }}>
              <Icon name="lock" size={14} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
              <span>{$t('vault.lock')}</span>
            </button>
          </div>
        {/if}
      </div>
    </div>
    {#if error}
      <div class="vault-banner" role="alert">
        <span>{error}</span>
        <button type="button" class="vault-icon" aria-label={$t('common.dismissError')} onclick={() => error = ''}>
          <Icon name="close" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
        </button>
      </div>
    {/if}
    {#if importNotice}
      <div class="vault-banner">
        <span>{importNotice}</span>
        <button type="button" class="vault-icon" aria-label={$t('common.dismissError')} onclick={() => importNotice = ''}>
          <Icon name="close" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
        </button>
      </div>
    {/if}
    <div class="vault-body">
      {#if list.items.length > 0}
        <div class="vault-list" use:scrollFade>
          {#if filtered.length === 0}
            <div class="vault-empty vault-empty-inline">
              <Icon name={query.trim() ? 'search' : 'key'} size={40} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
              <p>{query.trim() ? $t('common.noMatches') : $t('vault.empty')}</p>
              {#if !query.trim()}<p>{$t('vault.emptyHint')}</p>{/if}
            </div>
          {:else}
            {#each filtered as [site, items] (site)}
              <p class="vault-group">{site}</p>
              {#each items as item (item.id)}
                <button
                  type="button"
                  class={['vault-row', selectedId === item.id && 'selected']}
                  onclick={() => void select(item.id)}
                >
                  <span class="vault-row-icon"><Icon name={mark(item)} size={16} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></span>
                  <span class="vault-row-copy">
                    <span class="vault-row-title">{item.title}</span>
                    {#if item.username}<span class="vault-row-meta">{item.username}</span>{/if}
                  </span>
                </button>
              {/each}
            {/each}
          {/if}
        </div>
      {/if}
      <div class="vault-detail" use:scrollFade>
        {#if importPending}
          <form class="vault-editor" onsubmit={(event) => { event.preventDefault(); void confirmImport(); }}>
            <h2>{$t('vault.import')}</h2>
            <p>{importPending.name}</p>
            <p>{$t('vault.importKeePass')}</p>
            <label>
              <span>{$t('vault.importPassword')}</span>
              <input type="password" bind:value={importFilePassword} autocomplete="off"/>
            </label>
            <div class="vault-actions">
              <button type="submit" class="vault-primary" disabled={busy}>{$t('vault.import')}</button>
              <button type="button" class="vault-text" onclick={() => importPending = null}>{$t('common.cancel')}</button>
            </div>
          </form>
        {:else if editing}
          <form class="vault-editor" onsubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
            <h2>{creating ? $t('vault.newItem') : $t('common.edit')}</h2>
            <label>
              <span>{$t('vault.title')}</span>
              <input bind:value={draft.title}/>
            </label>
            <label>
              <span>{$t('vault.username')}</span>
              <input bind:value={draft.username}/>
            </label>
            {#if !creating || creating === 'password'}
              <label>
                <span>{$t('vault.password')}</span>
                <input type="password" bind:value={draft.password} autocomplete="off" placeholder={draft.id ? '••••••••' : ''}/>
              </label>
              <label>
                <span>{$t('vault.url')}</span>
                <input bind:value={draft.url}/>
              </label>
            {/if}
            <label>
              <span>{$t('vault.group')}</span>
              <input bind:value={draft.groupName}/>
            </label>
            {#if !creating || creating === 'totp'}
              <label>
                <span>{$t('vault.totpSecret')}</span>
                <input bind:value={draft.totpSecret} autocomplete="off" placeholder={selected?.hasTotp && !creating ? '••••••••' : ''}/>
              </label>
            {/if}
            {#if !creating || creating === 'recovery'}
            <label>
              <span>{$t('vault.recoveryCodes')}</span>
              <textarea
                rows="5"
                value={(draft.recoveryCodes ?? []).join('\n')}
                oninput={(event) => {
                  draft = {...draft, recoveryCodes: event.currentTarget.value.split('\n')};
                }}
              ></textarea>
            </label>
            {/if}
            {#if !creating || creating === 'passkey'}
            <label>
              <span>{$t('vault.passkeyRp')}</span>
              <input
                value={draft.passkey?.relyingParty ?? ''}
                oninput={(event) => {
                  draft = {
                    ...draft,
                    passkey: {
                      relyingParty: event.currentTarget.value,
                      username: draft.passkey?.username ?? '',
                      credentialId: draft.passkey?.credentialId ?? '',
                      userHandle: draft.passkey?.userHandle ?? '',
                      privateKeyPem: draft.passkey?.privateKeyPem ?? '',
                    },
                  };
                }}
              />
            </label>
            <label>
              <span>{$t('vault.passkeyUser')}</span>
              <input
                value={draft.passkey?.username ?? ''}
                oninput={(event) => {
                  const passkey = draft.passkey ?? {relyingParty: '', username: '', credentialId: ''};
                  draft = {...draft, passkey: {...passkey, username: event.currentTarget.value}};
                }}
              />
            </label>
            <label>
              <span>{$t('vault.passkeyId')}</span>
              <input
                value={draft.passkey?.credentialId ?? ''}
                oninput={(event) => {
                  const passkey = draft.passkey ?? {relyingParty: '', username: '', credentialId: ''};
                  draft = {...draft, passkey: {...passkey, credentialId: event.currentTarget.value}};
                }}
              />
            </label>
            <label>
              <span>{$t('vault.passkeyKey')}</span>
              <textarea
                rows="4"
                value={draft.passkey?.privateKeyPem ?? ''}
                placeholder={selected?.hasPasskey && !creating ? '••••••••' : ''}
                oninput={(event) => {
                  const passkey = draft.passkey ?? {relyingParty: '', username: '', credentialId: ''};
                  draft = {...draft, passkey: {...passkey, privateKeyPem: event.currentTarget.value}};
                }}
              ></textarea>
            </label>
            {/if}
            <label>
              <span>{$t('vault.notes')}</span>
              <textarea rows="4" bind:value={draft.notes}></textarea>
            </label>
            <div class="vault-actions">
              <button type="submit" class="vault-primary" disabled={busy}>{$t('common.save')}</button>
              <button type="button" class="vault-text" onclick={() => { editing = false; creating = null; }}>{$t('common.cancel')}</button>
            </div>
          </form>
        {:else if selected}
          <div class="vault-card">
            <header class="vault-card-head">
              <h2>{selected.title}</h2>
              <button type="button" class="vault-text" disabled={busy || secretsOwnerId !== selected.id || !secrets} onclick={startEdit}>{$t('common.edit')}</button>
            </header>
            {#if selected.username || selected.hasPassword || selected.url}
              <p class="vault-section">{$t('vault.catPasswords')}</p>
              <div class="vault-grid">
                {#if selected.username}
                  {@render secretRow($t('vault.username'), selected.username, 'username')}
                {/if}
                {#if selected.hasPassword}
                  {@render secretRow($t('vault.password'), showPassword ? (secrets?.password ?? '') : '••••••••', 'password', true)}
                {/if}
                {#if selected.url}
                  {@render secretRow($t('vault.url'), selected.url, 'url')}
                {/if}
              </div>
            {/if}
            {#if selected.hasTotp}
              <p class="vault-section">{$t('vault.catCodes')}</p>
              <div class="vault-field">
                <span class="vault-label">{$t('vault.totp')}</span>
                <div class="vault-value vault-totp">
                  <strong>{totp?.code ?? '••••••'}</strong>
                  {#if totp}
                    <span class="vault-totp-bar" style:--remaining={totp.remaining / totp.period}></span>
                    <span class="vault-totp-left">{$t('vault.oneTime', {remaining: totp.remaining})}</span>
                  {/if}
                  <button type="button" class="vault-text" onclick={() => void copyField('totp')}>
                    {copied === 'totp' ? $t('common.copied') : $t('common.copy')}
                  </button>
                </div>
              </div>
            {/if}
            {#if selected.hasRecoveryCodes}
              <p class="vault-section">{$t('vault.catRecovery')}</p>
              <div class="vault-field">
                <ul class="vault-codes">
                  {#each secrets?.recoveryCodes ?? [] as code, index (index)}
                    <li>
                      <code>{code}</code>
                      <button type="button" class="vault-text" onclick={() => void copyField('recovery', index)}>
                        {copied === `recovery:${index}` ? $t('common.copied') : $t('common.copy')}
                      </button>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
            {#if selected.hasPasskey}
              <p class="vault-section">{$t('vault.catPasskeys')}</p>
              {@render passkeyBlock(secrets?.passkey ?? null)}
            {/if}
            {#if selected.notes}
              <p class="vault-section">{$t('vault.catNotes')}</p>
              <p class="vault-notes">{selected.notes}</p>
            {/if}
            <div class="vault-actions">
              {#if pendingDelete}
                <span>{$t('vault.confirmDelete')}</span>
                <button type="button" class="vault-primary" onclick={() => void removeSelected()}>{$t('common.delete')}</button>
                <button type="button" class="vault-text" onclick={() => pendingDelete = false}>{$t('common.cancel')}</button>
              {:else}
                <button type="button" class="vault-text" onclick={() => pendingDelete = true}>{$t('common.delete')}</button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="vault-empty vault-empty-inline">
            <Icon name={!list.items.length && query.trim() ? 'search' : 'key'} size={40} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
            <p>{list.items.length ? $t('vault.selectItem') : query.trim() ? $t('common.noMatches') : $t('vault.empty')}</p>
            {#if !list.items.length && !query.trim()}<p>{$t('vault.emptyHint')}</p>{/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#snippet secretRow(label: string, value: string, field: 'password' | 'username' | 'url', revealable = false)}
  <div class="vault-field">
    <span class="vault-label">{label}</span>
    <div class="vault-value">
      <code class={['vault-secret', revealable && !showPassword && 'masked']}>{value}</code>
      {#if revealable}
        <button
          type="button"
          class="vault-icon"
          aria-label={showPassword ? $t('vault.hide') : $t('vault.show')}
          onclick={() => showPassword = !showPassword}
        >
          <Icon name={showPassword ? 'eye-off' : 'eye'} size={15} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
        </button>
      {/if}
      <button type="button" class="vault-text" onclick={() => void copyField(field)}>
        {copied === field ? $t('common.copied') : $t('common.copy')}
      </button>
    </div>
  </div>
{/snippet}

{#snippet passkeyBlock(passkey: VaultPasskeyDto | null)}
  <div class="vault-field">
    {#if passkey}
      <p class="vault-notes">{passkey.relyingParty}</p>
      {#if passkey.username}<p class="vault-notes">{passkey.username}</p>{/if}
      {#if passkey.credentialId}<p class="vault-notes">{passkey.credentialId}</p>{/if}
    {/if}
  </div>
{/snippet}

<style>
  .vault {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--main-panel-background);
  }
  .vault-empty {
    min-height: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px 18px;
    color: var(--neutral-500);
    text-align: center;
  }
  .vault-empty-inline { padding: 24px 18px; }
  .vault-empty :global(svg) { color: var(--neutral-400); }
  .vault-empty p { max-width: 24rem; margin: 0; font-size: 13px; line-height: 1.5; }
  .vault-gate {
    width: min(280px, 100%);
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 16px;
    text-align: start;
    pointer-events: auto;
  }
  .vault-gate label, .vault-editor label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--neutral-600);
    font-size: 11px;
    font-weight: 500;
  }
  .vault-gate input, .vault-editor input, .vault-editor textarea, .vault-search input {
    border: 1px solid var(--neutral-200);
    border-radius: 8px;
    padding: 7px 9px;
    background: var(--app-surface);
    color: var(--neutral-950);
    font: inherit;
    font-size: 13px;
  }
  .vault-gate input:focus, .vault-editor input:focus, .vault-editor textarea:focus, .vault-search:focus-within {
    border-color: var(--neutral-500);
    outline: 0;
  }
  .vault-error { margin: 0; color: var(--neutral-700); font-size: 12px; }
  .vault-locked { gap: 10px; }
  .vault-locked-title {
    margin: 6px 0 0;
    color: var(--neutral-950);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .vault-locked .vault-gate { align-items: stretch; }
  .vault-locked .vault-gate input { text-align: center; }
  .vault-gate input::placeholder { color: var(--neutral-400); }
  .vault-touch {
    border: 0;
    padding: 6px;
    margin-top: 2px;
    background: transparent;
    color: var(--neutral-600);
    cursor: pointer;
  }
  .vault-touch:hover:not(:disabled) { color: var(--neutral-950); }
  .vault-touch:disabled { opacity: .45; cursor: default; }
  .vault-primary {
    border: 0;
    border-radius: 8px;
    padding: 8px 12px;
    background: var(--neutral-950);
    color: var(--app-surface);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
  }
  .vault-primary:disabled { opacity: .45; cursor: default; }
  .vault-toolbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px 0;
  }
  .vault-search {
    min-width: 0;
    height: 30px;
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 1;
    border: 1px solid var(--neutral-200);
    border-radius: 8px;
    padding: 0 8px;
    color: var(--neutral-400);
  }
  .vault-search input {
    min-width: 0;
    flex: 1;
    border: 0;
    padding: 0;
    background: transparent;
  }
  .vault-search input:focus { outline: 0; }
  .vault-search input::-webkit-search-cancel-button { display: none; }
  .vault-text {
    flex: none;
    white-space: nowrap;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--neutral-600);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .vault-text:hover { color: var(--neutral-950); }
  .vault-add { position: relative; flex: none; }
  .vault-menu-wrap { position: relative; flex: none; }
  .vault-menu-panel { position: absolute; z-index: 70; top: calc(100% + 4px); right: 0; min-width: 168px; }
  .vault-add-menu { position: absolute; top: calc(100% + 4px); left: 50%; transform: translateX(-50%); z-index: 5; min-width: 160px; }
  .vault-icon {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    flex: none;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--neutral-500);
    cursor: pointer;
  }
  .vault-icon:hover:not(:disabled) { color: var(--neutral-950); }
  .vault-icon:disabled { opacity: .45; cursor: default; }
  .vault-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    color: var(--neutral-700);
    font-size: 12px;
  }
  .vault-banner span { min-width: 0; flex: 1; }
  .vault-body {
    min-height: 0;
    flex: 1;
    display: flex;
  }
  .vault-list, .vault-detail {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    scrollbar-width: none;
  }
  .vault-list::-webkit-scrollbar, .vault-detail::-webkit-scrollbar { display: none; }
  .vault-list {
    width: 32%;
    min-width: 190px;
    max-width: 300px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--neutral-100);
    padding: 4px 0 12px;
  }
  /* The account pane is the measured box: it decides when the fields under an
     account can afford a second column, rather than the window width, which
     says nothing about a docked panel. */
  .vault-detail { flex: 1; display: flex; flex-direction: column; container-type: inline-size; }
  .vault-group {
    margin: 6px 14px 2px;
    color: var(--neutral-500);
    font-size: 11px;
    font-weight: 600;
  }
  .vault-row {
    flex: none;
    width: auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0 6px;
    border: 0;
    border-radius: 8px;
    padding: 5px 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: start;
  }
  .vault-row:hover { background: var(--neutral-100); }
  .vault-row.selected { background: var(--neutral-100); }
  .vault-row-icon {
    flex: none;
    display: grid;
    place-items: center;
    height: 18px;
    color: var(--neutral-500);
  }
  .vault-row-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .vault-row-title, .vault-row-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vault-row-title { color: var(--neutral-950); font-size: 13px; line-height: 18px; }
  .vault-row-meta { color: var(--neutral-500); font-size: 11px; }
  .vault-card, .vault-editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 18px 18px;
  }
  .vault-card-head, .vault-actions, .vault-value, .vault-totp {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .vault-card-head { justify-content: space-between; }
  h2 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; color: var(--neutral-950); font-size: 16px; font-weight: 600; }
  .vault-section {
    margin: 6px 0 0;
    color: var(--neutral-500);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .04em;
    text-transform: uppercase;
  }
  .vault-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px 24px; }
  @container (min-width: 820px) {
    .vault-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  .vault-field { min-width: 0; display: flex; align-items: center; gap: 12px; }
  .vault-label {
    width: 88px;
    flex: none;
    color: var(--neutral-500);
    font-size: 12px;
    font-weight: 500;
  }
  .vault-totp-left { color: var(--neutral-500); font-size: 12px; }
  .vault-secret {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--neutral-950);
    font-family: inherit;
    font-size: 13px;
  }
  .vault-secret.masked { letter-spacing: 0.12em; }
  .vault-totp { flex-wrap: wrap; }
  .vault-totp strong {
    font-variant-numeric: tabular-nums;
    font-size: 19px;
    letter-spacing: 0.08em;
  }
  .vault-totp-bar {
    width: 48px;
    height: 3px;
    border-radius: 99px;
    background: var(--neutral-200);
    position: relative;
    overflow: hidden;
  }
  .vault-totp-bar::after {
    content: '';
    position: absolute;
    inset: 0;
    transform-origin: left center;
    transform: scaleX(var(--remaining, 1));
    background: var(--neutral-700);
  }
  .vault-codes { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
  .vault-codes li { display: flex; align-items: center; gap: 8px; }
  .vault-codes code { min-width: 0; flex: 1; font-family: inherit; font-size: 13px; }
  .vault-notes { margin: 0; color: var(--neutral-800); font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .vault-actions { flex-wrap: wrap; margin-top: 4px; }
  .vault-gate input, .vault-editor input, .vault-editor textarea { min-width: 0; width: 100%; }
  .vault-editor textarea { resize: vertical; min-height: 72px; }
  @media (prefers-reduced-motion: reduce) {
    .vault-totp-bar::after { transition: none; }
  }
</style>
