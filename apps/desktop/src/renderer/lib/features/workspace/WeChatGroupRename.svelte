<script lang="ts">
  import {onMount, tick} from 'svelte';
  import {fade} from 'svelte/transition';
  import type {ChatGroupInfoDto} from '@polymux/protocol';
  import {polymuxApi} from '../../api/polymux';
  import {t} from '../../../i18n';

  export let chatId: string;
  export let onRenamed: (name: string) => void;
  export let onClose: (restoreFocus: boolean) => void;

  const api = polymuxApi();
  let info: ChatGroupInfoDto | null = null;
  let name = '';
  let loading = true;
  let saving = false;
  let error = '';
  let needsReload = false;
  let input: HTMLInputElement | undefined;
  let cancel: HTMLButtonElement | undefined;
  let form: HTMLFormElement | undefined;
  let disposed = false;
  const motion = {duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 120};
  $: valid = Boolean(info?.isMember && name.trim() && name.trim() !== info.name &&
    !/[\u0000-\u001f\u007f]/.test(name) && new TextEncoder().encode(name.trim()).length <= 1024);

  onMount(() => {
    cancel?.focus();
    void load();
    return () => {disposed = true;};
  });

  async function load(): Promise<void> {
    if (saving) return;
    const focusBefore = document.activeElement;
    loading = true;
    error = '';
    try {
      const current = await api.comms.chatGroupInfo(chatId);
      if (disposed) return;
      info = current;
      name = current.name;
      needsReload = false;
      if (!current.isMember) error = $t('hub.groupNotMember');
    } catch (cause) {
      if (disposed) return;
      info = null;
      error = cause instanceof Error ? cause.message : String(cause);
      needsReload = true;
    } finally {
      if (!disposed) {
        loading = false;
        await tick();
        if (info?.isMember && document.activeElement === focusBefore && form?.contains(focusBefore)) {
          input?.focus(); input?.select();
        }
      }
    }
  }

  async function save(): Promise<void> {
    if (!info || !valid || saving || loading || needsReload) return;
    saving = true;
    error = '';
    try {
      const confirmed = await api.comms.chatRenameGroup(chatId, name.trim(), info.name);
      onRenamed(confirmed.name);
      if (!disposed) onClose(Boolean(form?.contains(document.activeElement) || document.activeElement === document.body));
    } catch (cause) {
      if (disposed) return;
      error = cause instanceof Error ? cause.message : String(cause);
      // An interrupted native call may still have applied. Read its current
      // name before permitting another write; keep the draft visible meanwhile.
      needsReload = true;
    } finally {
      if (!disposed) saving = false;
    }
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !event.isComposing) {
      event.preventDefault(); event.stopPropagation();
      if (!saving) onClose(true);
    } else if (event.key === 'Enter' && event.isComposing) event.preventDefault();
  }
</script>

<form bind:this={form} class="wechat-group-rename" aria-label={$t('hub.renameGroup')} aria-busy={loading || saving}
  transition:fade={motion}
  onsubmit={(event) => {event.preventDefault(); void save();}}>
  <h3>{$t('hub.renameGroup')}</h3>
  <p id="wechat-group-rename-help">{$t('hub.renameGroupHint')}</p>
  {#if loading}
    <p role="status">{$t('common.loading')}</p>
  {:else if info}
    <label for="wechat-group-name">{$t('hub.groupName')}</label>
    <input id="wechat-group-name" bind:this={input} bind:value={name} required autocomplete="off"
      disabled={saving || !info.isMember} aria-describedby="wechat-group-rename-help" onkeydown={keydown} />
  {/if}
  {#if error}<p class="rename-error" role="alert">{error}</p>{/if}
  <footer>
    {#if needsReload}<button type="button" disabled={saving || loading} onclick={() => void load()} onkeydown={keydown}>{$t('hub.reloadGroupName')}</button>{/if}
    <span></span>
    <button bind:this={cancel} type="button" disabled={saving} onclick={() => onClose(true)} onkeydown={keydown}>{$t('common.cancel')}</button>
    <button type="submit" class="rename-save" disabled={!valid || loading || saving || needsReload} onkeydown={keydown}>
      {saving ? $t('hub.saving') : $t('common.save')}
    </button>
  </footer>
</form>

<style>
  .wechat-group-rename {position:relative;flex:0 0 auto;display:flex;flex-direction:column;gap:8px;padding:16px 20px;background:var(--app-surface);color:var(--neutral-900)}
  .wechat-group-rename::after {content:'';position:absolute;bottom:0;left:20px;right:20px;border-bottom:1px solid var(--neutral-200);pointer-events:none}
  h3 {margin:0;font-size:13px;font-weight:600}
  p {margin:0;font-size:12px;line-height:1.5;color:var(--neutral-700);overflow-wrap:anywhere}
  label {margin-top:4px;font-size:12px;color:var(--neutral-800)}
  input {box-sizing:border-box;width:100%;min-width:0;height:34px;padding:0 10px;border:1px solid var(--neutral-300);border-radius:8px;background:var(--app-bg);color:var(--neutral-900);caret-color:currentColor;font:inherit;font-size:13px;outline:none}
  input:focus-visible {border-color:var(--focus-ring)}
  input::selection {background:var(--neutral-300);color:var(--neutral-950)}
  footer {display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap}
  footer span {flex:1}
  button {border:0;border-radius:6px;padding:7px 10px;background:transparent;color:var(--neutral-700);font:inherit;font-size:12px;cursor:pointer}
  button:hover:enabled {color:var(--neutral-950)}
  button:focus-visible {outline:2px solid var(--focus-ring);outline-offset:2px}
  button.rename-save {background:var(--neutral-900);color:var(--app-bg)}
  button.rename-save:hover:enabled {background:var(--neutral-800);color:var(--app-bg)}
  button:disabled, input:disabled {opacity:.5;cursor:default}
  .rename-error {color:var(--danger-600, #b42318)}
</style>
