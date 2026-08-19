<script lang="ts">
  import {untrack} from 'svelte';
  import type {
    CommsLoginStepDto,
    CommsPlatform,
    CommsStatusDto,
    FlareAIApi,
    SystemPermissionKind,
  } from '@flareai/protocol';
  import {COMMS_EMAIL_PRESETS, permissionPrompts, presetForHost} from '@flareai/protocol';
  import {readableError} from '../../shared/errors';
  import {invalidateHubCache} from '../../shared/state/hubCache';
  import {qrSvgPath} from '../../shared/qr';
  import {bridgeLogo, mailLogo} from '../../shared/options/platformBrands';
  import {emailPresetHint, qrInstructions} from '../../../i18n/names';
  import {plural, t} from '../../../i18n';
  import Icon from '../../shared/components/Icon.svelte';
  import BackAction from './BackAction.svelte';

  interface Props {
    api: FlareAIApi;
    onDone: (reach: {messaging: string[]; mail: string[]}) => void;
    /**
     * False while this step is parked off screen. Every step of setup is
     * mounted at once so the deck can pan between them, so the ring has to be
     * told when it is actually being looked at: its entrance is worth nothing
     * played to an empty room, and neither is a rAF loop.
     */
    active?: boolean;
  }

  const {api, onDone, active: onCamera = true}: Props = $props();

  /**
   * One seat on the arc. Messaging and mail are different machinery behind the
   * scenes, but to the person setting FlareAI up they are the same decision —
   * "give it this account" — so they share one ring.
   */
  interface Seat {
    key: string;
    kind: 'messaging' | 'mail';
    name: string;
    /** The company's own logo, or null when we ship no artwork for it. */
    logo: string | null;
    /** Stand-in for a missing brand mark. */
    initial: string;
    /** Set for messaging seats only. */
    platform?: CommsPlatform;
  }

  let status = $state<CommsStatusDto | null>(null);
  let busy = $state('');
  let error = $state('');
  /** The seat whose panel is open, if any. */
  let open = $state<string>('');
  /** The seat under the pointer or keyboard focus. */
  let hovered = $state<string>('');
  let hoverRelease: ReturnType<typeof setTimeout> | undefined;

  /**
   * Whether the pointer has moved of its own accord since the step slid into
   * view. The camera pans the ring up to a cursor that never left the middle
   * of the window, so a seat arrives *under* the pointer and fires
   * `mouseenter` without the user having reached for anything — the disc would
   * open on whichever logo happened to drift past. Until a real move, the ring
   * ignores the pointer; focus and clicks are unaffected, being deliberate by
   * definition.
   */
  let pointerArmed = $state(false);

  $effect(() => {
    if (!onCamera) {
      pointerArmed = false;
      return;
    }
    // Scrolling content under a still cursor can itself emit `pointermove`, so
    // the first event only records where the pointer already was; arming waits
    // for a position that actually differs from it.
    let from: {x: number; y: number} | null = null;
    const moved = (event: PointerEvent): void => {
      if (from && (Math.abs(event.clientX - from.x) > 2 || Math.abs(event.clientY - from.y) > 2)) {
        pointerArmed = true;
        return;
      }
      from = {x: event.clientX, y: event.clientY};
    };
    const pressed = (): void => {
      pointerArmed = true;
    };
    window.addEventListener('pointermove', moved, {passive: true});
    window.addEventListener('pointerdown', pressed, {capture: true, passive: true});
    return () => {
      window.removeEventListener('pointermove', moved);
      window.removeEventListener('pointerdown', pressed, {capture: true});
    };
  });

  /** Points the panel at a seat, cancelling any release already scheduled. */
  function hoverOn(key: string, viaPointer = false): void {
    if (viaPointer && !pointerArmed) return;
    clearTimeout(hoverRelease);
    hovered = key;
    // Hovering is the earliest honest signal that this platform is wanted, so
    // its bridge starts now rather than on the click. A bridge takes well under
    // a tenth of a second to answer, and spending that during the reach for the
    // seat means the panel has its login methods before the click lands.
    void woken(seatsByKey.find((seat) => seat.key === key)?.platform);
  }

  /**
   * Platforms already asked for this session. A bridge only has to be started
   * once, and hovering along the ring must not re-ask for every seat the
   * pointer crosses.
   */
  const wokenPlatforms = new Set<CommsPlatform>();

  async function woken(platform: CommsPlatform | undefined): Promise<void> {
    if (!platform || wokenPlatforms.has(platform)) return;
    wokenPlatforms.add(platform);
    const next = await api.comms.wake(platform).catch((): null => null);
    if (next) status = next;
  }

  /**
   * Fades a scroller's top and bottom edges so it reads as having more to see.
   * The fade only appears on the side that actually has more: laid over the
   * first row when nothing is above it, it stops being a hint and just makes
   * that row look dimmed.
   *
   * Written to custom properties rather than classes because the component's
   * CSS is scoped — a class added from script has no hash on it and the rule
   * would be compiled away as unused.
   */
  function fadeEdges(node: HTMLElement, _content: string | number) {
    const update = (): void => {
      const room = node.scrollHeight - node.clientHeight;
      // Sub-pixel scroll positions never land exactly on the ends.
      node.style.setProperty('--fade-top', room > 1 && node.scrollTop > 1 ? '1' : '0');
      node.style.setProperty(
        '--fade-bottom',
        room > 1 && node.scrollTop < room - 1 ? '1' : '0',
      );
    };
    update();
    node.addEventListener('scroll', update, {passive: true});
    // Catches the panel being resized; the `update` below catches content
    // arriving, which does not resize a scroller already at its cap.
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return {
      update: () => requestAnimationFrame(update),
      destroy: () => {
        node.removeEventListener('scroll', update);
        observer.disconnect();
      },
    };
  }

  /**
   * Crossfades the disc's contents when it starts showing a different platform.
   * Hovering along the ring swaps the whole panel at once, and the hard cut
   * read as a flicker.
   *
   * Both halves are needed for it to read as one movement, so the panel holds
   * the platform it is already showing (`shownKey`) until the old contents have
   * faded out, and only then renders the new ones — which fade back in through
   * the action below. Swapping first and fading second would mean fading in
   * from nothing, which is the same cut with a delay in front of it.
   */
  const SWAP_OUT_MS = 110;
  const SWAP_IN_MS = 190;
  let faceEl = $state<HTMLElement>();
  let shownKey = $state('');
  let swapping = false;
  let swapped = false;
  $effect(() => {
    const to = activeKey;
    if (to === shownKey || swapping) return;
    // The first pass has nothing on screen to fade out of; a flow moving on a
    // step keeps the same key, so that redraws in place as before.
    if (!swapped || !faceEl) {
      swapped = true;
      shownKey = to;
      return;
    }
    swapping = true;
    const node = faceEl;
    node
      .animate([{opacity: restOpacity}, {opacity: 0}], {
        duration: SWAP_OUT_MS,
        easing: 'ease-in',
      })
      .finished.catch(() => {})
      // Whatever is hovered *now*, not when the fade started: the pointer may
      // have crossed two more seats in the meantime.
      .finally(() => {
        swapping = false;
        shownKey = activeKey;
      });
  });

  /** The incoming half of the crossfade: see the effect above. */
  function fadeSwap(node: HTMLElement, _key: string) {
    const play = (): void => {
      node.animate(
        [
          {opacity: 0, transform: 'translateY(-50%) translateY(5px)'},
          {opacity: restOpacity, transform: 'translateY(-50%)'},
        ],
        {duration: SWAP_IN_MS, easing: 'cubic-bezier(.22,.61,.36,1)'},
      );
    };
    return {update: play};
  }

  /**
   * Hands the panel back once the pointer has actually left — not the instant
   * it crosses a seat's edge. Reaching the panel's button means travelling
   * over the gap between the ring and the disc, and a panel that closed on the
   * way would take the button with it. Entering the panel cancels the release.
   */
  function hoverOff(): void {
    clearTimeout(hoverRelease);
    hoverRelease = setTimeout(() => (hovered = ''), 180);
  }

  let step = $state<CommsLoginStepDto | null>(null);
  let linking = $state<CommsPlatform | ''>('');
  /**
   * The platform whose login has just been confirmed and whose account has not
   * shown up on the fleet's status yet. The flow says `complete` the moment the
   * phone confirms, but the bridge takes a beat longer to report the account —
   * and in that gap the panel had nothing to show but the log-in button it
   * started from, which read as a scan that had failed.
   */
  let settling = $state<CommsPlatform | ''>('');
  /** A grant is being asked for, so its button reads as busy rather than idle. */
  let granting = $state(false);
  let values = $state<Record<string, string>>({});
  let stepError = $state('');

  let email = $state('');
  let password = $state('');
  /** Values for a bridge's own configuration, e.g. Telegram's api_id pair. */
  let setupValues = $state<Record<string, string>>({});
  /** Which of the platform's login methods is on screen. */
  let activeFlow = $state('');
  /** Only asked for on the custom seat, where no preset can fill them in. */
  let imapHost = $state('');
  let smtpHost = $state('');

  const hub = $derived(status?.hub ?? null);
  const connected = $derived(hub?.status === 'signed-in');
  /**
   * Every platform the hub knows about, in the order the catalogue lists them.
   * Nothing is filtered out: before the hub starts, the backend reports the
   * whole fleet as `unreachable`, and hiding those would leave the ring empty
   * on exactly the screen whose job is to show what the hub covers. A seat
   * that cannot be linked yet says so when it is opened.
   */
  const bridges = $derived(status?.bridges ?? []);
  const mailAccounts = $derived(status?.email.accounts ?? []);
  const mailSignInProviders = $derived(status?.email.signInProviders ?? []);
  /**
   * Short seat names. The preset labels carry their alternates ("Gmail /
   * Google Workspace", "iCloud Mail") which read as clutter next to a logo,
   * and "custom" is any other IMAP server — a mailbox, not a brand.
   */
  const MAIL_NAMES: Record<string, string> = {
    gmail: 'Gmail',
    outlook: 'Outlook',
    icloud: 'iCloud',
    lark: 'Lark',
    fastmail: 'Fastmail',
    custom: 'Mail',
  };
  /**
   * Only the ones worth choosing between.
   *
   * A provider that is an app password and a hostname is what "Other" already
   * is, so a pill for it said nothing; its ports are still applied from the
   * host that gets typed in. Gmail and Outlook drop out too — but only once
   * their sign-in is actually on offer, because a build with no client
   * registered would otherwise leave those mailboxes with no way in at all.
   */
  const mailPresets = $derived(
    COMMS_EMAIL_PRESETS.filter(
      (item) =>
        !item.hidden &&
        !(item.value === 'gmail' && mailSignInProviders.includes('google')) &&
        !(item.value === 'outlook' && mailSignInProviders.includes('microsoft')),
    ),
  );

  const seats = $derived<Seat[]>([
    ...bridges.map((bridge) => ({
      key: `chat:${bridge.platform}`,
      kind: 'messaging' as const,
      name: bridge.name,
      logo: bridgeLogo(bridge.platform),
      initial: bridge.name.trim().charAt(0).toUpperCase(),
      platform: bridge.platform,
    })),
    // One seat, because mail is the platform. Gmail, Lark and the rest are
    // providers of it, not networks of their own: what FlareAI connects to is
    // IMAP either way, so a seat each would put five logos on the ring for one
    // capability — and file a Lark-hosted mailbox under "Lark" as though the
    // messaging side had been linked, which it has not.
    {
      key: 'mail',
      kind: 'mail' as const,
      name: $t('hub.mail'),
      logo: mailLogo('custom'),
      initial: 'M',
    },
  ]);

  /**
   * Keyed by platform, so a backend that reported the same one twice would
   * otherwise take the whole ring down with a duplicate-key error. Setup is
   * the worst place to be brittle about a status payload.
   */
  const seatsByKey = $derived([...new Map(seats.map((seat) => [seat.key, seat])).values()]);

  /**
   * The seat a login belongs to, if any — including one that is still settling,
   * so the panel keeps facing the platform that was just signed in rather than
   * handing itself back to whatever the pointer is resting on.
   */
  const flowKey = $derived(
    linking || settling
      ? (seatsByKey.find((seat) => seat.platform === (linking || settling))?.key ?? '')
      : '',
  );
  /**
   * Which seat the panel is showing. A chosen seat holds it until another is
   * chosen: once you are reading a QR or filling in a field, the pointer
   * wandering across the ring — on its way to that very field — must not swap
   * the panel out from under you. Hovering only leads while nothing is chosen,
   * where it is the fastest way to read down the ring.
   */
  const activeKey = $derived(open || ((step || settling) && flowKey ? flowKey : hovered));
  // `shownKey` trails `activeKey` by the length of the fade-out; the panel's
  // contents follow what is on screen, the ring follows the pointer.
  const active = $derived(seatsByKey.find((seat) => seat.key === shownKey) ?? null);
  /**
   * The opacity the panel rests at. Full, in every state: held back at .75 the
   * copy on the disc went grey rather than white, and the state with nothing
   * chosen — the one the panel spends the most time in — was the greyest of
   * them. Both halves of the fade land on this exact value, so the animation
   * ends where the stylesheet leaves it rather than stepping on the last frame.
   */
  const restOpacity = 1;
  const activeBridge = $derived(
    active?.platform ? (bridges.find((bridge) => bridge.platform === active.platform) ?? null) : null,
  );
  /**
   * Which provider the add-mailbox form is filling in for. It used to be
   * whichever seat you clicked; with one mail seat it is a choice inside the
   * form, which is where it belongs — it only ever decided which server names
   * to prefill.
   */
  // Starts on whatever the picker actually offers: with Gmail signed in
  // through its own button, the first pill is no longer Gmail.
  let mailPreset = $state<string>(COMMS_EMAIL_PRESETS[0].value);
  $effect(() => {
    if (mailPresets.length && !mailPresets.some((item) => item.value === mailPreset))
      mailPreset = mailPresets[0].value;
  });
  const activePreset = $derived(
    COMMS_EMAIL_PRESETS.find((item) => item.value === mailPreset) ?? COMMS_EMAIL_PRESETS[0],
  );


  /** Linked accounts on the shown platform. Several is normal, not an edge. */
  const activeAccounts = $derived(activeBridge?.accounts ?? []);
  /** Mailboxes already saved against the shown provider, matched by server. */
  /**
   * Every saved mailbox, since they all live under the one seat now. Matching
   * them to a seat by IMAP host also meant a mailbox on a server no preset
   * names — the whole point of "Other" — matched nothing and never appeared.
   */
  const activeMailboxes = $derived(active?.kind === 'mail' ? mailAccounts : []);
  /** Set while adding one more account to a platform that already has some. */
  let adding = $state('');
  /** A bridge that cannot even start until its own credentials are recorded. */
  const needsSetup = $derived(
    Boolean(activeBridge?.setup && !activeBridge.setup.configured),
  );
  /**
   * Scanning a code beats typing a number, so that is what a platform opens
   * on when it offers both. The rest stay one click away rather than hidden:
   * QR pairing fails often enough — no phone to hand, a desktop-only account —
   * that the alternative has to be visible at the moment it is needed.
   */
  function preferredFlow(flows: {id: string; name: string}[]): string | null {
    const qr = flows.find(
      (flow) => flow.id === 'qr' || /\bqr\b/i.test(flow.name),
    );
    return (qr ?? flows[0])?.id ?? null;
  }

  /**
   * Whether the step on screen belongs to the seat being shown. The panel
   * follows the pointer, but a running flow belongs to one platform: without
   * this, hovering a neighbour would show it another network's QR code.
   */
  const flowHere = $derived(Boolean(active?.platform && linking === active.platform));
  /**
   * A method has been chosen and the bridge has not answered with its first
   * step yet. The panel commits to the choice immediately and shows the shape
   * of what is coming: asking a bridge for a QR takes a moment, and leaving the
   * method list up for that moment read as a click that did nothing.
   */
  const pending = $derived(Boolean(flowHere && !step && busy === `link:${linking}`));
  /** The method being waited on, so the skeleton can match its shape. */
  const pendingFlow = $derived(
    pending ? (activeBridge?.flows.find((flow) => flow.id === activeFlow) ?? null) : null,
  );
  /** A QR is a square block; everything else arrives as lines of text or fields. */
  const pendingQr = $derived(
    Boolean(pendingFlow && /qr/i.test(`${pendingFlow.id} ${pendingFlow.name}`)),
  );

  /**
   * The line under a QR. Our own per-network wording wins where we have it:
   * it names the menu the scanner hides behind, which is the part a bridge's
   * "scan this" leaves the person to hunt for.
   */
  const scanNote = $derived(
    qrInstructions(active?.platform) ??
      (step?.type === 'display_and_wait' ? step.instructions : null) ??
      $t('platforms.scanFromPhone'),
  );

  /** The shown seat is the one whose sign-in is still landing. */
  const settlingHere = $derived(Boolean(active?.platform && settling === active.platform));

  /** Ready for the explicit "Log in" button: reachable, idle, and loggable. */
  const canLogin = $derived(
    connected &&
      !settlingHere &&
      !(flowHere && (step || pending)) &&
      !needsSetup &&
      activeBridge !== null &&
      activeBridge.flows.length > 0,
  );

  /**
   * A platform offering more than one way in owes the user a way back to that
   * choice. Picking QR and finding out your phone is across the room is not a
   * decision to be stuck with: the code on screen has to be leaveable, and the
   * pairing-code method reachable, without abandoning the platform entirely.
   */
  const hasChoices = $derived((activeBridge?.flows.length ?? 0) > 1);

  const setupReady = $derived(
    Boolean(
      activeBridge?.setup?.fields.every((field) => (setupValues[field.id] ?? '').trim() !== ''),
    ),
  );
  const qr = $derived(
    step?.type === 'display_and_wait' && step.display === 'qr' && step.data
      ? qrSvgPath(step.data)
      : null,
  );
  /**
   * Whether a `user_input` step is worth submitting: every field filled, and
   * matching the pattern the bridge gave for it. Submitting a value the bridge
   * already told us the shape of only round-trips to the same error.
   */
  const inputReady = $derived(
    step?.type === 'user_input' &&
      step.fields.every((field) => {
        const value = (values[field.id] ?? '').trim();
        if (value === '') return false;
        if (!field.pattern) return true;
        try {
          return new RegExp(field.pattern).test(value);
        } catch {
          // The bridge's regex dialect may not be ours; let the bridge judge.
          return true;
        }
      }),
  );
  /** As many logos as read as a hand rather than a list; the rest are a count. */
  const stackedSeats = $derived(seatsByKey.slice(0, 7));
  const linkedNames = $derived(
    bridges.filter((bridge) => bridge.state === 'connected').map((bridge) => bridge.name),
  );
  /** At least one platform or mailbox is in, so the step has produced something. */
  const hasReach = $derived(linkedNames.length > 0 || mailAccounts.length > 0);

  /* ---- The ring ------------------------------------------------------- */

  let vw = $state(1280);
  let vh = $state(800);
  /**
   * This step's own screen, which is taller than the window: the deck gives the
   * hub room above and below so the whole disc fits inside it uncut. The ring
   * is centred on that screen, while its size still comes from the window —
   * the camera parks on this screen's middle, so the two coincide in the only
   * frame that matters.
   */
  let stageH = $state(0);
  /**
   * Floored. A window reports zero size while it is being created or restored,
   * and the binding writes that through; without a floor the arc collapses to
   * its minimum radius and every seat piles up on the centre line.
   */
  const winW = $derived(Math.max(vw, 900));
  const winH = $derived(Math.max(vh, 520));

  /**
   * Logos ride their own circle, concentric with the visible one and a set
   * distance outside it. Every logo's centre sits on that circle — including
   * the chosen one, which grows about its centre rather than off the line.
   */
  const RING_GAP = 52;
  /** Widest a seat is allowed to get, when the fleet is small enough. */
  const MAX_SEAT = 53;
  const MIN_SEAT = 36;
  /** Clear air between neighbouring discs, held constant as the fleet grows. */
  const SEAT_GAP = 19;
  /** How far apart seats may drift when there are few of them. */
  const MAX_PITCH = 96;
  /**
   * How much opacity a seat gives up between the centre line and the window
   * edge. Deliberately tiny: this is depth, not a vignette — a seat clipped by
   * the frame must still look like a seat that carried on, not one that faded
   * out because the ring ended.
   */
  const EDGE_FADE = 0.22;

  /** Just over half the window's height: enough for the arc to leave through
   *  the top and bottom edges, tight enough to curve visibly on the way. */
  const radius = $derived(Math.max(winH * 0.62, 320));
  /** The arc's left-most point. The floor keeps the ring clear of the copy. */
  const arcLeft = $derived(Math.max(winW * 0.52, 430));
  const centreX = $derived(arcLeft + radius);
  const seatRadius = $derived(radius + RING_GAP);
  /** The disc's centre line, measured down this step's screen. */
  const centreY = $derived((stageH || winH) / 2);
  /**
   * The middle slot is the one on the window's horizontal centre line, and the
   * arc is measured outwards from it in both directions. With an even number
   * of seats one side carries one more than the other — which is right: the
   * chosen seat has to sit dead centre, not half a step off it.
   */
  const middle = $derived(Math.floor((seatsByKey.length - 1) / 2));
  /**
   * Spacing is fixed, not fitted: the ring is a carousel, so it does not owe
   * the window a view of every platform at once. Seats sit a constant distance
   * apart and the ones past the top and bottom edges simply wait their turn,
   * instead of the whole fleet crowding together to stay on screen.
   *
   * Stretched, if a short fleet needs it, until the whole run of seats is
   * longer than the window is tall. That is what keeps the illusion honest:
   * the point where the last seat jumps back to the head of the queue then
   * always falls outside the window, so what is on screen is only ever a
   * length of ring turning past — never a seat blinking out of existence.
   */
  const pitch = $derived(
    Math.max(MAX_PITCH, (winH + 2 * MAX_SEAT) / Math.max(seatsByKey.length, 1)),
  );
  /** Degrees between neighbouring slots. */
  const stepAngle = $derived((pitch / seatRadius) * (180 / Math.PI));
  /**
   * The disc is sized from the room a seat actually has, not fixed: the window
   * only holds so much arc, so a long fleet has to give ground on diameter
   * rather than on the air between neighbours. Spacing then reads the same
   * whether the hub carries six platforms or sixteen.
   */
  const seatSize = $derived(
    Math.round(Math.max(MIN_SEAT, Math.min(MAX_SEAT, pitch - SEAT_GAP))),
  );

  /**
   * Where the ring starts its entrance, in slots behind its settled position.
   * A couple of seats is enough to read as a wheel that was already turning.
   */
  const ROLL_FROM = -2.4;

  /**
   * The ring turns as one body: a single rotation value, in slots, drives
   * every seat, so they all sweep the arc at the same angular speed and can
   * never overlap. A seat's virtual slot is its natural index plus the
   * rotation, wrapped around the seat count.
   */
  let rot = $state(ROLL_FROM);
  let anim: number | null = null;

  /**
   * Slots per second the ring turns on its own. Slow enough that it reads as
   * the thing being alive rather than as a carousel demanding to be watched.
   */
  const DRIFT_RATE = 0.14;
  /**
   * The ring turns by itself whenever no seat is open. A click stops it — the
   * seat is being read, and a panel whose subject slides away is unusable —
   * and closing that seat hands the ring back to itself. Hover alone does not
   * stop it: a pointer crossing the arc on its way somewhere else is not a
   * decision, and halting for that would make the ring feel skittish.
   */
  /**
   * The ring arrives already turning, a couple of seats back from where it
   * settles, so the step opens on a wheel rolling to a stop rather than on a
   * diagram being switched on. It is the same motion the drift then carries
   * on, which is what ties the entrance to the thing itself.
   */
  let rolling = $state(true);

  $effect(() => {
    if (!onCamera || !rolling) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      rot = 0;
      rolling = false;
      return;
    }
    const started = performance.now();
    const duration = 1000;
    let frame: number | null = requestAnimationFrame(function tick(now: number): void {
      const t = Math.min(1, (now - started) / duration);
      // Eased out hard: most of the turn is spent in the first third, so it
      // reads as momentum running out rather than a slider being dragged.
      rot = ROLL_FROM * (1 - t) ** 3;
      if (t < 1) frame = requestAnimationFrame(tick);
      else {
        frame = null;
        rot = 0;
        rolling = false;
      }
    });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  });

  const drifting = $derived(onCamera && open === '' && !rolling);
  let drift: number | null = null;

  $effect(() => {
    if (!drifting) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // `from` is a plain local, not a read of `rot`: writing the state this
    // effect also read would re-run it every frame.
    const from = untrack(() => rot);
    // A rotate-to-centre still in flight would be writing `rot` too, and the
    // two loops would fight over it frame by frame.
    if (anim !== null) {
      cancelAnimationFrame(anim);
      anim = null;
    }
    const started = performance.now();
    const frame = (now: number): void => {
      rot = from + ((now - started) / 1000) * DRIFT_RATE;
      drift = requestAnimationFrame(frame);
    };
    drift = requestAnimationFrame(frame);
    return () => {
      if (drift !== null) cancelAnimationFrame(drift);
      drift = null;
    };
  });

  /**
   * Position and fade for the seat at natural index `index`. The last unit of
   * the wrap — between the bottom slot and the top one — is off screen: the
   * seat carries on past the bottom while fading out, then drops in from just
   * above the top while fading back in.
   */
  function seatPose(index: number): string {
    const count = seatsByKey.length;
    const v = count < 2 ? 0 : (((index + rot) % count) + count) % count;
    // Past the last slot the seat has left the bottom of the window; it is
    // moved to the head of the queue, above the top edge, where `pitch`
    // guarantees there is nothing to see. No fade: a seat dissolving at the
    // edge would say the ring stops there, and it does not.
    const slot = v > count - 0.5 ? v - count : v;
    // Angle 0 is the arc's left-most point, which is the window's vertical
    // centre — so the seat in the middle slot is exactly centred.
    const radians = ((slot - middle) * stepAngle * Math.PI) / 180;
    const top = centreY + seatRadius * Math.sin(radians);
    // A very slight lift towards the centre line, spread evenly over the whole
    // half-height rather than banked up at the edge. Nothing disappears — the
    // seat at the frame is still nearly solid — it just gives the ring some
    // depth, so the middle of the arc is the part being offered.
    const away = Math.min(1, Math.abs(top - centreY) / (winH / 2));
    return `left:${centreX - seatRadius * Math.cos(radians)}px;top:${top}px;--fade:${(1 - EDGE_FADE * away).toFixed(3)}`;
  }

  /** Turn the ring, the short way round, until `key` sits dead centre. */
  function rotateTo(key: string): void {
    const count = seatsByKey.length;
    const index = seatsByKey.findIndex((item) => item.key === key);
    if (count < 2 || index < 0) return;
    const v = (((index + rot) % count) + count) % count;
    let delta = v - middle;
    if (delta > count / 2) delta -= count;
    if (delta < -count / 2) delta += count;
    if (delta === 0) return;

    const target = rot - delta;
    if (anim !== null) cancelAnimationFrame(anim);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      rot = ((target % count) + count) % count;
      return;
    }
    // Time scales with distance, so every turn moves at about the same speed.
    const duration = Math.min(760, Math.max(300, Math.abs(delta) * 120));
    const from = rot;
    const started = performance.now();
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2);
    const frame = (now: number): void => {
      const t = Math.min(1, (now - started) / duration);
      rot = from + (target - from) * ease(t);
      if (t < 1) anim = requestAnimationFrame(frame);
      else {
        rot = ((target % count) + count) % count;
        anim = null;
      }
    };
    anim = requestAnimationFrame(frame);
  }

  $effect(() => () => {
    if (anim !== null) cancelAnimationFrame(anim);
  });

  $effect(() => {
    void api.comms
      .status()
      .then((next) => {
        status = next;
      })
      .catch((cause: unknown) => {
        error = readableError(cause);
      });
    // A grant given in System Settings comes back with nothing to announce it,
    // and a bridge held back by one starts the moment it is given — so coming
    // back to the window is when to ask the fleet again.
    const recheck = (): void => {
      void api.comms.refresh().then(
        (next) => {
          status = next;
        },
        () => {},
      );
    };
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  });

  async function connect(): Promise<void> {
    busy = 'connect';
    error = '';
    try {
      status = await api.comms.connect();
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  function choose(target: Seat): void {
    rotateTo(target.key);
    // Choosing is also pointing at it. A pointer normally hovers before it
    // clicks, but a keyboard or a programmatic click does not, and the panel
    // follows what is hovered — without this it would show the seat the
    // pointer last passed over instead of the one just chosen.
    hoverOn(target.key);
    if (open === target.key) {
      // Same seat again: fold it back into the carousel. Any flow it had
      // running goes with it — dismissing the panel is dismissing the login.
      void cancel();
      open = '';
      return;
    }
    void cancel();
    open = target.key;
    stepError = '';
    email = '';
    password = '';
    setupValues = {};
    imapHost = '';
    smtpHost = '';
    adding = '';
    // Deliberately no login here. Opening a seat is looking at it; talking to
    // the network starts from the button in the circle, so nothing fires a QR
    // or a sign-in sheet at someone who was only browsing the ring.
  }

  /** Starts the platform's first login flow, if it has one to start. */
  async function link(platform: CommsPlatform): Promise<void> {
    const bridge = bridges.find((item) => item.platform === platform);
    if (!bridge || bridge.flows.length === 0) return;
    // A bridge missing its own credentials cannot log anyone in; the panel
    // asks for those first and starts the flow once they are recorded.
    if (bridge.setup && !bridge.setup.configured) return;
    const flow = preferredFlow(bridge.flows);
    if (flow) await startLink(platform, flow);
  }

  /** Signs one account out, leaving the platform's others alone. */
  async function signOut(platform: CommsPlatform, accountId: string): Promise<void> {
    busy = `out:${accountId}`;
    stepError = '';
    try {
      status = await api.comms.bridgeLogout(platform, accountId);
      // See `HubTab.unlink`: the hub's copy outlives the account otherwise.
      invalidateHubCache();
    } catch (cause) {
      stepError = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /** Removes one mailbox, leaving the provider's others alone. */
  async function removeMailbox(id: string): Promise<void> {
    busy = `out:${id}`;
    stepError = '';
    try {
      status = await api.comms.emailRemove(id);
    } catch (cause) {
      stepError = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /** Records a bridge's own credentials, then carries on into its login. */
  async function saveSetup(): Promise<void> {
    if (!active?.platform || !setupReady) return;
    busy = 'setup';
    stepError = '';
    try {
      status = await api.comms.bridgeSetup(active.platform, setupValues);
      setupValues = {};
      await link(active.platform);
    } catch (cause) {
      stepError = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /**
   * Asks macOS for the grant a bridge is held back by, then re-reads the
   * fleet. For a permission macOS prompts for, the answer arrives with the
   * dialog; for Full Disk Access the pane opens and the answer arrives
   * whenever the user comes back, which the focus listener below picks up.
   */
  async function grant(permission: SystemPermissionKind): Promise<void> {
    granting = true;
    try {
      await api.permissions.request(permission);
      status = await api.comms.refresh().catch(() => status);
    } catch (cause) {
      stepError = readableError(cause);
    } finally {
      granting = false;
    }
  }

  /** The hub-is-down path: start it, then carry straight on into the link. */
  async function connectThenLink(platform: CommsPlatform): Promise<void> {
    await connect();
    if (hub?.status === 'signed-in') await link(platform);
  }

  async function startLink(platform: CommsPlatform, flowId: string): Promise<void> {
    attempt += 1;
    const mine = attempt;
    settling = '';
    linking = platform;
    activeFlow = flowId;
    step = null;
    stepError = '';
    busy = `link:${platform}`;
    try {
      const first = await api.comms.loginStart(platform, flowId);
      // Backed out while the bridge was still answering: the panel has already
      // moved on, and a step from an abandoned method must not land on it.
      if (attempt !== mine) return;
      step = first;
      // Busy ends when the first step is on screen, not when the flow does: a
      // QR wait can hold `advance` open for minutes, and the alternative
      // methods must stay clickable for exactly that stretch.
      busy = '';
      await advance();
    } catch (cause) {
      if (attempt === mine) stepError = readableError(cause);
    } finally {
      if (busy === `link:${platform}`) busy = '';
    }
  }

  /**
   * Which attempt the flow state belongs to. A `display_and_wait` blocks
   * server-side until the remote user acts, so its promise can outlive the
   * flow it belongs to — cancelled, or replaced by another login method. A
   * result from a superseded attempt is dropped on the floor; letting it
   * through would overwrite the step the user is actually on.
   */
  let attempt = 0;

  /** Carries the flow through every step that needs no typing. */
  async function advance(): Promise<void> {
    const mine = attempt;
    while (step && linking && attempt === mine) {
      if (step.type === 'display_and_wait') {
        try {
          const next = await api.comms.loginWait(linking, step.loginId, step.stepId);
          if (attempt !== mine) return;
          step = next;
        } catch (cause) {
          if (attempt === mine) stepError = readableError(cause);
          return;
        }
      } else if (step.type === 'cookies') {
        const platform = linking;
        const loginId = step.loginId;
        try {
          const next = await api.comms.loginCookies(linking, step.loginId, step.stepId);
          if (attempt !== mine) return;
          step = next;
        } catch (cause) {
          if (attempt !== mine) return;
          // The sign-in window is gone — closed, or it failed to open. Drop the
          // flow so the card offers the log-in button again; leaving the step
          // in place stranded the user on "finish signing in" with no window
          // to finish in and no way to retry.
          attempt += 1;
          step = null;
          activeFlow = '';
          linking = '';
          stepError = readableError(cause);
          status = await api.comms.loginCancel(platform, loginId).catch(() => status);
          return;
        }
      } else if (step.type === 'complete') {
        const platform = linking;
        step = null;
        linking = '';
        activeFlow = '';
        await settle(platform, mine);
        return;
      } else return;
    }
  }

  /**
   * Waits for the account to appear on the fleet, holding the panel on
   * "Signing in…" for as long as it takes.
   *
   * `status` rather than `refresh`: refresh retries every blocked bridge, which
   * means poking the very session that has just been established — the login
   * that just succeeded does not need looking for, it needs reporting. Polled
   * because the bridge reports the new account whenever it has finished
   * bringing it up, with nothing to announce that it has.
   */
  const SETTLE_POLL_MS = 700;
  const SETTLE_LIMIT_MS = 20000;

  async function settle(platform: CommsPlatform, mine: number): Promise<void> {
    settling = platform;
    const deadline = performance.now() + SETTLE_LIMIT_MS;
    try {
      for (;;) {
        const next = await api.comms.status().catch((): null => null);
        // Superseded: another login was started, or this seat was dismissed.
        if (attempt !== mine) return;
        if (next) status = next;
        const bridge = next?.bridges.find((item) => item.platform === platform);
        if (bridge?.accounts.length) return;
        if (performance.now() >= deadline) return;
        await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
        if (attempt !== mine) return;
      }
    } finally {
      if (settling === platform) settling = '';
    }
  }

  async function submit(): Promise<void> {
    if (!step || step.type !== 'user_input' || !linking) return;
    busy = 'step';
    stepError = '';
    const mine = attempt;
    try {
      const next = await api.comms.loginSubmit(linking, step.loginId, step.stepId, values);
      if (attempt !== mine) return;
      step = next;
      values = {};
      await advance();
    } catch (cause) {
      stepError = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function cancel(): Promise<void> {
    attempt += 1;
    const platform = linking;
    const loginId = step?.loginId;
    step = null;
    activeFlow = '';
    linking = '';
    settling = '';
    values = {};
    stepError = '';
    if (platform && loginId) status = await api.comms.loginCancel(platform, loginId).catch(() => status);
  }

  /** A mailbox needs a short handle; the address's local part is a good one. */
  function accountId(address: string): string {
    const base = address.split('@')[0]?.replace(/[^a-z0-9]+/gi, '') || 'mail';
    let id = base.toLowerCase();
    let suffix = 2;
    while (mailAccounts.some((account) => account.id === id)) id = `${base.toLowerCase()}${suffix++}`;
    return id;
  }

  /** The custom seat is the only one whose servers the user has to supply. */
  const customMail = $derived(activePreset?.value === 'custom');

  /**
   * Whose hint to show. A provider set up as "Other" is recognised from the
   * servers typed in, so the one thing that is not guessable about it — that
   * the account password will not work — still gets said.
   */
  const mailHintPreset = $derived(
    (customMail
      ? (presetForHost(smtpHost)?.value ?? presetForHost(imapHost)?.value)
      : undefined) ?? activePreset.value,
  );
  const mailReady = $derived(
    Boolean(email.trim() && password && (!customMail || (imapHost.trim() && smtpHost.trim()))),
  );

  /**
   * Signs a mailbox in with its provider. Everything the form below asks for —
   * the address, the servers — comes back from the sign-in, so there is
   * nothing left to fill in and the panel returns to the list.
   */
  async function signInMailbox(provider: 'google' | 'microsoft'): Promise<void> {
    busy = `mail-signin:${provider}`;
    stepError = '';
    try {
      status = await api.comms.emailSignIn(provider);
      adding = '';
    } catch (cause) {
      stepError = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function saveMailbox(): Promise<void> {
    if (!activePreset || !mailReady) return;
    busy = 'mail';
    stepError = '';
    try {
      status = await api.comms.emailSave({
        id: accountId(email.trim()),
        email: email.trim(),
        preset: activePreset.value,
        imapHost: customMail ? imapHost.trim() : activePreset.imapHost,
        imapPort: activePreset.imapPort,
        imapEncryption: activePreset.imapEncryption,
        smtpHost: customMail ? smtpHost.trim() : activePreset.smtpHost,
        smtpPort: activePreset.smtpPort,
        smtpEncryption: activePreset.smtpEncryption,
        password,
        isDefault: mailAccounts.length === 0,
      });
      email = '';
      password = '';
      imapHost = '';
      smtpHost = '';
      // Back to the list, with the new mailbox on it. The seat stays open:
      // having just added one, seeing where it landed is the point.
      adding = '';
    } catch (cause) {
      stepError = readableError(cause);
    } finally {
      busy = '';
    }
  }

  function inputType(type: string): string {
    if (type === 'password' || type === 'token') return 'password';
    if (type === 'phone_number') return 'tel';
    if (type === 'email') return 'email';
    return 'text';
  }

  function done(): void {
    onDone({messaging: linkedNames, mail: mailAccounts.map((account) => account.email)});
  }
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div
  class="pf"
  class:live={onCamera}
  bind:clientHeight={stageH}
  style="--arc:{arcLeft}px;--seat:{seatSize}px"
>
  <div class="pf-copy">
    <p class="onb-eyebrow">{$t('platforms.eyebrow')}</p>
    <h1 class="onb-title">{$t('platforms.title')}</h1>
    <p class="onb-lede">{$t('platforms.lede')}</p>

    {#if error}<p class="onb-note warn">{error}</p>{/if}

    <!-- Only when something is in the way. A running hub says so by the ring
         being live; a line repeating it is just furniture. -->
    {#if !connected}
      <p class="onb-note">
        {hub?.canAutoConnect ? $t('platforms.hubNotRunning') : $t('platforms.hubUnavailable')}
      </p>
    {/if}

    <div class="onb-actions">
      {#if !connected && hub?.canAutoConnect}
        <button type="button" class="onb-button primary" disabled={busy === 'connect'} onclick={() => void connect()}>
          {busy === 'connect' ? $t('platforms.startingHub') : $t('platforms.startHub')}
        </button>
      {:else}
        <!-- Nothing linked means nothing for the hub to carry, so Continue
             stays dead until one account is in. Skip is the way past. -->
        <button type="button" class="onb-button primary" disabled={!hasReach} onclick={done}>
          {$t('common.continue')}
        </button>
      {/if}
      <BackAction />
    </div>
  </div>

  <!-- Fixed, and clipped to the window: the arc belongs to a circle far larger
       than the screen, so what shows is one line running top edge to bottom. -->
  <div class="pf-scene">
    <div
      class="pf-arc"
      style="left:{arcLeft}px;top:{centreY - radius}px;width:{radius * 2}px;height:{radius * 2}px"
    ></div>

    {#each seatsByKey as item, index (item.key)}
      <button
        type="button"
        class="pf-seat"
        class:mail={item.kind === 'mail'}
        class:idle={item.kind === 'messaging' && !connected}
        class:done={item.kind === 'messaging'
          ? bridges.find((bridge) => bridge.platform === item.platform)?.state === 'connected'
          : mailAccounts.length > 0}
        class:open={open === item.key}
        style="{seatPose(index)};--i:{index}"
        onmouseenter={() => hoverOn(item.key, true)}
        onmouseleave={hoverOff}
        onfocus={() => hoverOn(item.key)}
        onblur={hoverOff}
        onclick={() => choose(item)}
      >
        <span class="pf-seat-mark">
          {#if item.logo}
            <img src={item.logo} data-logo={item.platform ?? item.key} alt="" aria-hidden="true" />
          {:else}
            {item.initial}
          {/if}
        </span>
        <span class="pf-seat-label">{item.name}</span>
        <span class="pf-seat-tick"><Icon name="check" size={9} strokeWidth={3} /></span>
      </button>
    {/each}
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="pf-face"
    bind:this={faceEl}
    use:fadeEdges={`${shownKey}:${activeMailboxes.length}:${adding}`}
    use:fadeSwap={shownKey}
    style="opacity:{restOpacity}"
    onmouseenter={() => clearTimeout(hoverRelease)}
    onmouseleave={hoverOff}
    onfocusin={() => clearTimeout(hoverRelease)}
  >
    {#if active && active.kind === 'messaging'}
      {#if active.logo}
        <span class="pf-face-mark"><img src={active.logo} alt="" aria-hidden="true" /></span>
      {/if}
      <p class="onb-eyebrow">{active.name}</p>
      {#if pending}
        <!-- The shape of the step being fetched, held in place until it lands,
             so the panel changes once rather than twice. -->
        {#if pendingQr}
          <div class="pf-qr pf-skeleton-qr" aria-hidden="true"></div>
        {:else}
          <div class="pf-skeleton-lines" aria-hidden="true">
            <span></span>
            <span></span>
          </div>
        {/if}
        <p class="onb-note" role="status">
          <!-- The method's own name, as the bridge writes it: lowercasing it
               turns "QR Code" into something that reads like a typo. -->
          {pendingFlow ? $t('platforms.gettingReady', {method: pendingFlow.name}) : $t('platforms.starting')}
        </p>
      {:else if settlingHere}
        <!-- Between the phone confirming and the bridge reporting the account.
             One line, in place, so the panel reads as carrying on rather than
             snapping back to the log-in button it started from. -->
        <p class="onb-note" role="status">{$t('hub.signingIn')}</p>
      {:else if flowHere && qr}
        <div class="pf-qr">
          <!-- The four-module quiet zone belongs to the symbol; scanners need it. -->
          <svg viewBox="-4 -4 {qr.size + 8} {qr.size + 8}" role="img" aria-label={$t('hub.pairingQr')}>
            <rect x="-4" y="-4" width={qr.size + 8} height={qr.size + 8} fill="#fff" />
            <path d={qr.path} fill="#000" />
          </svg>
        </div>
        <p class="onb-note">{scanNote}</p>
      {:else if flowHere && step?.type === 'display_and_wait' && step.display === 'qr' && step.imageUrl}
        <!-- Some bridges send a pre-rendered image rather than the payload. -->
        <div class="pf-qr">
          <img src={step.imageUrl} alt={$t('hub.pairingQr')} />
        </div>
        <p class="onb-note">{scanNote}</p>
      {:else if flowHere && step?.type === 'display_and_wait' && (step.display === 'code' || step.display === 'emoji') && step.data}
        <p class="pf-code" class:emoji={step.display === 'emoji'}>{step.data}</p>
        <p class="onb-note">
          {step.instructions ??
            (step.display === 'emoji' ? $t('platforms.checkEmoji') : $t('platforms.enterCode'))}
        </p>
      {:else if flowHere && step?.type === 'display_and_wait'}
        <!-- `nothing` to show: the remote side has to act on its own. -->
        <p class="onb-note">{step.instructions ?? $t('platforms.waitingConfirm', {platform: active.name})}</p>
      {:else if flowHere && step?.type === 'user_input'}
        {#if step.instructions}<p class="onb-note">{step.instructions}</p>{/if}
        {#each step.fields as field (field.id)}
          <label class="onb-field pf-field">
            <span>{field.name}</span>
            <input
              type={inputType(field.type)}
              spellcheck="false"
              autocomplete="off"
              value={values[field.id] ?? ''}
              oninput={(event) => (values = {...values, [field.id]: event.currentTarget.value})}
              onkeydown={(event) => {
                if (event.key === 'Enter' && inputReady) void submit();
              }}
            />
            {#if field.description}<small class="pf-field-hint">{field.description}</small>{/if}
          </label>
        {/each}
      {:else if flowHere && step?.type === 'cookies'}
        <p class="onb-note">
          Finish signing in to {active.name} in the window that just opened. Closing it brings you
          back here.
        </p>
      {:else if needsSetup && activeBridge?.setup}
        <!-- Telegram: the bridge will not connect on someone else's
             application, so the pair is asked for here rather than shipped. -->
        <p class="onb-note">
          {active.name} needs an application of your own before it can connect. Create one, it
          takes a minute, then paste the two values it gives you.
        </p>
        {#each activeBridge.setup.fields as field (field.id)}
          <label class="onb-field pf-field">
            <span>{field.name}</span>
            <input
              type={field.secret ? 'password' : 'text'}
              spellcheck="false"
              autocomplete="off"
              value={setupValues[field.id] ?? ''}
              oninput={(event) => (setupValues = {...setupValues, [field.id]: event.currentTarget.value})}
            />
          </label>
        {/each}
        {#if activeBridge.setup.fields[0]?.helpUrl}
          <p class="onb-note">
            Get them at <span class="pf-link">{activeBridge.setup.fields[0].helpUrl}</span>
          </p>
        {/if}
      {:else if activeAccounts.length > 0 && active.platform}
        <!-- One row per account. A platform holding two handles is ordinary,
             and each has to be identifiable and removable by itself. -->
        <ul class="pf-accounts">
          {#each activeAccounts as account (account.id)}
            <li class:warn={account.state === 'bad-credentials'}>
              <span class="pf-account-name">{account.name || account.id}</span>
              <span class="pf-account-state">
                {account.state === 'connected'
                  ? $t('drive.stateConnected')
                  : account.state === 'connecting'
                    ? $t('hub.connecting')
                    : account.state === 'bad-credentials'
                      ? $t('platforms.needsSignIn')
                      : $t('hub.unknown')}
              </span>
              <!-- A relay account is whoever the app on this Mac is signed in
                   as. FlareAI did not make that login and cannot end it. -->
              {#if activeBridge?.api !== 'none'}
                <button
                  type="button"
                  class="pf-account-drop"
                  disabled={busy === `out:${account.id}`}
                  onclick={() => void signOut(active.platform!, account.id)}
                >
                  {busy === `out:${account.id}` ? $t('platforms.removing') : $t('platforms.signOut')}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
        {#each activeAccounts.filter((account) => account.error) as account (account.id)}
          <p class="onb-note warn">{account.name}: {account.error}</p>
        {/each}
        {#if activeBridge?.api === 'none'}
          <!-- Said plainly, because a seat that shows an account but no button
               otherwise reads as one still waiting to be finished. -->
          <p class="onb-note">{$t('platforms.viaLocalApp', {platform: active.name})}</p>
        {/if}
      {:else if !connected}
        <p class="onb-note">
          {hub?.canAutoConnect ? $t('platforms.viaHubNotStarted') : $t('platforms.viaHubUnavailable')}
        </p>
      {:else if activeBridge?.state === 'unavailable' || activeBridge?.api === 'none'}
        <p class="onb-note">
          {activeBridge.error ?? $t('platforms.viaRelay')}
        </p>
        {#if activeBridge.api === 'none'}
          <!-- The requirement, stated whether or not anything has failed yet.
               A platform read through a desktop app depends on that app being
               installed and signed in, and finding that out from an error is
               finding out too late. -->
          <p class="onb-note">{$t('platforms.needsDesktopApp', {platform: active.name})}</p>
        {/if}
      {:else if activeBridge?.state === 'dormant'}
        <!-- Not running because nothing is linked to it. Hovering this seat
             already asked for it, so this is the sub-second gap before its own
             login methods arrive rather than a state to act on. -->
        <p class="onb-note">{$t('platforms.startingPlatform', {platform: active.name})}</p>
      {:else if activeBridge?.state === 'unreachable'}
        <p class="onb-note">{$t('platforms.bridgeUnreachable')}</p>
        {#if activeBridge.error}<p class="onb-note warn">{activeBridge.error}</p>{/if}
      {:else if canLogin && (activeBridge?.flows.length ?? 0) > 1}
        <!-- Every way in, all on screen. A platform offering two ways to sign
             in is offering a choice, and showing one at a time made the other
             read as a second button for the same thing rather than as the
             alternative it is. Which methods exist is the bridge's answer. -->
        <ul class="pf-methods">
          {#each activeBridge?.flows ?? [] as flow (flow.id)}
            <li>
              <button
                type="button"
                class="pf-method"
                disabled={busy.startsWith('link:')}
                onclick={() => void startLink(active.platform!, flow.id)}
              >
                <span class="pf-method-copy">
                  <strong>{flow.name}</strong>
                  <small>{flow.description}</small>
                </span>
                <Icon name="forward" size={13} />
              </button>
            </li>
          {/each}
        </ul>
      {:else if canLogin}
        <p class="onb-note">
          {activeBridge?.flows[0]?.description ?? $t('platforms.signInBlurb')}
        </p>
      {:else}
        <p class="onb-note">{busy ? $t('platforms.starting') : $t('platforms.nothingToBringIn')}</p>
      {/if}

      {#if stepError}<p class="onb-note warn">{stepError}</p>{/if}


      <div class="onb-actions pf-actions">
        {#if flowHere && step?.type === 'user_input'}
          <button
            type="button"
            class="onb-button primary"
            disabled={busy === 'step' || !inputReady}
            onclick={() => void submit()}
          >
            {busy === 'step' ? $t('hub.checking') : $t('common.continue')}
          </button>
        {:else if activeBridge?.permission}
          <!-- A blocker macOS can lift is an action, not a set of directions:
               being told where the switch is and being handed it are different
               things. It sits in the same row, and reads the same, as every
               other way into a platform. -->
          <button
            type="button"
            class="onb-button primary"
            disabled={granting}
            onclick={() => void grant(activeBridge.permission!)}
          >
            {granting
              ? $t('hub.waiting')
              : permissionPrompts(activeBridge.permission)
                ? $t('hub.allowAccess')
                : $t('hub.openSettings')}
          </button>
        {:else if canLogin && active.platform && (activeAccounts.length > 0 || (activeBridge?.flows.length ?? 0) <= 1)}
          <button
            type="button"
            class="onb-button primary"
            disabled={busy !== ''}
            onclick={() => void link(active.platform!)}
          >
            {busy.startsWith('link:')
              ? $t('platforms.starting')
              : activeAccounts.length > 0
                ? $t('hub.addAnotherAccount')
                : $t('platforms.logInTo', {platform: active.name})}
          </button>
        {:else if needsSetup}
          <button
            type="button"
            class="onb-button primary"
            disabled={busy === 'setup' || !setupReady}
            onclick={() => void saveSetup()}
          >
            {busy === 'setup' ? $t('hub.saving') : $t('platforms.saveAndContinue')}
          </button>
        {:else if !connected && hub?.canAutoConnect && active.platform}
          <button
            type="button"
            class="onb-button primary"
            disabled={busy === 'connect'}
            onclick={() => void connectThenLink(active.platform!)}
          >
            {busy === 'connect' ? $t('platforms.startingHub') : $t('platforms.startHubAndLink')}
          </button>
        {/if}
        {#if flowHere && hasChoices && (pending || (step && step.type !== 'cookies'))}
          <!-- Sits on its own line below whatever the step itself needs, so it
               reads as the way out of this method rather than as another step
               in it. Not offered for a cookie sign-in: that method's window is
               in front of this panel and has its own close button, which is
               already the way back here. -->
          <button type="button" class="onb-quiet pf-back" onclick={() => void cancel()}>
            Other verification methods
          </button>
        {/if}
      </div>
    {:else if active && active.kind === 'mail'}
      {#if active.logo}
        <span class="pf-face-mark"><img src={active.logo} alt="" aria-hidden="true" /></span>
      {/if}
      <p class="onb-eyebrow">{active.name}</p>
      {#if activeMailboxes.length > 0}
        <ul class="pf-accounts" use:fadeEdges={activeMailboxes.length}>
          {#each activeMailboxes as account (account.id)}
            <li class:warn={account.status === 'error'}>
              <span class="pf-account-name">{account.email}</span>
              <span class="pf-account-state">
                {account.status === 'ok'
                  ? account.isDefault
                    ? $t('hub.default')
                    : $t('drive.stateConnected')
                  : account.status === 'error'
                    ? $t('platforms.notSigningIn')
                    : $t('platforms.notChecked')}
              </span>
              <button
                type="button"
                class="pf-account-drop"
                disabled={busy === `out:${account.id}`}
                onclick={() => void removeMailbox(account.id)}
              >
                {busy === `out:${account.id}` ? $t('platforms.removing') : $t('hub.remove')}
              </button>
            </li>
          {/each}
        </ul>
        {#each activeMailboxes.filter((account) => account.error) as account (account.id)}
          <p class="onb-note warn">{account.email}: {account.error}</p>
        {/each}
      {/if}
      {#if activeMailboxes.length === 0 || adding === active.key}
      <!-- Signing in answers the address and the servers together, so it comes
           before the picker below, which only prefills hostnames for a mailbox
           set up by hand. Drawn only where a client is registered. -->
      {#if mailSignInProviders.length}
        <div class="pf-signin">
          {#each mailSignInProviders as provider (provider)}
            <button
              type="button"
              class="pf-signin-button"
              disabled={busy === `mail-signin:${provider}`}
              onclick={() => void signInMailbox(provider)}
            >
              {#if mailLogo(provider === 'google' ? 'gmail' : 'outlook')}
                <img src={mailLogo(provider === 'google' ? 'gmail' : 'outlook')} alt="" aria-hidden="true" />
              {/if}
              {busy === `mail-signin:${provider}`
                ? $t('hub.signingIn')
                : $t('hub.signInWith', {provider: provider === 'google' ? 'Google' : 'Microsoft'})}
            </button>
          {/each}
          <p class="onb-note">{$t('hub.signInOrManual')}</p>
        </div>
      {/if}
      <!-- The provider picker the seats used to be. It only decides which
           server names get prefilled, so it belongs beside the fields it
           fills rather than out on the ring as five separate platforms. It
           goes entirely once there is nothing left to choose between: a picker
           offering one option is a label pretending to be a choice. -->
      {#if mailPresets.length > 1}
      <div class="pf-providers">
        {#each mailPresets as preset (preset.value)}
          <button
            type="button"
            class="pf-provider"
            class:on={mailPreset === preset.value}
            aria-pressed={mailPreset === preset.value}
            onclick={() => (mailPreset = preset.value)}
          >
            {#if mailLogo(preset.value)}
              <img src={mailLogo(preset.value)} alt="" aria-hidden="true" />
            {/if}
            <!-- "Mail" is the seat's name; in here the same preset is the
                 any-other-server option, and repeating the heading would read
                 as a provider called Mail. -->
            {preset.value === 'custom' ? $t('platforms.otherProvider') : (MAIL_NAMES[preset.value] ?? preset.label)}
          </button>
        {/each}
      </div>
      {/if}
      <p class="onb-note">{emailPresetHint(mailHintPreset)}</p>
      <label class="onb-field pf-field">
        <span>{$t('hub.emailAddress')}</span>
        <input bind:value={email} type="email" spellcheck="false" placeholder="you@example.com" />
      </label>
      {#if customMail}
        <div class="pf-pair">
          <label class="onb-field pf-field">
            <span>{$t('hub.imapServer')}</span>
            <input bind:value={imapHost} spellcheck="false" placeholder="imap.example.com" />
          </label>
          <label class="onb-field pf-field">
            <span>{$t('hub.smtpServer')}</span>
            <input bind:value={smtpHost} spellcheck="false" placeholder="smtp.example.com" />
          </label>
        </div>
      {/if}
      <label class="onb-field pf-field">
        <span>{customMail ? $t('hub.password') : $t('hub.appPassword')}</span>
        <input
          bind:value={password}
          type="password"
          autocomplete="off"
          onkeydown={(event) => {
            if (event.key === 'Enter') void saveMailbox();
          }}
        />
      </label>

      {#if stepError}<p class="onb-note warn">{stepError}</p>{/if}

      <div class="onb-actions pf-actions">
        <button
          type="button"
          class="onb-button primary"
          disabled={busy === 'mail' || !mailReady}
          onclick={() => void saveMailbox()}
        >
          {busy === 'mail' ? $t('platforms.adding') : $t('platforms.addMailbox')}
        </button>
      </div>
      {:else}
      <div class="onb-actions pf-actions">
        <button type="button" class="onb-button primary" onclick={() => (adding = active.key)}>
          {$t('platforms.addAnotherMailbox')}
        </button>
      </div>
      {/if}
    {:else if active}
      <p class="onb-eyebrow">{active.kind === 'mail' ? $t('hub.mail') : $t('platforms.messaging')}</p>
      <p class="pf-name">{active.name}</p>
      <p class="onb-note">
        {#if active.kind === 'mail'}
          {mailAccounts.length > 0
            ? plural('platforms.mailboxesSetUp', mailAccounts.length)
            : $t('platforms.addMailboxHint')}
        {:else if !connected}
          {$t('platforms.startHubFirst')}
        {:else}
          {bridges.find((bridge) => bridge.platform === active.platform)?.state === 'connected'
            ? $t('platforms.linkedToHub')
            : (bridges.find((bridge) => bridge.platform === active.platform)?.flows[0]?.description ??
              $t('hub.notLinked'))}
        {/if}
      </p>
    {:else}
      <!-- Nothing chosen yet, so the disc says what is on offer: the size of
           the ring, and a hand of its logos. The count is the claim; the stack
           is the evidence for it. -->
      <p class="pf-count">{seatsByKey.length}<span> {$t('platforms.platforms')}</span></p>
      <div class="pf-stack" aria-hidden="true">
        {#each stackedSeats as item, position (item.key)}
          <span class="pf-stack-mark" style="--i:{position}">
            {#if item.logo}
              <img src={item.logo} data-logo={item.platform ?? item.key} alt="" />
            {:else}
              {item.initial}
            {/if}
          </span>
        {/each}
        {#if seatsByKey.length > stackedSeats.length}
          <span class="pf-stack-more" style="--i:{stackedSeats.length}">
            +{seatsByKey.length - stackedSeats.length}
          </span>
        {/if}
      </div>
      <p class="onb-note">{$t('platforms.ringBlurb')}</p>
    {/if}
  </div>
</div>

<style>
  /* --arc is the circle's left-most point, set from the script, and the anchor
     everything else is measured from. */
  .pf-copy{max-width:min(400px,calc(var(--arc) - 190px))}
  .pf.live .pf-copy{animation:pf-copy-in .58s cubic-bezier(.22,1,.36,1) .06s both}
  @keyframes pf-copy-in{from{opacity:0;transform:translate3d(0,18px,0)}to{opacity:1;transform:none}}
  .pf-copy .onb-note{margin-top:16px}

  /* The disc is the Hub: solid, edge to edge, no outline. Its inside runs the
     opposite way to the page, and swaps with it in dark mode. */
  /* Literal, not scale tokens: the neutral ramp inverts with the theme, so
     `--neutral-950` would follow the disc instead of opposing it. */
  /* Fills its own slide of the deck. The copy is centred against the window's
     height and measured from its left edge, the way the arc is. */
  .pf{--edge-fade:linear-gradient(to bottom,
      transparent 0,
      #000 calc(var(--fade-size) * var(--fade-top)),
      #000 calc(100% - var(--fade-size) * var(--fade-bottom)),
      transparent 100%);
    position:absolute;inset:0;display:flex;align-items:center;padding-left:clamp(52px,8.5vw,136px);--hub-fill:#0a0a0a;--hub-ink:#fff;--hub-ink-soft:rgb(255 255 255 / .86)}
  :global(:root[data-theme="dark"]) .pf{--hub-fill:#fafafa;--hub-ink:#0a0a0a;--hub-ink-soft:rgb(10 10 10 / .84)}
  @media (prefers-color-scheme:dark){
    :global(:root:not([data-theme="light"])) .pf{--hub-fill:#fafafa;--hub-ink:#0a0a0a;--hub-ink-soft:rgb(10 10 10 / .84)}
  }

  /* Opacity only. The pan is already carrying this screen up from below; a
     second rise on top of it reads as the disc sliding within its own page. */
  .pf-scene{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0}
  .pf.live .pf-scene{animation:pf-scene-in .62s cubic-bezier(.22,1,.36,1) both}
  @keyframes pf-scene-in{from{opacity:0}to{opacity:1}}
  /* Sized from the script: just past the window's height, so the rim leaves
     through the top and bottom edges while still curving on the way. */
  .pf-arc{position:absolute;border-radius:50%;border:0;background:var(--hub-fill)}

  /* left/top are the seat's centre, so the clearance from the rim is the same
     wherever it sits. Position transitions carry the rotation. */
  /* The box is exactly the disc, so what the arc's maths positions is the
     logo's own centre. The name hangs off it absolutely — a label in flow
     would widen the button and push the logo off the ring. Position and
     come per-frame from the script, so no left/top transitions here: they
     would fight the animation loop. */
  .pf-seat{position:absolute;width:var(--seat,44px);height:var(--seat,44px);transform:translate(-50%,-50%);display:block;padding:0;border:0;background:none;pointer-events:auto;cursor:pointer;opacity:var(--fade,1);
    transition:transform .22s cubic-bezier(.22,1,.36,1)}
  .pf-seat:disabled{cursor:default}
  /* No entrance of their own: the seats are riding a wheel that is already
     rolling, and a stagger on top of that reads as two animations arguing. */
  .pf-seat-mark{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;border:1px solid rgb(from var(--hub-ink) r g b / .16);background:var(--hub-fill);color:var(--hub-ink-soft);font-size:14.5px;font-weight:650;transition:border-color .22s,color .22s}
  .pf-seat-mark img{width:50%;height:50%;object-fit:contain}
  /* X and Matrix ship one pure-black mark each. The global rule in style.css
     inverts them on a dark *app* theme, which is right for the stack (its disc
     is `--hub-ink`) and exactly backwards here: the seat's disc is `--hub-fill`,
     dark in light mode and light in dark mode. So invert on the seat by default
     and undo the global inversion when the disc turns light. */
  .pf-seat-mark img[data-logo="twitter"],.pf-seat-mark img[data-logo="matrix"]{filter:invert(1)}
  :global(:root[data-theme="dark"]) .pf-seat-mark img[data-logo="twitter"],
  :global(:root[data-theme="dark"]) .pf-seat-mark img[data-logo="matrix"]{filter:none}
  @media (prefers-color-scheme:dark){
    :global(:root:not([data-theme="light"])) .pf-seat-mark img[data-logo="twitter"],
    :global(:root:not([data-theme="light"])) .pf-seat-mark img[data-logo="matrix"]{filter:none}
  }
  .pf-seat-tick{display:none}
  /* Carried for screen readers only. Painted, it runs outward from the rim
     and straight across the copy on the left — and it is the one thing on
     this screen that is already said elsewhere: the disc names the platform
     the moment the seat is looked at. */
  .pf-seat-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  /* Already linked. The ring stays the same weight as every other seat — a
     darker one here reads as "selected", which it is not. */
  .pf-seat.done .pf-seat-tick{position:absolute;right:-1px;bottom:-1px;display:grid;place-items:center;width:15px;height:15px;border-radius:50%;border:1.5px solid var(--app-bg);background:var(--hub-ink);color:var(--hub-fill)}
  /* Barely held back while its hub is down — every seat opens either way, so
     this is a hint, not a "keep out". */
  .pf-seat.idle{opacity:calc(var(--fade,1) * .92)}
  .pf-seat.open{z-index:2}
  /* The chosen seat rides the middle of the arc, a size up from the rest. */
  .pf-seat.open{transform:translate(-50%,-50%) scale(1.3)}
  /* Chosen reads as size and a darker ring — no fill, so the logo stays itself. */
  .pf-seat.open .pf-seat-mark{border-color:var(--hub-ink);background:var(--hub-fill)}
  .pf-seat:hover,.pf-seat:focus-visible{z-index:1}
  .pf-seat:hover:not(:disabled),.pf-seat:focus-visible{transform:translate(-50%,-50%) scale(1.22)}
  .pf-seat.open:hover,.pf-seat.open:focus-visible{transform:translate(-50%,-50%) scale(1.3)}
  .pf-seat:hover:not(:disabled) .pf-seat-mark,.pf-seat:focus-visible .pf-seat-mark{border-color:rgb(from var(--hub-ink) r g b / .45);color:var(--hub-ink)}
  .pf-seat:focus-visible{outline:none}

  /* Inside the circle, clear of the rim, and reading against the fill. */
  .pf-face{position:absolute;top:50%;left:calc(var(--arc) + 98px);width:min(360px,calc(100vw - var(--arc) - 130px));transform:translateY(-50%);display:flex;flex-direction:column;align-items:flex-start;gap:8px;z-index:1;color:var(--hub-ink);
    /* The disc is a circle, so the panel has a finite middle to sit in: past
       this it runs out through the curve and onto the page behind. Anything
       longer scrolls here instead. */
    max-height:min(74vh,600px);overflow-y:auto;overscroll-behavior:contain;
    /* Room for the buttons to grow into. A scroller clips on both axes — asking
       for `overflow-y` gets `overflow-x` with it — so a button that swells on
       hover had its edge cut off against the panel's own bounds. The padding is
       the growth (5% of a button), and the offset above gives it back, so the
       copy sits exactly where it did. */
    padding:5px 10px;
    --fade-top:0;--fade-bottom:0;--fade-size:28px;
    -webkit-mask-image:var(--edge-fade);mask-image:var(--edge-fade);
    /* The crossfade puts the panel on its own compositing layer for as long as
       it runs, and text is smoothed differently there — so the last frame of
       every fade handed the type back to the other smoothing and the whole
       panel appeared to darken on arrival. Held to one smoothing, and the
       layer kept rather than made and dropped, the fade ends where it looks
       like it is ending. */
    -webkit-font-smoothing:antialiased;will-change:opacity}
  .pf-face :global(.onb-note){margin:0;color:var(--hub-ink)}
  .pf-face :global(.onb-note.warn){color:#f87171}
  .pf-face :global(.onb-eyebrow){margin:0;color:var(--hub-ink)}
  .pf-face :global(.onb-state){color:var(--hub-ink)}
  .pf-name{margin:0;color:var(--hub-ink);font-size:16px;font-weight:650;letter-spacing:-.02em}
  /* The number carries the screen, so it is set like a headline and the word
     after it steps back to a caption. */
  .pf-count{display:flex;align-items:baseline;gap:8px;margin:0;color:var(--hub-ink);font-size:40px;font-weight:680;letter-spacing:-.04em;line-height:1}
  .pf-count span{font-size:14px;font-weight:560;letter-spacing:-.01em;color:var(--hub-ink-soft)}
  /* Overlapped left to right, each one cut into the one before by its ring, so
     the row reads as a stack of the same kind of thing. */
  .pf-stack{display:flex;margin:14px 0 2px;padding-left:2px}
  .pf-stack-mark,.pf-stack-more{display:grid;place-items:center;width:32px;height:32px;flex:none;
    border-radius:50%;border:1.5px solid var(--hub-fill);background:var(--hub-ink);color:var(--hub-fill);
    font-size:11px;font-weight:650;
    margin-left:-9px;z-index:calc(20 - var(--i,0))}
  .pf-stack-mark:first-child{margin-left:0}
  .pf-stack-mark img{width:18px;height:18px;object-fit:contain}
  .pf-stack-more{background:rgb(from var(--hub-ink) r g b / .22);color:var(--hub-ink);font-size:10.5px}
  .pf-actions{margin-top:8px}
  /* Its own row under the step's own button, never beside it. */
  .pf-back{flex-basis:100%;text-align:left;text-decoration:underline;text-underline-offset:3px}
  /* One row per linked account: who it is, how it is doing, and the way out.
     Rows rather than prose because the count is open-ended. */
  .pf-accounts{margin:2px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px;width:100%;
    /* About four rows. Someone with nine mailboxes still has to reach the form
       underneath, and a list that grows without limit takes it off screen. */
    max-height:172px;overflow-y:auto;overscroll-behavior:contain;
    --fade-top:0;--fade-bottom:0;--fade-size:22px;
    -webkit-mask-image:var(--edge-fade);mask-image:var(--edge-fade)}
  .pf-accounts li{display:flex;align-items:baseline;gap:8px;padding:6px 10px;border-radius:9px;background:rgb(from var(--hub-ink) r g b / .07)}
  .pf-accounts li.warn{background:rgb(248 113 113 / .13)}
  .pf-account-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--hub-ink);font-size:12.5px;font-weight:560}
  .pf-account-state{flex:none;color:var(--hub-ink-soft);font-size:10.5px}
  .pf-account-drop{flex:none;border:0;padding:0;background:none;color:var(--hub-ink-soft);font-family:inherit;font-size:10.5px;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
  .pf-account-drop:hover:not(:disabled){color:var(--hub-ink)}
  .pf-account-drop:disabled{opacity:.55;cursor:default}
  /* Alternatives, not actions: quieter than the button that finishes the flow
     on screen, but plainly clickable. */
  /* Every way into a platform, as a list rather than one-at-a-time: each row
     is the whole target, so the choice is read and taken in one move. */
  /* The seat's own mark, brought into the panel so the thing being set up is
     named twice: once in letters, once in the logo you actually recognise.
     No hairline ring — the seats carry one to lift them off the page, and on
     this ground it would only draw a circle around a circle.

     The disc stays light in both themes for the same reason the QR code does:
     brand marks are drawn for a light ground, and the panel's own ground
     inverts underneath them. In dark mode it lands on the panel's near-white
     fill and simply disappears, which is the correct result. */
  .pf-face-mark{display:grid;place-items:center;width:46px;height:46px;flex:none;border-radius:50%;background:#fff;margin-bottom:4px}
  .pf-face-mark img{width:56%;height:56%;object-fit:contain}
  .pf-providers{width:100%;display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
  .pf-provider{display:inline-flex;align-items:center;gap:6px;border:1px solid rgb(from var(--hub-ink) r g b / .22);border-radius:999px;padding:5px 11px 5px 7px;background:none;color:var(--hub-ink-soft);font-family:inherit;font-size:11.5px;font-weight:530;cursor:pointer;transition:border-color .16s,color .16s,background-color .16s}
  .pf-provider img{width:15px;height:15px;border-radius:50%;background:#fff;object-fit:contain;padding:1px}
  .pf-provider:hover{border-color:var(--hub-ink);color:var(--hub-ink)}
  .pf-provider.on{border-color:var(--hub-ink);background:var(--hub-ink);color:var(--hub-fill)}
  .pf-provider:focus-visible{outline:2px solid var(--hub-ink);outline-offset:2px}
  /* Full width and stacked, because signing in is the way in rather than one
     option among the pills below it. */
  .pf-signin{width:100%;display:flex;flex-direction:column;gap:7px;margin:0 0 4px}
  .pf-signin-button{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid rgb(from var(--hub-ink) r g b / .22);border-radius:9px;padding:9px 12px;background:none;color:var(--hub-ink);font-family:inherit;font-size:12.5px;font-weight:560;cursor:pointer;transition:border-color .16s,background-color .16s,opacity .16s}
  .pf-signin-button img{width:16px;height:16px;border-radius:50%;background:#fff;object-fit:contain;padding:1px}
  .pf-signin-button:hover:not(:disabled){border-color:var(--hub-ink)}
  .pf-signin-button:disabled{opacity:.55;cursor:default}
  .pf-signin-button:focus-visible{outline:2px solid var(--hub-ink);outline-offset:2px}
  .pf-methods{width:100%;margin:2px 0 0;padding:0;list-style:none;display:flex;flex-direction:column}
  .pf-methods li + li{border-top:1px solid rgb(from var(--hub-ink) r g b / .14)}
  .pf-method{width:100%;display:flex;align-items:center;gap:12px;padding:11px 0;border:0;background:none;color:var(--hub-ink);font-family:inherit;text-align:left;cursor:pointer;transition:opacity .16s}
  .pf-method:hover:not(:disabled){opacity:.72}
  .pf-method:disabled{opacity:.45;cursor:default}
  .pf-method:focus-visible{outline:2px solid var(--hub-ink);outline-offset:2px;border-radius:6px}
  .pf-method-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
  .pf-method-copy strong{font-size:12.5px;font-weight:560;letter-spacing:-.01em}
  .pf-method-copy small{color:var(--hub-ink-soft);font-size:11px;line-height:1.45}
  /* Buttons and fields flip with the disc: the page's own styles assume the
     page's background, which is the one colour that is not behind them here. */
  .pf-face :global(.onb-button){--onb-button-edge:rgb(from var(--hub-ink) r g b / .28);--onb-button-surface:transparent;color:var(--hub-ink)}
  .pf-face :global(.onb-button.primary){--onb-button-edge:var(--hub-ink);--onb-button-surface:var(--hub-ink);color:var(--hub-fill)}
  .pf-face :global(.onb-quiet){color:var(--hub-ink-soft)}
  .pf-face :global(.onb-quiet:hover){color:var(--hub-ink)}
  .pf-field{width:100%;margin-top:2px}
  .pf-field :global(span){color:var(--hub-ink-soft)}
  .pf-field :global(input){border-color:rgb(from var(--hub-ink) r g b / .28);background:rgb(from var(--hub-ink) r g b / .08);color:var(--hub-ink)}
  .pf-field :global(input:focus){border-color:var(--hub-ink);outline:none}
  .pf-field :global(input::placeholder){color:rgb(from var(--hub-ink) r g b / .4)}
  .pf-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%}
  /* A grid track will not shrink below its content's own width unless it is
     told it may, and an input is as wide as its placeholder — so without this
     the two server fields push the panel out and the second one is cut off. */
  .pf-pair > *{min-width:0}

  /* White ground regardless of theme: a dark-inverted symbol will not scan. */
  .pf-qr{width:168px;padding:10px;border-radius:12px;background:#fff}
  .pf-qr svg{width:100%;height:auto;display:block;shape-rendering:crispEdges}
  .pf-qr img{width:100%;height:auto;display:block}
  /* The placeholder holds the exact box the real code will fill, so nothing
     under it moves when it lands. It stays on the ink rather than the white
     ground: a blank white square reads as a QR that failed to draw. */
  .pf-skeleton-qr{width:168px;height:168px;padding:0;background:rgb(from var(--hub-ink) r g b / .12);animation:pf-skeleton 1.4s ease-in-out infinite}
  .pf-skeleton-lines{width:100%;display:flex;flex-direction:column;gap:9px}
  .pf-skeleton-lines span{height:34px;border-radius:9px;background:rgb(from var(--hub-ink) r g b / .12);animation:pf-skeleton 1.4s ease-in-out infinite}
  .pf-skeleton-lines span:last-child{width:62%;animation-delay:.18s}
  @keyframes pf-skeleton{0%,100%{opacity:.5}50%{opacity:1}}
  /* Emoji render larger than digits at the same size; even out the read. */
  .pf-code.emoji{font-size:26px;letter-spacing:.3em}
  .pf-field-hint{display:block;margin-top:3px;color:var(--hub-ink-soft);font-size:10.5px;line-height:1.4}
  .pf-code{margin:0;padding:11px 14px;border-radius:11px;background:rgb(from var(--hub-ink) r g b / .12);color:var(--hub-ink);font-size:21px;font-weight:600;letter-spacing:.18em;font-variant-numeric:tabular-nums}

  @media (prefers-reduced-motion:reduce){
    .pf-seat,.pf-seat-mark{transition:opacity .18s ease}
    .pf.live .pf-scene,.pf.live .pf-copy{animation:none}
    .pf-seat:hover:not(:disabled),.pf-seat:focus-visible{transform:translate(-50%,-50%)}
    /* The wait is still readable without the pulse: the note says so in words. */
    .pf-skeleton-qr,.pf-skeleton-lines span{animation:none}
  }
</style>
