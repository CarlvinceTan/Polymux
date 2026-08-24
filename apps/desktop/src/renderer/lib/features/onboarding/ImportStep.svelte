<script lang="ts">
  import type {
    PolymuxApi,
    DiscoveredSkillGroupDto,
    DiscoveredMcpGroupDto,
    BrowserSourceDto,
  } from '@polymux/protocol';
  import BackAction from './BackAction.svelte';
  import {t} from '../../../i18n';

  interface Props {
    api: PolymuxApi;
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

  /**
   * The left panel: a field of black circles perpetually falling inward and
   * being swallowed by the Polymux mark at the centre. Ambient by default; the
   * pull tightens while an import is running. Runs on a canvas because it is a
   * live particle field, not a handful of transitioned elements.
   */
  function absorbField(canvas: HTMLCanvasElement) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const SIZE = 280; // logical field, matches .import-field
    const CENTER = SIZE / 2;
    const OUTER = 132; // spawn ring
    const ABSORB = 26; // radius of the mark's throat — vanish here
    const FADE = 52; // start fading once inside this

    // The particle count tracks how much was found, so a rich machine reads as
    // a denser field, but stays inside a sensible band.
    const COUNT = Math.max(48, Math.min(120, items.length || 64));

    let ink = '#000';
    const readInk = () => {
      const v = getComputedStyle(canvas).getPropertyValue('--neutral-950').trim();
      if (v) ink = v;
    };
    readInk();

    // A deterministic pseudo-random so the field looks the same each mount
    // without pulling in Math.random at module scope.
    let seed = 0x2f6e2b1;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };

    interface P {
      angle: number;
      radius: number;
      size: number;
      spin: number; // angular drift, for the swirl into the throat
      speed: number; // base inward velocity
    }

    const spawn = (p: P, atOuter: boolean): void => {
      p.angle = rnd() * Math.PI * 2;
      p.radius = atOuter ? OUTER + rnd() * 24 : ABSORB + rnd() * (OUTER - ABSORB);
      p.size = 6 + rnd() * 11;
      p.spin = (rnd() - 0.5) * 0.010;
      p.speed = 0.18 + rnd() * 0.26;
    };

    const parts: P[] = [];
    for (let i = 0; i < COUNT; i++) {
      const p: P = {angle: 0, radius: 0, size: 0, spin: 0, speed: 0};
      spawn(p, false);
      parts.push(p);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dpr = 1;
    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = SIZE * dpr;
      canvas.height = SIZE * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const draw = (): void => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      // A hard pull tightens everything toward the throat while importing.
      const pull = importing || imported ? 3.0 : 1;
      for (const p of parts) {
        if (!reduce) {
          // Accelerate as it nears the centre — the closer to the mark, the
          // faster it is drawn in.
          const t = 1 - Math.max(0, (p.radius - ABSORB) / (OUTER - ABSORB));
          p.radius -= p.speed * (0.55 + t * 1.5) * pull;
          p.angle += p.spin * (1 + t * 2.2);
          if (p.radius <= ABSORB) spawn(p, true);
        }

        // Fade out into the throat, and in as they arrive from the rim.
        let alpha = 1;
        if (p.radius < FADE) alpha = Math.max(0, (p.radius - ABSORB) / (FADE - ABSORB));
        else if (p.radius > OUTER) alpha = Math.max(0, 1 - (p.radius - OUTER) / 24);

        if (alpha <= 0) continue;
        const x = CENTER + Math.cos(p.angle) * p.radius;
        const y = CENTER + Math.sin(p.angle) * p.radius;
        // Stretch along the radial axis near the throat — a droplet being drawn in.
        const stretch = p.radius < FADE ? 1 + (1 - p.radius / FADE) * 1.6 : 1;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = ink;
        ctx.translate(x, y);
        ctx.rotate(p.angle);
        ctx.beginPath();
        ctx.ellipse(0, 0, (p.size / 2) * stretch, (p.size / 2) / Math.sqrt(stretch), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    let raf = 0;
    const loop = (): void => {
      draw();
      raf = requestAnimationFrame(loop);
    };

    if (reduce) {
      draw();
    } else {
      raf = requestAnimationFrame(loop);
    }

    const onResize = (): void => {
      resize();
      readInk();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
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
      <!-- A live field of circles perpetually drawn into the mark at the centre. -->
      <div class="import-field" class:sucking={importing || imported} aria-hidden="true">
        <canvas class="absorb-canvas" {@attach absorbField}></canvas>
        <svg class="absorb-mark" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
          <path fill="currentColor" transform="translate(-10 0)" d="M 40 40 L 120 40 A 60 60 0 0 1 120 160 L 40 160 L 70 120 L 110 120 A 20 20 0 0 0 110 80 L 70 80 Z"/>
<!--
          <path fill="currentColor" d="M72.62,17a3.23,3.23,0,0,0-4.59.79l-2.46,3.62v.13l10.54,8.07,16.33,12,2.88-3.91a3.23,3.23,0,0,0-.69-4.52Z"/>
          <path fill="currentColor" d="M71.16,39.87l-27,4.12a3.23,3.23,0,0,0-2.69,3.8l.84,4.36,0,0,13.23-1.75,20-3-.73-4.8A3.23,3.23,0,0,0,71.16,39.87Z"/>
          <path fill="currentColor" d="M59.3,61.22l-16.2,22a3.23,3.23,0,0,0,.79,4.59l3.62,2.45h.13l8.07-10.54,12-16.34-3.91-2.87A3.23,3.23,0,0,0,59.3,61.22Z"/>
          <path fill="currentColor" d="M78.25,113.58l.07-.07-1.76-13.2-3.05-20-4.79.73A3.23,3.23,0,0,0,66,84.7l4.12,27a3.22,3.22,0,0,0,3.8,2.69Z"/>
          <path fill="currentColor" d="M116.4,108.39v-.2l-10.52-8-16.33-12L86.67,92a3.23,3.23,0,0,0,.69,4.52l22,16.2A3.24,3.24,0,0,0,114,112Z"/>
          <path fill="currentColor" d="M139.73,77.65l-.11-.1-13.17,1.74-20,3,.73,4.8a3.24,3.24,0,0,0,3.69,2.71l27-4.12a3.22,3.22,0,0,0,2.69-3.81Z"/>
          <path fill="currentColor" d="M134.43,39.4h0L126.28,50l-12,16.32,3.91,2.88a3.23,3.23,0,0,0,4.52-.69l16.2-22a3.24,3.24,0,0,0-.79-4.59Z"/>
          <path fill="currentColor" d="M111.87,18a3.23,3.23,0,0,0-3.81-2.68l-4.27.82-.11.11,1.75,13.17,3.05,20,4.8-.73A3.23,3.23,0,0,0,116,45Z"/>
          <path fill="currentColor" d="M73.92,33.3l0-1.36-8.22-6.3.26,11.63,5.19-.69A3.23,3.23,0,0,0,73.92,33.3Z"/>
          <path fill="currentColor" d="M56.45,54.88l-1.17-1.16-10.09,1.34,8.35,8.35,3.21-4.31A3.24,3.24,0,0,0,56.45,54.88Z"/>
          <path fill="currentColor" d="M59.42,81.93l-1.34,0-6.3,8.23,11.66-.27-.75-5.22A3.23,3.23,0,0,0,59.42,81.93Z"/>
          <path fill="currentColor" d="M80.77,99.37l-.94,1,1.36,10.21,8.11-8.37L85,99A3.24,3.24,0,0,0,80.77,99.37Z"/>
          <path fill="currentColor" d="M107.8,96.7l0,.88,8.37,6.4-.49-11.39-5.16.77A3.23,3.23,0,0,0,107.8,96.7Z"/>
          <path fill="currentColor" d="M128.1,66.73,125,71a3.23,3.23,0,0,0,.39,4.28l.87.82,10.34-1.37Z"/>
          <path fill="currentColor" d="M118.56,39.4l.76,5.3a3.23,3.23,0,0,0,3.2,2.78h1.61l6.19-8.08Z"/>
          <path fill="currentColor" d="M93.47,28.26l3.63,2.67a3.22,3.22,0,0,0,4.27-.4l.83-.89-1.37-10.35-8,8.53Z"/>
-->
        </svg>
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

  .absorb-canvas{position:absolute;inset:0;width:100%;height:100%;
    /* Carries --neutral-950 so the canvas can read the ink colour. */
    color:var(--neutral-950)}

  /* The mark sits at the throat the circles vanish into. It pulses inward as
     the pull tightens during an import. */
  .absorb-mark{position:absolute;top:50%;left:50%;width:64px;height:64px;
    color:#000;transform:translate(-50%,-50%);
    transition:transform .5s cubic-bezier(.3,0,0,1)}
  .import-field.sucking .absorb-mark{transform:translate(-50%,-50%) scale(1.12)}

  .import-spinner{display:block;width:20px;height:20px;border:2px solid var(--neutral-200);
    border-top-color:var(--neutral-600);border-radius:50%;animation:import-spin .7s linear infinite}
  @keyframes import-spin{to{transform:rotate(360deg)}}

  @media (max-width:700px){
    .import-step{grid-template-columns:1fr;grid-template-rows:auto 1fr}
    .import-left{min-height:180px}
  }

  @media (prefers-reduced-motion:reduce){
    .absorb-mark{transition:none}
    .import-field.sucking .absorb-mark{transform:translate(-50%,-50%)}
  }
</style>
