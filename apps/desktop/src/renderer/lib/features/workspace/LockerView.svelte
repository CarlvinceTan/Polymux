<script lang="ts">
  import {onDestroy, onMount} from 'svelte';
  import type {
    LockerImportStartDto,
    LockerItemDto,
    LockerListDto,
    LockerPasskeyDto,
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
  import {polymuxApi} from '../../api/polymux';
  import {readableError} from '../../shared/errors';
  import Icon from '../../shared/components/Icon.svelte';
  import {MAIN_UI_ICON_SIZE, MAIN_UI_ICON_STROKE_WIDTH} from '../../shared/layout/iconSizing';
  import {scrollFade} from '../../shared/scrollFade';
  import {t} from '../../../i18n';

  const api = polymuxApi();
  const selectionGate = new LockerSelectionGate();
  let status = $state<LockerStatusDto | null>(null);
  let list = $state<LockerListDto>({groups: [], items: [], trash: []});
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let masterPassword = $state('');
  let confirmPassword = $state('');
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
  let pendingDelete = $state(false);
  let importPending = $state<Extract<LockerImportStartDto, {status: 'needs-password'}> | null>(null);
  let importFilePassword = $state('');
  let importNotice = $state('');
  let addOpen = $state(false);
  let draft = $state(emptyLockerDraft('password'));

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
    const groups = new Map<string, LockerItemDto[]>();
    for (const item of items) {
      const key = item.groupName || $t('workspace.locker');
      const bucket = groups.get(key) ?? [];
      bucket.push(item);
      groups.set(key, bucket);
    }
    return [...groups.entries()];
  });
  const locked = $derived(!status?.exists || !status.unlocked);
  const storage = $derived(status?.sync.storage ?? 'account');
  const syncLabel = $derived.by(() => {
    const sync = status?.sync;
    if (!sync || sync.storage === 'local' || sync.conflict) return '';
    if (sync.state === 'syncing') return $t('locker.syncing');
    if (sync.state === 'synced') return $t('locker.synced');
    if (sync.state === 'pending') return $t('locker.syncPending');
    if (sync.state === 'error') return sync.error || $t('locker.syncError');
    if (sync.available && !sync.signedIn) return $t('locker.syncHint');
    return $t('locker.syncOffline');
  });
  const addOptions = $derived([
    {value: 'password', label: $t('locker.addPassword'), icon: 'key' as const},
    {value: 'totp', label: $t('locker.addTotp'), icon: 'clock' as const},
    {value: 'recovery', label: $t('locker.addRecovery'), icon: 'document-text' as const},
    {value: 'passkey', label: $t('locker.addPasskey'), icon: 'shield' as const},
  ]);

  const stopChanged = api.locker.subscribe((next) => {
    status = next;
    if (!next.unlocked) {
      list = {groups: [], items: [], trash: []};
      selectedId = null;
      clearSecrets();
      editing = false;
      creating = null;
      addOpen = false;
    }
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
      status = await api.locker.status();
      error = '';
      if (status.unlocked) await refreshList(selectedId);
    } catch (reason) {
      error = readableError(reason);
    } finally {
      loading = false;
    }
  }

  async function refreshList(keepId: string | null): Promise<void> {
    list = await api.locker.list();
    const next = keepId && list.items.some((item) => item.id === keepId)
      ? keepId
      : (list.items[0]?.id ?? null);
    await select(next);
  }

  async function createVault(): Promise<void> {
    if (masterPassword.length < 8) {
      error = $t('locker.passwordTooShort');
      return;
    }
    if (masterPassword !== confirmPassword) {
      error = $t('locker.passwordMismatch');
      return;
    }
    busy = true;
    try {
      status = await api.locker.create(masterPassword);
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
      status = await api.locker.unlock(masterPassword);
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
    status = await api.locker.lock();
    masterPassword = '';
    confirmPassword = '';
    list = {groups: [], items: [], trash: []};
    editing = false;
    creating = null;
    addOpen = false;
  }

  function touch(): void {
    if (status?.unlocked) void api.locker.touch();
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
      const revealed = await api.locker.reveal(id);
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
      const next = await api.locker.totp(id);
      if (selectionGate.accepts(request, selectedId) && secretsOwnerId === id && !locked) totp = next;
    } catch {
      if (selectionGate.accepts(request, selectedId) && secretsOwnerId === id) totp = null;
    }
  }

  function startCreate(kind: string): void {
    addOpen = false;
    const next = kind as LockerDraftKind;
    creating = next;
    editing = true;
    pendingDelete = false;
    selectedId = null;
    clearSecrets();
    draft = emptyLockerDraft(next);
  }

  function startEdit(): void {
    if (!selected || secretsOwnerId !== selected.id || !secrets) return;
    creating = null;
    editing = true;
    pendingDelete = false;
    draft = lockerEditDraft(selected, secrets);
  }

  async function saveDraft(): Promise<void> {
    const title = draft.title.trim();
    if (!title) {
      error = $t('locker.title');
      return;
    }
    busy = true;
    try {
      const payload = normalizeLockerSaveDraft(draft);
      const saved = await api.locker.save(payload);
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
      list = await api.locker.remove(selected.id);
      pendingDelete = false;
      selectedId = list.items[0]?.id ?? null;
      clearSecrets();
      if (selectedId) await loadSecrets(selectedId);
      else {
        clearSecrets();
      }
      error = '';
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
      await api.locker.copy(selected.id, field, recoveryIndex);
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
      const result = await api.locker.importBegin();
      if (result.status === 'cancelled') return;
      if (result.status === 'imported') {
        importNotice = $t('locker.imported', {count: result.imported});
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
      const result = await api.locker.importConfirm(importFilePassword);
      importFilePassword = '';
      importPending = null;
      importNotice = $t('locker.imported', {count: result.imported});
      error = result.problems[0] ?? '';
      await refreshList(selectedId);
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }

  function mark(item: LockerItemDto): 'key' | 'clock' | 'document-text' | 'shield' {
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

  async function setStorage(mode: LockerStorageMode, resolve?: LockerStorageResolve): Promise<void> {
    busy = true;
    try {
      status = await api.locker.setStorage(mode, resolve);
      if (status.unlocked) await refreshList(selectedId);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onclick={(event) => {
    if (addOpen && !(event.target as HTMLElement).closest('.locker-add')) addOpen = false;
  }}/>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions (touch activity resets locker idle timer) -->
<div class="locker" role="application" aria-label={$t('workspace.locker')} onpointerdown={touch} onkeydown={touch}>
  {#if loading}
    <div class="locker-empty" role="status">{$t('common.loading')}</div>
  {:else if locked}
    <div class="locker-empty">
      <Icon name="key" size={48} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
      <p class="locker-empty-title">{$t('workspace.locker')}</p>
      <p>{status?.exists ? $t('locker.unlockHint') : $t('locker.createHint')}</p>
      <form class="locker-gate" onsubmit={submitGate}>
        <label>
          <span>{$t('locker.masterPassword')}</span>
          <input
            type="password"
            bind:value={masterPassword}
            autocomplete={status?.exists ? 'current-password' : 'new-password'}
            disabled={busy}
          />
        </label>
        {#if !status?.exists}
          <label>
            <span>{$t('locker.confirmPassword')}</span>
            <input type="password" bind:value={confirmPassword} autocomplete="new-password" disabled={busy}/>
          </label>
        {/if}
        {#if error}<p class="locker-error" role="alert">{error}</p>{/if}
        <button type="submit" class="locker-primary" disabled={busy}>
          {status?.exists ? $t('locker.unlock') : $t('locker.create')}
        </button>
        {@render storageControl()}
      </form>
    </div>
  {:else}
    <div class="locker-toolbar">
      <label class="locker-search">
        <Icon name="search" size={14} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
        <input type="search" bind:value={query} placeholder={$t('locker.search')} aria-label={$t('locker.search')}/>
      </label>
      <div class="locker-add">
        <button
          type="button"
          class="locker-text"
          aria-haspopup="menu"
          aria-expanded={addOpen}
          onclick={() => addOpen = !addOpen}
        >{$t('locker.add')}</button>
        {#if addOpen}
          <div class="polymux-dropdown-menu locker-add-menu" role="menu">
            {#each addOptions as option (option.value)}
              <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => startCreate(option.value)}>
                <Icon name={option.icon} size={15} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
                <span>{option.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <button type="button" class="locker-text" onclick={() => void beginImport()}>{$t('locker.import')}</button>
      <button type="button" class="locker-icon" aria-label={$t('locker.lock')} onclick={() => void lock()}>
        <Icon name="lock" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
      </button>
    </div>
    <div class="locker-sync-bar">{@render storageControl()}</div>
    {#if error}
      <div class="locker-banner" role="alert">
        <span>{error}</span>
        <button type="button" class="locker-icon" aria-label={$t('common.dismissError')} onclick={() => error = ''}>
          <Icon name="close" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
        </button>
      </div>
    {/if}
    {#if importNotice}
      <div class="locker-banner">
        <span>{importNotice}</span>
        <button type="button" class="locker-icon" aria-label={$t('common.dismissError')} onclick={() => importNotice = ''}>
          <Icon name="close" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
        </button>
      </div>
    {/if}
    <div class="locker-body">
      <div class="locker-list" use:scrollFade>
        {#if filtered.length === 0}
          <div class="locker-empty locker-empty-inline">
            <Icon name={query.trim() ? 'search' : 'key'} size={40} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
            <p>{query.trim() ? $t('common.noMatches') : $t('locker.empty')}</p>
            {#if !query.trim()}<p>{$t('locker.emptyHint')}</p>{/if}
          </div>
        {:else}
          {#each filtered as [group, items] (group)}
            {#if filtered.length > 1 || group !== $t('workspace.locker')}
              <p class="locker-group">{group}</p>
            {/if}
            {#each items as item (item.id)}
              <button
                type="button"
                class={['locker-row', selectedId === item.id && 'selected']}
                onclick={() => void select(item.id)}
              >
                <span class="locker-row-icon"><Icon name={mark(item)} size={16} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></span>
                <span class="locker-row-copy">
                  <span class="locker-row-title">{item.title}</span>
                  {#if item.username}<span class="locker-row-meta">{item.username}</span>{/if}
                </span>
              </button>
            {/each}
          {/each}
        {/if}
      </div>
      <div class="locker-detail" use:scrollFade>
        {#if importPending}
          <form class="locker-editor" onsubmit={(event) => { event.preventDefault(); void confirmImport(); }}>
            <h2>{$t('locker.import')}</h2>
            <p>{importPending.name}</p>
            <p>{$t('locker.importKeePass')}</p>
            <label>
              <span>{$t('locker.importPassword')}</span>
              <input type="password" bind:value={importFilePassword} autocomplete="off"/>
            </label>
            <div class="locker-actions">
              <button type="submit" class="locker-primary" disabled={busy}>{$t('locker.import')}</button>
              <button type="button" class="locker-text" onclick={() => importPending = null}>{$t('common.cancel')}</button>
            </div>
          </form>
        {:else if editing}
          <form class="locker-editor" onsubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
            <h2>{creating ? $t('locker.newItem') : $t('common.edit')}</h2>
            <label>
              <span>{$t('locker.title')}</span>
              <input bind:value={draft.title}/>
            </label>
            <label>
              <span>{$t('locker.username')}</span>
              <input bind:value={draft.username}/>
            </label>
            {#if !creating || creating === 'password'}
              <label>
                <span>{$t('locker.password')}</span>
                <input type="password" bind:value={draft.password} autocomplete="off" placeholder={draft.id ? '••••••••' : ''}/>
              </label>
              <label>
                <span>{$t('locker.url')}</span>
                <input bind:value={draft.url}/>
              </label>
            {/if}
            <label>
              <span>{$t('locker.group')}</span>
              <input bind:value={draft.groupName}/>
            </label>
            {#if !creating || creating === 'totp'}
              <label>
                <span>{$t('locker.totpSecret')}</span>
                <input bind:value={draft.totpSecret} autocomplete="off" placeholder={selected?.hasTotp && !creating ? '••••••••' : ''}/>
              </label>
            {/if}
            {#if !creating || creating === 'recovery'}
            <label>
              <span>{$t('locker.recoveryCodes')}</span>
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
              <span>{$t('locker.passkeyRp')}</span>
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
              <span>{$t('locker.passkeyUser')}</span>
              <input
                value={draft.passkey?.username ?? ''}
                oninput={(event) => {
                  const passkey = draft.passkey ?? {relyingParty: '', username: '', credentialId: ''};
                  draft = {...draft, passkey: {...passkey, username: event.currentTarget.value}};
                }}
              />
            </label>
            <label>
              <span>{$t('locker.passkeyId')}</span>
              <input
                value={draft.passkey?.credentialId ?? ''}
                oninput={(event) => {
                  const passkey = draft.passkey ?? {relyingParty: '', username: '', credentialId: ''};
                  draft = {...draft, passkey: {...passkey, credentialId: event.currentTarget.value}};
                }}
              />
            </label>
            <label>
              <span>{$t('locker.passkeyKey')}</span>
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
              <span>{$t('locker.notes')}</span>
              <textarea rows="4" bind:value={draft.notes}></textarea>
            </label>
            <div class="locker-actions">
              <button type="submit" class="locker-primary" disabled={busy}>{$t('common.save')}</button>
              <button type="button" class="locker-text" onclick={() => { editing = false; creating = null; }}>{$t('common.cancel')}</button>
            </div>
          </form>
        {:else if selected}
          <div class="locker-card">
            <header class="locker-card-head">
              <h2>{selected.title}</h2>
              <button type="button" class="locker-text" disabled={busy || secretsOwnerId !== selected.id || !secrets} onclick={startEdit}>{$t('common.edit')}</button>
            </header>
            {#if selected.username}
              {@render secretRow($t('locker.username'), selected.username, 'username')}
            {/if}
            {#if selected.hasPassword}
              {@render secretRow($t('locker.password'), showPassword ? (secrets?.password ?? '') : '••••••••', 'password', true)}
            {/if}
            {#if selected.url}
              {@render secretRow($t('locker.url'), selected.url, 'url')}
            {/if}
            {#if selected.hasTotp}
              <div class="locker-field">
                <span>{$t('locker.totp')}</span>
                <div class="locker-totp">
                  <strong>{totp?.code ?? '••••••'}</strong>
                  {#if totp}
                    <span class="locker-totp-bar" style:--remaining={totp.remaining / totp.period}></span>
                    <span>{$t('locker.oneTime', {remaining: totp.remaining})}</span>
                  {/if}
                  <button type="button" class="locker-text" onclick={() => void copyField('totp')}>
                    {copied === 'totp' ? $t('common.copied') : $t('common.copy')}
                  </button>
                </div>
              </div>
            {/if}
            {#if selected.hasRecoveryCodes}
              <div class="locker-field">
                <span>{$t('locker.recoveryCodes')}</span>
                <ul class="locker-codes">
                  {#each secrets?.recoveryCodes ?? [] as code, index (index)}
                    <li>
                      <code>{code}</code>
                      <button type="button" class="locker-text" onclick={() => void copyField('recovery', index)}>
                        {copied === `recovery:${index}` ? $t('common.copied') : $t('common.copy')}
                      </button>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
            {#if selected.hasPasskey}
              {@render passkeyBlock(secrets?.passkey ?? null)}
            {/if}
            {#if selected.notes}
              <div class="locker-field">
                <span>{$t('locker.notes')}</span>
                <p class="locker-notes">{selected.notes}</p>
              </div>
            {/if}
            <div class="locker-actions">
              {#if pendingDelete}
                <span>{$t('locker.confirmDelete')}</span>
                <button type="button" class="locker-primary" onclick={() => void removeSelected()}>{$t('common.delete')}</button>
                <button type="button" class="locker-text" onclick={() => pendingDelete = false}>{$t('common.cancel')}</button>
              {:else}
                <button type="button" class="locker-text" onclick={() => pendingDelete = true}>{$t('common.delete')}</button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="locker-empty locker-empty-inline">
            <Icon name="key" size={40} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
            <p>{list.items.length ? $t('locker.selectItem') : $t('locker.empty')}</p>
            {#if !list.items.length}<p>{$t('locker.emptyHint')}</p>{/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#snippet secretRow(label: string, value: string, field: 'password' | 'username' | 'url', revealable = false)}
  <div class="locker-field">
    <span>{label}</span>
    <div class="locker-value">
      <code class={['locker-secret', revealable && !showPassword && 'masked']}>{value}</code>
      {#if revealable}
        <button
          type="button"
          class="locker-icon"
          aria-label={showPassword ? $t('locker.hide') : $t('locker.show')}
          onclick={() => showPassword = !showPassword}
        >
          <Icon name={showPassword ? 'eye-off' : 'eye'} size={15} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
        </button>
      {/if}
      <button type="button" class="locker-text" onclick={() => void copyField(field)}>
        {copied === field ? $t('common.copied') : $t('common.copy')}
      </button>
    </div>
  </div>
{/snippet}

{#snippet storageControl()}
  <div class="locker-storage" role="radiogroup" aria-label={$t('locker.storage')}>
    <button
      type="button"
      role="radio"
      aria-checked={storage === 'local'}
      class:selected={storage === 'local'}
      disabled={busy}
      onclick={() => void setStorage('local')}
    >{$t('locker.storageDevice')}</button>
    <button
      type="button"
      role="radio"
      aria-checked={storage === 'account'}
      class:selected={storage === 'account'}
      disabled={busy}
      onclick={() => void setStorage('account')}
    >{$t('locker.storageAccount')}</button>
  </div>
  <p class="locker-sync">{storage === 'local' ? $t('locker.storageDeviceHint') : $t('locker.storageAccountHint')}</p>
  {#if status?.sync.conflict === 'cloud-exists'}
    <p class="locker-sync">{$t('locker.storageConflict')}</p>
    <div class="locker-storage">
      <button type="button" class="locker-text" disabled={busy} onclick={() => void setStorage('account', 'keep-local')}>{$t('locker.storageKeepDevice')}</button>
      <button type="button" class="locker-text" disabled={busy} onclick={() => void setStorage('account', 'keep-cloud')}>{$t('locker.storageKeepAccount')}</button>
    </div>
  {:else if syncLabel}
    <button
      type="button"
      class="locker-sync"
      disabled={!status?.sync?.signedIn || storage === 'local' || busy}
      onclick={() => void api.locker.sync()}
    >{syncLabel}</button>
  {/if}
{/snippet}

{#snippet passkeyBlock(passkey: LockerPasskeyDto | null)}
  <div class="locker-field">
    <span>{$t('locker.passkey')}</span>
    {#if passkey}
      <p class="locker-notes">{passkey.relyingParty}</p>
      {#if passkey.username}<p class="locker-notes">{passkey.username}</p>{/if}
      {#if passkey.credentialId}<p class="locker-notes">{passkey.credentialId}</p>{/if}
    {/if}
  </div>
{/snippet}

<style>
  .locker {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--main-panel-background);
  }
  .locker-empty {
    min-height: 100%;
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
  .locker-empty-inline { min-height: 0; }
  .locker-empty :global(svg) { color: var(--neutral-400); }
  .locker-empty-title {
    margin: 8px 0 0;
    color: var(--neutral-950);
    font-size: 16px;
    font-weight: 600;
  }
  .locker-empty p { margin: 0; font-size: 13px; }
  .locker-gate {
    width: min(280px, 100%);
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 16px;
    text-align: start;
    pointer-events: auto;
  }
  .locker-gate label, .locker-editor label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--neutral-600);
    font-size: 11px;
    font-weight: 500;
  }
  .locker-gate input, .locker-editor input, .locker-editor textarea, .locker-search input {
    border: 1px solid var(--neutral-200);
    border-radius: 8px;
    padding: 7px 9px;
    background: var(--app-surface);
    color: var(--neutral-950);
    font: inherit;
    font-size: 13px;
  }
  .locker-gate input:focus, .locker-editor input:focus, .locker-editor textarea:focus, .locker-search:focus-within {
    border-color: var(--neutral-500);
    outline: 0;
  }
  .locker-error { margin: 0; color: var(--neutral-700); font-size: 12px; }
  .locker-primary {
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
  .locker-primary:disabled { opacity: .45; cursor: default; }
  .locker-sync {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--neutral-500);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }
  .locker-sync:disabled { cursor: default; }
  .locker-sync-bar {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    margin: 0 14px 6px;
  }
  .locker-storage {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .locker-storage > button[role='radio'] {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--neutral-400);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .locker-storage > button[role='radio'].selected {
    color: var(--neutral-950);
    font-weight: 600;
  }
  .locker-storage > button:disabled { cursor: default; }
  .locker-toolbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px 6px;
    border-bottom: 1px solid var(--neutral-100);
  }
  .locker-search {
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
  .locker-search input {
    min-width: 0;
    flex: 1;
    border: 0;
    padding: 0;
    background: transparent;
  }
  .locker-search input::-webkit-search-cancel-button { display: none; }
  .locker-text {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--neutral-600);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .locker-text:hover { color: var(--neutral-950); }
  .locker-add { position: relative; }
  .locker-add-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 5; min-width: 160px; }
  .locker-icon {
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
  .locker-icon:hover { color: var(--neutral-950); }
  .locker-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    color: var(--neutral-700);
    font-size: 12px;
  }
  .locker-banner span { min-width: 0; flex: 1; }
  .locker-body {
    min-height: 0;
    flex: 1;
    display: flex;
  }
  .locker-list, .locker-detail {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    scrollbar-width: none;
  }
  .locker-list::-webkit-scrollbar, .locker-detail::-webkit-scrollbar { display: none; }
  .locker-list {
    width: 240px;
    flex: none;
    border-right: 1px solid var(--neutral-100);
    padding: 6px 0;
  }
  .locker-detail { flex: 1; }
  .locker-group {
    margin: 10px 14px 4px;
    color: var(--neutral-500);
    font-size: 11px;
    font-weight: 600;
  }
  .locker-row {
    width: auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0 6px;
    border: 0;
    border-radius: 8px;
    padding: 7px 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: start;
  }
  .locker-row:hover { background: var(--neutral-100); }
  .locker-row.selected { background: var(--neutral-100); }
  .locker-row-icon {
    flex: none;
    display: grid;
    place-items: center;
    margin-top: 2px;
    color: var(--neutral-500);
  }
  .locker-row-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .locker-row-title, .locker-row-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .locker-row-title { color: var(--neutral-950); font-size: 13px; }
  .locker-row-meta { color: var(--neutral-500); font-size: 11px; }
  .locker-card, .locker-editor {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px 20px 24px;
  }
  .locker-card-head, .locker-actions, .locker-value, .locker-totp {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .locker-card-head { justify-content: space-between; }
  h2 { margin: 0; color: var(--neutral-950); font-size: 18px; font-weight: 600; }
  .locker-field { display: flex; flex-direction: column; gap: 5px; }
  .locker-field > span { color: var(--neutral-500); font-size: 11px; font-weight: 500; }
  .locker-secret {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--neutral-950);
    font-family: inherit;
    font-size: 13px;
  }
  .locker-secret.masked { letter-spacing: 0.12em; }
  .locker-totp { flex-wrap: wrap; }
  .locker-totp strong {
    font-variant-numeric: tabular-nums;
    font-size: 22px;
    letter-spacing: 0.08em;
  }
  .locker-totp-bar {
    width: 48px;
    height: 3px;
    border-radius: 99px;
    background: var(--neutral-200);
    position: relative;
    overflow: hidden;
  }
  .locker-totp-bar::after {
    content: '';
    position: absolute;
    inset: 0;
    transform-origin: left center;
    transform: scaleX(var(--remaining, 1));
    background: var(--neutral-700);
  }
  .locker-codes { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .locker-codes li { display: flex; align-items: center; gap: 8px; }
  .locker-codes code { min-width: 0; flex: 1; font-family: inherit; font-size: 13px; }
  .locker-notes { margin: 0; color: var(--neutral-800); font-size: 13px; white-space: pre-wrap; }
  .locker-editor textarea { resize: vertical; min-height: 72px; }
  @media (prefers-reduced-motion: reduce) {
    .locker-totp-bar::after { transition: none; }
  }
</style>
