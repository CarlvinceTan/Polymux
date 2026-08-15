<script lang="ts">
  import type {MidasApi} from '@midas/protocol';
  import Icon from '../shared/Icon.svelte';
  import ModelStep from './ModelStep.svelte';
  import PermissionsStep from './PermissionsStep.svelte';
  import PlatformsStep from './PlatformsStep.svelte';
  import MindOrb from './MindOrb.svelte';

  interface Props {
    api: MidasApi;
    onFinish: () => void;
    /**
     * False while the startup splash still covers the window. The welcome
     * lockup renders identically to the splash's and at the same point, so
     * the cover's fade is invisible; everything else (chrome, the Start
     * button) holds until the reveal so it reads as appearing when ready.
     */
    revealed?: boolean;
    /**
     * Set when setup was opened just to look at it, over a profile that has
     * already been through it. Nothing is written on the way out, so a
     * preview leaves the machine exactly as it found it.
     */
    preview?: boolean;
  }

  const {api, onFinish, revealed = true, preview = false}: Props = $props();

  const STEPS = ['welcome', 'platforms', 'model', 'permissions', 'ready'] as const;
  type Step = (typeof STEPS)[number];

  let index = $state(0);

  /**
   * The camera's height, and the deck's unit of travel.
   */
  let vh = $state(800);
  let vw = $state(1280);
  const winH = $derived(Math.max(vh, 520));
  /**
   * The hub screen is taller than the window on purpose. Its disc is half as
   * tall again as the camera, and a screen exactly one window high would have
   * to cut it off at its own top and bottom edges — which is what put a
   * straight slice across the circle mid-pan, and showed its crown on the start
   * screen when the clip was lifted to hide the slice. Given the room, the
   * whole circle lives inside its own screen, uncut, and simply is not there
   * until the camera reaches it.
   *
   * The disc reaches about 12% of the window above and below the centre line,
   * plus the ring the seats ride on outside it.
   */
  const OVERHANG = $derived(Math.round(winH * 0.26 + 240));
  const slideHeight = $derived((name: Step) => (name === 'platforms' ? winH + OVERHANG : winH));
  /**
   * Where the camera sits for a given screen: the top of every ordinary one,
   * and the middle of a screen taller than the window — which for the hub is
   * the disc's own centre line, the framing the step is drawn for.
   */
  const offset = $derived(
    STEPS.slice(0, index).reduce((total, name) => total + slideHeight(name), 0) +
      (slideHeight(STEPS[index]) - winH) / 2,
  );

  /**
   * How setup is leaving, in three beats. `squeezing` closes the disc's edge
   * in on itself — the words hold their size and are swallowed by the rim, not
   * shrunk with it. `filling` then plays the same circle inverted: an empty one
   * grows from the same centre until the window is all ink. `opening` opens a
   * clear circle in that ink and grows it until the app is all that is left.
   * The app is mounted underneath this screen already, so the reveal is real
   * rather than a picture of one.
   */
  let closing = $state<'' | 'squeezing' | 'filling' | 'opening'>('');
  /** Radius enough to clear the window's far corners. */
  const coverOpen = $derived(Math.ceil((Math.hypot(vw, winH) / 2) * 1.05));
  const SQUEEZE_MS = 520;
  const FILL_MS = 620;
  /** A beat with the window solid, so the fill is plainly finished first. */
  const FILL_HOLD = 90;
  const OPEN_MS = 840;

  let finishing = $state(false);

  const step = $derived(STEPS[index]);
  /** Welcome and the closing summary are not choices, so they get no dot. */
  const dotted = $derived(STEPS.slice(1));
  /**
   * Clamped rather than allowed to go negative on welcome. The rail is hidden
   * there either way, and letting the mark fall off the front made the pill
   * shrink and the fill slide back to the top *while* the rail was fading —
   * so leaving and returning to the start page read as movement, not a fade.
   * Held on the first dot, nothing but opacity changes across that boundary.
   */
  const dotIndex = $derived(Math.max(0, index - 1));

  function next(): void {
    if (index < STEPS.length - 1) index += 1;
  }

  function back(): void {
    if (index > 0) index -= 1;
  }

  /** What the rail's dots are called out loud. */
  const STEP_LABELS: Record<Step, string> = {
    welcome: 'Welcome',
    platforms: 'Accounts',
    model: 'Model',
    permissions: 'Permissions',
    ready: 'Summary',
  };

  /**
   * Jump straight to a step from the rail. Every step is skippable from its
   * own screen anyway, so there is nothing to guard here — moving the camera
   * is the whole of it, and the pan makes the jump legible either way.
   */
  function goto(position: number): void {
    index = position + 1;
  }

  async function finish(): Promise<void> {
    if (finishing) return;
    finishing = true;
    // Setup is over either way: a failed write must not trap the user on this
    // screen, it just means they see it again next launch.
    if (!preview) await api.general.update({onboardingCompleted: true}).catch(() => {});
    // Skipping is an escape hatch — it should feel like closing a window, not
    // like a curtain call. The full close is for finishing.
    if (step !== 'ready' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onFinish();
      return;
    }
    // Each beat is a fresh keyed element whose growth is a CSS animation, not
    // a transition: an animation runs from its own first frame regardless of
    // when the element reaches the screen, where a transition needs the
    // browser to have seen the starting size first — a frame this code was
    // never actually giving it, so the circle popped in full-grown.
    closing = 'squeezing';
    setTimeout(() => {
      closing = 'filling';
      setTimeout(() => {
        closing = 'opening';
        setTimeout(onFinish, OPEN_MS);
      }, FILL_MS + FILL_HOLD);
    }, SQUEEZE_MS);
  }
</script>

<svelte:window
  bind:innerHeight={vh}
  bind:innerWidth={vw}
  onkeydown={(event) => {
    if (event.key === 'Escape' && step !== 'ready') void finish();
  }}
/>

<section
  class="onb"
  class:revealed
  class:squeezing={closing !== ''}
  class:opening={closing === 'opening'}
  aria-label="Set up Midas"
>
  <!-- No brand lockup here: setup already says Midas on the welcome screen,
       and after that the name in the corner is just furniture. The bar stays
       for the drag region and the way out. -->
  <header class="onb-chrome" class:on-hub={step === 'platforms'}>
    <!-- Not on welcome: Start is the only thing to do there, and an escape
         hatch offered before anything has been asked for is just noise. -->
    {#if step === 'ready'}
      <!-- Nothing left to skip here, and the receipt is gone: the only thing
           this corner is still good for is the way back. -->
      <button type="button" class="onb-quiet onb-back" onclick={back}>
        <Icon name="back" size={13} />
        Back
      </button>
    {:else if step !== 'welcome'}
      <button type="button" class="onb-quiet" onclick={() => void finish()}>Skip setup</button>
    {/if}
  </header>

  <!-- Every screen is mounted and stacked; moving on pans the whole column up
       by one window height. Nothing is created or destroyed on the way, so the
       step you are leaving is still on screen above the one arriving — which
       is what makes it read as one page being scrolled rather than a slideshow
       swapping cards. -->
  <div class="onb-track" style="transform:translate3d(0,{-offset}px,0)">
    {#each STEPS as name (name)}
      <div
        class="onb-slide"
        class:wide={name === 'platforms'}
        class:mono={name === 'model'}
        class:disc={name === 'ready'}
        style="height:{slideHeight(name)}px"
        aria-hidden={name !== step}
      >
        {#if name === 'welcome'}
          <!-- The same lockup, at the same point, as the startup splash: the
               splash fades out over this and the brand appears not to move.
               Only the Start button enters. -->
          <div class="onb-hero">
            <!-- The button hangs off the lockup, not off the window, so the two
                 can never drift apart while the window is still settling. -->
            <div class="onb-hero-lockup">
              <h1 class="onb-hero-brand">
                <svg class="onb-hero-mark" viewBox="20 30 170 140" aria-hidden="true" focusable="false">
                  <path fill="currentColor" transform="translate(-10 0)" d="M 40 40 L 120 40 A 60 60 0 0 1 120 160 L 40 160 L 70 120 L 110 120 A 20 20 0 0 0 110 80 L 70 80 Z"/>
                </svg>
                <span>Midas</span>
              </h1>
              <button type="button" class="onb-hero-start" onclick={next}>Start</button>
            </div>
          </div>
        {:else if name === 'platforms'}
          <PlatformsStep {api} active={step === 'platforms'} onDone={next} onSkip={next} />
        {:else if name === 'model'}
          <!-- The mind: a field of dots on an exact grid, with something
               moving underneath it. Copy and cards stay on the page's own
               ground — the field is the step's mass, not its container. -->
          <div class="onb-mind">
            <div class="onb-mind-copy">
              <ModelStep {api} onDone={next} onSkip={next} />
            </div>
            <div class="onb-mind-orb" aria-hidden="true">
              <MindOrb active={step === 'model'} />
            </div>
          </div>
        {:else if name === 'permissions'}
          <!-- Three circles arranged around one centred statement, each
               holding a permission. Granting one fills it with ink. The step
               owns the whole composition. -->
          <PermissionsStep {api} onDone={next} onSkip={next} />
        {:else}
          <!-- The one line that ends setup, on the ground that then closes over
               the app. -->
          <div class="onb-disc onb-ink"><div class="onb-disc-inner">
            {#if false}
              <span></span>
            {:else}
              <h1 class="onb-title onb-finale">You're ready to go.</h1>
              <div class="onb-actions onb-actions-centre">
                <button type="button" class="onb-button primary" disabled={finishing} onclick={() => void finish()}>
                  Get started
                </button>
              </div>
            {/if}
          </div></div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Down the left edge, because that is the axis the deck moves on: the
       filled dot travels the same way the screens do. Kept mounted and faded
       rather than added and removed: the rail belongs to setup as a whole, and
       appearing and vanishing on the spot made it read as part of whichever
       screen was arriving. -->
  <ol
    class="onb-dots"
    class:shown={step !== 'welcome'}
    aria-label={`Step ${dotIndex + 1} of ${dotted.length}`}
    aria-hidden={step === 'welcome'}
  >
    {#each dotted as name, position (name)}
      <li>
        <!-- The mark is the dot; the button is a hit area around it, widened
             well past what it draws so the rail can be aimed at without
             changing how thin it looks. -->
        <button
          type="button"
          class="onb-dot"
          class:done={position < dotIndex}
          class:current={position === dotIndex}
          aria-label={`Go to ${STEP_LABELS[name]}`}
          aria-current={position === dotIndex ? 'step' : undefined}
          tabindex={step === 'welcome' ? -1 : 0}
          onclick={() => goto(position)}
        ></button>
      </li>
    {/each}
  </ol>

  {#if closing === 'filling' || closing === 'opening'}
    {#key closing}
      <div
        class="onb-cover"
        class:fill={closing === 'filling'}
        class:hole={closing === 'opening'}
        style="--cover-max:{coverOpen}px"
        aria-hidden="true"
      ></div>
    {/key}
  {/if}

  <footer class="onb-foot">
    {#if index > 0 && step !== 'ready'}
      <button type="button" class="onb-quiet onb-back" onclick={back}>
        <Icon name="back" size={13} />
        Back
      </button>
    {/if}
  </footer>
</section>

<style>
  .onb{position:fixed;inset:0;z-index:60;overflow:hidden;background:var(--app-bg);--cover-ink:#0a0a0a}
  /* The cover is the disc turned inside out, so it is painted in the disc's
     own fill rather than in a colour of its own. */
  :global(:root[data-theme="dark"]) .onb{--cover-ink:#fafafa}
  @media (prefers-color-scheme:dark){
    :global(:root:not([data-theme="light"])) .onb{--cover-ink:#fafafa}
  }

  /* Above the platforms arc, which is painted from a fixed layer at z-index 0. */
  /* Above the platforms arc, which is painted from a fixed layer at z-index 0.
     Empty on the left, where the macOS traffic lights sit over this surface. */
  .onb-chrome{position:absolute;z-index:2;top:0;left:0;right:0;display:flex;align-items:center;justify-content:flex-end;min-height:22px;padding:18px 22px;-webkit-app-region:drag;
    opacity:0;transition:opacity .3s ease .05s}
  .onb.revealed .onb-chrome{opacity:1}
  .onb-chrome button{-webkit-app-region:no-drag}
  /* On the platforms step the hub arc is painted under this bar, so the way out
     is sitting on the inverted surface: it has to take its ink from the arc,
     not from the theme, or the hover lands the same colour as the fill. */
  .onb-chrome.on-hub{--hub-ink:#fff;--hub-ink-soft:rgb(255 255 255 / .64)}
  :global(:root[data-theme="dark"]) .onb-chrome.on-hub{--hub-ink:#0a0a0a;--hub-ink-soft:rgb(10 10 10 / .62)}
  @media (prefers-color-scheme: dark){
    :global(:root:not([data-theme="light"])) .onb-chrome.on-hub{--hub-ink:#0a0a0a;--hub-ink-soft:rgb(10 10 10 / .62)}
  }
  .onb-chrome.on-hub :global(.onb-quiet){color:var(--hub-ink-soft)}
  .onb-chrome.on-hub :global(.onb-quiet:hover){color:var(--hub-ink)}
  .onb-chrome.on-hub :global(.onb-quiet:focus-visible){outline-color:var(--hub-ink)}

  /* The camera. One column of window-tall screens, moved by whole screens; the
     transition on the transform is the pan itself. Absolute rather than a flex
     child so the chrome and the footer float over it instead of stealing
     height from the screens — every slide has to be exactly the window, or the
     platforms arc, which is measured in window pixels, would not line up. */
  .onb-track{position:absolute;inset:0;display:flex;flex-direction:column;
    transition:transform 1.05s cubic-bezier(.62,.02,.24,1)}
  /* Heights come from the script, since they are not all one window. */
  .onb-slide{position:relative;flex:none;width:100%;overflow:hidden;padding:0 22px}
  /* The platforms step measures its own copy from the window's left edge, and
     paints the arc across the whole slide. */
  .onb-slide.wide{padding:0}
  /* The reading column every ordinary step sits in. */

  /* The disc. Literal colours, not scale tokens: the ramp inverts with the
     theme, so `--neutral-950` would follow the disc instead of opposing it —
     the same reason the hub screen states its own. */
  .onb-slide.disc{display:grid;place-items:center;padding:0}
  .onb-disc{display:grid;place-items:center;width:min(94vmin,1040px);aspect-ratio:1;border-radius:50%;
    transform-origin:50% 50%;transition:transform .52s cubic-bezier(.55,0,.3,1),opacity .3s ease}

  /* The mind: copy left on the page's ground, the orb breathing at the right.
     The same composition as the hub — words, then mass — so the deck keeps
     one grammar while every mass stays its own shape. */
  .onb-slide.mono{padding:0}
  /* The row is pinned to the slide's own height. Without that, the canvas
     resolves its 100% height against an auto row, falls back to its intrinsic
     size, and makes the row taller than the slide — which centres the copy
     against a box bigger than the screen and leaves it sitting low. */
  .onb-mind{display:grid;grid-template-columns:minmax(320px,404px) 1fr;grid-template-rows:minmax(0,1fr);
    align-items:center;gap:clamp(16px,3vw,48px);
    height:100%;padding-left:clamp(56px,8.5vw,140px);padding-right:clamp(8px,1.5vw,24px)}
  /* The copy scrolls inside its own column rather than pushing past the top
     and bottom of the window. A step whose content runs long — a provider
     list with everything expanded, say — stays reachable instead of being
     clipped by the deck, and the scrollbar is hidden so nothing appears
     unless there is genuinely more to reach. */
  .onb-mind-copy{min-width:0;min-height:0;max-height:100%;overflow-y:auto;
    scrollbar-width:none;padding-block:clamp(18px,4vh,34px)}
  .onb-mind-copy::-webkit-scrollbar{display:none}
  .onb-mind-orb{align-self:stretch;min-width:0;min-height:0}

  /* Too narrow for two columns: the words are the step, so the orb stands
     down rather than squeezing them into a gutter. */
  @media (max-width:860px){
    .onb-mind{grid-template-columns:minmax(0,1fr);padding-right:clamp(24px,6vw,64px)}
    .onb-mind-orb{display:none}
  }

  /* Kept well inside the rim: a reading column set to the circle's full width
     would have its first and last lines running along the curve. */
  .onb-disc-inner{width:min(430px,58%)}

  /* Leaving, in three beats.
     The squeeze is a clip, not a scale: the rim closes in over words that hold
     their size, swallowing them, rather than the whole screen shrinking like a
     zoom-out. The resting clip matches the disc's own edge so nothing changes
     until the close begins. */
  /* A breath, on `scale` rather than `transform` so it composes with the
     transform the exit already owns instead of fighting it. Under three per
     cent, over seven seconds: felt at the rim, never watched. It runs only
     while this slide is the one on screen, and stops the moment the squeeze
     starts so the close is not scaling and clipping at once. */
  @keyframes onb-disc-breathe{0%,100%{scale:1}50%{scale:1.026}}
  .onb-slide.disc:not([aria-hidden='true']) .onb-disc{animation:onb-disc-breathe 7s ease-in-out infinite}
  .onb.squeezing .onb-disc{animation:none}

  .onb-disc{clip-path:circle(50.5%);transition:clip-path .52s cubic-bezier(.55,0,.3,1)}
  .onb.squeezing .onb-disc{clip-path:circle(0%)}
  /* Then the same circle inverted, twice over: first a solid disc of the same
     ink grows from the same centre until the window is all ink, then a clear
     circle grows in that ink until the app is all that is left. One element
     plays both — solid while filling, and while opening a hole whose shadow
     paints everything outside it, so at size zero the window is still solid
     and the swap between the two beats has no seam. */
  .onb.opening{background:transparent}
  .onb.opening .onb-track,.onb.opening .onb-chrome,.onb.opening .onb-dots,.onb.opening .onb-foot{opacity:0;visibility:hidden}
  /* The cover itself is styled globally, next to its `@property`. */
  /* Fills its own slide rather than the window: inside a moving track, a fixed
     box would sit still while everything around it panned. */
  .onb-hero{position:absolute;inset:0;display:grid;place-items:center}
  /* Metric-for-metric the splash's .startup-brand at its animation's end. */
  .onb-hero-brand{display:flex;align-items:center;gap:12px;margin:0;color:var(--neutral-950)}
  .onb-hero-mark{width:72px;height:59px;display:block}
  .onb-hero-brand span{font-size:48px;font-weight:750;letter-spacing:-.045em;line-height:1;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased}
  /* Measured from the lockup's own box rather than from the window's centre
     line. Both used to be positioned off the viewport independently, so while
     the window was still settling into its restored size the button — the one
     part of the pair that is fading in at that moment, and so the only one you
     can see move — appeared to reseat itself vertically. */
  .onb-hero-lockup{position:relative;display:grid;place-items:center}
  /* Sits well below the lockup rather than tucked under it: the gap is what
     makes it read as the thing to do, not a caption to the name. */
  /* The label is never transformed — text under a scale transform is drawn
     from a bitmap rasterised at some other size, which is what made it soft
     both at rest and mid-hover. Only the pill behind it grows, and a solid
     rounded rect survives that with nothing to lose. */
  .onb-hero-start{position:absolute;top:calc(100% + 102px);left:50%;transform:translateX(-50%);width:max-content;
    isolation:isolate;border:0;border-radius:999px;padding:13px 42px;background:transparent;color:var(--app-bg);
    font-family:inherit;font-size:13px;font-weight:600;letter-spacing:.01em;cursor:pointer;
    transition:opacity .2s;
    opacity:0}
  .onb-hero-start::before{content:'';position:absolute;z-index:-1;inset:0;border-radius:inherit;
    background:var(--neutral-950);
    transition:transform .2s cubic-bezier(.22,1,.36,1);
    will-change:transform;backface-visibility:hidden}
  /* `backwards`, not `both`: a forwards fill would pin opacity at 1 and eat
     the hover's opacity change for as long as the element lives. */
  /* Opacity only. The button arrives where it will stay — a rise would make it
     the one thing moving over a still splash. */
  .onb.revealed .onb-hero-start{opacity:1;animation:onb-fade .9s ease .15s backwards}
  /* Grows in place rather than lifting: the button is the one fixed point on
     this screen, and a rise would read as it coming loose from the lockup. */
  .onb-hero-start:hover{opacity:.92}
  .onb-hero-start:hover::before{transform:scale(1.06)}
  .onb-hero-start:active::before{transform:scale(1.02)}
  .onb-hero-start:focus-visible{outline:2px solid var(--neutral-500);outline-offset:3px}
  @keyframes onb-fade{from{opacity:0}to{opacity:1}}

  .onb-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:26px}
  /* The last screen has one thing to do and no column of choices left to line
     up against, so its button sits on the middle of the receipt. */
  .onb-actions-centre{justify-content:center;margin-top:32px}
  /* The one line on the screen, so it is allowed to be the size of one. */
  .onb-finale{margin:0;font-size:clamp(30px,4.4vmin,44px);line-height:1.08;text-align:center}
  .onb-disc .onb-finale + .onb-actions-centre{margin-top:38px}


  .onb-foot{position:absolute;z-index:2;bottom:0;left:0;right:0;display:flex;align-items:center;min-height:56px;padding:0 22px 20px;pointer-events:none}
  .onb-foot > *{pointer-events:auto}
  .onb-back{display:inline-flex;align-items:center;gap:5px}
  /* A vertical rail on the same axis the deck travels: the filled mark moves
     down the edge exactly as the screens move up past it. */
  .onb-dots{position:absolute;z-index:2;left:24px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;
    opacity:0;pointer-events:none;transition:opacity .38s ease}
  .onb-dots.shown{opacity:1;pointer-events:auto}
  .onb-dots li{display:flex}
  .onb-dot{position:relative;width:5px;height:5px;border:0;padding:0;border-radius:50%;background:var(--neutral-200);cursor:pointer;
    transition:background-color .2s,height .2s}
  /* The target, not the dot: 3px of reach top and bottom is exactly the gap
     between marks, so neighbours meet without ever overlapping and stealing
     each other's clicks, and the rail is wide enough to hit without aiming. */
  .onb-dot::after{content:'';position:absolute;inset:-3px -10px}
  .onb-dot:hover{background:var(--neutral-400)}
  .onb-dot.done{background:var(--neutral-300)}
  .onb-dot.done:hover{background:var(--neutral-500)}
  .onb-dot.current{height:16px;border-radius:3px;background:var(--neutral-900)}
  .onb-dot.current:hover{background:var(--neutral-900)}
  .onb-dot:focus-visible{outline:2px solid var(--neutral-500);outline-offset:3px}

  @media (prefers-reduced-motion:reduce){
    .onb-disc{transition:none}
    .onb-slide.disc:not([aria-hidden='true']) .onb-disc{animation:none}
    .onb.revealed .onb-hero-start{animation:none}
    .onb-track{transition:none}
    .onb-hero-start,.onb-hero-start::before,.onb-chrome{transition:none}
    .onb-dots,.onb-dot{transition:none}
  }
</style>
