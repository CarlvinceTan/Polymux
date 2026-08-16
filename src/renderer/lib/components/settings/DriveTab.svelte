<script lang="ts">
  import {onMount} from 'svelte';
  import type {
    DriveProviderDto,
    DriveProviderId,
    DriveS3ConfigRequest,
    DriveStatusDto,
    FlareAIApi,
  } from '@flareai/protocol';
  import {DRIVE_PROVIDERS} from '@flareai/protocol';
  import {readableError} from '../../errors';
  import Icon from '../shared/Icon.svelte';

  export let api: FlareAIApi;

  let status: DriveStatusDto | null = null;
  let selected: DriveProviderId = 'local';
  let loading = true;
  let error = '';
  let busy = '';

  // S3 credentials form
  let editingS3 = false;
  let s3Form: DriveS3ConfigRequest = blankS3();
  let s3Secret = '';

  onMount(() => {
    void load();
    return api.drive.subscribe((next) => {
      status = next;
    });
  });

  async function load(): Promise<void> {
    loading = true;
    error = '';
    try {
      status = await api.drive.status();
    } catch (cause) {
      error = readableError(cause);
    } finally {
      loading = false;
    }
  }

  async function refresh(): Promise<void> {
    busy = 'refresh';
    try {
      status = await api.drive.refresh();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  $: providers = status?.providers ?? [];
  $: active = providers.find((entry) => entry.id === selected) ?? null;
  /** The save order, resolved to the providers that could actually take a
   * file right now — an order listing disconnected accounts is a wish, not a
   * plan, and reordering it would not mean anything. */
  $: writable = (status?.saveOrder ?? [])
    .map((id) => providers.find((entry) => entry.id === id))
    .filter((entry): entry is DriveProviderDto => entry?.state === 'connected');
  $: description = (id: DriveProviderId) =>
    DRIVE_PROVIDERS.find((entry) => entry.value === id)?.description ?? '';

  /** Who the connection belongs to, which leads the rail's second line the way
   * an MCP server's author does. Nothing to say for a provider that is not
   * connected, so the state word stands alone there. */
  function accountLabel(provider: DriveProviderDto): string {
    if (provider.state !== 'connected') return '';
    return provider.accounts.length > 1
      ? `${provider.accounts.length} accounts`
      : (provider.accounts[0]?.name ?? '');
  }

  function stateLabel(provider: DriveProviderDto): string {
    switch (provider.state) {
      case 'connected':
        return 'Connected';
      case 'logged-out':
        return 'Not connected';
      case 'unconfigured':
        return 'Unavailable in this build';
      case 'unavailable':
        return 'Unavailable';
      case 'error':
        return 'Needs attention';
      default:
        return 'Unknown';
    }
  }

  async function connect(provider: DriveProviderDto): Promise<void> {
    busy = `connect:${provider.id}`;
    try {
      status = await api.drive.connect(provider.id);
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function disconnect(provider: DriveProviderDto): Promise<void> {
    busy = `disconnect:${provider.id}`;
    try {
      status = await api.drive.disconnect(provider.id);
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /** Passing no path opens the folder picker in the main process. */
  async function chooseFolder(): Promise<void> {
    busy = 'local-root';
    try {
      status = await api.drive.setLocalRoot(null);
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  function blankS3(): DriveS3ConfigRequest {
    return {
      bucket: '',
      region: 'us-east-1',
      endpoint: null,
      accessKeyId: '',
      prefix: null,
      forcePathStyle: false,
    };
  }

  function editS3(): void {
    const s3 = providers.find((entry) => entry.id === 's3');
    s3Form = blankS3();
    // The bucket is the only part of a saved connection that comes back in the
    // status, so an edit starts from it rather than from nothing.
    if (s3?.root) s3Form.bucket = s3.root.split('/')[0];
    s3Secret = '';
    editingS3 = true;
  }

  async function saveS3(): Promise<void> {
    busy = 's3-save';
    try {
      status = await api.drive.saveS3({
        ...s3Form,
        secretAccessKey: s3Secret || undefined,
      });
      editingS3 = false;
      s3Secret = '';
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function move(provider: DriveProviderId, delta: -1 | 1): Promise<void> {
    const order = writable.map((entry) => entry.id);
    const index = order.indexOf(provider);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    busy = 'order';
    try {
      // Only the connected slice is reordered here; the main process folds it
      // back into the full order so a disconnected provider keeps its place.
      status = await api.drive.setSaveOrder([
        ...order,
        ...(status?.saveOrder ?? []).filter((id) => !order.includes(id)),
      ]);
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
  }
</script>

<div class="drive" role="tabpanel">
  {#if loading}
    <p class="drive-muted">Checking your storage…</p>
  {:else}
    {#if error}
      <div class="drive-error" role="alert">
        <span>{error}</span>
        <button type="button" onclick={() => void refresh()} disabled={busy === 'refresh'}>Retry</button>
      </div>
    {/if}

    <div class="drive-body">
      <ul class="drive-rail">
        {#each providers as provider (provider.id)}
          <li>
            <button
              type="button"
              class:active={selected === provider.id}
              onclick={() => {
                selected = provider.id;
                // Walking away to another provider abandons the form rather
                // than leaving it up over a provider it has nothing to do with.
                editingS3 = false;
              }}
            >
              <span>
                <strong>{provider.name}</strong>
                <small>
                  {#if accountLabel(provider)}{accountLabel(provider)} · {/if}<span
                    class="state-text"
                    data-state={provider.state}
                  >{stateLabel(provider)}</span>
                </small>
              </span>
            </button>
          </li>
        {/each}
      </ul>

      <div class="drive-detail">
        {#if editingS3}
          <header class="drive-detail-header">
            <h3>S3 storage</h3>
            <p>
              Works with any S3-compatible service. The secret key goes to your keychain; the rest
              is kept as ordinary settings.
            </p>
          </header>
          <div class="drive-form">
            <label>
              <span>Bucket</span>
              <input bind:value={s3Form.bucket} spellcheck="false" placeholder="my-bucket" />
            </label>
            <label>
              <span>Region</span>
              <input bind:value={s3Form.region} spellcheck="false" placeholder="us-east-1" />
            </label>
            <label>
              <span>Endpoint</span>
              <input
                value={s3Form.endpoint ?? ''}
                spellcheck="false"
                placeholder="Leave blank for AWS"
                oninput={(event) => (s3Form.endpoint = (event.currentTarget as HTMLInputElement).value || null)}
              />
              <small>Set this for Cloudflare R2, Backblaze B2, or MinIO.</small>
            </label>
            <label>
              <span>Access key ID</span>
              <input bind:value={s3Form.accessKeyId} spellcheck="false" />
            </label>
            <label>
              <span>Secret access key</span>
              <input bind:value={s3Secret} type="password" placeholder="Leave blank to keep the saved key" />
            </label>
            <label>
              <span>Prefix</span>
              <input
                value={s3Form.prefix ?? ''}
                spellcheck="false"
                placeholder="Optional — confines FlareAI to one folder"
                oninput={(event) => (s3Form.prefix = (event.currentTarget as HTMLInputElement).value || null)}
              />
            </label>
            <label class="drive-check">
              <input type="checkbox" bind:checked={s3Form.forcePathStyle} />
              <span>Use path-style addressing</span>
            </label>
            <footer class="drive-actions">
              <button type="button" onclick={() => (editingS3 = false)}>Cancel</button>
              <button
                type="button"
                class="primary"
                disabled={busy === 's3-save' || !s3Form.bucket.trim() || !s3Form.accessKeyId.trim()}
                onclick={() => void saveS3()}
              >
                {busy === 's3-save' ? 'Saving…' : 'Save bucket'}
              </button>
            </footer>
          </div>
        {:else if active}
          <header class="drive-detail-header">
            <h3>{active.name}</h3>
            <p>{description(active.id)}</p>
            <span class="drive-detail-actions">
              <button
                type="button"
                aria-label="Recheck storage"
                data-tooltip-label="Recheck"
                class:spinning={busy === 'refresh'}
                disabled={busy === 'refresh'}
                onclick={() => void refresh()}
              >
                <Icon name="reload" size={13} />
              </button>
            </span>
          </header>

          {#if active.error}
            <p class="drive-hint warn">{active.error}</p>
          {/if}

          <section class="drive-block">
            <h4>Connection</h4>
            {#if active.state === 'connected'}
              {#each active.accounts as account (account.id)}
                <p class="drive-value">
                  <code>{account.email ?? account.name}</code>
                  {#if active.id !== 'local'}
                    <button
                      type="button"
                      class="destructive"
                      disabled={busy === `disconnect:${active.id}`}
                      onclick={() => void disconnect(active)}
                    >
                      {busy === `disconnect:${active.id}` ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  {/if}
                </p>
              {/each}
              {#if active.root}
                <p class="drive-hint">Files live in <code>{active.root}</code>.</p>
              {/if}
            {:else if active.state === 'unconfigured'}
              <p class="drive-hint warn">
                This build was made without {active.name} credentials, so it cannot connect. See
                <code>README.md</code> for the environment variables to set.
              </p>
            {:else if active.kind === 's3'}
              <p class="drive-hint">Add a bucket and FlareAI will read and write files in it.</p>
              <footer class="drive-actions">
                <button type="button" class="primary" onclick={editS3}>Add a bucket</button>
              </footer>
            {:else}
              <p class="drive-hint">
                Signing in opens {active.name}'s own page. FlareAI only ever sees the token it hands
                back, and only for its own folder.
              </p>
              <footer class="drive-actions">
                <button
                  type="button"
                  class="primary"
                  disabled={busy === `connect:${active.id}`}
                  onclick={() => void connect(active)}
                >
                  {busy === `connect:${active.id}` ? 'Waiting for sign-in…' : `Connect ${active.name}`}
                </button>
              </footer>
            {/if}
          </section>

          {#if active.id === 'local'}
            <section class="drive-block">
              <h4>Folder</h4>
              <p class="drive-value">
                <code>{active.root ?? '—'}</code>
                <button type="button" disabled={busy === 'local-root'} onclick={() => void chooseFolder()}>
                  Change
                </button>
              </p>
              <p class="drive-hint">Everything FlareAI saves to this Mac goes here.</p>
            </section>
          {/if}

          {#if active.id === 's3' && active.state === 'connected'}
            <section class="drive-block">
              <h4>Bucket</h4>
              <footer class="drive-actions">
                <button type="button" onclick={editS3}>Edit settings</button>
              </footer>
            </section>
          {/if}

          {#if active.usage}
            <section class="drive-block">
              <h4>Space</h4>
              {#if active.usage.total !== null && active.usage.used !== null}
                <div class="drive-meter" role="img" aria-label={`${formatBytes(active.usage.used)} of ${formatBytes(active.usage.total)} used`}>
                  <span style={`width:${Math.min(100, (active.usage.used / active.usage.total) * 100)}%`}></span>
                </div>
                <p class="drive-hint">
                  {formatBytes(active.usage.used)} of {formatBytes(active.usage.total)} used
                </p>
              {:else if active.usage.used !== null}
                <!-- An account with no cap reports usage but no limit, which is
                     a real answer rather than a missing one. -->
                <p class="drive-hint">{formatBytes(active.usage.used)} used — no quota on this account.</p>
              {/if}
            </section>
          {/if}
        {/if}

        {#if !editingS3}
          <section class="drive-block">
            <h4>Where new files go</h4>
            <p class="drive-hint">
              FlareAI saves to the first of these it can reach, so the one at the top is the one it
              normally uses.
            </p>
            {#if writable.length === 0}
              <p class="drive-muted">Nothing is connected yet.</p>
            {:else}
              <ol class="drive-order">
                {#each writable as provider, index (provider.id)}
                  <li>
                    <span class="drive-rank" class:primary={index === 0}>{index + 1}</span>
                    <span class="drive-order-name">
                      <strong>{provider.name}</strong>
                      {#if index === 0}<em>Primary</em>{/if}
                    </span>
                    <span class="drive-order-actions">
                      <button
                        type="button"
                        class="up"
                        aria-label={`Move ${provider.name} up`}
                        disabled={index === 0 || busy === 'order'}
                        onclick={() => void move(provider.id, -1)}
                      >
                        <Icon name="chevron" size={12} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${provider.name} down`}
                        disabled={index === writable.length - 1 || busy === 'order'}
                        onclick={() => void move(provider.id, 1)}
                      >
                        <Icon name="chevron" size={12} />
                      </button>
                    </span>
                  </li>
                {/each}
              </ol>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .drive{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:2px var(--options-detail-edge) 16px calc(var(--options-content-edge) + var(--options-tab-inline))}
  .drive-muted{color:var(--neutral-400);font-size:11px}
  .drive-error{display:flex;align-items:center;gap:12px;margin-bottom:10px;padding:9px 11px;border-radius:9px;background:#fff5f5;color:#8f3e3e;font-size:11px}
  .drive-error>span{min-width:0;flex:1}
  .drive-error button{height:26px;flex:none;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:7px;padding:0 9px;background:var(--app-surface);color:inherit;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}
  :global(:root[data-theme="dark"]) .drive-error{background:#321f1f;color:#eea7a7}

  .drive-body{min-height:0;flex:1;display:grid;grid-template-columns:186px 1fr;gap:var(--options-divider-gap)}
  .drive-rail{min-height:0;display:flex;flex-direction:column;gap:4px;margin:0;padding:0 4px 0 0;overflow-y:auto;list-style:none;border-right:1px solid var(--neutral-200)}
  .drive-rail>li{margin:0}
  .drive-rail button{width:100%;display:flex;align-items:center;gap:9px;border:0;border-radius:8px;padding:7px 8px;background:transparent;color:var(--neutral-700);cursor:pointer;font-family:inherit;text-align:left}
  .drive-rail button:hover{background:var(--neutral-100)}
  .drive-rail button.active{background:var(--neutral-100);color:var(--neutral-950)}
  .drive-rail button>span{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
  .drive-rail strong{overflow:hidden;color:var(--neutral-900);text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:540}
  .drive-rail small{overflow:hidden;color:var(--neutral-400);text-overflow:ellipsis;white-space:nowrap;font-size:9.5px}

  .drive-detail{min-height:0;overflow-y:auto;padding-right:2px}
  .drive-detail-header{position:relative;margin-bottom:14px}
  .drive-detail-header h3{margin:0;color:var(--neutral-950);font-size:14px;font-weight:580}
  .drive-detail-header p{max-width:520px;margin:5px 0 0;color:var(--neutral-600);font-size:11px;line-height:1.5}
  .drive-detail-actions{position:absolute;top:0;right:0;display:flex;gap:4px}
  .drive-detail-actions button{width:26px;height:26px;display:grid;place-items:center;border:1px solid var(--neutral-200);border-radius:7px;background:var(--app-surface);color:var(--neutral-600);cursor:pointer}
  .drive-detail-actions button:hover{background:var(--neutral-100);color:var(--neutral-950)}
  .drive-detail-actions button.spinning{animation:drive-spin 1s linear infinite}
  @keyframes drive-spin{to{transform:rotate(360deg)}}

  .drive-block{margin-bottom:16px;padding-top:12px;border-top:1px solid var(--neutral-200)}
  .drive-block h4{margin:0 0 7px;color:var(--neutral-900);font-size:11.5px;font-weight:570}
  .drive-value{display:flex;align-items:center;gap:9px;margin:0 0 4px;font-size:11px}
  .drive-value code{overflow:hidden;padding:2px 6px;border-radius:5px;background:var(--neutral-100);color:var(--neutral-800);text-overflow:ellipsis;white-space:nowrap;font-size:10.5px}
  .drive-value button{height:26px;flex:none;border:1px solid var(--neutral-200);border-radius:7px;padding:0 10px;background:var(--app-surface);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}
  .drive-value button:hover{background:var(--neutral-100);color:var(--neutral-950)}
  .drive-value button.destructive{color:#a04545}
  .drive-value button:disabled{cursor:default;opacity:.5}

  .drive-hint{max-width:520px;margin:5px 0 0;color:var(--neutral-500);font-size:10.5px;line-height:1.5}
  .drive-hint code{padding:1px 4px;border-radius:4px;background:var(--neutral-100);font-size:10px}
  .drive-hint.warn{color:#a04545}
  :global(:root[data-theme="dark"]) .drive-hint.warn{color:#e79c9c}

  .drive-form{display:flex;max-width:440px;flex-direction:column;gap:9px}
  .drive-form label{display:flex;flex-direction:column;gap:3px}
  .drive-form label>span{color:var(--neutral-600);font-size:10.5px;font-weight:530}
  .drive-form label>small{color:var(--neutral-400);font-size:9.5px}
  .drive-form input{height:30px;border:1px solid var(--neutral-200);border-radius:8px;padding:0 9px;background:var(--app-surface);color:var(--neutral-950);font-family:inherit;font-size:11.5px}
  .drive-form input:focus-visible{border-color:var(--neutral-500);outline:0}
  .drive-check{flex-direction:row!important;align-items:center;gap:7px!important}
  .drive-check input{width:14px;height:14px;flex:none}

  .drive-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:12px}
  .drive-actions button{height:29px;border:1px solid var(--neutral-200);border-radius:8px;padding:0 12px;background:var(--app-surface);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:11px;font-weight:550}
  .drive-actions button:hover{background:var(--neutral-100);color:var(--neutral-950)}
  .drive-actions button.primary{border-color:var(--neutral-950);background:var(--neutral-950);color:var(--app-bg)}
  .drive-actions button.primary:hover{opacity:.88}
  .drive-actions button:disabled{cursor:default;opacity:.5}

  .drive-meter{height:6px;overflow:hidden;border-radius:3px;background:var(--neutral-200)}
  .drive-meter>span{display:block;height:100%;border-radius:3px;background:var(--neutral-800)}

  .drive-order{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
  .drive-order li{display:flex;align-items:center;gap:10px;padding:8px 11px;border:1px solid var(--neutral-200);border-radius:9px}
  .drive-rank{width:19px;height:19px;flex:none;display:grid;place-items:center;border-radius:50%;background:var(--neutral-100);color:var(--neutral-600);font-size:9.5px;font-weight:600;font-variant-numeric:tabular-nums}
  .drive-rank.primary{background:var(--neutral-950);color:var(--app-bg)}
  .drive-order-name{min-width:0;flex:1;display:flex;align-items:center;gap:7px}
  .drive-order-name strong{overflow:hidden;color:var(--neutral-900);text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:545}
  .drive-order-name em{flex:none;padding:1px 6px;border-radius:5px;background:var(--neutral-100);color:var(--neutral-600);font-size:9.5px;font-style:normal;font-weight:550}
  .drive-order-actions{flex:none;display:flex;gap:2px}
  .drive-order-actions button{width:24px;height:24px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:var(--neutral-500);cursor:pointer}
  .drive-order-actions button:hover:not(:disabled){background:var(--neutral-100);color:var(--neutral-950)}
  .drive-order-actions button:disabled{cursor:default;opacity:.3}
  /* The chevron points down, so one glyph serves both directions rather than
     shipping a second icon that is the same shape upside down. */
  .drive-order-actions button.up{transform:rotate(180deg)}
</style>
