<script lang="ts">
  /**
   * The voice orb, shown here purely as a picture of what Polymux is.
   *
   * This is the same visualiser the real voice mode uses — the WebGL orb, with
   * the canvas orb as a fallback — driven by a synthesised speech envelope
   * rather than a microphone. Nothing is recorded, no audio device is opened,
   * and no session exists: it is fed numbers that behave the way speech
   * behaves, so the shape moves the way it will when you actually talk to it.
   */
  import {onDestroy, onMount} from 'svelte';
  import {startVoiceOrb, type VoiceOrbHandle} from '../../shared/voice/voiceOrb';

  interface Props {
    /** False while the deck has this slide parked off camera. */
    active?: boolean;
  }

  const {active = true}: Props = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let orb: VoiceOrbHandle | null = null;
  let mounted = true;
  let frame = 0;

  /**
   * A stand-in for the loudness of a voice.
   *
   * Four things, layered, and all four are needed. Phrases with short breaths
   * between them. Syllables chopping the inside of a phrase. A loudness that
   * differs from one phrase to the next, so the shape does not reach the same
   * size every time. And three frequency bands with their own slow weights, so
   * which one dominates keeps changing and the orb deforms differently rather
   * than only scaling. Everything is a sum of sines at unrelated rates, so no
   * second of this "audio" ever comes back around.
   */
  function speechAt(t: number): {level: number; low: number; mid: number; high: number} {
    // The gate spends most of its time open, dipping shut only briefly — long
    // silences read as the thing having stopped rather than as a breath.
    const gate = Math.max(
      0,
      Math.min(1, (Math.sin(t * 0.51) * 0.6 + Math.sin(t * 0.29 + 2.1) * 0.4 + 0.95) * 1.6),
    );

    // How loud this particular phrase is. Without it every phrase peaks at the
    // same height, and a shape that always reaches the same size is read as a
    // loop even when the detail underneath is changing. Two slow terms out of
    // step, so quiet passages and emphatic ones arrive in no fixed order.
    const energy =
      0.34 + 0.42 * (0.5 + 0.5 * Math.sin(t * 0.113)) + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.067 + 2.7));

    // Syllables, at three unrelated rates so the chop never falls into a beat.
    const syllables =
      0.5 + 0.26 * Math.sin(t * 12.7) + 0.18 * Math.sin(t * 8.3 + 0.8) + 0.14 * Math.sin(t * 5.1 + 2.4);
    // A stressed syllable every few seconds: narrow, occasional, and the thing
    // that keeps the top of the range from being a ceiling the orb sits at.
    const stress = Math.pow(Math.max(0, Math.sin(t * 0.83 + 1.3)), 7) * 0.75;

    // Gain kept just under the point where the sum would spend its time
    // pinned at 1: a level that saturates is a level with no dynamics left,
    // which is exactly what makes a visualiser look like it is idling at full
    // tilt rather than reacting to anything.
    const level = Math.max(0, Math.min(1, gate * energy * (Math.max(0, syllables) + stress) * 1.1));

    // Each band gets its own slow weight as well as its own rate, so which one
    // is loudest keeps changing: a passage where the lows swell and the orb
    // rounds out, another where the highs chatter and its surface breaks up.
    // If the three moved together the shape would only ever scale.
    const lowWeight = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.091 + 0.4));
    const midWeight = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.127 + 3.1));
    const highWeight = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 0.073 + 5.2));
    return {
      level,
      low: level * lowWeight * (0.7 + 0.3 * Math.sin(t * 2.7)),
      mid: level * midWeight * (0.6 + 0.4 * Math.sin(t * 9.4 + 2.2)),
      high: level * highWeight * (0.3 + 0.7 * Math.max(0, Math.sin(t * 19.3 + 0.4))),
    };
  }

  async function start(): Promise<void> {
    const element = canvas;
    if (!element) return;
    // Three.js is the weight worth splitting out, so the WebGL orb stays a
    // dynamic import and first-run does not pay for it. The 2D fallback is
    // imported normally: the chat's orb pulls the same module in statically,
    // so asking for it lazily here only produced a chunk the bundler could not
    // actually separate. Any WebGL failure falls back to it rather than
    // leaving the panel empty.
    try {
      const {startThreeVoiceOrb} = await import('../../shared/voice/voiceOrbThree');
      if (!mounted) return;
      orb = startThreeVoiceOrb(element, 'listening');
    } catch {
      if (!mounted) return;
      orb = startVoiceOrb(element, 'listening');
    }

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      orb?.setState('listening');
      orb?.setLevel(0.12, {low: 0.12, mid: 0.1, high: 0.05});
      return;
    }

    const started = performance.now();
    let speaking = false;
    const feed = (now: number): void => {
      // Off camera the effect below has parked the orb; feeding it here would
      // wake it back up on the next phrase and waste frames on an unseen slide.
      if (!active) {
        // Forget mid-phrase state so coming back on camera re-derives it.
        speaking = false;
        frame = requestAnimationFrame(feed);
        return;
      }
      const t = (now - started) / 1000;
      const audio = speechAt(t);
      // The state is inferred from the envelope the same way the real session
      // infers it: sound means speaking, silence means back to listening.
      const talking = audio.level > 0.06;
      if (talking !== speaking) {
        speaking = talking;
        orb?.setState(talking ? 'speaking' : 'listening');
      }
      orb?.setLevel(audio.level, {low: audio.low, mid: audio.mid, high: audio.high});
      frame = requestAnimationFrame(feed);
    };
    frame = requestAnimationFrame(feed);
  }

  onMount(() => {
    void start();
  });

  // Off camera the orb holds still rather than miming a conversation nobody is
  // watching.
  $effect(() => {
    orb?.setState(active ? 'listening' : 'connecting');
  });

  onDestroy(() => {
    mounted = false;
    cancelAnimationFrame(frame);
    orb?.destroy();
    orb = null;
  });
</script>

<div class="mind-orb">
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>

<style>
  .mind-orb{width:100%;height:100%;display:grid;place-items:center}
  /* Square, and sized off the smaller viewport axis so the orb keeps room to
     bulge on a loud syllable without meeting the panel's edges. */
  canvas{width:min(100%,clamp(300px,78vmin,720px));aspect-ratio:1;display:block}
</style>
