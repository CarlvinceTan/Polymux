<script lang="ts">
  import {onMount} from 'svelte';
  import type {
    CommsBridgeAccountDto,
    CommsBridgeDto,
    CommsEmailAccountDto,
    CommsLoginStepDto,
    CommsPlatform,
    CommsStatusDto,
    MidasApi,
    SaveEmailAccountRequest,
    SystemPermissionKind,
  } from '@midas/protocol';
  import {COMMS_EMAIL_PRESETS, permissionPrompts} from '@midas/protocol';
  import {readableError} from '../../errors';
  import {qrSvgPath} from '../../qr';
  import Icon from '../shared/Icon.svelte';
  import Menu from '../shared/Menu.svelte';

  export let api: MidasApi;

  type Section = {kind: 'bridge'; platform: CommsPlatform} | {kind: 'mail'} | {kind: 'hub'};

  let status: CommsStatusDto | null = null;
  let selected: Section = {kind: 'hub'};
  let loading = true;
  let error = '';
  let busy = '';

  // Hub sign-in
  let hubUserId = '';
  let hubPassword = '';
  let hubUrlDraft = '';
  let editingHubUrl = false;
  let showManualSignIn = false;

  // Bridge linking
  let step: CommsLoginStepDto | null = null;
  let stepPlatform: CommsPlatform | null = null;
  let stepValues: Record<string, string> = {};
  let stepError = '';
  let waiting = false;

  // Email form
  let editingEmail = false;
  let emailForm = blankEmail();
  let emailOriginalId = '';
  let emailPassword = '';

  onMount(() => {
    void load();
    return api.comms.subscribe((next) => {
      status = next;
    });
  });

  async function load(): Promise<void> {
    loading = true;
    error = '';
    try {
      status = await api.comms.status();
    } catch (cause) {
      error = readableError(cause);
    } finally {
      loading = false;
    }
  }

  async function refresh(): Promise<void> {
    busy = 'refresh';
    try {
      status = await api.comms.refresh();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /**
   * Asks macOS for the grant a bridge is held back by, then re-reads the fleet
   * so a bridge freed by it stops reporting itself as blocked. Full Disk
   * Access opens its pane rather than prompting, so that answer only arrives
   * once the user has been and come back.
   */
  async function grant(permission: SystemPermissionKind): Promise<void> {
    busy = 'grant';
    try {
      await api.permissions.request(permission);
      status = await api.comms.refresh();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  function blankEmail(): SaveEmailAccountRequest {
    const preset = COMMS_EMAIL_PRESETS[0];
    return {
      id: '',
      email: '',
      displayName: '',
      preset: preset.value,
      imapHost: preset.imapHost,
      imapPort: preset.imapPort,
      imapEncryption: preset.imapEncryption,
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort,
      smtpEncryption: preset.smtpEncryption,
    };
  }

  /** Filling in a provider's servers is the whole point of picking one. */
  function applyPreset(value: string): void {
    const preset = COMMS_EMAIL_PRESETS.find((item) => item.value === value);
    if (!preset) return;
    emailForm = {
      ...emailForm,
      preset: preset.value,
      imapHost: preset.imapHost,
      imapPort: preset.imapPort,
      imapEncryption: preset.imapEncryption,
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort,
      smtpEncryption: preset.smtpEncryption,
    };
  }

  $: presetHint = COMMS_EMAIL_PRESETS.find((item) => item.value === emailForm.preset)?.hint ?? '';
  $: bridges = status?.bridges ?? [];
  $: emailAccounts = status?.email.accounts ?? [];
  $: signedIn = status?.hub.status === 'signed-in';
  // svelte-check does not narrow `selected` across the ternary, so the tagged
  // branch is pulled into a local first.
  $: activeBridge = pickBridge(selected, bridges);
  $: mailOpen = selected.kind === 'mail';
  $: mailSummary = !status?.email.tooling.installed
    ? 'Unavailable'
    : emailAccounts.length === 0
      ? 'No mailboxes'
      : emailAccounts.length === 1
        ? emailAccounts[0].email
        : `${emailAccounts.length} mailboxes`;
  $: mailState = !status?.email.tooling.installed
    ? 'unavailable'
    : emailAccounts.some((account) => account.status === 'error')
      ? 'error'
      : emailAccounts.length > 0
        ? 'connected'
        : 'logged-out';

  function pickBridge(section: Section, list: CommsBridgeDto[]): CommsBridgeDto | null {
    if (section.kind !== 'bridge') return null;
    return list.find((item) => item.platform === section.platform) ?? null;
  }

  function bridgeLabel(bridge: CommsBridgeDto): string {
    switch (bridge.state) {
      case 'connected':
        return bridge.accounts.length > 1
          ? `${bridge.accounts.length} accounts`
          : (bridge.accounts[0]?.name ?? 'Connected');
      case 'connecting':
        return 'Connecting…';
      case 'logged-out':
        return 'Not linked';
      case 'error':
        return 'Needs attention';
      case 'unavailable':
        return 'Local only';
      case 'unreachable':
        return 'Hub offline';
      case 'dormant':
        return 'Not linked';
      default:
        return 'Unknown';
    }
  }

  async function connect(): Promise<void> {
    busy = 'connect';
    try {
      status = await api.comms.connect();
      error = '';
    } catch (cause) {
      error = readableError(cause);
      // Provisioning is the only path most people should need; offer the manual
      // one only once it has actually failed.
      showManualSignIn = true;
    } finally {
      busy = '';
    }
  }

  async function signIn(): Promise<void> {
    busy = 'sign-in';
    try {
      status = await api.comms.signIn(hubUserId.trim(), hubPassword);
      hubPassword = '';
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function signOut(): Promise<void> {
    busy = 'sign-out';
    try {
      status = await api.comms.signOut();
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function saveHubUrl(): Promise<void> {
    busy = 'hub-url';
    try {
      status = await api.comms.setHubUrl(hubUrlDraft.trim());
      editingHubUrl = false;
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function startLink(platform: CommsPlatform, flowId: string): Promise<void> {
    stepPlatform = platform;
    stepError = '';
    stepValues = {};
    busy = `link:${platform}`;
    try {
      step = await api.comms.loginStart(platform, flowId);
      await advance();
    } catch (cause) {
      stepError = readableError(cause);
      step = null;
    } finally {
      busy = '';
    }
  }

  /**
   * Drives whichever step the bridge returned that needs no typing: a QR or
   * code has to be waited on, and a cookie sign-in opens its own window.
   */
  async function advance(): Promise<void> {
    while (step && stepPlatform) {
      if (step.type === 'display_and_wait') {
        waiting = true;
        try {
          step = await api.comms.loginWait(stepPlatform, step.loginId, step.stepId);
        } catch (cause) {
          stepError = readableError(cause);
          waiting = false;
          return;
        } finally {
          waiting = false;
        }
        continue;
      }
      if (step.type === 'cookies') {
        waiting = true;
        try {
          step = await api.comms.loginCookies(stepPlatform, step.loginId, step.stepId);
        } catch (cause) {
          stepError = readableError(cause);
          waiting = false;
          return;
        } finally {
          waiting = false;
        }
        continue;
      }
      if (step.type === 'complete') {
        step = null;
        stepPlatform = null;
        await refresh();
        return;
      }
      return;
    }
  }

  async function submitStep(): Promise<void> {
    if (!step || step.type !== 'user_input' || !stepPlatform) return;
    stepError = '';
    busy = 'step';
    try {
      step = await api.comms.loginSubmit(stepPlatform, step.loginId, step.stepId, stepValues);
      stepValues = {};
      await advance();
    } catch (cause) {
      stepError = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function cancelLink(): Promise<void> {
    if (!step || !stepPlatform) {
      step = null;
      stepPlatform = null;
      return;
    }
    const platform = stepPlatform;
    const loginId = step.loginId;
    step = null;
    stepPlatform = null;
    stepError = '';
    try {
      status = await api.comms.loginCancel(platform, loginId);
    } catch {
      // The dialog is already closed; a failed cancel is not worth reporting.
    }
  }

  async function unlink(bridge: CommsBridgeDto, account: CommsBridgeAccountDto): Promise<void> {
    busy = `unlink:${bridge.platform}:${account.id}`;
    try {
      status = await api.comms.bridgeLogout(bridge.platform, account.id);
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  function editEmail(account: CommsEmailAccountDto): void {
    emailOriginalId = account.id;
    emailPassword = '';
    emailForm = {
      originalId: account.id,
      id: account.id,
      email: account.email,
      displayName: account.displayName ?? '',
      preset: 'custom',
      imapHost: account.incoming.host ?? '',
      imapPort: account.incoming.port ?? 993,
      imapEncryption: account.incoming.encryption ?? 'tls',
      imapLogin: account.incoming.login ?? '',
      smtpHost: account.outgoing.host ?? '',
      smtpPort: account.outgoing.port ?? 587,
      smtpEncryption: account.outgoing.encryption ?? 'start-tls',
      smtpLogin: account.outgoing.login ?? '',
      isDefault: account.isDefault,
    };
    editingEmail = true;
  }

  function addEmail(): void {
    emailOriginalId = '';
    emailPassword = '';
    emailForm = blankEmail();
    editingEmail = true;
  }

  async function saveEmail(): Promise<void> {
    busy = 'email-save';
    try {
      status = await api.comms.emailSave({
        ...emailForm,
        originalId: emailOriginalId || undefined,
        password: emailPassword || undefined,
      });
      editingEmail = false;
      emailPassword = '';
      selected = {kind: 'mail'};
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function removeEmail(account: CommsEmailAccountDto): Promise<void> {
    busy = `email-remove:${account.id}`;
    try {
      status = await api.comms.emailRemove(account.id);
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function testEmail(account: CommsEmailAccountDto): Promise<void> {
    busy = `email-test:${account.id}`;
    try {
      const tested = await api.comms.emailTest(account.id);
      if (status)
        status = {
          ...status,
          email: {
            ...status.email,
            accounts: status.email.accounts.map((item) =>
              item.id === tested.id ? tested : item,
            ),
          },
        };
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  $: qr =
    step?.type === 'display_and_wait' && step.display === 'qr' && step.data
      ? qrSvgPath(step.data)
      : null;

  function fieldType(type: string): string {
    if (type === 'password' || type === 'token') return 'password';
    if (type === 'email') return 'email';
    if (type === 'phone_number') return 'tel';
    if (type === 'url') return 'url';
    return 'text';
  }
</script>

<div class="comms" role="tabpanel">
  {#if loading}
    <p class="comms-muted">Checking your accounts…</p>
  {:else}
    {#if error}
      <div class="comms-error" role="alert">
        <span>{error}</span>
        <button type="button" onclick={() => void refresh()} disabled={busy === 'refresh'}>Retry</button>
      </div>
    {/if}

    <div class="comms-body">
      <ul class="comms-rail">
        <li>
          <button type="button" class:active={selected.kind === 'hub'} onclick={() => (selected = {kind: 'hub'})}>
            <Icon name="connections" size={15} />
            <span>
              <strong>Message hub</strong>
              <small>{status?.hub.status === 'signed-in' ? 'Connected' : status?.hub.status === 'reachable' ? 'Setup needed' : 'Offline'}</small>
            </span>
          </button>
        </li>
        {#each bridges as bridge (bridge.platform)}
          <li>
            <button
              type="button"
              class:active={selected.kind === 'bridge' && selected.platform === bridge.platform}
              onclick={() => (selected = {kind: 'bridge', platform: bridge.platform})}
            >
              <span class="comms-dot" data-state={bridge.state}></span>
              <span>
                <strong>{bridge.name}</strong>
                <small>{bridgeLabel(bridge)}</small>
              </span>
            </button>
          </li>
        {/each}
        <li>
          <button
            type="button"
            class:active={selected.kind === 'mail'}
            onclick={() => (selected = {kind: 'mail'})}
          >
            <span class="comms-dot" data-state={mailState}></span>
            <span>
              <strong>Mail</strong>
              <small>{mailSummary}</small>
            </span>
          </button>
        </li>
      </ul>

      <div class="comms-detail">
        {#if editingEmail}
          <header class="comms-detail-header">
            <h3>{emailOriginalId ? `Edit ${emailOriginalId}` : 'Add a mailbox'}</h3>
            <p>Midas stores the password in your keychain and writes only a lookup into Himalaya's config.</p>
          </header>
          <div class="comms-form">
            <label>
              <span>Provider</span>
              <Menu
                value={emailForm.preset}
                label="Provider"
                wide
                options={COMMS_EMAIL_PRESETS.map((item) => ({value: item.value, label: item.label}))}
                onChange={applyPreset}
              />
            </label>
            {#if presetHint}<p class="comms-hint">{presetHint}</p>{/if}
            <label>
              <span>Account name</span>
              <input bind:value={emailForm.id} placeholder="work" spellcheck="false" />
            </label>
            <label>
              <span>Email address</span>
              <input bind:value={emailForm.email} type="email" placeholder="you@example.com" spellcheck="false" />
            </label>
            <label>
              <span>Display name</span>
              <input bind:value={emailForm.displayName} placeholder="Your Name" />
            </label>
            <label>
              <span>Password</span>
              <input
                bind:value={emailPassword}
                type="password"
                placeholder={emailOriginalId ? 'Leave blank to keep the saved password' : 'App password'}
              />
            </label>
            <div class="comms-form-row">
              <label>
                <span>IMAP server</span>
                <input bind:value={emailForm.imapHost} spellcheck="false" />
              </label>
              <label class="comms-port">
                <span>Port</span>
                <input bind:value={emailForm.imapPort} type="number" />
              </label>
            </div>
            <div class="comms-form-row">
              <label>
                <span>SMTP server</span>
                <input bind:value={emailForm.smtpHost} spellcheck="false" />
              </label>
              <label class="comms-port">
                <span>Port</span>
                <input bind:value={emailForm.smtpPort} type="number" />
              </label>
            </div>
            <label class="comms-check">
              <input type="checkbox" bind:checked={emailForm.isDefault} />
              <span>Send from this mailbox by default</span>
            </label>
            <footer class="comms-actions">
              <button type="button" onclick={() => (editingEmail = false)}>Cancel</button>
              <button
                type="button"
                class="primary"
                disabled={busy === 'email-save' || !emailForm.id.trim() || !emailForm.email.trim()}
                onclick={() => void saveEmail()}
              >
                {busy === 'email-save' ? 'Saving…' : 'Save mailbox'}
              </button>
            </footer>
          </div>
        {:else if selected.kind === 'hub'}
          <header class="comms-detail-header">
            <h3>Message hub</h3>
            <p>
              Every messaging platform below runs through one hub on this Mac. Nothing leaves your
              machine except the traffic each platform sends anyway.
            </p>
          </header>
          <section class="comms-block">
            <h4>Status</h4>
            {#if signedIn}
              <p class="comms-value">
                <span class="comms-status" data-state="ok">Connected</span>
                <button type="button" disabled={busy === 'sign-out'} onclick={() => void signOut()}>Disconnect</button>
              </p>
              <p class="comms-hint">
                Midas holds its own account on the hub. Its credentials are generated and kept in
                your keychain, so there is nothing for you to remember.
              </p>
            {:else if status?.hub.canAutoConnect}
              <p class="comms-hint">
                Midas will set up its own account on the hub. You do not need to create one or
                choose a password.
              </p>
              <footer class="comms-actions">
                <button type="button" class="primary" disabled={busy === 'connect'} onclick={() => void connect()}>
                  {busy === 'connect' ? 'Setting up…' : 'Set up messaging'}
                </button>
              </footer>
            {:else if status?.hub.status === 'reachable'}
              <p class="comms-hint warn">
                The hub is reachable but Midas cannot create an account on it, so it needs an
                existing one.
              </p>
            {:else}
              <p class="comms-hint warn">
                {status?.hub.error ?? 'The message hub is not running on this Mac.'}
              </p>
            {/if}
          </section>
          <section class="comms-block">
            <h4>Hub address</h4>
            {#if editingHubUrl}
              <div class="comms-form-row">
                <label>
                  <span>Address</span>
                  <input bind:value={hubUrlDraft} spellcheck="false" placeholder="http://127.0.0.1:18080" />
                </label>
              </div>
              <footer class="comms-actions">
                <button type="button" onclick={() => (editingHubUrl = false)}>Cancel</button>
                <button type="button" class="primary" disabled={busy === 'hub-url'} onclick={() => void saveHubUrl()}>Save</button>
              </footer>
            {:else}
              <p class="comms-value">
                <code>{status?.hub.baseUrl}</code>
                <button
                  type="button"
                  onclick={() => {
                    hubUrlDraft = status?.hub.baseUrl ?? '';
                    editingHubUrl = true;
                  }}>Change</button>
              </p>
              {#if status?.hub.error}<p class="comms-hint warn">{status.hub.error}</p>{/if}
            {/if}
          </section>
          {#if !signedIn}
            <section class="comms-block">
              <button
                type="button"
                class="comms-disclosure"
                aria-expanded={showManualSignIn}
                onclick={() => (showManualSignIn = !showManualSignIn)}
              >
                Use an existing Matrix account instead
              </button>
              {#if showManualSignIn}
                <div class="comms-form">
                  <label>
                    <span>Matrix user ID</span>
                    <input bind:value={hubUserId} spellcheck="false" placeholder="@you:your-server" />
                  </label>
                  <label>
                    <span>Password</span>
                    <input bind:value={hubPassword} type="password" />
                  </label>
                  <footer class="comms-actions">
                    <button
                      type="button"
                      disabled={busy === 'sign-in' || !hubUserId.trim() || !hubPassword}
                      onclick={() => void signIn()}
                    >
                      {busy === 'sign-in' ? 'Signing in…' : 'Sign in'}
                    </button>
                  </footer>
                </div>
              {/if}
            </section>
          {/if}
        {:else if activeBridge}
          <header class="comms-detail-header">
            <h3>{activeBridge.name}</h3>
            <p>
              {#if activeBridge.state === 'connected'}
                {activeBridge.accounts.length > 1
                  ? `${activeBridge.accounts.length} accounts are linked. Midas can read and send on all of them.`
                  : `Linked as ${activeBridge.accounts[0]?.name}. Midas can read and send here.`}
              {:else if activeBridge.state === 'unavailable'}
                {activeBridge.error}
              {:else if activeBridge.state === 'dormant'}
                Not running yet — nothing is linked to it. Opening it starts it.
              {:else if activeBridge.state === 'unreachable'}
                The message hub is not responding, so this platform cannot be checked.
              {:else}
                Link your {activeBridge.name} account to let Midas read and send messages.
              {/if}
            </p>
          </header>

          {#if activeBridge.error && activeBridge.state !== 'unavailable'}
            <p class="comms-hint warn">{activeBridge.error}</p>
          {/if}

          <!-- A blocker macOS can lift belongs behind a button rather than in
               directions the reader has to carry to another app. -->
          {#if activeBridge.permission}
            <section class="comms-block">
              <button
                type="button"
                disabled={busy === 'grant'}
                onclick={() => void grant(activeBridge.permission!)}
              >
                {busy === 'grant'
                  ? 'Waiting…'
                  : permissionPrompts(activeBridge.permission)
                    ? 'Allow access'
                    : 'Open Settings'}
              </button>
            </section>
          {/if}

          {#if step && stepPlatform === activeBridge.platform}
            <section class="comms-block comms-step">
              {#if step.type === 'display_and_wait'}
                {#if qr}
                  <div class="comms-qr">
                    <!-- The four-module quiet zone is part of the symbol, not
                         padding: scanners need it to find the finder patterns. -->
                    <svg
                      viewBox="-4 -4 {qr.size + 8} {qr.size + 8}"
                      role="img"
                      aria-label="Pairing QR code"
                    >
                      <rect x="-4" y="-4" width={qr.size + 8} height={qr.size + 8} fill="#fff" />
                      <path d={qr.path} fill="#000" />
                    </svg>
                  </div>
                {:else if step.display === 'code' && step.data}
                  <p class="comms-code">{step.data}</p>
                {/if}
                <p>{step.instructions ?? 'Waiting for you to confirm on your phone…'}</p>
                {#if waiting}<p class="comms-muted">Waiting…</p>{/if}
              {:else if step.type === 'user_input'}
                {#if step.instructions}<p>{step.instructions}</p>{/if}
                <div class="comms-form">
                  {#each step.fields as field (field.id)}
                    <label>
                      <span>{field.name}</span>
                      <input
                        type={fieldType(field.type)}
                        value={stepValues[field.id] ?? ''}
                        oninput={(event) =>
                          (stepValues = {
                            ...stepValues,
                            [field.id]: (event.currentTarget as HTMLInputElement).value,
                          })}
                        spellcheck="false"
                      />
                      {#if field.description}<small>{field.description}</small>{/if}
                    </label>
                  {/each}
                </div>
              {:else if step.type === 'cookies'}
                <p>{step.instructions ?? 'Finish signing in the window that just opened.'}</p>
              {/if}
              {#if stepError}<p class="comms-hint warn">{stepError}</p>{/if}
              <footer class="comms-actions">
                <button type="button" onclick={() => void cancelLink()}>Cancel</button>
                {#if step.type === 'user_input'}
                  <button type="button" class="primary" disabled={busy === 'step'} onclick={() => void submitStep()}>
                    {busy === 'step' ? 'Checking…' : 'Continue'}
                  </button>
                {/if}
              </footer>
            </section>
          {:else}
            {#if activeBridge.accounts.length > 0}
              <section class="comms-block">
                <h4>{activeBridge.accounts.length === 1 ? 'Linked account' : 'Linked accounts'}</h4>
                {#each activeBridge.accounts as account (account.id)}
                  <p class="comms-value">
                    <code>{account.name}</code>
                    <button
                      type="button"
                      class="destructive"
                      disabled={busy === `unlink:${activeBridge.platform}:${account.id}`}
                      onclick={() => void unlink(activeBridge, account)}>Unlink</button>
                  </p>
                  {#if account.error}<p class="comms-hint warn">{account.error}</p>{/if}
                {/each}
              </section>
            {/if}
            {#if activeBridge.flows.length > 0 && activeBridge.state !== 'unavailable'}
            <section class="comms-block">
              <h4>{activeBridge.accounts.length > 0 ? 'Add another account' : 'How do you want to link it?'}</h4>
              <ul class="comms-flows">
                {#each activeBridge.flows as flow (flow.id)}
                  <li>
                    <span>
                      <strong>{flow.name}</strong>
                      <small>{flow.description}</small>
                    </span>
                    <button
                      type="button"
                      disabled={!signedIn || busy === `link:${activeBridge.platform}`}
                      onclick={() => void startLink(activeBridge.platform, flow.id)}
                    >
                      {flow.id === 'qr' ? 'Show QR' : 'Start'}
                    </button>
                  </li>
                {/each}
              </ul>
              {#if !signedIn}
                <p class="comms-hint">Set up the message hub first.</p>
              {/if}
              {#if stepError}<p class="comms-hint warn">{stepError}</p>{/if}
            </section>
            {:else if activeBridge.state !== 'unavailable' && activeBridge.accounts.length === 0}
            <p class="comms-muted">
              This bridge did not offer a way to link an account from here.
              {#if activeBridge.managementRoomHint}
                Use its management room instead.
              {/if}
            </p>
            {/if}
          {/if}
        {:else if mailOpen}
          <header class="comms-detail-header">
            <h3>Mail</h3>
            <p>
              Midas reads and sends email through these mailboxes. Passwords live in your keychain,
              never in a config file.
            </p>
            <span class="comms-detail-actions">
              <button type="button" aria-label="Add mailbox" onclick={addEmail}>
                <Icon name="plus" size={14} />
              </button>
            </span>
          </header>

          {#if status && !status.email.tooling.installed}
            <p class="comms-hint warn">{status.email.tooling.error}</p>
          {:else}
            <ul class="comms-mailboxes">
              {#each emailAccounts as account (account.id)}
                <li>
                  <div class="comms-mailbox-head">
                    <span class="comms-mailbox-name">
                      <strong>{account.email}</strong>
                      {#if account.isDefault}<em>Default</em>{/if}
                    </span>
                    <span class="comms-status" data-state={account.status}>
                      {account.status === 'ok' ? 'Reachable' : account.status === 'error' ? 'Failed' : 'Not tested'}
                    </span>
                  </div>
                  <p class="comms-mailbox-servers">
                    <span>{account.incoming.host ?? 'No IMAP server'}{account.incoming.port ? `:${account.incoming.port}` : ''}</span>
                    <span aria-hidden="true">·</span>
                    <span>{account.outgoing.host ?? 'No SMTP server'}{account.outgoing.port ? `:${account.outgoing.port}` : ''}</span>
                    <span aria-hidden="true">·</span>
                    <span>{account.incoming.auth === 'oauth2' ? 'OAuth' : account.incoming.auth === 'command' ? 'Keychain' : account.incoming.auth}</span>
                  </p>
                  {#if account.error}<p class="comms-hint warn">{account.error}</p>{/if}
                  {#if !account.secretStored}
                    <p class="comms-hint">
                      Set up outside Midas, so its password is not in Midas's keychain entry. Editing
                      it here will move it.
                    </p>
                  {/if}
                  <div class="comms-mailbox-actions">
                    <button
                      type="button"
                      disabled={busy === `email-test:${account.id}`}
                      onclick={() => void testEmail(account)}
                    >
                      {busy === `email-test:${account.id}` ? 'Testing…' : 'Test'}
                    </button>
                    <button type="button" onclick={() => editEmail(account)}>Edit</button>
                    <button
                      type="button"
                      class="destructive"
                      disabled={busy === `email-remove:${account.id}`}
                      onclick={() => void removeEmail(account)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              {:else}
                <li class="comms-mailbox-empty">
                  <p>No mailboxes yet.</p>
                  <button type="button" onclick={addEmail}>Add a mailbox</button>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}

        {#if !editingEmail && selected.kind === 'hub' && status && !status.email.tooling.installed}
          <section class="comms-block">
            <h4>Email</h4>
            <p class="comms-hint warn">{status.email.tooling.error}</p>
          </section>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .comms{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:2px var(--options-detail-edge) 16px calc(var(--options-content-edge) + var(--options-tab-inline))}
  .comms-muted{color:var(--neutral-400);font-size:11px}
  .comms-error{display:flex;align-items:center;gap:12px;margin-bottom:10px;padding:9px 11px;border-radius:9px;background:#fff5f5;color:#8f3e3e;font-size:11px}
  .comms-error>span{min-width:0;flex:1}
  .comms-error button{height:26px;flex:none;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:7px;padding:0 9px;background:var(--app-surface);color:inherit;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}
  :global(:root[data-theme="dark"]) .comms-error{background:#321f1f;color:#eea7a7}

  .comms-body{min-height:0;flex:1;display:grid;grid-template-columns:186px 1fr;gap:var(--options-divider-gap)}
  /* Flex gap rather than row margins: block margins collapse to half the
     intended spacing, and the MCP and Skills rails read as 4px of clear air
     between adjacent highlights. */
  .comms-rail{min-height:0;display:flex;flex-direction:column;gap:4px;margin:0;padding:0 4px 0 0;overflow-y:auto;list-style:none;border-right:1px solid var(--neutral-200)}
  .comms-rail>li{margin:0}
  .comms-rail button:not(.comms-add){width:100%;display:flex;align-items:center;gap:9px;border:0;border-radius:8px;padding:7px 8px;background:transparent;color:var(--neutral-700);cursor:pointer;font-family:inherit;text-align:left}
  .comms-rail button:not(.comms-add):hover{background:var(--neutral-100)}
  .comms-rail button.active{background:var(--neutral-100);color:var(--neutral-950)}
  /* Excludes the status dot, which is a sibling span with a fixed size. */
  .comms-rail button>span:not(.comms-dot){min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
  .comms-rail strong{overflow:hidden;color:var(--neutral-900);text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:540}
  .comms-rail small{overflow:hidden;color:var(--neutral-400);text-overflow:ellipsis;white-space:nowrap;font-size:9.5px}

  .comms-dot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--neutral-300)}
  .comms-dot[data-state="connected"]{background:#3f9c5a}
  .comms-dot[data-state="connecting"]{background:#c99a3a}
  .comms-dot[data-state="error"]{background:#c05a5a}
  .comms-dot[data-state="logged-out"]{background:var(--neutral-300)}
  .comms-dot[data-state="unreachable"],.comms-dot[data-state="unavailable"]{background:var(--neutral-200);box-shadow:inset 0 0 0 1px var(--neutral-300)}

  .comms-detail{min-height:0;overflow-y:auto;padding-right:2px}
  .comms-detail-header{position:relative;margin-bottom:14px}
  .comms-detail-header h3{margin:0;color:var(--neutral-950);font-size:14px;font-weight:580}
  .comms-detail-header p{max-width:520px;margin:5px 0 0;color:var(--neutral-600);font-size:11px;line-height:1.5}
  .comms-detail-actions{position:absolute;top:0;right:0;display:flex;gap:4px}
  .comms-detail-actions button{width:26px;height:26px;display:grid;place-items:center;border:1px solid var(--neutral-200);border-radius:7px;background:var(--app-surface);color:var(--neutral-600);cursor:pointer}
  .comms-detail-actions button:hover{background:var(--neutral-100);color:var(--neutral-950)}

  .comms-block{margin-bottom:16px;padding-top:12px;border-top:1px solid var(--neutral-200)}
  .comms-block h4{margin:0 0 7px;color:var(--neutral-900);font-size:11.5px;font-weight:570}
  .comms-block h4:not(:first-child){margin-top:12px}
  .comms-value{display:flex;align-items:center;gap:9px;margin:0 0 4px;font-size:11px}
  .comms-value code{overflow:hidden;padding:2px 6px;border-radius:5px;background:var(--neutral-100);color:var(--neutral-800);text-overflow:ellipsis;white-space:nowrap;font-size:10.5px}
  .comms-value button{height:26px;flex:none;border:1px solid var(--neutral-200);border-radius:7px;padding:0 10px;background:var(--app-surface);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}
  .comms-value button:hover{background:var(--neutral-100);color:var(--neutral-950)}
  .comms-value button.destructive{color:#a04545}
  .comms-value button:disabled{cursor:default;opacity:.5}

  .comms-hint{max-width:520px;margin:5px 0 0;color:var(--neutral-500);font-size:10.5px;line-height:1.5}
  .comms-hint.warn{color:#a04545}
  :global(:root[data-theme="dark"]) .comms-hint.warn{color:#e79c9c}

  .comms-form{display:flex;max-width:440px;flex-direction:column;gap:9px}
  .comms-form label{display:flex;flex-direction:column;gap:3px}
  .comms-form label>span{color:var(--neutral-600);font-size:10.5px;font-weight:530}
  .comms-form label>small{color:var(--neutral-400);font-size:9.5px}
  .comms-form input{height:30px;border:1px solid var(--neutral-200);border-radius:8px;padding:0 9px;background:var(--app-surface);color:var(--neutral-950);font-family:inherit;font-size:11.5px}
  .comms-form input:focus-visible{border-color:var(--neutral-500);outline:0}
  .comms-form-row{display:flex;max-width:440px;gap:9px}
  .comms-form-row>label{flex:1}
  .comms-form-row .comms-port{max-width:82px;flex:none}
  .comms-check{flex-direction:row!important;align-items:center;gap:7px!important}
  .comms-check input{width:14px;height:14px;flex:none}

  .comms-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:12px}
  .comms-actions button{height:29px;border:1px solid var(--neutral-200);border-radius:8px;padding:0 12px;background:var(--app-surface);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:11px;font-weight:550}
  .comms-actions button:hover{background:var(--neutral-100);color:var(--neutral-950)}
  .comms-actions button.primary{border-color:var(--neutral-950);background:var(--neutral-950);color:var(--app-bg)}
  .comms-actions button.primary:hover{opacity:.88}
  .comms-actions button:disabled{cursor:default;opacity:.5}

  .comms-flows{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
  .comms-flows li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 11px;border:1px solid var(--neutral-200);border-radius:9px}
  .comms-flows span{min-width:0;display:flex;flex-direction:column;gap:2px}
  .comms-flows strong{color:var(--neutral-900);font-size:11.5px;font-weight:545}
  .comms-flows small{color:var(--neutral-500);font-size:10px}
  .comms-flows button{height:27px;flex:none;border:1px solid var(--neutral-200);border-radius:7px;padding:0 11px;background:var(--app-surface);color:var(--neutral-800);cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}
  .comms-flows button:hover:not(:disabled){background:var(--neutral-100)}
  .comms-flows button:disabled{cursor:default;opacity:.45}

  .comms-step p{margin:0 0 8px;color:var(--neutral-700);font-size:11px;line-height:1.5}
  /* The symbol needs a light quiet zone regardless of theme, or scanners fail. */
  .comms-qr{width:200px;padding:10px;margin:0 0 12px;border-radius:10px;background:#fff}
  .comms-qr svg{width:100%;height:auto;display:block;shape-rendering:crispEdges}
  .comms-code{padding:9px 12px;border-radius:9px;background:var(--neutral-100);color:var(--neutral-950);font-size:19px;font-weight:600;letter-spacing:.16em;font-variant-numeric:tabular-nums}

  .comms-disclosure{border:0;padding:0;margin:0 0 8px;background:transparent;color:var(--neutral-600);cursor:pointer;font-family:inherit;font-size:11px;text-decoration:underline;text-underline-offset:2px}
  .comms-disclosure:hover{color:var(--neutral-950)}

  .comms-mailboxes{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
  .comms-mailboxes>li{padding:11px 12px;border:1px solid var(--neutral-200);border-radius:11px}
  .comms-mailbox-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .comms-mailbox-name{min-width:0;display:flex;align-items:center;gap:7px}
  .comms-mailbox-name strong{overflow:hidden;color:var(--neutral-950);text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:555}
  .comms-mailbox-name em{flex:none;padding:1px 6px;border-radius:5px;background:var(--neutral-100);color:var(--neutral-600);font-size:9.5px;font-style:normal;font-weight:550}
  .comms-mailbox-servers{display:flex;flex-wrap:wrap;gap:6px;margin:5px 0 0;color:var(--neutral-500);font-size:10.5px}
  .comms-mailbox-actions{display:flex;gap:6px;margin-top:9px}
  .comms-mailbox-actions button{height:26px;border:1px solid var(--neutral-200);border-radius:7px;padding:0 9px;background:var(--app-surface);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}
  .comms-mailbox-actions button:hover:not(:disabled){background:var(--neutral-100);color:var(--neutral-950)}
  .comms-mailbox-actions button.destructive{color:#a04545}
  .comms-mailbox-actions button:disabled{cursor:default;opacity:.5}
  .comms-mailbox-empty{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .comms-mailbox-empty p{margin:0;color:var(--neutral-500);font-size:11px}
  .comms-mailbox-empty button{height:27px;flex:none;border:1px solid var(--neutral-200);border-radius:7px;padding:0 11px;background:var(--app-surface);color:var(--neutral-800);cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}
  .comms-mailbox-empty button:hover{background:var(--neutral-100)}

  .comms-status{font-size:11px;font-weight:540}
  .comms-status[data-state="ok"]{color:#3f9c5a}
  .comms-status[data-state="error"]{color:#a04545}
  .comms-status[data-state="unknown"]{color:var(--neutral-500)}
</style>
