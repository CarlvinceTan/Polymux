<script lang="ts">
  import {onMount} from 'svelte';
  import type {GeneralSettingsDto, PolymuxApi} from '@polymux/protocol';
  import {t} from '../../../i18n';
  import {readableError} from '../../shared/errors';
  import Icon from '../../shared/components/Icon.svelte';
  import HubTab from './HubTab.svelte';

  export let api: PolymuxApi;
  export let embedded = false;
  export let onGeneralChange: (settings: GeneralSettingsDto) => void = () => {};
  let general: GeneralSettingsDto | null = null;
  let busy = false;
  let error = '';

  onMount(() => { void load(); });
  async function load(): Promise<void> {
    error = '';
    try { general = await api.general.get(); }
    catch (cause) { error = readableError(cause); }
  }
  async function toggleIncognito(): Promise<void> {
    if (!general || busy) return;
    busy = true;
    error = '';
    try {
      general = await api.general.update({hubIncognitoMode: !general.hubIncognitoMode});
      onGeneralChange(general);
    } catch (cause) { error = readableError(cause); }
    finally { busy = false; }
  }
</script>

<div class="hub-settings">
  <div class="hub-settings-privacy">
    <div class="hub-settings-preference">
      <Icon name="incognito" size={18}/>
      <div class="hub-settings-copy">
        <h3>{$t('settings.hubIncognitoMode')}</h3>
        <p>{$t('settings.hubIncognitoModeHint')}</p>
      </div>
      <button type="button" class="hub-settings-toggle" class:enabled={general?.hubIncognitoMode}
        role="switch" aria-label={$t('settings.enableHubIncognitoMode')}
        aria-checked={general?.hubIncognitoMode ?? false} aria-busy={!general && !error}
        disabled={!general || busy} onclick={() => void toggleIncognito()}><span></span></button>
    </div>
    {#if error}
      <div class="hub-settings-error" role="alert"><span>{error}</span>
        <button type="button" onclick={() => void load()}>{$t('common.retry')}</button>
      </div>
    {/if}
  </div>
  <HubTab {api} responsive={embedded}/>
</div>

<style>
  .hub-settings{min-width:0;min-height:0;flex:1;display:flex;flex-direction:column;--options-content-edge:0px;--options-detail-edge:0px;--options-tab-inline:0px;--options-divider-gap:16px}
  .hub-settings-privacy{flex:none;margin-bottom:18px}
  .hub-settings-preference{display:flex;align-items:center;gap:10px;min-width:0}
  .hub-settings-preference :global(svg){flex:none;color:var(--neutral-600);align-self:flex-start;margin-top:1px}
  .hub-settings-copy{flex:1;min-width:0}
  h3{margin:0;color:var(--neutral-900);font-size:12px;font-weight:550;line-height:20px}
  p{margin:3px 0 0;color:var(--neutral-500);font-size:11px;line-height:1.5}
  .hub-settings-toggle{width:36px;height:20px;align-self:flex-start;flex:none;border:0;border-radius:999px;padding:2px;background:var(--neutral-300);cursor:pointer;transition:background .15s ease}
  .hub-settings-toggle span{width:16px;height:16px;display:block;border-radius:50%;background:var(--neutral-50);transition:transform .15s ease,background .15s ease}
  .hub-settings-toggle.enabled{background:var(--neutral-900)}
  .hub-settings-toggle.enabled span{transform:translateX(16px)}
  :global(:root[data-theme='dark']) .hub-settings-toggle span{background:var(--neutral-800)}
  :global(:root[data-theme='dark']) .hub-settings-toggle.enabled span{background:var(--neutral-100)}
  .hub-settings-toggle:disabled{cursor:default;opacity:.5}
  .hub-settings-toggle:focus-visible{outline:2px solid var(--neutral-500);outline-offset:3px}
  .hub-settings-error{display:flex;align-items:center;gap:12px;margin-top:10px;color:var(--danger-500);font-size:11px}
  .hub-settings-error span{flex:1;min-width:0}
  .hub-settings-error button{flex:none;border:0;padding:0;background:none;color:var(--neutral-700);font:inherit;cursor:pointer}
</style>
