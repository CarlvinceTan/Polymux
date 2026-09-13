<script lang="ts">
  import {onMount} from 'svelte';
  import PolymuxMark from './PolymuxMark.svelte';
  import {phoneAccount, isApplePhone, signInWithApple, signInWithGoogle, signOutPhoneAccount} from './account';
  import {discoverAccountHosts, type AccountHost} from './account-devices';

  export let onPair: () => void;
  export let onLocker: () => void;
  export let onConnect: (host: AccountHost) => Promise<void>;
  const account = phoneAccount();
  let signedIn = false;
  let busy = false;
  let error = '';
  let notice = '';
  let email = '';
  let password = '';
  let confirmation = '';
  let mode: 'sign-in' | 'sign-up' | 'forgot' = 'sign-in';
  let hosts: AccountHost[] = [];

  onMount(() => { void restore(); });
  async function restore() {
    busy = true;
    try {
      await account?.ready;
      signedIn = account?.client.status().signedIn ?? false;
      if (signedIn) await discover();
    } catch (cause) { error = readable(cause); }
    finally { busy = false; }
  }
  async function discover() {
    if (!account) return;
    hosts = await discoverAccountHosts(account.client);
    if (hosts.length === 1) await onConnect(hosts[0]);
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true; error = ''; notice = '';
    try { await action(); }
    catch (cause) { error = readable(cause); }
    finally { busy = false; password = ''; confirmation = ''; }
  }
  async function submit() {
    if (!account) return;
    await run(async () => {
      if (mode === 'forgot') {
        const result = await account.client.requestPasswordReset(email.trim());
        if (!result.ok) throw new Error(result.error);
        notice = 'Check your email for the reset link.'; return;
      }
      if (mode === 'sign-up' && (password.length < 6 || password !== confirmation)) throw new Error('Use at least six characters and matching passwords.');
      const result = mode === 'sign-up'
        ? await account.client.signUp(email.trim(), password)
        : await account.client.signInWithPassword(email.trim(), password);
      if (result.error) throw new Error(result.error);
      signedIn = result.signedIn;
      if (signedIn) await discover();
      else notice = 'Check your email to confirm your account.';
    });
  }
  function readable(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
</script>

<main class="signin">
  <section aria-labelledby="signin-title">
    <div class="brand"><PolymuxMark size={52} /></div>
    <h1 id="signin-title">{signedIn ? 'Your devices' : mode === 'sign-up' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : 'Welcome back'}</h1>
    {#if signedIn}
      {#each hosts as host (host.device_id)}
        <button class="provider" disabled={busy} onclick={() => void run(() => onConnect(host))}>{host.device_name}</button>
      {:else}<p>Open Polymux on your desktop with the same account.</p>{/each}
      <button class="quiet" disabled={busy} onclick={() => void run(discover)}>Refresh devices</button>
      <button class="quiet" disabled={busy} onclick={() => void run(async () => { await signOutPhoneAccount(); signedIn = false; hosts = []; })}>Sign out</button>
    {:else if account}
      {#if mode === 'sign-in' && isApplePhone()}
        <button class="provider" disabled={busy} onclick={() => void run(async () => {
          const result = await signInWithGoogle();
          if (result.error) throw new Error(result.error);
          signedIn = result.signedIn;
          if (signedIn) await discover();
        })}>Continue with Google</button>
        <button class="provider" disabled={busy} onclick={() => void run(async () => {
          const result = await signInWithApple();
          if (result.error) throw new Error(result.error);
          signedIn = result.signedIn;
          if (signedIn) await discover();
        })}>Sign in with Apple</button>
        <div class="divider">or</div>
      {/if}
      <form onsubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label>Email<input type="email" autocomplete="username" bind:value={email} required disabled={busy} /></label>
        {#if mode !== 'forgot'}
          <label>Password<input type="password" autocomplete={mode === 'sign-up' ? 'new-password' : 'current-password'} bind:value={password} required disabled={busy} /></label>
        {/if}
        {#if mode === 'sign-up'}<label>Confirm password<input type="password" autocomplete="new-password" bind:value={confirmation} required disabled={busy} /></label>{/if}
        <button class="primary" disabled={busy}>{busy ? 'Connecting…' : mode === 'sign-up' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}</button>
      </form>
      <div class="links">
        <button class="quiet" disabled={busy} onclick={() => { mode = mode === 'sign-in' ? 'sign-up' : 'sign-in'; error = ''; notice = ''; password = ''; confirmation = ''; }}>{mode === 'sign-in' ? 'Create account' : 'Back to sign in'}</button>
        {#if mode === 'sign-in'}<button class="quiet" disabled={busy} onclick={() => {mode = 'forgot'; password = '';}}>Forgot password?</button>{/if}
      </div>
    {/if}
    {#if error}<p role="alert">{error}</p>{/if}
    {#if notice}<p role="status">{notice}</p>{/if}
    <div class="links"><button class="quiet" disabled={busy} onclick={onPair}>Connect with QR or code</button><button class="quiet" disabled={busy} onclick={onLocker}>Open Locker</button></div>
  </section>
</main>

<style>
  .signin { min-height: 100dvh; display: grid; place-items: center; padding: max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom)); box-sizing: border-box; }
  section { width: min(100%, 380px); }
  .brand { display: flex; justify-content: center; }
  h1 { text-align: center; font-size: 24px; font-weight: 600; margin: 16px 0 24px; }
  form, label { display: flex; flex-direction: column; gap: 8px; }
  form { gap: 16px; }
  input { min-height: 44px; border: 1px solid var(--line); border-radius: 8px; padding: 0 12px; background: var(--field); color: var(--ink); font: inherit; }
  .primary, .provider { min-height: 44px; width: 100%; border-radius: 8px; font: inherit; }
  .primary { background: var(--ink); color: var(--surface); border: 0; }
  .provider { background: var(--field); color: var(--ink); border: 1px solid var(--line); margin-bottom: 8px; }
  .links { display: flex; justify-content: center; flex-wrap: wrap; gap: 16px; margin-top: 20px; }
  .quiet { background: none; border: 0; padding: 4px 0; color: var(--muted); font: inherit; }
  .quiet:hover { color: var(--ink); }
  .divider, p { text-align: center; color: var(--muted); margin: 16px 0; }
  [role='alert'] { color: var(--danger, #b42318); }
  button:disabled { opacity: .5; }
</style>
