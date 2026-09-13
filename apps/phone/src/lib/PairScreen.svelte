<script lang="ts">
  import {HOST_PAIRING_CODE_LENGTH, parseTeamHostSetupCode, sanitizeHostPairingCodeInput} from '@polymux/protocol';
  import {
    cancel,
    checkPermissions,
    Format,
    openAppSettings,
    requestPermissions,
    scan,
  } from '@tauri-apps/plugin-barcode-scanner';
  import {onDestroy} from 'svelte';
  import Icon from './Icon.svelte';
  import PolymuxMark from './PolymuxMark.svelte';

  export let confirmationNumber = '';
  export let onCancel: () => void = () => {};
  export let busy = false;
  export let error = '';
  export let onPair: (endpoint: string | null, code: string) => Promise<void>;
  export let onLocker: (() => void) | undefined = undefined;

  let code = '';
  let openingScanner = false;
  let scanning = false;
  let scanError = '';
  let cameraDenied = false;
  let pairMethod: 'scan' | 'code' = 'scan';

  onDestroy(() => {
    document.documentElement.classList.remove('scanner-mode');
    if (scanning) void cancel();
  });

  async function submit(): Promise<void> {
    if (busy) return;
    scanError = '';
    await onPair(null, code);
  }

  function codeInput(event: Event): void {
    code = sanitizeHostPairingCodeInput((event.currentTarget as HTMLInputElement).value);
  }

  function showPairMethod(method: 'scan' | 'code'): void {
    pairMethod = method;
    scanError = '';
  }

  async function scanPairingCode(): Promise<void> {
    if (busy || openingScanner || scanning) return;
    openingScanner = true;
    scanError = '';
    try {
      let permission = await checkPermissions();
      if (permission !== 'granted') permission = await requestPermissions();
      if (permission !== 'granted') {
        cameraDenied = true;
        throw new Error('Allow camera access to scan the pairing QR code.');
      }

      cameraDenied = false;
      scanning = true;
      document.documentElement.classList.add('scanner-mode');
      const result = await scan({windowed: true, formats: [Format.QRCode]});
      stopScannerMode();
      const setup = parseTeamHostSetupCode(result.content);
      if (!setup || setup.code.length !== HOST_PAIRING_CODE_LENGTH)
        throw new Error('That is not a Polymux pairing QR code. Scan the code shown by your other device.');

      code = setup.code;
      await onPair(setup.endpoint, code);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/cancel/i.test(message)) scanError = message;
    } finally {
      openingScanner = false;
      stopScannerMode();
    }
  }

  async function cancelScanning(): Promise<void> {
    if (!scanning) return;
    try {
      await cancel();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/cancel/i.test(message)) scanError = message;
    } finally {
      stopScannerMode();
    }
  }

  async function openCameraSettings(): Promise<void> {
    try {
      await openAppSettings();
    } catch (cause) {
      scanError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function stopScannerMode(): void {
    scanning = false;
    document.documentElement.classList.remove('scanner-mode');
  }
</script>

<main class:scanner-active={scanning} class="pair-screen">
  {#if scanning}
    <dialog class="scanner-overlay" open aria-modal="true" aria-labelledby="scanner-title">
      <div class="scanner-copy">
        <h1 id="scanner-title">Scan pairing code</h1>
        <p>Point the camera at the QR code shown by your other device.</p>
      </div>
      <div class="scanner-frame" aria-hidden="true"></div>
      <button class="scanner-cancel" type="button" on:click={cancelScanning}>Cancel</button>
    </dialog>
  {:else}
    <section class="pair-card" aria-labelledby="pair-title">
    <div class="pair-intro">
      <PolymuxMark size={58} />
      <h1 id="pair-title">Connect to Polymux</h1>
      <p>{pairMethod === 'scan' ? 'Scan the QR code.' : `Enter the ${HOST_PAIRING_CODE_LENGTH}-character code.`}</p>
    </div>

    {#if confirmationNumber}
      <div class="pair-action"><strong class="confirmation-number">{confirmationNumber}</strong><p>Select this number on your other device to approve the connection.</p><button type="button" on:click={onCancel}>Cancel connection</button></div>
    {:else if pairMethod === 'scan'}
      <div class="pair-action">
        <button class="scan-button" type="button" disabled={busy || openingScanner} on:click={scanPairingCode}>
          <Icon name="scan" size={20} />
          <span>{openingScanner ? 'Opening camera…' : 'Scan QR code'}</span>
        </button>
        {#if scanError || error}
          <div class="form-recovery" role="alert">
            <p class="form-error">{scanError || error}</p>
            {#if cameraDenied}<button type="button" on:click={openCameraSettings}>Open Settings</button>{/if}
          </div>
        {/if}
        <button class="method-switch" type="button" disabled={busy || openingScanner} on:click={() => showPairMethod('code')}>
          Enter connect code instead
        </button>
        {#if onLocker}
          <button class="method-switch" type="button" disabled={busy || openingScanner} on:click={onLocker}>
            Open Locker
          </button>
        {/if}
      </div>
    {:else}
      <form on:submit|preventDefault={submit}>
        <label class="code-label">
          <span>Connect code</span>
          <div class="code-entry">
            <input
              value={code}
              on:input={codeInput}
              inputmode="text"
              autocapitalize="characters"
              autocomplete="one-time-code"
              spellcheck="false"
              aria-label={`${HOST_PAIRING_CODE_LENGTH}-character connect code`}
              disabled={busy || openingScanner}
            />
            <div class="code-cells" aria-hidden="true">
              {#each Array(HOST_PAIRING_CODE_LENGTH) as _, index}
                <span class:filled={Boolean(code[index])} class:active={code.length < HOST_PAIRING_CODE_LENGTH && index === code.length}>
                  {code[index] ?? ''}
                </span>
              {/each}
            </div>
          </div>
        </label>
        {#if scanError || error}
          <div class="form-recovery" role="alert">
            <p class="form-error">{scanError || error}</p>
          </div>
        {/if}
        <button class="primary-button" type="submit" disabled={busy || openingScanner || code.length !== HOST_PAIRING_CODE_LENGTH}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        <button class="method-switch" type="button" disabled={busy || openingScanner} on:click={() => showPairMethod('scan')}>
          Scan QR code instead
        </button>
        {#if onLocker}
          <button class="method-switch" type="button" disabled={busy || openingScanner} on:click={onLocker}>
            Open Locker
          </button>
        {/if}
      </form>
    {/if}

    </section>
  {/if}
</main>

<style>
  .confirmation-number{display:block;font-size:48px;font-variant-numeric:tabular-nums;text-align:center;margin:20px 0;}
  .pair-screen {
    height: 100dvh;
    padding: calc(env(safe-area-inset-top) + 24px) 24px calc(env(safe-area-inset-bottom) + 24px);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    background: var(--surface);
  }
  .pair-screen::-webkit-scrollbar { display: none; }
  .pair-screen.scanner-active { overflow: hidden; background: transparent; color: #fff; }

  .pair-card { width: min(100%, 390px); flex: 0 0 auto; margin: auto; }
  .pair-intro { display: grid; justify-items: center; text-align: center; }
  h1 { margin: 20px 0 8px; font-size: clamp(1.75rem, 8vw, 2.125rem); line-height: 1.1; letter-spacing: -.03em; }
  p { max-width: 30ch; margin: 0; color: var(--muted); font-size: .9375rem; line-height: 1.45; }
  .pair-action { display: grid; gap: 14px; margin-top: 28px; }
  .scan-button { width: 100%; min-height: 54px; display: flex; align-items: center; justify-content: center; gap: 9px; border: 0; border-radius: 15px; background: var(--ink); color: var(--surface); font: inherit; font-weight: 700; }
  .scan-button:disabled { opacity: .5; }
  form { display: grid; gap: 14px; margin-top: 28px; }
  label { display: grid; gap: 7px; color: var(--muted); font-size: .75rem; font-weight: 650; }
  input { width: 100%; min-height: 54px; padding: 0 15px; border: 1px solid transparent; border-radius: 15px; background: var(--bubble); color: var(--ink); font: inherit; }
  input::placeholder { color: var(--muted); opacity: 1; }
  input:focus { outline: 3px solid color-mix(in srgb, var(--accent) 28%, transparent); border-color: var(--accent); }
  .code-entry { position: relative; }
  .code-entry > input { position: absolute; z-index: 1; inset: 0; min-height: 0; height: 100%; opacity: 0; cursor: text; }
  .code-entry > input:focus { outline: 0; }
  .code-cells { display: grid; grid-template-columns: repeat(9, minmax(0, 1fr)); gap: 5px; }
  .code-cells span { min-width: 0; height: 50px; display: grid; place-items: center; border: 1px solid transparent; border-radius: 11px; background: var(--bubble); color: var(--ink); font-size: 1.0625rem; font-weight: 700; font-variant-numeric: tabular-nums; transition: border-color 140ms ease, background 140ms ease; }
  .code-entry:focus-within .code-cells { border-radius: 15px; outline: 3px solid color-mix(in srgb, var(--accent) 28%, transparent); outline-offset: 2px; }
  .code-entry:focus-within .code-cells span.active { border-color: var(--accent); background: var(--surface); }
  .primary-button { min-height: 54px; margin-top: 2px; border: 0; border-radius: 15px; background: var(--ink); color: var(--surface); font: inherit; font-weight: 700; }
  .primary-button:disabled { opacity: .38; }
  .method-switch { min-height: 32px; justify-self: center; border: 0; padding: 0 8px; background: transparent; color: var(--muted); font: inherit; font-size: .8125rem; font-weight: 650; }
  .method-switch:disabled { opacity: .45; }
  .form-recovery { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .form-error { margin: 0; color: var(--danger); font-size: .875rem; }
  .form-recovery button { flex: none; min-height: 32px; border: 0; padding: 0 2px; background: transparent; color: var(--accent); font: inherit; font-size: .8125rem; font-weight: 700; }
  .scanner-overlay { position: static; width: min(100%, 440px); max-width: none; max-height: none; min-height: 100%; margin: auto; padding: 0; display: grid; grid-template-rows: auto 1fr auto; justify-items: center; gap: 28px; border: 0; background: transparent; color: inherit; }
  .scanner-copy { position: relative; z-index: 1; text-align: center; text-shadow: 0 1px 12px rgba(0, 0, 0, .75); }
  .scanner-copy h1 { margin: 0 0 7px; font-size: 1.5rem; letter-spacing: -.025em; }
  .scanner-copy p { color: rgba(255, 255, 255, .84); }
  .scanner-frame { align-self: center; width: min(72vw, 300px); aspect-ratio: 1; border: 2px solid rgba(255, 255, 255, .92); border-radius: 24px; box-shadow: 0 0 0 999px rgba(0, 0, 0, .34); }
  .scanner-cancel { position: relative; z-index: 1; width: 100%; min-height: 52px; border: 1px solid rgba(255, 255, 255, .28); border-radius: 15px; background: rgba(18, 18, 18, .68); color: #fff; font: inherit; font-weight: 700; }

  @media (prefers-reduced-motion: reduce) {
    .code-cells span { transition: none; }
  }
</style>
