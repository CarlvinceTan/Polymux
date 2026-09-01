<script lang="ts">
  import {onDestroy, onMount} from 'svelte';
  import type {PhoneFrameDto, PhoneIosSigningStatusDto, PhoneStatusDto} from '@polymux/protocol';
  import {polymuxApi} from '../../api/polymux';
  import {readableError} from '../../shared/errors';
  import Icon from '../../shared/components/Icon.svelte';

  const api = polymuxApi();
  let status: PhoneStatusDto | null = null;
  let frame: PhoneFrameDto | null = null;
  let iosSigning: PhoneIosSigningStatusDto | null = null;
  let loading = true;
  let connecting = false;
  let signingLoading = false;
  let capturing = false;
  let error = '';
  let typedText = '';
  let showAndroidPairing = false;
  let androidPairingAddress = '';
  let androidConnectionAddress = '';
  let androidPairingCode = '';
  let appleEmail = '';
  let applePassword = '';
  let appleVerificationCode = '';
  let frameTimer: ReturnType<typeof setInterval> | undefined;
  let pointerStart: {x: number; y: number} | null = null;

  onMount(() => {
    void refreshStatus();
  });

  onDestroy(stopFrames);

  async function refreshStatus(): Promise<void> {
    try {
      status = await api.phone.status();
      error = '';
      if (status.device?.platform === 'ios' && !status.signing.available) {
        await refreshIosSigning();
      } else {
        iosSigning = null;
      }
      if (status.stage === 'connected') {
        startFrames();
        await refreshFrame();
      } else {
        stopFrames();
        frame = null;
      }
    } catch (reason) {
      error = readableError(reason);
    } finally {
      loading = false;
    }
  }

  async function refreshIosSigning(): Promise<void> {
    signingLoading = true;
    try {
      iosSigning = await api.phone.iosSigningStatus();
      if (iosSigning.email && !appleEmail) appleEmail = iosSigning.email;
    } catch (reason) {
      error = readableError(reason);
    } finally {
      signingLoading = false;
    }
  }

  async function beginIosSigning(): Promise<void> {
    if (!appleEmail.trim() || !applePassword) return;
    connecting = true;
    error = '';
    let ready = false;
    try {
      iosSigning = await api.phone.iosSigningBegin(appleEmail.trim(), applePassword);
      ready = iosSigning.stage === 'authenticated';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      applePassword = '';
      connecting = false;
    }
    if (ready) await connect();
  }

  async function completeIosSigning(): Promise<void> {
    if (appleVerificationCode.length !== 6) return;
    connecting = true;
    error = '';
    let ready = false;
    try {
      iosSigning = await api.phone.iosSigningComplete(appleVerificationCode);
      ready = iosSigning.stage === 'authenticated';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      appleVerificationCode = '';
      connecting = false;
    }
    if (ready) await connect();
  }

  async function restartIosSigning(): Promise<void> {
    connecting = true;
    error = '';
    try {
      iosSigning = await api.phone.iosSigningLogout();
      applePassword = '';
      appleVerificationCode = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      connecting = false;
    }
  }

  async function connect(): Promise<void> {
    connecting = true;
    error = '';
    try {
      status = await api.phone.connect();
      startFrames();
      await refreshFrame();
    } catch (reason) {
      const message = readableError(reason);
      await refreshStatus().catch(() => {});
      error = message;
    } finally {
      connecting = false;
    }
  }

  async function stopControl(): Promise<void> {
    connecting = true;
    error = '';
    try {
      stopFrames();
      status = await api.phone.stop();
      frame = null;
    } catch (reason) {
      const message = readableError(reason);
      await refreshStatus().catch(() => {});
      error = message;
    } finally {
      connecting = false;
    }
  }

  async function pairAndroid(): Promise<void> {
    if (!androidPairingAddress.trim() || androidPairingCode.length !== 6) return;
    connecting = true;
    error = '';
    try {
      status = await api.phone.pairAndroid(
        androidPairingAddress.trim(),
        androidPairingCode,
        androidConnectionAddress.trim() || undefined,
      );
      if (status.stage === 'connected') {
        showAndroidPairing = false;
        startFrames();
        await refreshFrame();
      }
    } catch (reason) {
      error = readableError(reason);
    } finally {
      connecting = false;
    }
  }

  function startFrames(): void {
    if (frameTimer) return;
    frameTimer = setInterval(() => void refreshFrame(), 1_200);
  }

  function stopFrames(): void {
    if (frameTimer) clearInterval(frameTimer);
    frameTimer = undefined;
  }

  async function refreshFrame(): Promise<void> {
    if (capturing || status?.stage !== 'connected') return;
    capturing = true;
    try {
      frame = await api.phone.frame();
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      capturing = false;
    }
  }

  function screenPoint(event: PointerEvent): {x: number; y: number} | null {
    if (!frame) return null;
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return {
      x: Math.max(0, Math.min(frame.width, (event.clientX - bounds.left) / bounds.width * frame.width)),
      y: Math.max(0, Math.min(frame.height, (event.clientY - bounds.top) / bounds.height * frame.height)),
    };
  }

  function pointerDown(event: PointerEvent): void {
    pointerStart = screenPoint(event);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  async function pointerUp(event: PointerEvent): Promise<void> {
    const from = pointerStart;
    const to = screenPoint(event);
    pointerStart = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    if (!from || !to) return;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    try {
      if (distance > 12) await api.phone.swipe(from, to);
      else await api.phone.tap(to);
      setTimeout(() => void refreshFrame(), 280);
    } catch (reason) {
      error = readableError(reason);
    }
  }

  async function submitText(): Promise<void> {
    if (!typedText) return;
    const value = typedText;
    typedText = '';
    try {
      await api.phone.type(value);
      setTimeout(() => void refreshFrame(), 200);
    } catch (reason) {
      typedText = value;
      error = readableError(reason);
    }
  }

  async function pressHome(): Promise<void> {
    try {
      await api.phone.home();
      setTimeout(() => void refreshFrame(), 280);
    } catch (reason) {
      error = readableError(reason);
    }
  }

  function textKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submitText();
  }

  function profileExpiry(value: string | null): string {
    if (!value) return 'No active profile';
    return `Signed until ${new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'}).format(new Date(value))}`;
  }

  function platformName(): string {
    return status?.device?.platform === 'android' ? 'Android' : 'iPhone';
  }
</script>

<!--
  PHONEVIEW DIRECTION
  THESIS: the connected phone itself is the workspace; setup recedes once its live screen arrives.
  OWN-WORLD: Polymux neutrals, hairline dividers, bare glyph controls, and one physical black device edge.
  STORY: find the iPhone, establish the signed local bridge, then share one controllable screen with the agent.
  FIRST VIEWPORT: device identity and state above a centered, near-full-height live screen with controls directly below.
  FORM: an extension of the existing Workspace surface; no new visual world or category-dashboard chrome.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->
<div class="phone-view">
  {#if loading}
    <div class="phone-empty" role="status"><span class="phone-spinner"></span><span>Looking for your iPhone…</span></div>
  {:else if status?.stage === 'connected'}
    <header class="phone-toolbar">
      <div class="phone-identity">
        <span class="phone-state-dot" aria-hidden="true"></span>
        <span class="phone-device-name">{status.device?.name ?? 'Phone'}</span>
        <span class="phone-device-detail">{status.device?.transport}</span>
      </div>
      <button type="button" class="phone-text-action" disabled={connecting} onclick={() => void stopControl()}>Stop phone control</button>
    </header>

    <div class="phone-live">
      <div class="phone-stage">
        {#if frame?.dataUrl}
          <button
            type="button"
            class="phone-screen"
            aria-label={`Control ${platformName()} screen`}
            style:aspect-ratio={`${frame.width} / ${frame.height}`}
            onpointerdown={pointerDown}
            onpointerup={(event) => void pointerUp(event)}
            onpointercancel={() => pointerStart = null}
          ><img src={frame.dataUrl} alt={`Live ${platformName()} screen`} draggable="false"/></button>
        {:else}
          <div class="phone-screen phone-screen-waiting" role="status">
            <span class="phone-spinner phone-spinner-light"></span>
            <span>Opening screen…</span>
          </div>
        {/if}
      </div>

      <div class="phone-controls">
        <button type="button" class="phone-icon-action" aria-label="Home" onclick={() => void pressHome()}><Icon name="home" size={17}/></button>
        <div class="phone-type-control">
          <input aria-label={`Type on ${platformName()}`} placeholder={`Type on ${platformName()}`} bind:value={typedText} onkeydown={textKeydown}/>
          <button type="button" aria-label={`Send text to ${platformName()}`} disabled={!typedText} onclick={() => void submitText()}><Icon name="send" size={15}/></button>
        </div>
        <button type="button" class="phone-icon-action" aria-label="Refresh screen" disabled={capturing} onclick={() => void refreshFrame()}><Icon name="reload" size={17}/></button>
      </div>
      <p class="phone-agent-note">Phone stays available to you and your agent while Polymux is open.</p>
    </div>
  {:else}
    <div class="phone-setup">
      <div class="phone-setup-mark" aria-hidden="true"><Icon name="phone" size={34}/></div>
      <div class="phone-setup-copy">
        <h2>{status?.device ? `Set up this ${platformName()}` : 'Connect your phone'}</h2>
        <p>{status?.message ?? 'Connect with USB, or pair Android wirelessly.'}</p>
      </div>

      {#if status?.device}
        <div class="phone-device-summary">
          <div><span>Device</span><strong>{status.device.model}</strong></div>
          <div><span>{status.device.platform === 'android' ? 'USB debugging' : 'Developer Mode'}</span><strong class:phone-ok={status.device.developerMode}>{status.device.developerMode ? 'On' : 'Off'}</strong></div>
          <div><span>Connection</span><strong>{status.device.transport === 'wired' ? 'USB' : 'Wireless'}</strong></div>
          {#if status.device.platform === 'ios'}
            <div><span>Signing</span><strong class:phone-ok={status.signing.available}>{profileExpiry(status.signing.expiresAt)}</strong></div>
          {:else}
            <div><span>Control</span><strong class="phone-ok">ADB</strong></div>
          {/if}
        </div>
      {/if}

      {#if showAndroidPairing && !status?.device}
        <form class="phone-pairing" onsubmit={(event) => { event.preventDefault(); void pairAndroid(); }}>
          <p>Open Wireless debugging, then choose <strong>Pair device with pairing code</strong>. The separate connection address is only needed if discovery is blocked.</p>
          <label>
            <span>Pairing address</span>
            <input aria-label="Android pairing address" placeholder="192.168.1.24:37123" autocomplete="off" bind:value={androidPairingAddress}/>
          </label>
          <label>
            <span>Six-digit code</span>
            <input aria-label="Android pairing code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" bind:value={androidPairingCode}/>
          </label>
          <label>
            <span>Connection address <small>Optional</small></span>
            <input aria-label="Android connection address" placeholder="192.168.1.24:39841" autocomplete="off" bind:value={androidConnectionAddress}/>
          </label>
          <div class="phone-pairing-actions">
            <button type="submit" class="phone-primary-action" disabled={connecting || !androidPairingAddress.trim() || androidPairingCode.length !== 6}>{connecting ? 'Pairing…' : 'Pair Android'}</button>
            <button type="button" class="phone-text-action" onclick={() => showAndroidPairing = false}>Cancel</button>
          </div>
        </form>
      {/if}

      {#if status?.device?.platform === 'ios' && !status.signing.available}
        {#if signingLoading}
          <div class="phone-signing-loading" role="status"><span class="phone-spinner"></span><span>Checking local signing…</span></div>
        {:else if iosSigning?.stage === 'signed-out'}
          <form class="phone-pairing phone-signing" onsubmit={(event) => { event.preventDefault(); void beginIosSigning(); }}>
            <p>Sign in with the Apple Account used on this iPhone. Your password is used only for this sign-in and is not saved.</p>
            <label>
              <span>Apple Account</span>
              <input aria-label="Apple Account email" type="email" autocomplete="username" bind:value={appleEmail}/>
            </label>
            <label>
              <span>Password</span>
              <input aria-label="Apple Account password" type="password" autocomplete="current-password" bind:value={applePassword}/>
            </label>
            <div class="phone-pairing-actions">
              <button type="submit" class="phone-primary-action" disabled={connecting || !appleEmail.trim() || !applePassword}>{connecting ? 'Signing in…' : 'Continue'}</button>
            </div>
          </form>
        {:else if iosSigning?.stage === 'verification-required'}
          <form class="phone-pairing phone-signing" onsubmit={(event) => { event.preventDefault(); void completeIosSigning(); }}>
            <p>{iosSigning.verificationMethod === 'sms' ? iosSigning.message : 'Enter the six-digit code Apple shows on a trusted device.'}</p>
            {#if iosSigning.verificationMethod !== 'sms'}
              <label>
                <span>Verification code</span>
                <input aria-label="Apple verification code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" bind:value={appleVerificationCode}/>
              </label>
            {/if}
            <div class="phone-pairing-actions">
              {#if iosSigning.verificationMethod !== 'sms'}
                <button type="submit" class="phone-primary-action" disabled={connecting || appleVerificationCode.length !== 6}>{connecting ? 'Verifying…' : 'Verify & start'}</button>
              {/if}
              <button type="button" class="phone-text-action" disabled={connecting} onclick={() => void restartIosSigning()}>Start again</button>
            </div>
          </form>
        {:else if iosSigning?.stage === 'authenticated'}
          <div class="phone-signing-ready">
            <span class="phone-state-dot" aria-hidden="true"></span>
            <span>{iosSigning.email ?? 'Apple Account'} ready</span>
            <button type="button" class="phone-text-action" disabled={connecting} onclick={() => void restartIosSigning()}>Use another</button>
          </div>
        {:else if iosSigning?.message}
          <p class="phone-error" role="alert">{iosSigning.message}</p>
        {/if}
      {/if}

      {#if error}<p class="phone-error" role="alert">{error}</p>{/if}

      <div class="phone-setup-actions">
        {#if status?.device && (status.device.platform === 'android' || status.signing.available || iosSigning?.stage === 'authenticated')}
          <button type="button" class="phone-primary-action" disabled={connecting} onclick={() => void connect()}>
            {#if connecting}<span class="phone-spinner phone-spinner-button"></span>{/if}
            <span>{connecting ? (status.device.platform === 'ios' && !status.signing.available ? 'Preparing…' : 'Starting…') : (status.device.platform === 'ios' && !status.signing.available ? 'Prepare & start' : 'Start phone control')}</span>
          </button>
        {:else if !status?.device}
          <button type="button" class="phone-primary-action" disabled={connecting} onclick={() => void refreshStatus()}>Check USB</button>
          {#if !showAndroidPairing}
            <button type="button" class="phone-text-action phone-pairing-link" onclick={() => showAndroidPairing = true}>Pair Android wirelessly</button>
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  {#if error && status?.stage === 'connected'}
    <div class="phone-live-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss" onclick={() => error = ''}><Icon name="close" size={14}/></button></div>
  {/if}
</div>

<style>
  .phone-view{position:relative;width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--main-panel-background);color:var(--neutral-950)}
  .phone-empty{min-height:100%;display:flex;align-items:center;justify-content:center;gap:9px;color:var(--neutral-400);font-size:12px}
  .phone-spinner{width:14px;height:14px;flex:none;border:2px solid var(--neutral-200);border-top-color:var(--neutral-600);border-radius:50%;animation:phone-spin .7s linear infinite}
  .phone-toolbar{height:44px;min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 13px;border-bottom:1px solid var(--neutral-200)}
  .phone-identity{min-width:0;display:flex;align-items:center;gap:7px;font-size:11px}
  .phone-state-dot{width:7px;height:7px;flex:none;border-radius:50%;background:#3f9c5a;box-shadow:0 0 0 3px color-mix(in srgb,#3f9c5a 12%,transparent)}
  .phone-device-name{min-width:0;overflow:hidden;font-weight:610;text-overflow:ellipsis;white-space:nowrap}
  .phone-device-detail{flex:none;color:var(--neutral-400);text-transform:capitalize}
  .phone-text-action{border:0;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer;font-size:10.5px;transition:color .15s ease}
  .phone-text-action:hover{color:var(--neutral-950)}
  .phone-live{min-height:0;flex:1;display:flex;flex-direction:column;align-items:center;padding:14px 14px 11px}
  .phone-stage{min-height:0;flex:1;width:100%;display:flex;align-items:center;justify-content:center}
  .phone-screen{height:100%;max-width:100%;display:block;overflow:hidden;border:0;border-radius:clamp(18px,3.2vh,28px);padding:0;background:#050505;box-shadow:0 9px 28px rgba(0,0,0,.2);cursor:crosshair;touch-action:none;user-select:none}
  .phone-screen:focus-visible{outline:2px solid var(--neutral-500);outline-offset:4px}
  .phone-screen img{width:100%;height:100%;display:block;object-fit:contain;pointer-events:none}
  .phone-screen-waiting{width:min(250px,72%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#aaa;cursor:default;font-size:11px}
  .phone-spinner-light{border-color:#333;border-top-color:#bbb}
  .phone-controls{width:min(330px,100%);min-height:36px;display:flex;align-items:center;gap:8px;margin-top:12px}
  .phone-icon-action{width:34px;height:34px;flex:none;display:grid;place-items:center;border:0;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer;transition:color .15s ease}
  .phone-icon-action:hover{color:var(--neutral-950)}
  .phone-type-control{height:34px;min-width:0;flex:1;display:flex;align-items:center;border:1px solid var(--neutral-200);border-radius:9px;background:var(--input-surface)}
  .phone-type-control:focus-within{border-color:var(--neutral-400)}
  .phone-type-control input{min-width:0;flex:1;border:0;outline:0;padding:0 0 0 10px;background:transparent;color:var(--neutral-900);font-size:11px}
  .phone-type-control input::placeholder{color:var(--neutral-400)}
  .phone-type-control button{width:31px;height:31px;display:grid;place-items:center;border:0;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer}
  .phone-type-control button:disabled,.phone-icon-action:disabled,.phone-text-action:disabled{opacity:.42;cursor:default}
  .phone-agent-note{margin:7px 0 0;color:var(--neutral-400);font-size:9.5px;text-align:center}
  .phone-setup{width:min(380px,calc(100% - 40px));min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;margin:auto;padding:28px 0;text-align:center}
  .phone-setup-mark{height:45px;display:grid;place-items:center;margin-bottom:15px;color:var(--neutral-700)}
  .phone-setup-copy h2{margin:0;color:var(--neutral-950);font-size:18px;font-weight:650;letter-spacing:-.02em}
  .phone-setup-copy p{max-width:34ch;margin:7px auto 0;color:var(--neutral-500);font-size:11.5px;line-height:1.5}
  .phone-device-summary{width:100%;margin-top:22px;border-top:1px solid var(--neutral-200);border-bottom:1px solid var(--neutral-200);text-align:left}
  .phone-device-summary>div{min-height:35px;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:0 3px;border-bottom:1px solid var(--neutral-150,var(--neutral-100));font-size:10.5px}
  .phone-device-summary>div:last-child{border-bottom:0}
  .phone-device-summary span{color:var(--neutral-500)}
  .phone-device-summary strong{min-width:0;overflow:hidden;color:var(--neutral-800);font-weight:560;text-overflow:ellipsis;white-space:nowrap}
  .phone-device-summary strong.phone-ok{color:#3f9c5a}
  .phone-pairing{width:100%;display:flex;flex-direction:column;gap:11px;margin-top:18px;padding:15px 3px;border-top:1px solid var(--neutral-200);border-bottom:1px solid var(--neutral-200);text-align:left}
  .phone-pairing>p{max-width:none;margin:0 0 2px;color:var(--neutral-500);font-size:10.5px;line-height:1.45}
  .phone-pairing>p strong{color:var(--neutral-700);font-weight:580}
  .phone-pairing label{display:flex;align-items:center;justify-content:space-between;gap:14px;color:var(--neutral-500);font-size:10.5px}
  .phone-pairing label span{flex:none}
  .phone-pairing label small{margin-inline-start:4px;color:var(--neutral-400);font:inherit}
  .phone-pairing input{width:min(210px,62%);height:32px;border:1px solid var(--neutral-200);border-radius:8px;outline:0;padding:0 9px;background:var(--input-surface);color:var(--neutral-900);font:inherit}
  .phone-pairing input::placeholder{color:var(--neutral-400)}
  .phone-pairing input:focus{border-color:var(--neutral-400)}
  .phone-pairing-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:3px}
  .phone-signing-loading{min-height:47px;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:18px;color:var(--neutral-500);font-size:10.5px}
  .phone-signing-ready{width:100%;min-height:38px;display:flex;align-items:center;gap:8px;margin-top:18px;padding:0 3px;border-top:1px solid var(--neutral-200);border-bottom:1px solid var(--neutral-200);color:var(--neutral-700);font-size:10.5px}
  .phone-signing-ready .phone-text-action{margin-left:auto}
  .phone-error{max-width:36ch;margin:12px 0 0;color:#c05a5a;font-size:10.5px;line-height:1.45}
  .phone-setup-actions{min-height:36px;display:flex;align-items:center;gap:13px;margin-top:18px}
  .phone-pairing-link{font-size:10.5px}
  .phone-primary-action{min-width:126px;height:34px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:9px;padding:0 14px;background:var(--primary);color:var(--on-primary);cursor:pointer;font-size:11px;font-weight:580;transition:opacity .15s ease}
  .phone-primary-action:hover{opacity:.82}
  .phone-primary-action:disabled{opacity:.52;cursor:default}
  .phone-spinner-button{width:12px;height:12px;border-color:color-mix(in srgb,var(--on-primary) 25%,transparent);border-top-color:var(--on-primary)}
  .phone-live-error{position:absolute;left:50%;bottom:12px;width:max-content;max-width:calc(100% - 28px);min-height:34px;display:flex;align-items:center;gap:8px;padding:6px 7px 6px 10px;border:1px solid var(--neutral-200);border-radius:9px;background:var(--app-translucent);color:#c05a5a;box-shadow:0 7px 20px rgba(0,0,0,.12);font-size:10.5px;transform:translateX(-50%)}
  .phone-live-error button{width:22px;height:22px;display:grid;place-items:center;border:0;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer}
  @keyframes phone-spin{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){.phone-spinner{animation-duration:1.4s}}
  @container (max-width:500px){.phone-live{padding-inline:10px}.phone-agent-note{display:none}.phone-toolbar{padding-inline:10px}}
</style>
