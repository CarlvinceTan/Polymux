<script lang="ts">
  import type {
    FlareAIApi,
    DiscoveredSkillGroupDto,
    DiscoveredMcpGroupDto,
    BrowserSourceDto,
  } from '@flareai/protocol';
  import BackAction from './BackAction.svelte';
  import {t} from '../../../i18n';

  interface Props {
    api: FlareAIApi;
    onDone: () => void;
    preview?: boolean;
  }

  const {api, onDone, preview = false}: Props = $props();

  interface DetectedItem {
    id: string;
    label: string;
    source: string;
    kind: 'skill' | 'mcp' | 'browser';
    /** Enough to adopt it. */
    meta: {groupId?: string; serverId?: string; path?: string; sourceId?: string; profileId?: string};
  }

  let items = $state<DetectedItem[]>([]);
  let loading = $state(true);
  let importing = $state(false);
  let imported = $state(false);

  $effect(() => {
    void detect();
  });

  async function detect(): Promise<void> {
    loading = true;
    const [skillGroups, mcpGroups, browserSources] = await Promise.all([
      api.skills.discover().catch((): DiscoveredSkillGroupDto[] => []),
      api.mcp.discover().catch((): DiscoveredMcpGroupDto[] => []),
      api.browser.importSources().catch((): BrowserSourceDto[] => []),
    ]);

    const found: DetectedItem[] = [];

    for (const group of skillGroups) {
      for (const skill of group.skills) {
        if (skill.state === 'available') {
          found.push({
            id: `skill:${skill.path}`,
            label: skill.name,
            source: group.label,
            kind: 'skill',
            meta: {path: skill.path},
          });
        }
      }
    }

    for (const group of mcpGroups) {
      for (const server of group.servers) {
        if (server.state === 'available') {
          found.push({
            id: `mcp:${server.id}`,
            label: server.name,
            source: group.label,
            kind: 'mcp',
            meta: {groupId: group.id, serverId: server.id},
          });
        }
      }
    }

    for (const source of browserSources) {
      if (source.fileImportOnly) continue;
      for (const profile of source.profiles) {
        if (!profile.readable) continue;
        found.push({
          id: `browser:${source.id}:${profile.id}`,
          label: `${source.name} — ${profile.name}`,
          source: source.name,
          kind: 'browser',
          meta: {sourceId: source.id, profileId: profile.id},
        });
      }
    }

    items = found;
    loading = false;
  }

  async function doImport(): Promise<void> {
    if (importing || imported || preview) return;
    importing = true;

    const promises: Promise<unknown>[] = [];

    for (const item of items) {
      if (item.kind === 'skill' && item.meta.path) {
        promises.push(api.skills.adopt(item.meta.path).catch(() => {}));
      } else if (item.kind === 'mcp' && item.meta.groupId && item.meta.serverId) {
        promises.push(api.mcp.adopt(item.meta.groupId, item.meta.serverId).catch(() => {}));
      } else if (item.kind === 'browser' && item.meta.sourceId && item.meta.profileId) {
        promises.push(
          api.browser
            .importFrom({
              sourceId: item.meta.sourceId,
              profileId: item.meta.profileId,
              history: true,
              cookies: false,
              passwords: false,
            })
            .catch(() => {}),
        );
      }
    }

    await Promise.allSettled(promises);
    imported = true;
    importing = false;
  }

  const SUCK_DURATION_MS = 820;

  function importAndAnimate(): void {
    if (importing || imported) return;
    void doImport();
    setTimeout(onDone, SUCK_DURATION_MS + 200);
  }
</script>

<div class="import-step" class:sucking={importing || imported}>
  <div class="import-left">
    {#if loading}
      <div class="import-empty">
        <span class="import-spinner"></span>
      </div>
    {:else if items.length === 0}
      <div class="import-empty">
        <p class="onb-lede">{$t('onboarding.importNone')}</p>
      </div>
    {:else}
      <!-- The suck target — circles converge here -->
      <div class="import-field" aria-hidden="true">
        <span class="suck-target"></span>
        {#each items as item, i (item.id)}
          {@const angle = (i / items.length) * 360}
          {@const dist = 80 + (i % 3) * 40 + (i % 2) * 20}
          <span
            class="suck-circle"
            class:active={importing || imported}
            style="
              --angle:{angle}deg;
              --dist:{dist}px;
              --delay:{i * 60}ms;
              --size:{item.kind === 'mcp' ? 28 : item.kind === 'skill' ? 24 : 20}px;
            "
          >
            <span class="suck-dot"></span>
          </span>
        {/each}
      </div>
    {/if}
  </div>

  <div class="import-right">
    <p class="onb-eyebrow">{$t('onboarding.stepImport')}</p>
    <h1 class="onb-title">{$t('onboarding.importTitle')}</h1>
    <p class="onb-lede">{$t('onboarding.importLede')}</p>

    {#if !loading && items.length > 0}
      {@const skills = items.filter((i) => i.kind === 'skill')}
      {@const mcps = items.filter((i) => i.kind === 'mcp')}
      {@const browsers = items.filter((i) => i.kind === 'browser')}
      <ul class="import-summary">
        {#if skills.length > 0}
          <li>{$t('onboarding.importSkills', {count: skills.length})}</li>
        {/if}
        {#if mcps.length > 0}
          <li>{$t('onboarding.importMcp', {count: mcps.length})}</li>
        {/if}
        {#if browsers.length > 0}
          <li>{$t('onboarding.importBrowsers', {count: browsers.length})}</li>
        {/if}
      </ul>
    {/if}

    <div class="onb-actions import-actions">
      {#if items.length > 0 && !imported}
        <button
          type="button"
          class="onb-button primary"
          disabled={loading || importing || preview}
          onclick={importAndAnimate}
        >
          {importing ? $t('onboarding.importWorking') : $t('onboarding.importButton')}
        </button>
      {/if}
      <button
        type="button"
        class="onb-button"
        disabled={importing}
        onclick={onDone}
      >
        {items.length === 0 || imported ? $t('common.continue') : $t('onboarding.importSkipButton')}
      </button>
      <BackAction />
    </div>
  </div>
</div>

<style>
  .import-step{position:relative;height:100%;display:grid;grid-template-columns:1fr 1fr;
    align-items:center;width:100%;max-width:920px;margin:0 auto;padding:24px 22px;gap:clamp(24px,4vw,64px)}

  .import-left{position:relative;display:grid;place-items:center;min-height:280px;align-self:stretch}
  .import-empty{display:grid;place-items:center;height:100%}

  .import-right{display:flex;flex-direction:column;justify-content:center;min-width:0}
  .import-right :global(.onb-lede){max-width:36ch}

  .import-summary{list-style:none;margin:18px 0 0;padding:0;display:flex;flex-direction:column;gap:4px;
    color:var(--neutral-500);font-size:12.5px}

  .import-actions{margin-top:26px}

  /* The field the circles live in, centred in the left half. */
  .import-field{position:relative;width:280px;height:280px}

  .suck-target{position:absolute;top:50%;left:50%;width:6px;height:6px;border-radius:50%;
    background:var(--neutral-950);transform:translate(-50%,-50%);
    transition:transform .5s cubic-bezier(.3,0,0,1),opacity .4s ease}
  .sucking .suck-target{transform:translate(-50%,-50%) scale(3);opacity:0}

  /* Each circle is positioned by rotating a wrapper around the centre then
     translating outward by --dist. The dot inside is the visible shape. */
  .suck-circle{position:absolute;top:50%;left:50%;width:0;height:0;
    transform:rotate(var(--angle)) translateX(var(--dist))}

  .suck-dot{display:block;width:var(--size);height:var(--size);border-radius:50%;
    background:var(--neutral-950);transform:translate(-50%,-50%);
    transition:transform .82s cubic-bezier(.7,0,1,1) var(--delay),
               border-radius .6s ease var(--delay),
               opacity .3s ease calc(var(--delay) + .5s)}

  /* The suck: translate back to centre, stretch along the radial axis, collapse. */
  .suck-circle.active .suck-dot{
    transform:translate(-50%,-50%) translateX(calc(var(--dist) * -1)) scaleX(2.2) scaleY(.3) scale(0);
    border-radius:40%;opacity:0}

  .import-spinner{display:block;width:20px;height:20px;border:2px solid var(--neutral-200);
    border-top-color:var(--neutral-600);border-radius:50%;animation:import-spin .7s linear infinite}
  @keyframes import-spin{to{transform:rotate(360deg)}}

  @media (max-width:700px){
    .import-step{grid-template-columns:1fr;grid-template-rows:auto 1fr}
    .import-left{min-height:180px}
  }

  @media (prefers-reduced-motion:reduce){
    .suck-dot{transition:opacity .3s ease var(--delay) !important}
    .suck-circle.active .suck-dot{transform:translate(-50%,-50%);opacity:0}
    .suck-target{transition:opacity .3s ease !important}
  }
</style>
