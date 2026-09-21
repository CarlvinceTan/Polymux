<script lang="ts">
  import {onMount} from 'svelte';
  import type {VaultItemDto, VaultStatusDto} from '@polymux/protocol';
  import {polymuxApi} from '../../api/polymux';
  import {readableError} from '../../shared/errors';
  import Icon from '../../shared/components/Icon.svelte';
  import {MAIN_UI_ICON_SIZE, MAIN_UI_ICON_STROKE_WIDTH} from '../../shared/layout/iconSizing';
  import {t} from '../../../i18n';

  const api = polymuxApi();
  let status = $state<VaultStatusDto | null>(null);
  let trash = $state<VaultItemDto[]>([]);
  let busy = $state(false);
  let error = $state('');
  let enrollOpen = $state(false);
  let enrollPassword = $state('');
  let emptyConfirm = $state(false);

  const syncOn = $derived((status?.sync.storage ?? 'account') === 'account');
  const unlocked = $derived(status?.unlocked === true);
  const syncDetail = $derived.by(() => {
    const sync = status?.sync;
    if (!sync) return '';
    if (sync.state === 'syncing') return $t('vault.syncing');
    if (sync.state === 'synced') {
      return sync.lastSyncedAt
        ? $t('vault.syncedAt', {when: new Date(sync.lastSyncedAt).toLocaleString()})
        : $t('vault.synced');
    }
    if (sync.state === 'pending') return $t('vault.syncPending');
    if (sync.state === 'error') return sync.error || $t('vault.syncError');
    if (sync.storage === 'local') return $t('vault.syncOffHint');
    if (sync.available && !sync.signedIn) return $t('vault.syncHint');
    return $t('vault.syncOffline');
  });

  onMount(() => {
    void load();
    return api.vault.subscribe((next) => {
      status = next;
      if (!next.unlocked) trash = [];
      else void loadTrash();
    });
  });

  async function load(): Promise<void> {
    error = '';
    try {
      status = await api.vault.status();
      await loadTrash();
    } catch (reason) {
      error = readableError(reason);
    }
  }

  async function loadTrash(): Promise<void> {
    if (status?.unlocked !== true) {
      trash = [];
      return;
    }
    try {
      trash = (await api.vault.list()).trash;
    } catch {
      // The list is a convenience here; sync and Touch ID stay usable.
      trash = [];
    }
  }

  async function setSyncOn(next: boolean): Promise<void> {
    busy = true;
    try {
      status = await api.vault.setStorage(next ? 'account' : 'local');
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
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

  async function enrollBiometric(): Promise<void> {
    busy = true;
    try {
      status = await api.vault.enrollBiometric(enrollPassword);
      enrollPassword = '';
      enrollOpen = false;
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }

  async function disenrollBiometric(): Promise<void> {
    busy = true;
    try {
      status = await api.vault.disenrollBiometric();
      enrollOpen = false;
      enrollPassword = '';
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }

  async function restore(id: string): Promise<void> {
    busy = true;
    try {
      await api.vault.restore([id]);
      error = '';
      await loadTrash();
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }

  async function purge(id: string): Promise<void> {
    busy = true;
    try {
      await api.vault.purge([id]);
      error = '';
      await loadTrash();
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }

  async function emptyTrash(): Promise<void> {
    busy = true;
    try {
      await api.vault.emptyTrash();
      emptyConfirm = false;
      error = '';
      await loadTrash();
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }
</script>

<div class="vault-settings">
  {#if error}
    <div class="vault-settings-error" role="alert">
      <span>{error}</span>
      <button type="button" onclick={load}>{$t('vault.retry')}</button>
    </div>
  {/if}

  <section class="vault-settings-group">
    <div class="vault-settings-row">
      <div class="vault-settings-copy">
        <h3>{$t('vault.syncToggle')}</h3>
        <p>{syncDetail}</p>
      </div>
      <div class="vault-settings-controls">
        {#if syncOn}
          <button
            type="button"
            class="vault-settings-icon"
            aria-label={$t('vault.syncNow')}
            data-tooltip-label={$t('vault.syncNow')}
            disabled={busy || !status?.sync.signedIn}
            onclick={() => void syncNow()}
          >
            <Icon name="reload" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
          </button>
        {/if}
        <button
          type="button"
          class="vault-settings-switch"
          role="switch"
          aria-label={$t('vault.syncToggle')}
          aria-checked={syncOn}
          disabled={busy}
          onclick={() => void setSyncOn(!syncOn)}
        ><span></span></button>
      </div>
    </div>
  </section>

  {#if status?.biometric.available}
    <section class="vault-settings-group">
      <div class="vault-settings-row">
        <div class="vault-settings-copy">
          <h3>{$t('vault.enrollTouchId')}</h3>
          <p>{unlocked ? $t('vault.touchIdHint') : $t('vault.touchIdLockedHint')}</p>
        </div>
        <button
          type="button"
          class="vault-settings-switch"
          role="switch"
          aria-label={$t('vault.enrollTouchId')}
          aria-checked={status?.biometric.enrolled === true}
          disabled={busy || (!unlocked && status?.biometric.enrolled !== true)}
          onclick={() => {
            if (status?.biometric.enrolled) void disenrollBiometric();
            else enrollOpen = !enrollOpen;
          }}
        ><span></span></button>
      </div>
      {#if enrollOpen && !status?.biometric.enrolled}
        <form
          class="vault-settings-enroll"
          onsubmit={(event) => {
            event.preventDefault();
            void enrollBiometric();
          }}
        >
          <input
            type="password"
            bind:value={enrollPassword}
            autocomplete="current-password"
            aria-label={$t('vault.masterPassword')}
            placeholder={$t('vault.masterPassword')}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !enrollPassword}>{$t('vault.enable')}</button>
        </form>
      {/if}
    </section>
  {/if}

  <section class="vault-settings-group">
    <div class="vault-settings-row">
      <div class="vault-settings-copy">
        <h3>{$t('vault.catDeleted')}</h3>
        <p>
          {#if !unlocked}
            {$t('vault.trashLockedHint')}
          {:else if trash.length === 0}
            {$t('vault.trashEmpty')}
          {:else}
            {$t('vault.trashCount', {count: trash.length})}
          {/if}
        </p>
      </div>
      {#if unlocked && trash.length > 0}
        {#if emptyConfirm}
          <div class="vault-settings-controls">
            <button type="button" disabled={busy} onclick={() => void emptyTrash()}>{$t('vault.emptyTrash')}</button>
            <button type="button" class="quiet" onclick={() => emptyConfirm = false}>{$t('common.cancel')}</button>
          </div>
        {:else}
          <button type="button" disabled={busy} onclick={() => emptyConfirm = true}>{$t('vault.emptyTrash')}</button>
        {/if}
      {/if}
    </div>
    {#each trash as item (item.id)}
      <div class="vault-settings-trash">
        <span class="vault-settings-trash-copy">
          <strong>{item.title}</strong>
          {#if item.username}<small>{item.username}</small>{/if}
        </span>
        <div class="vault-settings-controls">
          <button type="button" disabled={busy} onclick={() => void restore(item.id)}>{$t('vault.restore')}</button>
          <button type="button" class="quiet" disabled={busy} onclick={() => void purge(item.id)}>{$t('vault.deleteForever')}</button>
        </div>
      </div>
    {/each}
  </section>
</div>

<style>
  .vault-settings { display:flex; flex-direction:column; gap:22px; padding:4px 22px 24px; }
  .vault-settings-group { display:flex; flex-direction:column; gap:10px; }
  .vault-settings-row { display:flex; align-items:center; justify-content:space-between; gap:16px; }
  .vault-settings-copy { min-width:0; display:flex; flex-direction:column; gap:4px; }
  .vault-settings-copy h3 { margin:0; font-size:13px; font-weight:550; }
  .vault-settings-copy p { margin:0; font-size:12px; line-height:1.5; color:var(--neutral-500); overflow-wrap:anywhere; }
  .vault-settings-controls { display:flex; align-items:center; gap:12px; flex:none; }
  .vault-settings button { border:0; padding:0; background:none; color:var(--neutral-600); font:inherit; font-size:13px; cursor:pointer; white-space:nowrap; }
  .vault-settings button:hover:not(:disabled) { color:var(--neutral-950); }
  .vault-settings button:disabled { opacity:.5; cursor:default; }
  .vault-settings button:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; border-radius:5px; }
  .vault-settings button.quiet { color:var(--neutral-500); }
  .vault-settings-icon { width:24px; height:24px; display:grid; place-items:center; flex:none; }
  .vault-settings-switch { width:30px; height:18px; border-radius:10px; flex:none; padding:2px; background:var(--neutral-300); }
  .vault-settings-switch span { display:block; width:14px; height:14px; border-radius:50%; background:var(--app-surface); transition:transform .15s; }
  .vault-settings-switch[aria-checked=true] { background:var(--neutral-900); }
  .vault-settings-switch[aria-checked=true] span { transform:translateX(12px); }
  .vault-settings-enroll { display:flex; align-items:center; gap:10px; }
  .vault-settings-enroll input { min-width:0; flex:1; max-width:280px; border:1px solid var(--neutral-200); border-radius:8px; padding:7px 9px; background:var(--app-surface); color:var(--neutral-950); font:inherit; font-size:13px; }
  .vault-settings-enroll input:focus { border-color:var(--neutral-500); outline:0; }
  .vault-settings-enroll input::placeholder { color:var(--neutral-400); }
  .vault-settings-trash { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:8px 0; border-top:1px solid var(--neutral-100); }
  .vault-settings-trash-copy { min-width:0; display:flex; flex-direction:column; gap:3px; }
  .vault-settings-trash-copy strong { font-size:13px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .vault-settings-trash-copy small { font-size:12px; color:var(--neutral-500); }
  .vault-settings-error { display:flex; align-items:center; justify-content:space-between; gap:16px; color:var(--danger); font-size:13px; }
</style>
