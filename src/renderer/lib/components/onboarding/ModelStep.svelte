<script lang="ts">
  import type {FlareAIApi, ProviderDto} from '@flareai/protocol';
  import {readableError} from '../../errors';
  import ProviderLogo from '../settings/ProviderLogo.svelte';
  import SkipAction from './SkipAction.svelte';

  interface Props {
    api: FlareAIApi;
    onDone: (label: string) => void;
  }

  const {api, onDone}: Props = $props();

  let providers = $state<ProviderDto[]>([]);
  let chosen = $state('');
  let apiKey = $state('');
  let saving = $state(false);
  let error = $state('');
  let grid = $state<HTMLDivElement | null>(null);
  /** The long tail stays folded away until asked for. */
  let showAll = $state(false);

  /**
   * The grid is what the step is actually about, so it — not the column as a
   * whole — is what sits on the window's centre line. How much copy stands
   * above it and how much field below it changes with the provider chosen, so
   * the offset is measured rather than guessed: half the column's height, less
   * where the grid's own middle falls inside it.
   *
   * Measured from the column and the grid together, both inside the same
   * transformed deck, so the numbers are layout distances and the shift this
   * produces cannot feed back into them.
   */
  /** Bumped by anything that changes the column's height. */
  let measured = $state(0);

  $effect(() => {
    // Read what the measurement depends on, so it is redone when they change.
    void [chosen, showAll, providers.length, error, measured];
    const column = grid?.parentElement;
    if (!grid || !column) return;
    const box = column.getBoundingClientRect();
    const row = grid.getBoundingClientRect();
    // A column tall enough to scroll is already using every pixel it has;
    // moving it would only push its far end out of reach.
    if (column.scrollHeight > column.clientHeight + 1) {
      column.style.setProperty('--mind-shift', '0px');
      return;
    }
    const shift = Math.round(box.height / 2 - (row.top - box.top + row.height / 2));
    column.style.setProperty('--mind-shift', `${shift}px`);
  });

  $effect(() => {
    const column = grid?.parentElement;
    if (!column) return;
    const observer = new ResizeObserver(() => (measured += 1));
    observer.observe(column);
    return () => observer.disconnect();
  });

  /**
   * The providers worth putting first. They get the grid; everything else is
   * one click away behind it, so the choice reads as a short recommendation
   * rather than a directory.
   */
  const FEATURED = ['anthropic', 'openai', 'google', 'openrouter'];

  const ordered = $derived(
    [...providers].sort((a, b) => {
      const rank = (provider: ProviderDto) => {
        const featured = FEATURED.indexOf(provider.id);
        return featured === -1 ? FEATURED.length : featured;
      };
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    }),
  );
  const recommended = $derived(ordered.filter((provider) => FEATURED.includes(provider.id)));
  const rest = $derived(ordered.filter((provider) => !FEATURED.includes(provider.id)));
  /** What is actually on screen, and so what the arrow keys walk. */
  const shown = $derived(showAll ? [...recommended, ...rest] : recommended);
  const selected = $derived(providers.find((provider) => provider.id === chosen) ?? null);

  $effect(() => {
    void api.providers
      .list()
      .then((list) => {
        providers = list;
        // Default to the first card actually shown, not the first the backend
        // happens to return, so the highlighted option matches the order.
        chosen ||= FEATURED.find((id) => list.some((provider) => provider.id === id)) ?? '';
      })
      .catch(() => {});
  });

  function choose(provider: ProviderDto): void {
    chosen = provider.id;
    apiKey = '';
    error = '';
  }

  /**
   * Arrow keys walk the grid, the way a radio group is expected to. Two
   * columns, so up and down step by a row and left and right by a card.
   */
  function walk(event: KeyboardEvent, position: number): void {
    const step =
      event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowLeft' ? -1
      : event.key === 'ArrowDown' ? 2
      : event.key === 'ArrowUp' ? -2
      : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = shown[position + step];
    if (!next) return;
    const card = grid?.querySelector<HTMLButtonElement>(`[data-provider="${next.id}"]`);
    if (!card) return;
    card.focus();
    choose(next);
  }

  async function save(): Promise<void> {
    if (!selected || !apiKey.trim()) return;
    saving = true;
    error = '';
    try {
      const updated = await api.providers.saveApiKey(selected.id, apiKey.trim());
      apiKey = '';
      onDone(updated.name);
    } catch (cause) {
      error = readableError(cause);
    } finally {
      saving = false;
    }
  }
</script>

<p class="onb-eyebrow">Model</p>
<h1 class="onb-title">Choose who FlareAI thinks with.</h1>
<p class="onb-lede">
  FlareAI talks to a model provider using your own API key. The key is encrypted by macOS and never
  leaves this Mac.
</p>

<!-- A short grid of the ones worth recommending, with the rest folded in
     behind them. What the chosen one needs — a key, a sign-in — is answered
     directly underneath rather than on a screen of its own. -->
<div
  class="onb-section prov-grid"
  role="radiogroup"
  aria-label="Model provider"
  bind:this={grid}
>
  {#each shown as provider, position (provider.id)}
    <button
      type="button"
      role="radio"
      data-provider={provider.id}
      aria-checked={chosen === provider.id}
      class="prov-card"
      class:selected={chosen === provider.id}
      onclick={() => choose(provider)}
      onkeydown={(event) => walk(event, position)}
    >
      <span class="prov-mark"><ProviderLogo provider={provider.id} size={20} /></span>
      <span class="prov-text">
      <span class="prov-name">{provider.name}</span>
      <span class="prov-how">
        {#if provider.configured}
          Connected
        {:else if provider.apiKeyLabel}
          API key
        {:else if provider.supportsOAuth}
          Sign in
        {:else}
          Setup
        {/if}
      </span>
      </span>
    </button>
  {/each}
</div>

{#if rest.length > 0}
  <!-- The rest of the catalogue, under the grid it belongs to. Passing on the
       question entirely is Skip's job, in the action row. -->
  <button type="button" class="onb-quiet prov-more" onclick={() => (showAll = !showAll)}>
    {showAll ? 'Show fewer' : `${rest.length} more providers`}
  </button>
{/if}

{#if selected}
  <!-- Keyed on the provider so the panel is rebuilt, and its entrance runs,
       each time the choice changes. -->
  {#key selected.id}
    <div class="prov-detail">
      {#if selected.configured}
        <p class="onb-note">{selected.name} already has a key saved on this Mac.</p>
        <div class="onb-actions">
          <button type="button" class="onb-button primary" onclick={() => onDone(selected.name)}>
            Use {selected.name}
          </button>
          <SkipAction />
        </div>
      {:else if selected.apiKeyLabel}
        <div class="onb-field prov-key">
          <span>{selected.apiKeyLabel}</span>
          <input
            bind:value={apiKey}
            type="password"
            spellcheck="false"
            autocomplete="off"
            placeholder="Paste your key"
            onkeydown={(event) => {
              if (event.key === 'Enter') void save();
            }}
          />
        </div>
        {#if selected.supportsOAuth}
          <p class="onb-note">
            {selected.name} can also sign you in with your account, from Settings → Providers,
            once setup is done.
          </p>
        {/if}
        {#if error}<p class="onb-note warn">{error}</p>{/if}
        <div class="onb-actions">
          <button
            type="button"
            class="onb-button primary"
            disabled={saving || !apiKey.trim()}
            onclick={() => void save()}
          >
            {saving ? 'Checking…' : 'Connect'}
          </button>
          <SkipAction />
        </div>
      {:else}
        <!-- No key to paste: whatever this provider needs, it is not
             something this screen can ask for. -->
        <p class="onb-note">
          {selected.name} signs in with your account. FlareAI opens that from Settings → Providers.
        </p>
        <div class="onb-actions">
          <SkipAction />
        </div>
      {/if}
    </div>
  {/key}
{/if}

<style>
  /* Two columns of equal cards. A handful of recommendations reads as a
     choice; the whole catalogue read as a directory, which is why the tail
     sits behind a disclosure instead. */
  /* The scroll box needs slack inside it: a selected card's outline and the
     hover swell both reach past the card's own box, and with only a hair of
     padding the clip edge cut them off. The padding is cancelled by an equal
     negative margin, so the cards still line up with the copy above them. */
  .prov-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;
    padding:7px;margin:24px -7px -3px;
    /* Four recommendations fit without scrolling; the expanded list scrolls
       inside this box instead of pushing the key field off the screen. */
    max-height:clamp(182px,36vh,314px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}
  .prov-grid::-webkit-scrollbar{display:none}
  .prov-more{margin:8px 0 0;padding:0;align-self:flex-start;font-size:11.5px}
  /* Same split as .onb-button: the card's plate grows on hover, its label and
     logo never scale, so the type stays where it was drawn and stays sharp. */
  .prov-card{--prov-card-edge:var(--neutral-200);--prov-card-surface:var(--app-surface);
    position:relative;isolation:isolate;display:flex;align-items:center;gap:10px;min-width:0;
    border:0;border-radius:13px;padding:11px 12px;background:transparent;
    color:var(--neutral-800);cursor:pointer;font-family:inherit;text-align:left}
  .prov-text{display:flex;flex-direction:column;gap:1px;min-width:0}
  .prov-name,.prov-how{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .prov-card::before{content:'';position:absolute;z-index:-1;inset:0;border:1px solid var(--prov-card-edge);border-radius:inherit;
    background:var(--prov-card-surface);
    transition:border-color .16s,background-color .16s,transform .18s cubic-bezier(.22,1,.36,1);
    will-change:transform;backface-visibility:hidden}
  .prov-mark{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:var(--neutral-100)}
  .prov-name{font-size:12.5px;font-weight:570;color:var(--neutral-900);line-height:1.2}
  .prov-how{font-size:10.5px;font-weight:520;color:var(--neutral-500);letter-spacing:.02em}
  /* Size, not colour — the cards sit on the page on one screen and on the
     disc's inverted ground on another, and only one of those a neutral hover
     tint can be written for. */
  .prov-card:hover::before{transform:scale(1.04)}
  .prov-card:active::before{transform:scale(1.01)}
  .prov-card.selected{--prov-card-edge:var(--neutral-950);--prov-card-surface:var(--app-surface)}
  .prov-card.selected .prov-mark{background:var(--neutral-100)}
  .prov-card:focus-visible{outline:2px solid var(--neutral-500);outline-offset:2px}

  /* The answer to the card just chosen, arriving under it. Held to the width
     of the field it is mostly made of: run full width, the one line of
     explanation stretched twice as wide as the input it explains and stopped
     reading as a pair. Its own rhythm too — label to field to note to buttons,
     each step a little further apart than the last — rather than the page's
     section spacing, which was written for whole blocks. */
  /* The column is centred on its own height, so a panel that is taller for one
     provider than the next pushed the title and the cards up and down as the
     choice changed. The panel holds the room the tallest of them needs — a
     key field, a line about signing in, and the buttons — and the shorter ones
     leave the rest of it empty rather than dragging the page after them. */
  .prov-detail{max-width:380px;min-height:172px;margin-top:18px;animation:prov-in .28s cubic-bezier(.22,1,.36,1) both}
  .prov-detail :global(.onb-note){margin-top:9px}
  .prov-detail :global(.onb-actions){margin-top:18px}
  @keyframes prov-in{from{opacity:0;transform:translate3d(0,-6px,0)}to{opacity:1;transform:none}}

  /* On any ink ground — disc or slab — the cards sit on the inverted surface
     like everything else. */
  :global(.onb-ink) .prov-card{--prov-card-edge:rgb(from var(--disc-ink) r g b / .2);--prov-card-surface:rgb(from var(--disc-ink) r g b / .06)}
  :global(.onb-ink) .prov-name{color:var(--disc-ink)}
  :global(.onb-ink) .prov-how{color:var(--disc-ink-soft)}
  :global(.onb-ink) .prov-mark{background:rgb(from var(--disc-ink) r g b / .1)}
  :global(.onb-ink) .prov-card:focus-visible{outline-color:var(--disc-ink)}

  @media (prefers-reduced-motion:reduce){
    .prov-card,.prov-card::before,.prov-detail{transition:none;animation:none}
  }
</style>
