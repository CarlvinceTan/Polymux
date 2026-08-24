<script lang="ts">
  import {onMount, setContext} from 'svelte';
  import type {PolymuxApi} from '@polymux/protocol';
  import ImportStep from './ImportStep.svelte';
  import ModelStep from './ModelStep.svelte';
  import PermissionsStep from './PermissionsStep.svelte';
  import PlatformsStep from './PlatformsStep.svelte';
  import MindOrb from './MindOrb.svelte';
  import {t, type MessageKey} from '../../../i18n';

  interface Props {
    api: PolymuxApi;
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

  const STEPS = ['welcome', 'platforms', 'model', 'import', 'permissions', 'ready'] as const;
  type Step = (typeof STEPS)[number];

  let index = $state(0);

  /**
   * The speech-to-text model is fetched while setup is still being read, so
   * voice works on the first press rather than stalling on a download the
   * moment it is wanted. It runs behind the screens with nothing to show for
   * itself: it costs a one-off ~148MB, it is finished long before setup is,
   * and if it fails there is a step here that never mentioned it.
   */
  onMount(() => void api.dictation.prepare().catch(() => {}));

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
  /**
   * The mind screen is taller than the window for the same reason the hub is:
   * the two small discs above and below its big one are cut by the window when
   * the camera is parked, and a screen exactly one window high would have
   * nowhere to keep the rest of them. Given the room they live inside their own
   * screen whole, and the pan is what reveals them — while the slide's own clip
   * keeps them from ever showing up on the screens either side.
   */
  const MIND_OVERHANG = $derived(Math.round(winH * 0.6));
  const slideHeight = $derived((name: Step) =>
    name === 'platforms' ? winH + OVERHANG
    : name === 'model' ? winH + MIND_OVERHANG
    : winH,
  );
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
   * grows from the same centre until the window is all ink. `opening` then
   * thins that ink away to nothing over the same stretch. The app is mounted
   * underneath this screen already, so the reveal is real rather than a
   * picture of one.
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
  /** The deck's own element, so the wheel can be taken non-passively. */
  let root = $state<HTMLElement | null>(null);

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

  /**
   * The deck also answers the wheel, but as a deck rather than as a page: one
   * gesture moves one screen, whole, and the pan is the same one the buttons
   * and the rail play. Nothing is dragged under the finger, so a long flick
   * cannot fall two screens at once — the pan holds the wheel off until it has
   * landed and the gesture that started it has died down.
   *
   * The travel of the pan itself, plus a beat for the tail of a trackpad
   * flick, which keeps sending events long after the fingers have left.
   *
   * The wheel re-arms a little before the pan lands, so someone moving through
   * the deck at pace is not made to wait on the last of the settle. It is only
   * the tail end: earlier than that and the screen being scrolled away from is
   * still the one on the screen, so the step would read as coming from nowhere.
   */
  const PAN_MS = 1050;
  const PAN_ARM_MS = PAN_MS - 220;
  const GESTURE_QUIET_MS = 260;

  /**
   * Which screen the corner is dressed for. It follows the deck a pan behind:
   * the deck is a camera move and the chrome sits still above it, so a control
   * fading in or out mid-travel reads as a second, unrelated animation
   * competing with the pan. Letting the corner change only once the screens are
   * at rest keeps the two apart — the deck moves, then the corner settles.
   *
   * Started a fade before the pan lands, so the control it brings in is fully
   * there the moment the screens stop rather than still arriving after them.
   */
  const CORNER_FADE_MS = 240;
  /**
   * How far before the pan lands the corner is finished. Enough that the
   * control has plainly settled while the screens are still coasting to a
   * stop, rather than the two finishing on the same frame.
   */
  const CORNER_LEAD_MS = 260;
  let settled = $state(0);
  $effect(() => {
    const arriving = index;
    const landed = setTimeout(() => {
      settled = arriving;
    }, Math.max(0, PAN_MS - CORNER_FADE_MS - CORNER_LEAD_MS));
    return () => clearTimeout(landed);
  });

  /**
   * The corner carries one control, and which one depends on where setup is.
   * Nothing to skip on the opening screen, where setup has not been proposed
   * yet; nothing to skip on the closing one either, where it is all behind you
   * — that screen has only somewhere to go back to, and the way back rides the
   * corner there rather than crowding the one button that ends setup.
   */
  /**
   * The exception to waiting for the deck: on the way to either end of it, the
   * corner lets go straight away. It sits still while the screens travel, so
   * holding it across a pan onto the opening or closing screen reads as the
   * button following you onto a screen it has no business on — better it fades
   * where it stands and stays behind with the step it belongs to. Between
   * steps it does hold, since it is on duty at both ends of that pan.
   */
  const skippable = $derived(
    index > 0 && index < STEPS.length - 1 && settled > 0 && settled < STEPS.length - 1,
  );
  /**
   * Gone the moment Get started is pressed: setup is on its way out, and a way
   * back to a screen that is being closed over is a control with nowhere to
   * lead. It fades rather than disappears, over the beat before the disc
   * squeezes shut.
   *
   * And gone the moment it is used, for the same reason the skip does at the
   * ends of the deck: the corner sits still while the screens travel, so it
   * fades where it stands rather than riding the pan back to a step it does
   * not belong to. The skip then takes the cell once that pan has landed.
   */
  const cornerBack = $derived(
    index === STEPS.length - 1 && settled === STEPS.length - 1 && !finishing,
  );

  /** Enough that a nudge is not a step, low enough that a flick always is. */
  const WHEEL_THRESHOLD = 22;
  /**
   * Momentum arrives as an unbroken stream of shrinking deltas, so a gap or a
   * delta that grows again is the hand back on the pad. Only the tail of the
   * old flick is allowed to hold the deck off; a real new gesture takes it back
   * immediately, rather than waiting out an inertia it had nothing to do with.
   */
  const INERTIA_GAP_MS = 90;
  const INERTIA_RISE = 1.3;
  let travelling = false;
  let unlockAt = 0;
  let rolled = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let lastAt = 0;
  let lastMagnitude = 0;
  /** Whether the gesture in progress belongs to a scroller under the pointer. */
  let surrendered = false;

  function wheel(event: WheelEvent): void {
    // The finale is the end of the deck forwards, but not backwards: scrolling
    // up off it returns to the last step it was reached from.
    if (closing !== '' || (step === 'ready' && event.deltaY > 0)) return;
    const now = Date.now();
    const magnitude = Math.abs(event.deltaY);
    const started = now - lastAt > INERTIA_GAP_MS || magnitude > lastMagnitude * INERTIA_RISE;
    lastAt = now;
    lastMagnitude = magnitude;
    // A list under the pointer keeps its own wheel, and keeps it for the rest
    // of the gesture: the tail of a flick that scrolled a list to its end must
    // not carry on into the deck.
    if (started) surrendered = scrollable(event.target as Element | null);
    if (surrendered) return;
    event.preventDefault();
    // Still panning: nothing is taken, and only coasting keeps the hold alive.
    if (travelling) {
      if (!started) unlockAt = now + GESTURE_QUIET_MS;
      return;
    }
    if (now < unlockAt) {
      // Coasting off the last flick — hold, and keep holding while it coasts.
      if (!started) {
        unlockAt = now + GESTURE_QUIET_MS;
        return;
      }
      // A gesture of its own: the hold was never about this one.
      unlockAt = 0;
      rolled = 0;
    }
    rolled += event.deltaY;
    // The gesture is over when the events stop, whether or not it moved far
    // enough — otherwise two unrelated nudges add up into a step.
    clearTimeout(settle);
    settle = setTimeout(() => (rolled = 0), GESTURE_QUIET_MS);
    if (Math.abs(rolled) < WHEEL_THRESHOLD) return;
    const forward = rolled > 0;
    rolled = 0;
    if (forward ? index >= STEPS.length - 1 : index <= 0) return;
    travelling = true;
    unlockAt = now + PAN_ARM_MS + GESTURE_QUIET_MS;
    setTimeout(() => (travelling = false), PAN_ARM_MS);
    if (forward) next();
    else back();
  }

  // Bound by hand: the handler refuses the browser's own scroll, and that is
  // only allowed of a listener registered as willing to.
  $effect(() => {
    const node = root;
    if (!node) return;
    node.addEventListener('wheel', wheel, {passive: false});
    return () => node.removeEventListener('wheel', wheel);
  });

  /**
   * Whether the pointer is over a list of its own. A scroller keeps the wheel
   * whichever way it is turned and wherever it currently sits: the ends of a
   * list are not a way through to the deck, or a mouse — whose every notch is
   * a gesture of its own — would step the deck the moment the list ran out,
   * and a list that opens at its top could never be scrolled up at all.
   * The deck is moved from anywhere else on the screen, which is most of it.
   */
  function scrollable(from: Element | null): boolean {
    for (let node = from; node && node !== document.body; node = node.parentElement) {
      // The screen's own copy column scrolls when a step outgrows the window,
      // but it is the screen — the wheel over its heading, its note or its
      // buttons belongs to the deck, as it does over any other part of the
      // page. Only a list drawn inside a step counts as having a wheel of its
      // own, so the walk stops at the slide.
      if (node.classList.contains('onb-slide')) return false;
      if (node.classList.contains('onb-mind-copy')) continue;
      const room = node.scrollHeight - node.clientHeight;
      if (room > 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return true;
    }
    return false;
  }

  /**
   * Past the whole of setup, not one screen of it: the deck pans from wherever
   * it is to the closing screen, over every step in between, so leaving reads
   * as scrolling to the end rather than as the window being closed. Nothing is
   * answered on the way — the steps passed over keep whatever they had.
   */
  function skipSetup(): void {
    index = STEPS.length - 1;
  }

  // Every step carries its own way back, in its own action row. The handler is
  // handed down rather than passed as a prop so a step can place it wherever
  // its actions live without every step needing to thread it through.
  setContext('onb-deck', {back});

  /** What the rail's dots are called out loud. */
  const STEP_LABELS: Record<Step, MessageKey> = {
    welcome: 'onboarding.stepWelcome',
    platforms: 'onboarding.stepAccounts',
    model: 'onboarding.stepModel',
    import: 'onboarding.stepImport',
    permissions: 'onboarding.stepPermissions',
    ready: 'onboarding.stepSummary',
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
  aria-label={$t('onboarding.title')}
  bind:this={root}
>
  <!-- No brand lockup here: setup already says Polymux on the welcome screen,
       and after that the name in the corner is just furniture. The bar stays
       for the drag region and the way out. -->
  <header class="onb-chrome" class:on-hub={step === 'platforms'}>
    <!-- The corner holds whichever secondary action the screen has: the way out
         while setup is still being answered, and the way back once it is over.
         They are stacked on the one spot rather than laid out side by side, so
         the two never shift each other and each can fade in its own time —
         being used is never what makes one vanish. -->
    <div class="onb-corner">
      <button
        type="button"
        class="onb-quiet onb-skip-setup"
        class:shown={skippable}
        tabindex={skippable ? 0 : -1}
        aria-hidden={!skippable}
        onclick={skipSetup}
      >
        <!-- Two prints of the same word, one over the other: the hub's is
             drawn as the difference against the arc behind it, the other in
             plain ink. Crossing between the two screens fades one into the
             other, so the colour arrives with the pan rather than flipping the
             moment the step changes. -->
        <span class="onb-corner-label">
          <span class="ink">{$t('onboarding.skipSetup')}</span>
          <span class="lit" aria-hidden="true">{$t('onboarding.skipSetup')}</span>
        </span>
      </button>
      <button
        type="button"
        class="onb-quiet onb-skip-setup"
        class:shown={cornerBack}
        tabindex={cornerBack ? 0 : -1}
        aria-hidden={!cornerBack}
        onclick={back}
      >
        <span class="onb-corner-label">
          <span class="ink">{$t('onboarding.back')}</span>
          <span class="lit" aria-hidden="true">{$t('onboarding.back')}</span>
        </span>
      </button>
    </div>
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
                <svg class="onb-hero-mark" viewBox="41.41 15.26 99.21 99.19" aria-hidden="true" focusable="false">
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
                </svg>
                <span>Polymux</span>
              </h1>
              <button type="button" class="onb-hero-start" onclick={next}>{$t('onboarding.start')}</button>
            </div>
          </div>
        {:else if name === 'platforms'}
          <PlatformsStep {api} active={step === 'platforms'} onDone={next} />
        {:else if name === 'model'}
          <!-- The mind: a field of dots on an exact grid, with something
               moving underneath it. Copy and cards stay on the page's own
               ground — the field is the step's mass, not its container. -->
          <div class="onb-mind" style="height:{winH}px">
            <div class="onb-mind-copy">
              <ModelStep {api} onDone={next} />
            </div>
            <!-- The orb over its own ground: one disc under it, and a smaller
                 one off each end of the column, cut by the window until the
                 camera moves off this screen. -->
            <div class="onb-mind-orb" aria-hidden="true">
              <span class="mind-disc big"></span>
              <span class="mind-disc pip top"></span>
              <span class="mind-disc pip bottom"></span>
              <MindOrb active={step === 'model'} />
            </div>
          </div>
        {:else if name === 'import'}
          <ImportStep {api} {preview} onDone={next} />
        {:else if name === 'permissions'}
          <!-- Three circles arranged around one centred statement, each
               holding a permission. Granting one fills it with ink. The step
               owns the whole composition. -->
          <PermissionsStep {api} onDone={next} />
        {:else}
          <!-- The one line that ends setup, on the ground that then closes over
               the app. -->
          <div class="onb-disc onb-ink"><div class="onb-disc-inner">
            <h1 class="onb-title onb-finale">{$t('onboarding.ready')}</h1>
            <div class="onb-actions onb-actions-centre">
              <!-- The one thing left to do, alone on the disc. Skipping setup
                   lands here, so the steps passed over stay reachable — but
                   from the window's corner, where the way out was, rather than
                   from beside the button that ends setup. -->
              <button type="button" class="onb-button primary" disabled={finishing} onclick={() => void finish()}>
                {$t('onboarding.getStarted')}
              </button>
            </div>
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
    class:on-ink={step === 'permissions'}
    aria-label={$t('onboarding.stepOf', {step: dotIndex + 1, total: dotted.length})}
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
          aria-label={$t('onboarding.goToStep', {step: $t(STEP_LABELS[name])})}
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

</section>

<style>
  .onb{position:fixed;inset:0;z-index:60;overflow:hidden;background:var(--app-bg);--cover-ink:#0a0a0a;--cover-on-ink:#fff}
  /* The cover is the disc turned inside out, so it is painted in the disc's
     own fill rather than in a colour of its own. */
  :global(:root[data-theme="dark"]) .onb{--cover-ink:#fafafa;--cover-on-ink:#0a0a0a}
  @media (prefers-color-scheme:dark){
    :global(:root:not([data-theme="light"])) .onb{--cover-ink:#fafafa;--cover-on-ink:#0a0a0a}
  }

  /* Above the platforms arc, which is painted from a fixed layer at z-index 0.
     Empty on the left, where the macOS traffic lights sit over this surface. */
  .onb-chrome{position:absolute;z-index:2;top:0;left:0;right:0;display:flex;align-items:center;justify-content:flex-end;min-height:22px;padding:18px 22px;-webkit-app-region:drag;
    opacity:0;transition:opacity .3s ease .05s}
  .onb.revealed .onb-chrome{opacity:1}
  .onb-chrome button{-webkit-app-region:no-drag}
  /* One cell, both controls in it: they cross-fade in place instead of sliding
     each other along the bar, and the corner keeps the width of whichever is
     the wider of the two. */
  .onb-corner{display:grid;justify-items:end;align-items:center}
  .onb-corner>*{grid-area:1/1}
  /* Matches CORNER_FADE_MS above: the two are one timing. */
  .onb-skip-setup{opacity:0;pointer-events:none;transition:opacity .24s ease}
  .onb-skip-setup.shown{opacity:1;pointer-events:auto}
  /* On the platforms step the arc may or may not have reached this corner,
     depending on how wide the window is, so the corner cannot be given one
     colour: drawn as the difference against whatever is behind it, it comes out
     dark on the page and light on the arc without having to know which.
     Blend modes do not interpolate, so the change is carried by two prints of
     the word fading past each other over the length of the pan — the corner
     changes colour as the screens travel, in either direction. */
  .onb-corner-label{display:grid;justify-items:end;align-items:center}
  .onb-corner-label>*{grid-area:1/1;transition:opacity .62s ease}
  .onb-corner-label .lit{color:var(--cover-on-ink);opacity:0}
  .onb-chrome.on-hub .onb-corner-label .ink{opacity:0}
  .onb-chrome.on-hub .onb-corner-label .lit{opacity:1}

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
  .onb-slide.mono{display:grid;place-items:center;padding:0}
  /* The row is pinned to the slide's own height. Without that, the canvas
     resolves its 100% height against an auto row, falls back to its intrinsic
     size, and makes the row taller than the slide — which centres the copy
     against a box bigger than the screen and leaves it sitting low. */
  .onb-mind{display:grid;grid-template-columns:minmax(320px,404px) 1fr;grid-template-rows:minmax(0,1fr);
    align-items:center;gap:clamp(16px,3vw,48px);
    width:100%;padding-left:clamp(56px,8.5vw,140px);padding-right:clamp(8px,1.5vw,24px)}
  /* The copy scrolls inside its own column rather than pushing past the top
     and bottom of the window. A step whose content runs long — a provider
     list with everything expanded, say — stays reachable instead of being
     clipped by the deck, and the scrollbar is hidden so nothing appears
     unless there is genuinely more to reach.

     A scroller clips both axes, not just the one it scrolls, so the column
     also carries side padding cancelled by an equal negative margin: the
     provider cards swell past their own box on hover, and without that slack
     the clip edge sheared the outermost ones.

     The top of that padding is the heavier half: a column long enough to
     scroll starts at its own top edge, and an eyebrow sitting level with the
     traffic lights reads as crowding them rather than as the start of a
     page. */
  /* Dropped below the true centre line by however much it takes to put the
     step's own grid on it — the step measures that and sets --mind-shift. A
     transform rather than a margin, so it changes neither the column's height
     nor how much of it the scroller can reach, and so the measurement cannot
     chase its own result. */
  .onb-mind-copy{min-width:0;min-height:0;max-height:100%;overflow-y:auto;
    scrollbar-width:none;padding-block:clamp(44px,8vh,78px) clamp(18px,4vh,34px);
    padding-inline:10px;margin-inline:-10px;transform:translateY(var(--mind-shift,0px))}
  .onb-mind-copy::-webkit-scrollbar{display:none}
  .onb-mind-orb{position:relative;align-self:stretch;min-width:0;min-height:0;display:grid;place-items:center;
    --mind-disc:clamp(240px,56vmin,520px);--mind-pip:calc(var(--mind-disc) * .42)}
  /* Drawn from the column's centre line, which is the orb's own axis, so the
     three read as one stack however wide the window gets. */
  .mind-disc{position:absolute;left:50%;border-radius:50%;background:var(--neutral-950);
    transform:translate(-50%,-50%);pointer-events:none}
  .mind-disc.big{top:50%;width:var(--mind-disc);height:var(--mind-disc)}
  .mind-disc.pip{width:var(--mind-pip);height:var(--mind-pip)}
  /* A tenth of the way past the window's edge: enough of each one is missing
     that the screen reads as a view onto something taller than itself. */
  .mind-disc.pip.top{top:calc(var(--mind-pip) * .1)}
  .mind-disc.pip.bottom{top:calc(100% - var(--mind-pip) * .1)}
  /* The cloud paints over its ground, never under it. */
  .onb-mind-orb :global(.mind-orb){position:relative;z-index:1}

  /* Too narrow for two columns: the words are the step, so the orb stands
     down rather than squeezing them into a gutter. */
  @media (max-width:860px){
    .onb-mind{grid-template-columns:minmax(0,1fr);padding-right:clamp(24px,6vw,64px)}
    .onb-mind-orb{display:none}
  }

  /* Kept well inside the rim: a reading column set to the circle's full width
     would have its first and last lines running along the curve. */
  /* The line is what the screen is, so it takes the disc's own centre; the
     button hangs off it rather than sharing the centring, which would push the
     words up by half the button's height. */
  .onb-disc-inner{position:relative;width:min(430px,58%)}

  /* Leaving, in three beats.
     The squeeze is a clip, not a scale: the rim closes in over words that hold
     their size, swallowing them, rather than the whole screen shrinking like a
     zoom-out. The resting clip matches the disc's own edge so nothing changes
     until the close begins. */
  /* A breath, on `scale` rather than `transform` so it composes with the
     transform the exit already owns instead of fighting it. Just under four
     per cent, over seven seconds: enough travel at the rim to be seen if you
     look for it, still slow enough not to ask to be watched. It runs only
     while this slide is the one on screen, and stops the moment the squeeze
     starts so the close is not scaling and clipping at once. */
  @keyframes onb-disc-breathe{0%,100%{scale:1}50%{scale:1.038}}
  .onb-slide.disc:not([aria-hidden='true']) .onb-disc{animation:onb-disc-breathe 7s ease-in-out infinite}
  .onb.squeezing .onb-disc{animation:none}

  .onb-disc{clip-path:circle(50.5%);transition:clip-path .52s cubic-bezier(.55,0,.3,1)}
  .onb.squeezing .onb-disc{clip-path:circle(0%)}
  /* Then the same circle inverted: a solid disc of the same ink grows from the
     same centre until the window is all ink, and that ink then fades off to
     leave the app. One element plays both — the growing disc while filling,
     a full-bleed sheet while opening, so the swap between the two beats has
     no seam. */
  .onb.opening{background:transparent}
  .onb.opening .onb-track,.onb.opening .onb-chrome,.onb.opening .onb-dots{opacity:0;visibility:hidden}
  /* The cover itself is styled globally, next to its `@property`. */
  /* Fills its own slide rather than the window: inside a moving track, a fixed
     box would sit still while everything around it panned. */
  .onb-hero{position:absolute;inset:0;display:grid;place-items:center}
  /* Metric-for-metric the splash's .startup-brand at its animation's end. */
  .onb-hero-brand{display:flex;align-items:center;gap:12px;margin:0;color:var(--neutral-950)}
  .onb-hero-mark{width:64px;height:64px;display:block}
  .onb-hero-brand span{font-size:48px;font-weight:750;letter-spacing:-.045em;line-height:1;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased}
  /* Measured from the lockup's own box rather than from the window's centre
     line. Both used to be positioned off the viewport independently, so while
     the window was still settling into its restored size the button — the one
     part of the pair that is fading in at that moment, and so the only one you
     can see move — appeared to reseat itself vertically. */
  /* Snapped to the pixel grid the same way, and for the same reason, as the
     startup splash's lockup (see `.startup-brand` in style.css): centring puts
     this at x.703 whatever the window size, because the wordmark's advance is
     not a whole number, and a mark that straddles device pixels has every edge
     spread over two of them. It has to be snapped here as well as there — the
     splash fades out over this one, and two lockups three quarters of a pixel
     apart cross-fade as a blur rather than as one brand standing still. */
  .onb-hero-lockup{position:relative;display:grid;place-items:center;
    transform:translateX(calc(round(down, (100vw - 100%) / 2, 1px) - (100vw - 100%) / 2))}
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
     the one thing moving over a still splash.

     The delay is measured from the moment the splash starts lifting, which is
     also the moment the lockup has finished settling — and the cover takes
     .24s to fade from there. So anything shorter than that has the button
     arriving through a splash still on screen, on top of the brand's own last
     beat. Clearing it by a further fifth of a second leaves the two as separate
     events: the brand settles and the window opens, and then the button is
     there. */
  .onb.revealed .onb-hero-start{opacity:1;animation:onb-fade .5s ease .44s backwards}
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
  .onb-disc .onb-finale + .onb-actions-centre{position:absolute;top:100%;left:0;right:0;margin-top:46px}


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
  /* The permissions step puts a disc behind the rail, so the marks change
     ground: over ink they are drawn in the page's own background instead. */
  .onb-dots.on-ink .onb-dot{background:rgb(255 255 255 / .38)}
  .onb-dots.on-ink .onb-dot.done{background:rgb(255 255 255 / .6)}
  .onb-dots.on-ink .onb-dot.current,.onb-dots.on-ink .onb-dot:hover{background:#fff}
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
    .onb-corner-label>*{transition:none}
    .onb-dots,.onb-dot{transition:none}
  }
</style>
