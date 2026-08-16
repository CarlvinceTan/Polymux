<script lang="ts">
  import type {FlareAIApi, ModelDto, ProviderDto} from '@flareai/protocol';
  import {fly} from 'svelte/transition';
  import {readableError} from '../../errors';
  import Icon from '../shared/Icon.svelte';
  import ProviderLogo from '../settings/ProviderLogo.svelte';
  import BackAction from './BackAction.svelte';
  import {t} from '../../i18n';

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
  /** Narrows the grid rather than paging it — every provider stays reachable
   * by scrolling, so search is a shortcut, not the only way through. */
  let search = $state('');

  /**
   * Two halves of one decision, in one step rather than two screens: which
   * provider FlareAI talks to, and which of that provider's models it thinks
   * with. The second half has nothing to show until the first is settled, so
   * the same grid and the same button carry both — the button says what it
   * does at each half, and the copy above changes with it.
   */
  let phase = $state<'provider' | 'model'>('provider');
  let models = $state<ModelDto[]>([]);
  let chosenModel = $state('');
  let loadingModels = $state(false);

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
  /**
   * And then a little below even that. Dead centre, the eyebrow ends up level
   * with the window's own traffic lights, which reads as crowding them rather
   * than as the top of a page; this much clears them without the column
   * looking like it has slipped.
   */
  const DROP = 26;
  /** Bumped by anything that changes the column's height. */
  let measured = $state(0);

  $effect(() => {
    // Read what the measurement depends on, so it is redone when they change.
    void [phase, chosen, chosenModel, search, providers.length, models.length, error, measured];
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
    const shift = Math.round(box.height / 2 - (row.top - box.top + row.height / 2)) + DROP;
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
   * The same edge fade the settings rail carries: faded where the grid runs on,
   * solid where it ends, so the first and last row of cards are never dimmed
   * once there is nothing more to scroll to in that direction.
   */
  let atTop = $state(true);
  let atBottom = $state(true);

  function measureEdges(): void {
    if (!grid) return;
    atTop = grid.scrollTop <= 1;
    atBottom = grid.scrollHeight - grid.scrollTop - grid.clientHeight <= 1;
  }

  $effect(() => {
    // Anything that changes what is in the grid changes where its ends are.
    void [phase, shown.length, shownModels.length, measured];
    const node = grid;
    if (!node) return;
    measureEdges();
    node.addEventListener('scroll', measureEdges, {passive: true});
    const observer = new ResizeObserver(measureEdges);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', measureEdges);
      observer.disconnect();
    };
  });

  /**
   * The providers worth putting first. They open the grid; the rest of the
   * catalogue follows them in it, so the recommendation is where the eye lands
   * without putting anything out of reach.
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
  /** What is actually on screen, and so what the arrow keys walk. */
  const shown = $derived.by(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return ordered;
    return ordered.filter((provider) =>
      `${provider.name} ${provider.id}`.toLocaleLowerCase().includes(query),
    );
  });
  const selected = $derived(providers.find((provider) => provider.id === chosen) ?? null);
  /** The same narrowing, over the settled provider's models. */
  const shownModels = $derived.by(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return models;
    return models.filter((model) => `${model.name} ${model.id}`.toLocaleLowerCase().includes(query));
  });

  /** Context windows are read at a glance, not compared to the token. */
  function compactTokens(size: number): string {
    if (size >= 1_000_000) return `${Math.round(size / 100_000) / 10}m`;
    if (size >= 1000) return `${Math.round(size / 1000)}k`;
    return `${size}`;
  }

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
    if (phase === 'model') {
      const next = shownModels[position + step];
      if (!next) return;
      const card = grid?.querySelector<HTMLButtonElement>(`[data-model="${CSS.escape(next.id)}"]`);
      if (!card) return;
      card.focus();
      chosenModel = next.id;
      return;
    }
    const next = shown[position + step];
    if (!next) return;
    const card = grid?.querySelector<HTMLButtonElement>(`[data-provider="${next.id}"]`);
    if (!card) return;
    card.focus();
    choose(next);
  }

  /** The provider is settled — now the models it offers, in the same grid. */
  async function settle(provider: ProviderDto): Promise<void> {
    search = '';
    error = '';
    loadingModels = true;
    phase = 'model';
    try {
      const list = await api.models.list();
      models = list.filter((model) => model.provider === provider.id);
      chosenModel = models.find((model) => model.selected)?.id ?? models[0]?.id ?? '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      loadingModels = false;
    }
  }

  function reopenProviders(): void {
    phase = 'provider';
    search = '';
    error = '';
    models = [];
  }

  async function save(): Promise<void> {
    if (!selected || !apiKey.trim()) return;
    saving = true;
    error = '';
    try {
      const updated = await api.providers.saveApiKey(selected.id, apiKey.trim());
      apiKey = '';
      providers = providers.map((provider) => (provider.id === updated.id ? updated : provider));
      await settle(updated);
    } catch (cause) {
      error = readableError(cause);
    } finally {
      saving = false;
    }
  }

  /** Local runtimes carry no credential: setting one up is reading its models
   * off the server, after which it behaves like any configured provider. */
  async function connectRuntime(provider: ProviderDto): Promise<void> {
    saving = true;
    error = '';
    try {
      const updated = await api.providers.setupLocalRuntime({id: provider.id});
      providers = providers.map((item) => (item.id === updated.id ? updated : item));
      await settle(updated);
    } catch (cause) {
      error = readableError(cause);
    } finally {
      saving = false;
    }
  }

  async function finish(): Promise<void> {
    if (!selected) return;
    saving = true;
    error = '';
    try {
      if (chosenModel) await api.models.select(selected.id, chosenModel);
      onDone(selected.name);
    } catch (cause) {
      error = readableError(cause);
    } finally {
      saving = false;
    }
  }
</script>

<p class="onb-eyebrow">{$t('onboarding.stepModel')}</p>

<!-- The heading answers whichever half of the step is on screen. Both sit in
     the same grid cell so the words that go are replaced in place while the
     new ones rise into the same place, rather than the page jumping by a line
     between them. -->
<div class="prov-copy">
  {#key phase}
    <div class="prov-copy-slot" in:fly={{y: 8, duration: 280}}>
      <h1 class="onb-title">{phase === 'model' ? $t('model.modelTitle') : $t('model.title')}</h1>
      <p class="onb-lede">
        <!-- The lede counts the providers, so it waits for the list rather
             than saying nought of them for a frame. -->
        {phase === 'model' ?
          $t('model.modelLede', {provider: selected?.name ?? ''})
        : providers.length ? $t('model.lede', {count: providers.length})
        : ''}
      </p>
    </div>
  {/key}
</div>

<!-- Every provider, recommendations first, in a grid that scrolls. Search
     narrows it for anyone who already knows what they came for. What the
     chosen one needs — a key, a sign-in — is answered directly underneath
     rather than on a screen of its own. -->
<div class="onb-section prov-search">
  <Icon name="search" size={14} />
  <input
    bind:value={search}
    type="search"
    spellcheck="false"
    autocomplete="off"
    placeholder={phase === 'model' ? $t('model.searchModels') : $t('model.searchProviders')}
    aria-label={phase === 'model' ? $t('model.searchModels') : $t('model.searchProviders')}
  />
  {#if search}
    <button type="button" aria-label={$t('common.clearSearch')} onclick={() => (search = '')}>
      <Icon name="close" size={12} strokeWidth={1.7} />
    </button>
  {/if}
</div>

<div
  class="onb-section prov-grid"
  class:at-top={atTop}
  class:at-bottom={atBottom}
  role="radiogroup"
  aria-label={phase === 'model' ? $t('model.model') : $t('model.provider')}
  bind:this={grid}
>
  {#if phase === 'model'}
    {#each shownModels as model, position (model.id)}
      <button
        type="button"
        role="radio"
        data-model={model.id}
        aria-checked={chosenModel === model.id}
        class="prov-card"
        class:selected={chosenModel === model.id}
        onclick={() => (chosenModel = model.id)}
        onkeydown={(event) => walk(event, position)}
      >
        <span class="prov-mark"><ProviderLogo provider={model.provider} size={20} /></span>
        <span class="prov-text">
          <span class="prov-name">{model.name}</span>
          <span class="prov-how">{$t('model.contextSize', {size: compactTokens(model.contextWindow)})}</span>
        </span>
      </button>
    {/each}
    {#if shownModels.length === 0 && !loadingModels}
      <p class="onb-note prov-empty">{$t('model.noModelMatches')}</p>
    {/if}
  {:else}
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
          {$t('drive.stateConnected')}
        {:else if provider.apiKeyLabel}
          {$t('model.apiKey')}
        {:else if provider.supportsOAuth}
          {$t('model.signIn')}
        {:else if provider.localRuntime}
          {$t('model.onThisMac')}
        {:else}
          {$t('model.setup')}
        {/if}
      </span>
      </span>
    </button>
  {/each}
  {#if shown.length === 0}
    <p class="onb-note prov-empty">{$t('model.noProviderMatches')}</p>
  {/if}
  {/if}
</div>

{#if phase === 'model'}
  <!-- Nothing to fill in here: the grid is the whole answer, so this half
       carries the actions alone rather than the key field's reserved room. -->
  <div class="prov-detail compact">
    {#if error}<p class="onb-note warn">{error}</p>{/if}
    <div class="onb-actions">
      <button
        type="button"
        class="onb-button primary"
        disabled={saving || loadingModels || !chosenModel}
        onclick={() => void finish()}
      >
        {$t('common.continue')}
      </button>
      <button type="button" class="onb-quiet" onclick={reopenProviders}>
        {$t('model.changeProvider')}
      </button>
    </div>
  </div>
{:else if selected}
  <!-- Not keyed on the provider: switching providers should swap the text in
       place, not tear the panel down and animate a new one in. -->
  <div class="prov-detail">
    {#if selected.configured}
      <p class="onb-note">{$t('model.keyAlreadySaved', {provider: selected.name})}</p>
      <div class="onb-actions">
        <button type="button" class="onb-button primary" onclick={() => void settle(selected)}>
          {$t('model.useProvider', {provider: selected.name})}
        </button>
        <BackAction />
      </div>
    {:else if selected.apiKeyLabel}
      <div class="onb-field prov-key">
        <span>{selected.apiKeyLabel}</span>
        <input
          bind:value={apiKey}
          type="password"
          spellcheck="false"
          autocomplete="off"
          placeholder={$t('model.pasteKey')}
          onkeydown={(event) => {
            if (event.key === 'Enter') void save();
          }}
        />
      </div>
      {#if error}<p class="onb-note warn">{error}</p>{/if}
      <div class="onb-actions">
        <button
          type="button"
          class="onb-button primary"
          disabled={saving || !apiKey.trim()}
          onclick={() => void save()}
        >
          {saving ? $t('hub.checking') : $t('model.set')}
        </button>
        <BackAction />
      </div>
    {:else if selected.localRuntime}
      <!-- A server on this Mac: there is no key to paste, so the whole step
           is asking it what it has. -->
      <p class="onb-note">{$t('model.localRuntimeNote', {provider: selected.name})}</p>
      {#if error}<p class="onb-note warn">{error}</p>{/if}
      <div class="onb-actions">
        <button
          type="button"
          class="onb-button primary"
          disabled={saving}
          onclick={() => void connectRuntime(selected)}
        >
          {saving ? $t('hub.checking') : $t('model.connect')}
        </button>
        <BackAction />
      </div>
    {:else}
      <!-- No key to paste: whatever this provider needs, it is not
           something this screen can ask for. -->
      <p class="onb-note">{$t('model.oauthOnly', {provider: selected.name})}</p>
      <div class="onb-actions">
        <BackAction />
      </div>
    {/if}
  </div>
{/if}

<style>
  /* One cell, both headings stacked in it: the swap is a crossfade in place,
     so nothing under it moves while the words change. The block holds the
     taller of the two so a two-line lede does not shove the grid down when it
     arrives. */
  /* Sized by whichever half is in it rather than by the taller of the two: the
     lede is one line either way, and the room held for a second one read as a
     gap between the words and the search box they belong to. Aligned to the
     bottom of the cell so a lede that does wrap grows upwards, away from the
     box, instead of pushing it down. */
  .prov-copy{display:grid;grid-template-areas:'copy';align-items:end}
  .prov-copy-slot{grid-area:copy}
  .prov-copy-slot :global(.onb-title){margin:0}

  /* Two columns of equal cards. A handful of recommendations reads as a
     choice; the whole catalogue read as a directory, which is why the tail
     sits behind a disclosure instead. */
  /* The scroll box needs slack inside it: a selected card's outline and the
     hover swell both reach past the card's own box, and with only a hair of
     padding the clip edge cut them off. The padding is cancelled by an equal
     negative margin, so the cards still line up with the copy above them. */
  .prov-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;
    padding:7px;margin:8px -7px -3px;
    /* The whole catalogue lives in here, so it scrolls inside this box rather
       than pushing the key field off the screen. */
    /* Three rows and no more: enough that the grid reads as a list you scroll
       rather than as the whole catalogue, and short enough that the copy above
       it and the key field below it fit on one screen with it. Three rows of
       card, the two gaps between them, and the box's own slack. */
    max-height:calc(3 * 54px + 2 * 8px + 14px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;
    /* Faded only on the side there is more to see on. Each end turns solid the
       moment the scroll reaches it, so the top and bottom rows are never left
       dimmed when they are as far as the grid goes. */
    --prov-mask-top:transparent;--prov-mask-bottom:transparent;
    -webkit-mask-image:linear-gradient(to bottom,var(--prov-mask-top),#000 26px,#000 calc(100% - 26px),var(--prov-mask-bottom));
    mask-image:linear-gradient(to bottom,var(--prov-mask-top),#000 26px,#000 calc(100% - 26px),var(--prov-mask-bottom))}
  .prov-grid.at-top{--prov-mask-top:#000}
  .prov-grid.at-bottom{--prov-mask-bottom:#000}
  .prov-grid::-webkit-scrollbar{display:none}
  .prov-empty{grid-column:1/-1;margin:6px 0 2px}
  /* Above the grid it filters, carrying the same edge as the cards under it. */
  .prov-search{--prov-search-edge:var(--neutral-200);--prov-search-surface:var(--app-surface);
    display:flex;align-items:center;gap:8px;height:34px;margin:24px 0 0;padding:0 11px;
    border:1px solid var(--prov-search-edge);border-radius:11px;background:var(--prov-search-surface);
    color:var(--neutral-500)}
  .prov-search:focus-within{border-color:var(--neutral-500)}
  .prov-search input{-webkit-appearance:none;appearance:none;min-width:0;flex:1;border:0;padding:0;
    background:transparent;color:var(--neutral-900);outline:none;font-family:inherit;font-size:12.5px}
  .prov-search input::placeholder{color:var(--neutral-500)}
  .prov-search input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
  .prov-search button{display:grid;flex:none;place-items:center;width:18px;height:18px;border:0;border-radius:6px;
    padding:0;background:transparent;color:inherit;cursor:pointer}
  .prov-search button:hover,.prov-search button:focus-visible{outline:0;color:var(--neutral-900)}
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
  .prov-detail{max-width:380px;min-height:172px;margin-top:18px}
  .prov-detail.compact{min-height:0}
  .prov-detail :global(.onb-note){margin-top:9px}
  .prov-detail :global(.onb-actions){margin-top:18px}

  /* On any ink ground — disc or slab — the cards sit on the inverted surface
     like everything else. */
  :global(.onb-ink) .prov-card{--prov-card-edge:rgb(from var(--disc-ink) r g b / .2);--prov-card-surface:rgb(from var(--disc-ink) r g b / .06)}
  :global(.onb-ink) .prov-name{color:var(--disc-ink)}
  :global(.onb-ink) .prov-how{color:var(--disc-ink-soft)}
  :global(.onb-ink) .prov-mark{background:rgb(from var(--disc-ink) r g b / .1)}
  :global(.onb-ink) .prov-card:focus-visible{outline-color:var(--disc-ink)}
  :global(.onb-ink) .prov-search{--prov-search-edge:rgb(from var(--disc-ink) r g b / .2);--prov-search-surface:rgb(from var(--disc-ink) r g b / .06);color:var(--disc-ink-soft)}
  :global(.onb-ink) .prov-search:focus-within{border-color:rgb(from var(--disc-ink) r g b / .45)}
  :global(.onb-ink) .prov-search input{color:var(--disc-ink)}
  :global(.onb-ink) .prov-search input::placeholder{color:var(--disc-ink-soft)}
  :global(.onb-ink) .prov-search button:hover,:global(.onb-ink) .prov-search button:focus-visible{color:var(--disc-ink)}

  @media (prefers-reduced-motion:reduce){
    .prov-card,.prov-card::before{transition:none;animation:none}
  }
</style>
