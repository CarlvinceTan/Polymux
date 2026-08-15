<script lang="ts">
  import type {MidasApi, SystemPermissionKind, SystemPermissionStatus} from '@midas/protocol';
  import {permissionPrompts} from '@midas/protocol';
  import Icon from '../shared/Icon.svelte';

  interface Props {
    api: MidasApi;
    onDone: (granted: string[]) => void;
    onSkip: () => void;
  }

  const {api, onDone, onSkip}: Props = $props();

  /**
   * Each permission is asked for on its own button rather than all at once.
   * macOS shows its own dialog the moment one is requested, and a dialog that
   * arrives with no explanation is the fastest way to get a permanent "Don't
   * Allow" — so the reason is on screen first, and the user starts the prompt.
   */
  const PERMISSIONS: Array<{
    kind: SystemPermissionKind;
    title: string;
    reason: string;
  }> = [
    {
      kind: 'microphone',
      title: 'Microphone',
      reason: 'Talk to Midas, and dictate instead of typing.',
    },
    {
      kind: 'accessibility',
      title: 'Screen reading',
      reason: 'Act on what is on your screen.',
    },
    {
      kind: 'full-disk-access',
      title: 'Full Disk Access',
      reason: 'Bring iMessage into the Hub.',
    },
  ];

  let statuses = $state<Partial<Record<SystemPermissionKind, SystemPermissionStatus>>>({});
  let asking = $state<SystemPermissionKind | ''>('');

  const granted = $derived(
    PERMISSIONS.filter((entry) => statuses[entry.kind] === 'granted').map((entry) => entry.title),
  );
  /** Rows still waiting on a pane the user has to visit themselves. */
  const awaitingSettings = $derived(
    PERMISSIONS.some((entry) => !permissionPrompts(entry.kind) && statuses[entry.kind] !== 'granted'),
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
    // grant that will not apply until Midas is relaunched.
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
  <p class="onb-eyebrow">Permissions</p>
  <h1 class="onb-title">Give Midas only what you want it to have.</h1>
  <p class="onb-lede">
    All three are optional and can be turned off later. macOS has the final say on each one.
  </p>

  <ul class="perm-list">
    {#each PERMISSIONS as entry (entry.kind)}
      {@const status = statuses[entry.kind]}
      {@const isGranted = status === 'granted'}
      {@const settings = !permissionPrompts(entry.kind) || status === 'denied' || status === 'restricted'}
      <li class="perm">
        <div class="perm-copy">
          <strong>{entry.title}</strong>
          <small>{entry.reason}</small>
        </div>
        {#if isGranted}
          <span class="perm-done"><Icon name="check" size={13} /> Allowed</span>
        {:else if settings}
          <button
            type="button"
            class="perm-action"
            onclick={() => void api.permissions.openSettings(entry.kind)}
          >
            Open Settings
          </button>
        {:else}
          <button
            type="button"
            class="perm-action"
            disabled={asking === entry.kind}
            onclick={() => void request(entry.kind)}
          >
            {asking === entry.kind ? 'Waiting\u2026' : 'Allow'}
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  <!-- Two different situations, so two different notes: a prompt already
       answered cannot be raised again, while a pane never visited was never
       refused in the first place. -->
  {#if PERMISSIONS.some((entry) => permissionPrompts(entry.kind) && (statuses[entry.kind] === 'denied' || statuses[entry.kind] === 'restricted'))}
    <p class="onb-note">
      macOS only asks once. To change a denied permission, turn it on in System Settings and restart
      Midas.
    </p>
  {/if}
  {#if awaitingSettings}
    <p class="onb-note">
      macOS never asks for Full Disk Access. Switch Midas on in the list that opens, then let it
      relaunch the app.
    </p>
  {/if}

  <div class="onb-actions perm-actions">
    <button type="button" class="onb-button primary" onclick={() => onDone(granted)}>Continue</button>
    {#if granted.length === 0}
      <button type="button" class="onb-quiet" onclick={onSkip}>Not now</button>
    {/if}
  </div>
</div>

<style>
  .permissions{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;
    text-align:center;width:min(520px,86vw);margin:0 auto;padding:24px 0}
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
