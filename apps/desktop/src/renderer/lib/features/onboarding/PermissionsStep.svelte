<script lang="ts">
  import type {FlareAIApi, SystemPermissionKind, SystemPermissionStatus} from '@flareai/protocol';
  import {permissionPrompts} from '@flareai/protocol';
  import Icon from '../../shared/components/Icon.svelte';
  import BackAction from './BackAction.svelte';
  import {t, type MessageKey} from '../../../i18n';

  interface Props {
    api: FlareAIApi;
    onDone: (granted: string[]) => void;
  }

  const {api, onDone}: Props = $props();

  /**
   * Each permission is asked for on its own button rather than all at once.
   * macOS shows its own dialog the moment one is requested, and a dialog that
   * arrives with no explanation is the fastest way to get a permanent "Don't
   * Allow" — so the reason is on screen first, and the user starts the prompt.
   */
  const PERMISSIONS: Array<{
    kind: SystemPermissionKind;
    title: MessageKey;
    reason: MessageKey;
  }> = [
    {
      kind: 'microphone',
      title: 'permission.microphone',
      reason: 'permission.microphoneReason',
    },
    {
      kind: 'accessibility',
      title: 'permission.screenReading',
      reason: 'permission.screenReadingReason',
    },
    {
      kind: 'screen-recording',
      title: 'permission.screenRecording',
      reason: 'permission.screenRecordingReason',
    },
    {
      kind: 'full-disk-access',
      title: 'permission.fullDisk',
      reason: 'permission.fullDiskReason',
    },
  ];

  let statuses = $state<Partial<Record<SystemPermissionKind, SystemPermissionStatus>>>({});
  let asking = $state<SystemPermissionKind | ''>('');

  const granted = $derived(
    PERMISSIONS.filter((entry) => statuses[entry.kind] === 'granted').map((entry) => $t(entry.title)),
  );

  async function refresh(): Promise<void> {
    await Promise.all(
      PERMISSIONS.map(async (entry) => {
        const status = await api.permissions
          .status(entry.kind)
          .catch((): SystemPermissionStatus | null => null);
        if (status) statuses[entry.kind] = status;
      }),
    );
  }

  $effect(() => {
    void refresh();
    // A grant given in System Settings comes back with nothing to announce it,
    // so returning to the window is the moment to look again. The check is a
    // real read rather than a stored answer, so it also stays honest about a
    // grant that will not apply until FlareAI is relaunched.
    const recheck = (): void => void refresh();
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  });

  async function request(kind: SystemPermissionKind): Promise<void> {
    asking = kind;
    try {
      statuses[kind] = await api.permissions.request(kind);
    } catch {
      statuses[kind] = 'denied';
    } finally {
      asking = '';
    }
  }
</script>

<!-- One centred column. The rows carry no chrome of their own — a name, the
     reason for it, and the control, separated by hairlines — so nothing here
     competes with the sentence at the top. -->
<div class="permissions">
  <!-- Two discs, one off each edge of the window, cut by it so only their
       inner faces show. They flank the column without ever reaching it: the
       step still reads as one centred sentence, held between two weights. -->
  <div class="perm-orbs" aria-hidden="true">
    <span class="perm-orb left"></span>
    <span class="perm-orb right"></span>
  </div>

  <p class="onb-eyebrow">{$t('onboarding.stepPermissions')}</p>
  <h1 class="onb-title">{$t('permission.title')}</h1>
  <p class="onb-lede">{$t('permission.lede')}</p>

  <ul class="perm-list">
    {#each PERMISSIONS as entry (entry.kind)}
      {@const status = statuses[entry.kind]}
      {@const isGranted = status === 'granted'}
      {@const settings = !permissionPrompts(entry.kind) || status === 'denied' || status === 'restricted'}
      <li class="perm">
        <div class="perm-copy">
          <strong>{$t(entry.title)}</strong>
          <small>{$t(entry.reason)}</small>
        </div>
        {#if isGranted}
          <span class="perm-done"><Icon name="check" size={13} /> {$t('permission.allowed')}</span>
        {:else if settings}
          <button
            type="button"
            class="perm-action"
            onclick={() => void api.permissions.openSettings(entry.kind)}
          >
            {$t('hub.openSettings')}
          </button>
        {:else}
          <button
            type="button"
            class="perm-action"
            disabled={asking === entry.kind}
            onclick={() => void request(entry.kind)}
          >
            {asking === entry.kind ? $t('hub.waiting') : $t('permission.allow')}
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  <!-- A prompt already answered cannot be raised again, so say so. -->
  {#if PERMISSIONS.some((entry) => permissionPrompts(entry.kind) && (statuses[entry.kind] === 'denied' || statuses[entry.kind] === 'restricted'))}
    <p class="onb-note">{$t('permission.deniedNote')}</p>
  {/if}

  <div class="onb-actions perm-actions">
    <!-- Live only once macOS has actually said yes to all three: the button
         means "these are settled", and it should not read as available while
         a row is still asking. Anyone who does not want to grant them all has
         Skip, which is the honest way past this screen. -->
    <button
      type="button"
      class="onb-button primary"
      disabled={granted.length < PERMISSIONS.length}
      onclick={() => onDone(granted)}
    >
      {$t('common.continue')}
    </button>
    <BackAction />
  </div>
</div>

<style>
  .permissions{position:relative;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;
    text-align:center;width:min(520px,86vw);margin:0 auto;padding:24px 0;--perm-orb:clamp(200px,32vw,440px)}
  /* Everything the step actually says sits above the discs. */
  .permissions > :not(.perm-orbs){position:relative;z-index:1}
  .perm-orbs{position:absolute;inset:0;z-index:0;pointer-events:none}
  /* 50% is the column's centre, so `50% - 50vw` is the window's left edge:
     the discs are placed against the window even though they hang off a box
     narrower than it. */
  .perm-orb{position:absolute;top:50%;width:var(--perm-orb);height:var(--perm-orb);
    border-radius:50%;background:var(--neutral-950);transform:translateY(-50%)}
  .perm-orb.left{left:calc(50% - 50vw - var(--perm-orb) * .55)}
  .perm-orb.right{right:calc(50% - 50vw - var(--perm-orb) * .55)}
  .permissions :global(.onb-lede){max-width:40ch}
  .permissions :global(.onb-note){margin:14px 0 0;max-width:44ch}

  /* Hairlines instead of cards: the list reads as one block rather than three
     objects, and the eye goes down the names. */
  .perm-list{list-style:none;margin:26px 0 0;padding:0;width:100%;
    border-top:1px solid var(--neutral-200)}
  .perm{display:flex;align-items:center;justify-content:space-between;gap:18px;
    padding:13px 2px;border-bottom:1px solid var(--neutral-200);text-align:left}
  .perm-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
  .perm-copy strong{color:var(--neutral-950);font-size:13.5px;font-weight:560;letter-spacing:-.01em}
  .perm-copy small{color:var(--neutral-500);font-size:11.5px;line-height:1.35}

  .perm-action{flex:none;height:28px;border:1px solid var(--neutral-300);border-radius:999px;padding:0 14px;
    background:none;color:var(--neutral-950);font-family:inherit;font-size:12px;font-weight:540;cursor:pointer;
    transition:border-color .16s ease,background-color .16s ease}
  .perm-action:hover:not(:disabled){border-color:var(--neutral-950);background:var(--neutral-100)}
  .perm-action:disabled{opacity:.5;cursor:default}
  .perm-action:focus-visible{outline:2px solid var(--neutral-500);outline-offset:2px}

  .perm-done{flex:none;display:inline-flex;align-items:center;gap:6px;color:var(--neutral-500);font-size:12px}

  .perm-actions{margin-top:26px;justify-content:center}
</style>
