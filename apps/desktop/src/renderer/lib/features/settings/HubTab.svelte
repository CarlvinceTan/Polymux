<script lang="ts" context="module">
  import type {CommsStatusDto as CachedStatusDto} from '@polymux/protocol';

  /**
   * The last status the Hub tab saw, kept outside the component.
   *
   * Settings destroys the tab when the mode changes, so every return to Hub
   * used to wait on a fresh status read and flash its loading rail first. The
   * tab now paints what it knew and corrects it behind the pane. Window-lived,
   * never persisted — which is exactly as long as the answer is worth trusting.
   */
  const hubSnapshot: {status: CachedStatusDto | null} = {status: null};
</script>

<script lang="ts">
  import {onMount, tick} from 'svelte';
  import type {
    CommsBridgeAccountDto,
    CommsBridgeDto,
    CommsEmailAccountDto,
    CommsLoginStepDto,
    CommsPlatform,
    CommsStatusDto,
    CommsMailProvider,
    PolymuxApi,
    SaveEmailAccountRequest,
    SystemPermissionKind,
  } from '@polymux/protocol';
  import {COMMS_EMAIL_PRESETS, permissionPrompts, presetForHost} from '@polymux/protocol';
  import {readableError} from '../../shared/errors';
  import {invalidateHubCache} from '../../shared/state/hubCache';
  import {scrollFade} from '../../shared/scrollFade';
  import {qrSvgPath} from '../../shared/qr';
  import {bridgeLogo, mailLogo} from '../../shared/options/platformBrands';
  import {emailPresetHint, qrInstructions} from '../../../i18n/names';
  import {locale, plural, t, translate, withLocale} from '../../../i18n';
  import Icon from '../../shared/components/Icon.svelte';
  import Menu from '../../shared/components/Menu.svelte';

  export let api: PolymuxApi;

  /** Which providers this build can sign in to; empty draws no buttons. */
  $: mailSignInProviders = status?.email.signInProviders ?? [];
  $: mailPresetOptions = visibleMailPresets(mailSignInProviders).map((item) => ({
    value: item.value,
    label: item.label,
  }));

  /**
   * The providers still worth picking by hand. One that is an app password and
   * a hostname is what "Other" already is; Gmail and Outlook come out only
   * once their sign-in is offered, so a build with no client registered still
   * leaves a way into those mailboxes.
   *
   * A function rather than a reactive statement because the blank form is
   * built during setup, before those have run.
   */
  function visibleMailPresets(providers: readonly CommsMailProvider[]) {
    return COMMS_EMAIL_PRESETS.filter(
      (item) =>
        !item.hidden &&
        !(item.value === 'gmail' && providers.includes('google')) &&
        !(item.value === 'outlook' && providers.includes('microsoft')),
    );
  }

  function mailProviderLabel(provider: CommsMailProvider): string {
    return provider === 'google' ? 'Google' : 'Microsoft';
  }

  /**
   * The provider's own page opens over Polymux; everything after it — the
   * address, the servers, the tokens — comes back from the sign-in, so there
   * is nothing left to fill in and the form closes.
   */
  async function signInMailbox(provider: CommsMailProvider): Promise<void> {
    busy = `email-signin:${provider}`;
    try {
      status = await api.comms.emailSignIn(provider);
      editingEmail = false;
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  type Section = {kind: 'bridge'; platform: CommsPlatform} | {kind: 'mail'};

  let status: CommsStatusDto | null = hubSnapshot.status;
  $: if (status) hubSnapshot.status = status;
  // Mail heads the rail whatever the fleet turns out to hold, so the opening
  // section is set here rather than waiting on the first status — the pane is
  // filled the moment the tab is opened, not a beat later. `keepSelectionOnRail`
  // still moves it if a filter hides Mail.
  let selected: Section | null = {kind: 'mail'};
  let loading = !hubSnapshot.status;
  let error = '';
  let busy = '';
  let emailHealthChecking = false;

  // Bridge linking
  let step: CommsLoginStepDto | null = null;
  let stepPlatform: CommsPlatform | null = null;
  let stepValues: Record<string, string> = {};
  let stepError = '';
  let waiting = false;
  /**
   * The platform whose login has been confirmed and whose account has not been
   * reported by the bridge yet. Holds the pane on "Signing in…" across that
   * gap, instead of dropping back to the log-in button it started from.
   */
  let settling: CommsPlatform | null = null;

  // Bridge setup — the credentials a bridge needs before it can run at all.
  let setupValues: Record<string, string> = {};
  let setupPlatform: CommsPlatform | null = null;

  // Email form
  let editingEmail = false;
  let emailForm = blankEmail();
  let emailOriginalId = '';
  let emailPassword = '';

  onMount(() => {
    const unsubscribe = api.comms.subscribe((next) => {
      status = next;
    });
    void load().then(() => checkEmailConnections());
    const healthTimer = window.setInterval(() => void checkEmailConnections(), 60_000);
    return () => {
      window.clearInterval(healthTimer);
      unsubscribe();
    };
  });

  /** Keep mailbox state current without making connection testing a user task. */
  async function checkEmailConnections(): Promise<void> {
    if (emailHealthChecking || !status?.email.accounts.length) return;
    emailHealthChecking = true;
    try {
      const results = await Promise.allSettled(status.email.accounts.map((account) => api.comms.emailTest(account.id)));
      if (status) {
        const byId = new Map(results.flatMap((result) => result.status === 'fulfilled' ? [[result.value.id, result.value] as const] : []));
        status = {...status, email: {...status.email, accounts: status.email.accounts.map((account) => byId.get(account.id) ?? account)}};
      }
    } finally {
      emailHealthChecking = false;
    }
  }

  async function load(): Promise<void> {
    // Only an empty pane waits — a reopened tab already has rows on screen and
    // corrects them in place rather than blanking back to the loading rail.
    loading = !status;
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
    // The first one the picker is actually showing: with Gmail signed in
    // through its own button it is no longer the head of the list.
    const preset =
      visibleMailPresets(status?.email.signInProviders ?? [])[0] ?? COMMS_EMAIL_PRESETS[0];
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

  /**
   * What to tell the user about credentials here.
   *
   * A provider without its own pill is set up as "Other", so its hint has to
   * follow the servers instead — otherwise the one thing that is not guessable
   * about iCloud or Lark, that the account password will not work, goes
   * unsaid.
   */
  $: presetHint = withLocale(
    $locale,
    emailPresetHint(
      (emailForm.preset === 'custom'
        ? presetForHost(emailForm.smtpHost)?.value ?? presetForHost(emailForm.imapHost)?.value
        : undefined) ?? emailForm.preset,
    ),
  );
  $: bridges = status?.bridges ?? [];
  $: emailAccounts = status?.email.accounts ?? [];
  $: signedIn = status?.hub.status === 'signed-in';
  // svelte-check does not narrow `selected` across the ternary, so the tagged
  // branch is pulled into a local first.
  $: activeBridge = pickBridge(selected, bridges);
  $: mailOpen = selected?.kind === 'mail';
  /** A bridge that cannot even start until its own credentials are recorded. */
  $: needsSetup = Boolean(activeBridge?.setup && !activeBridge.setup.configured);
  $: setupReady = Boolean(
    activeBridge?.setup?.fields.every((field) => (setupValues[field.id] ?? '').trim() !== ''),
  );
  // Warm every installed bridge as soon as the Hub status arrives. Login
  // methods belong to the running bridge, so waiting until a row is selected
  // makes quick navigation flash an avoidable intermediate state.
  $: void warmDormantBridges(status);
  // Typed credentials belong to the platform they were typed under, not to
  // whichever one the rail lands on next.
  $: if (activeBridge?.platform !== setupPlatform) {
    setupPlatform = activeBridge?.platform ?? null;
    setupValues = {};
  }

  /** Platforms already asked for this session; a bridge starts once. */
  const wokenPlatforms = new Set<CommsPlatform>();

  async function warmDormantBridges(snapshot: CommsStatusDto | null): Promise<void> {
    const platforms = (snapshot?.bridges ?? [])
      .filter((bridge) => bridge.state === 'dormant' && !wokenPlatforms.has(bridge.platform))
      .map((bridge) => bridge.platform);
    if (platforms.length === 0) return;
    for (const platform of platforms) wokenPlatforms.add(platform);
    await Promise.allSettled(platforms.map((platform) => api.comms.wake(platform)));
    const next = await api.comms.status().catch((): null => null);
    if (next) status = next;
  }

  async function wakeSelected(section: Section | null): Promise<void> {
    if (section?.kind !== 'bridge') return;
    const platform = section.platform;
    if (wokenPlatforms.has(platform)) return;
    wokenPlatforms.add(platform);
    const next = await api.comms.wake(platform).catch((): null => null);
    if (next) status = next;
  }

  async function saveSetup(platform: CommsPlatform): Promise<void> {
    busy = 'setup';
    try {
      status = await api.comms.bridgeSetup(platform, setupValues);
      setupValues = {};
      error = '';
      // Recorded credentials only take effect once the bridge is back up, and
      // it is parked until something asks for it.
      wokenPlatforms.delete(platform);
      await wakeSelected({kind: 'bridge', platform});
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }
  $: mailSummary = emailAccounts.length === 0
      ? $t('hub.noMailboxes')
      : emailAccounts.length === 1
        ? emailAccounts[0].email
        : plural('hub.mailboxes', emailAccounts.length);
  $: mailState = emailAccounts.some((account) => account.status === 'error')
      ? 'error'
      : emailAccounts.length > 0
        ? 'connected'
        : 'logged-out';

  /**
   * Mail and the bridges share one rail, so they are flattened into a single
   * list before filtering and sorting — otherwise "Name A–Z" would sort the
   * bridges around a Mail row pinned outside the ordering.
   */
  $: railEntries = [
    {
      key: 'mail',
      section: {kind: 'mail'} as Section,
      name: $t('hub.mail'),
      logo: mailLogo('custom'),
      state: mailState,
      label: mailSummary,
    },
    ...bridges.map((bridge) => ({
      key: bridge.platform,
      section: {kind: 'bridge', platform: bridge.platform} as Section,
      name: bridge.name,
      logo: bridgeLogo(bridge.platform),
      state: bridge.state as string,
      label: bridgeLabel(bridge),
    })),
  ];
  $: visibleRail = sortRail(railEntries);
  $: railEmpty = visibleRail.length === 0;
  // In a function, and handed its inputs, because what a reactive statement
  // re-runs on is what it reads at the top level.
  $: keepSelectionOnRail(visibleRail, railEntries);

  /**
   * A platform that has left the fleet would otherwise leave the detail pane
   * showing something the rail no longer offers a way back to.
   *
   * Deliberately not a reason to move on every status read: signing in changes
   * a platform's state, and a selection that jumped on that would throw you off
   * WhatsApp at the moment logging in to it succeeded — the one screen you are
   * certainly still reading.
   */
  function keepSelectionOnRail(visible: typeof railEntries, all: typeof railEntries): void {
    if (!visible.length) return;
    if (selected !== null && all.some((entry) => isSelected(entry.section, selected))) return;
    selected = visible[0].section;
  }
  // The masks are painted from measurements, so they are re-taken whenever the
  // list's contents change under them.
  $: railContentKey = `${visibleRail.length}`;

  function isSelected(section: Section, current: Section | null): boolean {
    if (!current || current.kind !== section.kind) return false;
    return section.kind !== 'bridge' || (current.kind === 'bridge' && current.platform === section.platform);
  }

  /**
   * What is linked, first. The catalogue order underneath it is a fixed list
   * the user has no part in, so a platform they actually connected can sit at
   * the bottom of it — WeChat does — while a dozen rows they have never linked
   * are what the rail opens on. Sorting is stable, so within each group the
   * catalogue order stands.
   *
   * Mail keeps the top whatever its own state, matching where the tab opens.
   */
  function sortRail<T extends {name: string; key: string; state: string}>(entries: T[]): T[] {
    return [...entries].sort((a, b) => railRank(a) - railRank(b));
  }

  function railRank(entry: {key: string; state: string}): number {
    if (entry.key === 'mail') return 0;
    switch (entry.state) {
      case 'connected':
        return 1;
      // Linked, and saying so: it belongs with the platforms in use rather
      // than among the ones never set up.
      case 'connecting':
      case 'error':
        return 2;
      default:
        return 3;
    }
  }

  function pickBridge(section: Section | null, list: CommsBridgeDto[]): CommsBridgeDto | null {
    if (section?.kind !== 'bridge') return null;
    return list.find((item) => item.platform === section.platform) ?? null;
  }

  function bridgeLabel(bridge: CommsBridgeDto): string {
    switch (bridge.state) {
      case 'connected':
        return bridge.accounts.length > 1
          ? plural('drive.accounts', bridge.accounts.length)
          : (bridge.accounts[0]?.name ?? translate('drive.stateConnected'));
      case 'connecting':
        return translate('hub.connecting');
      case 'logged-out':
        return translate('hub.notLinked');
      case 'error':
        return translate('drive.stateError');
      case 'unavailable':
        return translate('hub.localOnly');
      case 'unreachable':
        return translate('hub.hubOffline');
      case 'dormant':
        return translate('hub.notLinked');
      default:
        return translate('hub.unknown');
    }
  }

  /**
   * The hub sets itself up on its own; this only exists so a bridge held back
   * by a hub that has not provisioned yet is not a dead end.
   */
  async function connect(): Promise<void> {
    busy = 'connect';
    try {
      status = await api.comms.connect();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  // Versions the login flow so a cancelled attempt's pending waits cannot
  // write their stale steps over a newer flow (loginWait blocks for minutes).
  let linkAttempt = 0;

  async function startLink(platform: CommsPlatform, flowId: string): Promise<void> {
    const mine = ++linkAttempt;
    settling = null;
    stepPlatform = platform;
    stepError = '';
    stepValues = {};
    busy = `link:${platform}`;
    try {
      const next = await api.comms.loginStart(platform, flowId);
      if (mine !== linkAttempt) return;
      step = next;
      await advance(mine);
    } catch (cause) {
      if (mine !== linkAttempt) return;
      stepError = readableError(cause);
      step = null;
    } finally {
      if (mine === linkAttempt) busy = '';
    }
  }

  /**
   * Drives whichever step the bridge returned that needs no typing: a QR or
   * code has to be waited on, and a cookie sign-in opens its own window.
   */
  async function advance(mine: number): Promise<void> {
    while (step && stepPlatform) {
      if (step.type === 'display_and_wait') {
        waiting = true;
        try {
          const next = await api.comms.loginWait(stepPlatform, step.loginId, step.stepId);
          if (mine !== linkAttempt) return;
          step = next;
        } catch (cause) {
          if (mine !== linkAttempt) return;
          stepError = readableError(cause);
          waiting = false;
          return;
        } finally {
          if (mine === linkAttempt) waiting = false;
        }
        continue;
      }
      if (step.type === 'cookies') {
        waiting = true;
        const platform = stepPlatform;
        const loginId = step.loginId;
        try {
          const next = await api.comms.loginCookies(stepPlatform, step.loginId, step.stepId);
          if (mine !== linkAttempt) return;
          step = next;
        } catch (cause) {
          if (mine !== linkAttempt) return;
          // The sign-in window is gone — closed, or it failed to open. End the
          // flow so the log-in button comes back; the error stays on screen.
          stepError = readableError(cause);
          step = null;
          stepPlatform = null;
          status = await api.comms.loginCancel(platform, loginId).catch(() => status);
          return;
        } finally {
          if (mine === linkAttempt) waiting = false;
        }
        continue;
      }
      if (step.type === 'complete') {
        const platform = stepPlatform;
        step = null;
        stepPlatform = null;
        await settle(platform, mine);
        return;
      }
      return;
    }
  }

  /**
   * Waits for a just-confirmed login to show up on the fleet, holding the panel
   * on "Signing in…" until it does.
   *
   * `status` rather than `refresh`: refresh retries every blocked bridge, so it
   * pokes the very session that has just been established, and it runs through
   * `busy` — which took the whole detail pane through a loading state for a
   * login that had already succeeded. Polled because the bridge reports the new
   * account whenever it has finished bringing it up, with nothing to announce it.
   */
  const SETTLE_POLL_MS = 700;
  const SETTLE_LIMIT_MS = 20000;

  async function settle(platform: CommsPlatform, mine: number): Promise<void> {
    settling = platform;
    const deadline = Date.now() + SETTLE_LIMIT_MS;
    try {
      for (;;) {
        const next = await api.comms.status().catch(() => null);
        if (mine !== linkAttempt) return;
        if (next) status = next;
        const bridge = next?.bridges.find((item) => item.platform === platform);
        if (bridge?.accounts.length) return;
        if (Date.now() >= deadline) return;
        await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
        if (mine !== linkAttempt) return;
      }
    } finally {
      if (settling === platform) settling = null;
    }
  }

  async function submitStep(): Promise<void> {
    if (!step || step.type !== 'user_input' || !stepPlatform) return;
    stepError = '';
    busy = 'step';
    const mine = linkAttempt;
    try {
      const next = await api.comms.loginSubmit(stepPlatform, step.loginId, step.stepId, stepValues);
      if (mine !== linkAttempt) return;
      step = next;
      stepValues = {};
      await advance(mine);
    } catch (cause) {
      if (mine !== linkAttempt) return;
      stepError = readableError(cause);
    } finally {
      if (mine === linkAttempt) busy = '';
    }
  }

  async function cancelLink(): Promise<void> {
    linkAttempt++;
    settling = null;
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
      // The hub holds this account's chats and messages in memory; without
      // this it keeps drawing them after the account is gone.
      invalidateHubCache();
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
    {#if error}
      <div class="comms-error" role="alert">
        <span>{error}</span>
        <button type="button" onclick={() => void refresh()} disabled={busy === 'refresh'}>{$t('common.retry')}</button>
      </div>
    {/if}

    <!-- The rail chrome — divider, tool row, list frame — is painted before the
         fleet lands, so the first status fills a pane that is already there
         rather than replacing a bare line of text with the whole layout. -->
    <div class="comms-body">
      <div class="comms-rail-column">
        <ul
          class="comms-rail"
          class:empty-state={railEmpty || loading}
          class:loading
          use:scrollFade={railContentKey}
        >
          {#if loading}
            <li class="comms-rail-loading">{$t('hub.checkingAccounts')}</li>
          {:else}
          {#each visibleRail as entry (entry.key)}
            <li>
              <button
                type="button"
                class:active={isSelected(entry.section, selected)}
                onclick={() => (selected = entry.section)}
              >
                <span class="comms-mark">
                  {#if entry.logo}
                    <img src={entry.logo} data-logo={entry.key} alt="" aria-hidden="true" />
                  {:else}
                    <span class="comms-mark-letter">{entry.name.charAt(0)}</span>
                  {/if}
                  <span class="comms-dot" data-state={entry.state}></span>
                </span>
                <span>
                  <strong>{entry.name}</strong>
                  <small class="state-text" data-state={entry.state}>{entry.label}</small>
                </span>
              </button>
            </li>
          {:else}
            <li class="comms-rail-empty">{$t('hub.railNoMatches')}</li>
          {/each}
          {/if}
        </ul>

      </div>

      <div class="comms-detail" use:scrollFade={selected}>
        {#if editingEmail}
          <header class="comms-detail-header">
            <h3>{emailOriginalId ? $t('hub.editMailbox', {name: emailOriginalId}) : $t('hub.addMailbox')}</h3>
            <p>{$t('hub.mailboxFormBlurb')}</p>
          </header>
          <!-- Signing in answers the address and the servers at once, so it
               stands above the form rather than beside a Provider field: for a
               Google or Microsoft mailbox there is nothing below worth
               filling in. Only offered where a client is registered. -->
          {#if !emailOriginalId && mailSignInProviders.length}
            <div class="comms-signin">
              {#each mailSignInProviders as provider (provider)}
                <button
                  type="button"
                  class="comms-signin-button"
                  disabled={busy === `email-signin:${provider}`}
                  onclick={() => void signInMailbox(provider)}
                >
                  <img src={mailLogo(provider === 'google' ? 'gmail' : 'outlook')} alt="" aria-hidden="true" />
                  {busy === `email-signin:${provider}`
                    ? $t('hub.signingIn')
                    : $t('hub.signInWith', {provider: mailProviderLabel(provider)})}
                </button>
              {/each}
              <p class="comms-signin-note">{$t('hub.signInOrManual')}</p>
            </div>
          {/if}
          <div class="comms-form">
            {#if mailPresetOptions.length > 1}
              <label>
              <span>{$t('hub.provider')}</span>
              <Menu
                value={emailForm.preset}
                label={$t('hub.provider')}
                wide
                options={mailPresetOptions}
                onChange={applyPreset}
              />
            </label>
            {/if}
            {#if presetHint}<p class="comms-hint">{presetHint}</p>{/if}
            <label>
              <span>{$t('hub.accountName')}</span>
              <input bind:value={emailForm.id} placeholder="work" spellcheck="false" />
            </label>
            <label>
              <span>{$t('hub.emailAddress')}</span>
              <input bind:value={emailForm.email} type="email" placeholder="you@example.com" spellcheck="false" />
            </label>
            <label>
              <span>{$t('hub.displayName')}</span>
              <input bind:value={emailForm.displayName} placeholder={$t('hub.displayNamePlaceholder')} />
            </label>
            <label>
              <span>{$t('hub.password')}</span>
              <input
                bind:value={emailPassword}
                type="password"
                placeholder={emailOriginalId ? $t('hub.passwordKeep') : $t('hub.appPassword')}
              />
            </label>
            <div class="comms-form-row">
              <label>
                <span>{$t('hub.imapServer')}</span>
                <input bind:value={emailForm.imapHost} spellcheck="false" />
              </label>
              <label class="comms-port">
                <span>{$t('hub.port')}</span>
                <input bind:value={emailForm.imapPort} type="number" />
              </label>
            </div>
            <div class="comms-form-row">
              <label>
                <span>{$t('hub.smtpServer')}</span>
                <input bind:value={emailForm.smtpHost} spellcheck="false" />
              </label>
              <label class="comms-port">
                <span>{$t('hub.port')}</span>
                <input bind:value={emailForm.smtpPort} type="number" />
              </label>
            </div>
            <label class="comms-check">
              <input type="checkbox" bind:checked={emailForm.isDefault} />
              <span>{$t('hub.sendByDefault')}</span>
            </label>
            <footer class="comms-actions">
              <button type="button" onclick={() => (editingEmail = false)}>{$t('common.cancel')}</button>
              <button
                type="button"
                class="primary"
                disabled={busy === 'email-save' || !emailForm.id.trim() || !emailForm.email.trim()}
                onclick={() => void saveEmail()}
              >
                {busy === 'email-save' ? $t('hub.saving') : $t('hub.saveMailbox')}
              </button>
            </footer>
          </div>
        {:else if activeBridge}
          <header class="comms-detail-header">
            <h3>{activeBridge.name}</h3>
            <p>
              {#if activeBridge.state === 'connected'}
                {activeBridge.accounts.length > 1
                  ? $t('hub.linkedMany', {count: activeBridge.accounts.length})
                  : $t('hub.linkedOne', {name: activeBridge.accounts[0]?.name ?? ''})}
              {:else if activeBridge.state === 'unavailable'}
                {activeBridge.error}
              {:else if activeBridge.state === 'unreachable'}
                {$t('hub.unreachable')}
              {:else}
                {$t('hub.linkPrompt', {platform: activeBridge.name})}
              {/if}
            </p>
          </header>

          <!-- The bridge's error is just its first account's (see hub.ts), so
               showing it here as well as on the row would say it twice. The
               row is the more precise of the two: it names the account. -->
          {#if activeBridge.error && activeBridge.state !== 'unavailable' && !activeBridge.accounts.some((account) => account.error)}
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
                  ? $t('hub.waiting')
                  : permissionPrompts(activeBridge.permission)
                    ? $t('hub.allowAccess')
                    : $t('hub.openSettings')}
              </button>
            </section>
          {/if}

          {#if settling === activeBridge.platform}
            <!-- Between the phone confirming and the bridge reporting the
                 account. One line, in place: the pane carries on rather than
                 snapping back to the log-in button it started from. -->
            <section class="comms-block comms-step">
              <p role="status">{$t('hub.signingIn')}</p>
            </section>
          {:else if step && stepPlatform === activeBridge.platform}
            <section class="comms-block comms-step">
              {#if step.type === 'display_and_wait'}
                {#if qr}
                  <div class="comms-qr">
                    <!-- The four-module quiet zone is part of the symbol, not
                         padding: scanners need it to find the finder patterns. -->
                    <svg
                      viewBox="-4 -4 {qr.size + 8} {qr.size + 8}"
                      role="img"
                      aria-label={$t('hub.pairingQr')}
                    >
                      <rect x="-4" y="-4" width={qr.size + 8} height={qr.size + 8} fill="#fff" />
                      <path d={qr.path} fill="#000" />
                    </svg>
                  </div>
                {:else if step.display === 'code' && step.data}
                  <p class="comms-code">{step.data}</p>
                {/if}
                <!-- Our own wording first when the QR is up: it names the menu
                     the scanner hides behind, which "scan this" leaves out. -->
                <p>
                  {(qr && qrInstructions(stepPlatform)) ??
                    step.instructions ??
                    $t('hub.confirmOnPhone')}
                </p>
                {#if waiting}<p class="comms-muted">{$t('hub.waiting')}</p>{/if}
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
                <p>{step.instructions ?? $t('hub.finishInWindow')}</p>
              {/if}
              {#if stepError}<p class="comms-hint warn">{stepError}</p>{/if}
              <footer class="comms-actions">
                <!-- With more than one way in, backing out of a method is a
                     step towards the others rather than giving up on the
                     platform, and the label should say so. -->
                <button type="button" onclick={() => void cancelLink()}>
                  {activeBridge.flows.length > 1 && step.type !== 'cookies'
                    ? $t('hub.otherMethods')
                    : $t('common.cancel')}
                </button>
                {#if step.type === 'user_input'}
                  <button type="button" class="primary" disabled={busy === 'step'} onclick={() => void submitStep()}>
                    {busy === 'step' ? $t('hub.checking') : $t('common.continue')}
                  </button>
                {/if}
              </footer>
            </section>
          {:else}
            {#if activeBridge.accounts.length > 0}
              <section class="comms-block">
                <h4>{activeBridge.accounts.length === 1 ? $t('hub.linkedAccount') : $t('hub.linkedAccounts')}</h4>
                {#each activeBridge.accounts as account (account.id)}
                  <p class="comms-value">
                    <code>{account.name}</code>
                    <!-- A relay account belongs to the app on this Mac, so
                         unlinking it stops Polymux carrying its messages
                         rather than signing anything out — but it is still the
                         way off the platform, and belongs on the row. -->
                    <button
                      type="button"
                      class="destructive"
                      disabled={busy === `unlink:${activeBridge.platform}:${account.id}`}
                      onclick={() => void unlink(activeBridge, account)}>{$t('hub.unlink')}</button>
                  </p>
                  {#if account.error}<p class="comms-hint warn">{account.error}</p>{/if}
                {/each}
              </section>
            {/if}
            {#if needsSetup && activeBridge.setup}
            <!-- Telegram and its like will not run on someone else's
                 application, so the pair is asked for here. Without this the
                 pane offered no login methods and no way to get any. -->
            <section class="comms-block">
              <h4>{$t('hub.setupTitle', {platform: activeBridge.name})}</h4>
              <p class="comms-hint">{$t('hub.setupBlurb', {platform: activeBridge.name})}</p>
              <div class="comms-form">
                {#each activeBridge.setup.fields as field (field.id)}
                  <label>
                    <span>{field.name}</span>
                    <input
                      type={field.secret ? 'password' : 'text'}
                      spellcheck="false"
                      autocomplete="off"
                      value={setupValues[field.id] ?? ''}
                      oninput={(event) =>
                        (setupValues = {
                          ...setupValues,
                          [field.id]: (event.currentTarget as HTMLInputElement).value,
                        })}
                    />
                    {#if field.description}<small>{field.description}</small>{/if}
                  </label>
                {/each}
              </div>
              {#if activeBridge.setup.fields[0]?.helpUrl}
                <p class="comms-hint">
                  {$t('hub.setupHelp', {url: activeBridge.setup.fields[0].helpUrl})}
                </p>
              {/if}
              <footer class="comms-actions">
                <button
                  type="button"
                  class="primary"
                  disabled={busy === 'setup' || !setupReady}
                  onclick={() => void saveSetup(activeBridge.platform)}
                >
                  {busy === 'setup' ? $t('hub.saving') : $t('common.save')}
                </button>
              </footer>
            </section>
            {:else if activeBridge.flows.length > 0 && activeBridge.state !== 'unavailable'}
            <section class="comms-block">
              <h4>{activeBridge.accounts.length > 0 ? $t('hub.addAnotherAccount') : $t('hub.howToLink')}</h4>
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
                      {flow.id === 'qr' ? $t('hub.showQr') : $t('hub.start')}
                    </button>
                  </li>
                {/each}
              </ul>
              {#if !signedIn}
                {#if status?.hub.canAutoConnect}
                  <p class="comms-hint">{$t('hub.setupFirst')}</p>
                  <footer class="comms-actions">
                    <button type="button" class="primary" disabled={busy === 'connect'} onclick={() => void connect()}>
                      {busy === 'connect' ? $t('hub.settingUp') : $t('hub.setUpMessaging')}
                    </button>
                  </footer>
                {:else}
                  <p class="comms-hint warn">
                    {status?.hub.error ?? $t('hub.notRunning')}
                  </p>
                {/if}
              {/if}
              {#if stepError}<p class="comms-hint warn">{stepError}</p>{/if}
            </section>
            {:else if activeBridge.state !== 'unavailable' &&
            activeBridge.state !== 'dormant' &&
            activeBridge.accounts.length === 0}
            <p class="comms-muted">
              {$t('hub.noLinkMethod')}
              {#if activeBridge.managementRoomHint}
                {$t('hub.useManagementRoom')}
              {/if}
            </p>
            {/if}
          {/if}
        {:else if mailOpen}
          <header class="comms-detail-header">
            <h3>{$t('hub.mail')}</h3>
            <p>{$t('hub.mailBlurb')}</p>
            <span class="comms-detail-actions">
              <button type="button" aria-label={$t('hub.addMailboxShort')} onclick={addEmail}>
                <Icon name="plus" size={14} />
              </button>
            </span>
          </header>

          <!-- Held back while the fleet is still on its way: "No mailboxes yet"
               is an answer, and it is the wrong one to flash before we have it. -->
          {#if loading}
            <p class="comms-muted">{$t('hub.checkingAccounts')}</p>
          {:else}
            <ul class="comms-mailboxes">
              {#each emailAccounts as account (account.id)}
                <li>
                  <div class="comms-mailbox-head">
                    <span class="comms-mailbox-name">
                      <strong>{account.email}</strong>
                      {#if account.isDefault}<em>{$t('hub.default')}</em>{/if}
                    </span>
                    <span class="comms-status" data-state={account.status}>
                      {account.status === 'ok' ? $t('hub.reachable') : account.status === 'error' ? $t('drive.stateDisconnected') : $t('hub.testing')}
                    </span>
                  </div>
                  <p class="comms-mailbox-servers">
                    <span>{account.incoming.host ?? $t('hub.noImapServer')}{account.incoming.port ? `:${account.incoming.port}` : ''}</span>
                    <span aria-hidden="true">·</span>
                    <span>{account.outgoing.host ?? $t('hub.noSmtpServer')}{account.outgoing.port ? `:${account.outgoing.port}` : ''}</span>
                    <span aria-hidden="true">·</span>
                    <span>{account.incoming.auth === 'oauth2' ? 'OAuth' : account.incoming.auth === 'command' ? $t('hub.keychain') : account.incoming.auth}</span>
                  </p>
                  {#if account.error}<p class="comms-hint warn">{account.error}</p>{/if}
                  <div class="comms-mailbox-actions">
                    <button type="button" onclick={() => editEmail(account)}>{$t('common.edit')}</button>
                    <button
                      type="button"
                      class="destructive"
                      disabled={busy === `email-remove:${account.id}`}
                      onclick={() => void removeEmail(account)}
                    >
                      {$t('hub.remove')}
                    </button>
                  </div>
                </li>
              {:else}
                <li class="comms-mailbox-empty">
                  <p>{$t('hub.noMailboxesYet')}</p>
                  <button type="button" onclick={addEmail}>{$t('hub.addMailbox')}</button>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>
    </div>
</div>

<style>
  .comms{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:2px var(--options-detail-edge) 16px var(--options-content-edge)}
  .comms-muted{color:var(--neutral-400);font-size:11px}
  .comms-error{display:flex;align-items:center;gap:12px;margin-bottom:10px;padding:9px 11px;border-radius:9px;background:#fff5f5;color:#8f3e3e;font-size:11px}
  .comms-error>span{min-width:0;flex:1}
  .comms-error button{height:26px;flex:none;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:7px;padding:0 9px;background:var(--app-surface);color:inherit;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}
  :global(:root[data-theme="dark"]) .comms-error{background:#321f1f;color:#eea7a7}

  .comms-body{min-height:0;flex:1;display:grid;grid-template-columns:calc(186px + var(--options-tab-inline)) 1fr;gap:var(--options-divider-gap)}
  /* Flex gap rather than row margins: block margins collapse to half the
     intended spacing, and the MCP and Skills rails read as 4px of clear air
     between adjacent highlights. */
  .comms-rail-column{min-height:0;display:flex;flex-direction:column;gap:6px;padding-right:var(--options-divider-gap);border-right:1px solid var(--neutral-200)}
  /* Same fade as the MCP/Skills rails: the mask only opens at an edge the list
     is actually scrolled away from, so a short list keeps crisp ends. */
  .comms-rail{min-height:0;flex:1;display:flex;flex-direction:column;gap:4px;margin:0;padding:6px 0;overflow-y:auto;list-style:none}
  .comms-rail.empty-state{-webkit-mask-image:none;mask-image:none}
  .comms-rail>li{margin:0}
  .comms-rail-empty{padding:6px 8px;color:var(--neutral-400);font-size:10.5px}
  /* Centred in the rail's whole height rather than sat at the top: while the
     fleet is on its way the rail has no rows for it to head. */
  .comms-rail.loading{justify-content:center}
  .comms-rail-loading{padding:0 8px;color:var(--neutral-400);text-align:center;font-size:10.5px}
  .comms-rail button:not(.comms-add){width:100%;display:flex;align-items:center;gap:9px;border:0;border-radius:8px;padding:7px 8px;background:transparent;color:var(--neutral-700);cursor:pointer;font-family:inherit;text-align:left}
  .comms-rail button:not(.comms-add):hover{background:var(--neutral-100)}
  .comms-rail button.active{background:var(--neutral-100);color:var(--neutral-950)}
  /* Excludes the status dot, which is a sibling span with a fixed size. */
  .comms-rail button>span:not(.comms-dot){min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
  .comms-rail strong{overflow:hidden;color:var(--neutral-900);text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:540}
  .comms-rail small{overflow:hidden;color:var(--neutral-400);text-overflow:ellipsis;white-space:nowrap;font-size:9.5px}

  /* The mark says which platform, the dot says how it is doing. The dot rides
     the corner of the logo rather than sitting beside it, so the row keeps one
     leading element and the names still line up. */
  /* Outranks `.comms-rail button>span:not(.comms-dot)`, which would otherwise
     claim this span as the text column and stretch it. */
  .comms-rail button>span.comms-mark{position:relative;width:20px;height:20px;flex:none;display:grid;place-items:center}
  .comms-mark img{width:100%;height:100%;object-fit:contain}
  .comms-mark-letter{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;background:var(--neutral-200);color:var(--neutral-600);font-size:10px;font-weight:650}
  .comms-mark .comms-dot{position:absolute;right:-2px;bottom:-2px;box-shadow:0 0 0 1.5px var(--app-surface)}
  .comms-rail button.active .comms-mark .comms-dot{box-shadow:0 0 0 1.5px var(--neutral-100)}
  .comms-dot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--neutral-300)}
  .comms-dot[data-state="connected"]{background:#3f9c5a}
  .comms-dot[data-state="connecting"]{background:#c99a3a}
  .comms-dot[data-state="error"]{background:#c05a5a}
  .comms-dot[data-state="logged-out"]{background:var(--neutral-300)}
  .comms-dot[data-state="unreachable"],.comms-dot[data-state="unavailable"]{background:var(--neutral-200);box-shadow:inset 0 0 0 1px var(--neutral-300)}

  .comms-detail{min-height:0;overflow-y:auto;padding-right:2px}
  /* The action sits out of the text's way rather than on top of it: the header
     keeps a lane clear on the right wide enough for the button and its gap. */
  .comms-detail-header{position:relative;margin-bottom:14px;padding-right:44px}
  .comms-detail-header h3{margin:0;color:var(--neutral-950);font-size:14px;font-weight:580}
  .comms-detail-header p{max-width:520px;margin:5px 0 0;color:var(--neutral-600);font-size:11px;line-height:1.5}
  .comms-detail-actions{position:absolute;top:-2px;right:0;display:flex;gap:4px}
  /* Borderless — the glyph is the affordance, and a box around it competes with
     the cards below. The hover fill is what confirms it is a target. */
  .comms-detail-actions button{width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--neutral-500);cursor:pointer}
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

  /* Above the form and the same width as it, because for a Google or
     Microsoft mailbox there is nothing below worth filling in. */
  .comms-signin{display:flex;max-width:440px;flex-direction:column;gap:7px;margin:0 0 14px}
  .comms-signin-button{display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line);border-radius:9px;padding:9px 12px;background:none;color:var(--ink);font-family:inherit;font-size:12.5px;font-weight:560;cursor:pointer;transition:border-color .16s,opacity .16s}
  .comms-signin-button img{width:16px;height:16px;border-radius:50%;background:#fff;object-fit:contain;padding:1px}
  .comms-signin-button:hover:not(:disabled){border-color:var(--ink-soft)}
  .comms-signin-button:disabled{opacity:.55;cursor:default}
  .comms-signin-button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
  .comms-signin-note{margin:1px 0 0;color:var(--ink-faint);font-size:11.5px}
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

  .comms-flows{margin:0;padding:0;list-style:none}
  .comms-flows li{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 4px}
  .comms-flows li+li::before{position:absolute;top:0;right:4px;left:4px;height:1px;background:var(--neutral-200);content:""}
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


  .comms-mailboxes{margin:0;padding:0;list-style:none}
  .comms-mailboxes>li{position:relative;padding:12px 4px}
  .comms-mailboxes>li+li::before{position:absolute;top:0;right:4px;left:4px;height:1px;background:var(--neutral-200);content:""}
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

  .comms-status{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:540}
  .comms-status::before{width:6px;height:6px;flex:none;border-radius:50%;background:currentColor;content:""}
  .comms-status[data-state="ok"]{color:#3f9c5a}
  .comms-status[data-state="error"]{color:#a04545}
  .comms-status[data-state="unknown"]{color:var(--neutral-500)}
</style>
