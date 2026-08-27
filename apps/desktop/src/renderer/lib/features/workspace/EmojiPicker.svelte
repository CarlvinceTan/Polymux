<script lang="ts">
  import {onMount, tick} from 'svelte';
  import {cubicInOut} from 'svelte/easing';
  import {t} from '../../../i18n';
  import Icon from '../../shared/components/Icon.svelte';

  export let onpick: (emoji: string) => void = () => {};
  export let direction: 'above' | 'below' = 'above';
  export let ariaLabel = '';

  /** A compact, deliberately common set: broad enough to search, small enough
   * to remain an instant reaction picker rather than a second character app. */
  const EMOJIS = [
    ['😀', 'grinning face', 'smile happy'], ['😃', 'smiling face', 'happy joy'],
    ['😄', 'smiling eyes', 'happy laugh'], ['😁', 'beaming face', 'grin happy'],
    ['😆', 'squinting face', 'laugh happy'], ['😅', 'sweat smile', 'relief nervous'],
    ['😂', 'tears of joy', 'laugh crying'], ['🤣', 'rolling laughing', 'rofl laugh'],
    ['🥲', 'smiling tear', 'touched bittersweet'], ['😊', 'warm smile', 'happy blush'],
    ['😇', 'halo', 'angel innocent'], ['🙂', 'slight smile', 'happy'],
    ['🙃', 'upside down', 'silly sarcasm'], ['😉', 'wink', 'playful'],
    ['😌', 'relieved face', 'calm content'], ['😍', 'heart eyes', 'love crush'],
    ['🥰', 'hearts face', 'love affection'], ['😘', 'blowing kiss', 'love'],
    ['😗', 'kissing face', 'kiss'], ['😋', 'savouring food', 'yum tasty'],
    ['😛', 'tongue', 'playful silly'], ['😜', 'winking tongue', 'silly playful'],
    ['🤪', 'zany face', 'wild silly'], ['🤨', 'raised eyebrow', 'skeptical doubt'],
    ['🧐', 'monocle face', 'thinking inspect'], ['🤓', 'nerd face', 'smart glasses'],
    ['😎', 'sunglasses', 'cool'], ['🥳', 'party face', 'celebrate birthday'],
    ['😏', 'smirk', 'flirt smug'], ['😒', 'unamused face', 'annoyed'],
    ['😞', 'disappointed face', 'sad'], ['😔', 'pensive face', 'sad thoughtful'],
    ['😟', 'worried face', 'concern'], ['😕', 'confused face', 'unsure'],
    ['🙁', 'frowning face', 'sad'], ['☹️', 'frown', 'sad'],
    ['😣', 'persevering face', 'struggle'], ['😖', 'confounded face', 'frustrated'],
    ['😫', 'tired face', 'exhausted'], ['😩', 'weary face', 'tired'],
    ['🥺', 'pleading face', 'please puppy eyes'], ['😢', 'crying face', 'sad tear'],
    ['😭', 'loudly crying', 'sad tears'], ['😤', 'steam face', 'triumph angry'],
    ['😠', 'angry face', 'mad'], ['😡', 'enraged face', 'angry mad'],
    ['🤬', 'swearing face', 'angry curse'], ['🤯', 'mind blown', 'shocked wow'],
    ['😳', 'flushed face', 'embarrassed surprised'], ['🥵', 'hot face', 'heat'],
    ['🥶', 'cold face', 'freezing'], ['😱', 'screaming face', 'shock fear'],
    ['😨', 'fearful face', 'scared'], ['😰', 'anxious sweat', 'nervous'],
    ['😥', 'sad relieved', 'sweat'], ['😓', 'downcast sweat', 'tired'],
    ['🤗', 'hugging face', 'hug support'], ['🤔', 'thinking face', 'hmm question'],
    ['🫡', 'saluting face', 'respect yes'], ['🤭', 'hand over mouth', 'giggle oops'],
    ['🫢', 'open eyes hand mouth', 'surprise gasp'], ['🤫', 'shushing face', 'quiet secret'],
    ['🤥', 'lying face', 'lie pinocchio'], ['😶', 'no mouth', 'silent speechless'],
    ['🫠', 'melting face', 'awkward heat'], ['🙄', 'rolling eyes', 'annoyed'],
    ['😮', 'open mouth', 'wow surprise'], ['😲', 'astonished face', 'shock surprise'],
    ['🥱', 'yawning face', 'sleepy bored'], ['😴', 'sleeping face', 'tired zzz'],
    ['🤤', 'drooling face', 'hungry'], ['🤢', 'nauseated face', 'sick'],
    ['🤮', 'vomiting face', 'sick'], ['🤧', 'sneezing face', 'sick'],
    ['🥴', 'woozy face', 'dizzy'], ['😵', 'dizzy face', 'knocked out'],
    ['🤠', 'cowboy face', 'western'], ['😈', 'smiling devil', 'mischief'],
    ['💩', 'poop', 'funny'], ['🤡', 'clown face', 'circus'],

    ['👍', 'thumbs up', 'yes approve like'], ['👎', 'thumbs down', 'no disapprove'],
    ['👌', 'ok hand', 'good perfect'], ['🤌', 'pinched fingers', 'italian gesture'],
    ['🤏', 'pinching hand', 'small little'], ['✌️', 'victory hand', 'peace two'],
    ['🤞', 'crossed fingers', 'luck hope'], ['🫰', 'finger heart', 'love'],
    ['🤟', 'love you gesture', 'ily'], ['🤘', 'rock hand', 'horns music'],
    ['🤙', 'call me hand', 'phone shaka'], ['👈', 'point left', 'direction'],
    ['👉', 'point right', 'direction'], ['👆', 'point up', 'direction'],
    ['👇', 'point down', 'direction'], ['☝️', 'index finger', 'one point'],
    ['✋', 'raised hand', 'stop high five'], ['🤚', 'backhand raised', 'stop'],
    ['🖐️', 'five fingers', 'hand'], ['🖖', 'vulcan salute', 'spock'],
    ['👋', 'waving hand', 'hello goodbye'], ['👏', 'clapping hands', 'applause congrats'],
    ['🙌', 'raised hands', 'celebrate hooray'], ['🫶', 'heart hands', 'love support'],
    ['🤝', 'handshake', 'deal agreement'], ['🙏', 'folded hands', 'please thanks pray'],
    ['💪', 'flexed biceps', 'strong muscle'], ['🫂', 'people hugging', 'support hug'],
    ['🤷', 'shrug', 'unsure whatever'], ['🤦', 'facepalm', 'oops frustrated'],
    ['🙈', 'see no evil', 'monkey embarrassed'], ['🙉', 'hear no evil', 'monkey'],
    ['🙊', 'speak no evil', 'monkey secret'], ['👀', 'eyes', 'look watching'],
    ['🧠', 'brain', 'smart thinking'], ['🫀', 'heart organ', 'health'],

    ['❤️', 'red heart', 'love'], ['🩷', 'pink heart', 'love'],
    ['🧡', 'orange heart', 'love'], ['💛', 'yellow heart', 'love'],
    ['💚', 'green heart', 'love'], ['💙', 'blue heart', 'love'],
    ['💜', 'purple heart', 'love'], ['🖤', 'black heart', 'love dark'],
    ['🤍', 'white heart', 'love'], ['🤎', 'brown heart', 'love'],
    ['💔', 'broken heart', 'sad breakup'], ['❤️‍🔥', 'heart on fire', 'love passion'],
    ['💕', 'two hearts', 'love'], ['💞', 'revolving hearts', 'love'],
    ['💓', 'beating heart', 'love'], ['💗', 'growing heart', 'love'],
    ['💖', 'sparkling heart', 'love'], ['💘', 'heart arrow', 'love cupid'],
    ['💯', 'hundred points', 'perfect agree'], ['💥', 'collision', 'boom impact'],
    ['✨', 'sparkles', 'magic shine'], ['⭐', 'star', 'favourite'],
    ['🌟', 'glowing star', 'shine'], ['🔥', 'fire', 'hot lit flame'],
    ['🎉', 'party popper', 'celebrate congrats'], ['🎊', 'confetti ball', 'celebrate'],
    ['✅', 'check mark', 'yes done correct'], ['❌', 'cross mark', 'no wrong'],
    ['❗', 'exclamation mark', 'important'], ['❓', 'question mark', 'what help'],
    ['💡', 'light bulb', 'idea'], ['🚩', 'red flag', 'warning'],

    ['🐶', 'dog face', 'pet animal'], ['🐱', 'cat face', 'pet animal'],
    ['🐭', 'mouse face', 'animal'], ['🐹', 'hamster face', 'pet animal'],
    ['🐰', 'rabbit face', 'bunny animal'], ['🦊', 'fox face', 'animal'],
    ['🐻', 'bear face', 'animal'], ['🐼', 'panda face', 'animal'],
    ['🐨', 'koala face', 'animal'], ['🐯', 'tiger face', 'animal'],
    ['🦁', 'lion face', 'animal'], ['🐮', 'cow face', 'animal'],
    ['🐷', 'pig face', 'animal'], ['🐸', 'frog face', 'animal'],
    ['🐵', 'monkey face', 'animal'], ['🦄', 'unicorn', 'animal magic'],
    ['🐝', 'bee', 'animal insect'], ['🦋', 'butterfly', 'animal insect'],
    ['🐢', 'turtle', 'animal slow'], ['🐙', 'octopus', 'animal sea'],
    ['🌸', 'cherry blossom', 'flower spring'], ['🌹', 'rose', 'flower love'],
    ['🌻', 'sunflower', 'flower'], ['🌈', 'rainbow', 'weather pride'],
    ['☀️', 'sun', 'weather bright'], ['🌙', 'moon', 'night'],

    ['🍎', 'red apple', 'food fruit'], ['🍓', 'strawberry', 'food fruit'],
    ['🍉', 'watermelon', 'food fruit'], ['🍕', 'pizza', 'food'],
    ['🍔', 'hamburger', 'food'], ['🍟', 'fries', 'food'],
    ['🍜', 'noodles', 'food ramen'], ['🍣', 'sushi', 'food'],
    ['🍰', 'cake', 'food dessert birthday'], ['🎂', 'birthday cake', 'celebrate food'],
    ['🍿', 'popcorn', 'food movie'], ['☕', 'coffee', 'drink morning'],
    ['🍻', 'beer mugs', 'drink cheers'], ['🥂', 'clinking glasses', 'drink cheers celebrate'],
    ['⚽', 'soccer ball', 'sport football'], ['🏀', 'basketball', 'sport'],
    ['🏆', 'trophy', 'winner sport'], ['🎮', 'video game', 'gaming controller'],
    ['🎵', 'music note', 'song'], ['🎧', 'headphones', 'music'],
    ['🚀', 'rocket', 'space launch'], ['✈️', 'airplane', 'travel flight'],
    ['🚗', 'car', 'travel drive'], ['🏠', 'house', 'home'],
    ['💻', 'laptop', 'computer work'], ['📱', 'phone', 'mobile'],
    ['📸', 'camera flash', 'photo'], ['🎁', 'gift', 'present'],
  ] as const;

  let query = '';
  let searchInput: HTMLInputElement;
  let grid: HTMLDivElement;
  let atTop = true;
  let atBottom = false;

  /** Reveals a fixed-size inner picker through a changing-height viewport.
   * Unlike `slide`, this never scales the top padding, so a picker opening
   * below the quick row cannot settle with a final search-field nudge. */
  function reveal(node: HTMLElement) {
    const height = Number.parseFloat(getComputedStyle(node).height);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      duration: reducedMotion ? 0 : 320,
      easing: cubicInOut,
      css: (progress: number) => {
        const opacity = Math.min(progress * 4, 1);
        const edge = `rgba(0,0,0,${progress})`;
        return `height:${height * progress}px;min-height:0;overflow:clip;opacity:${opacity};` +
          `-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 12px),${edge} 100%);` +
          `mask-image:linear-gradient(to bottom,#000 calc(100% - 12px),${edge} 100%)`;
      },
    };
  }

  $: needle = query.trim().toLocaleLowerCase();
  $: filtered = EMOJIS.filter((entry) =>
    !needle || `${entry[0]} ${entry[1]} ${entry[2]}`.toLocaleLowerCase().includes(needle),
  );
  $: if (filtered) void tick().then(measureEdges);

  function measureEdges(): void {
    if (!grid) return;
    atTop = grid.scrollTop <= 1;
    atBottom = grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 1;
  }

  onMount(() => {
    searchInput.focus();
    measureEdges();
  });
</script>

<div
  class="hub-view-emoji-picker"
  class:above={direction === 'above'}
  class:below={direction === 'below'}
  role="group"
  aria-label={ariaLabel || $t('hub.react')}
  transition:reveal
>
  <div class="hub-view-emoji-picker-content">
    <label class="hub-view-emoji-search">
      <Icon name="search" size={13} />
      <input
        bind:this={searchInput}
        bind:value={query}
        type="search"
        autocomplete="off"
        aria-label={$t('common.search')}
        placeholder={$t('common.search')}
      />
    </label>
    <div
      class="hub-view-emoji-grid"
      class:at-top={atTop}
      class:at-bottom={atBottom}
      class:empty={filtered.length === 0}
      bind:this={grid}
      onscroll={measureEdges}
    >
      {#each filtered as emoji (emoji[0])}
        <button type="button" aria-label={emoji[1]} onclick={() => onpick(emoji[0])}>{emoji[0]}</button>
      {:else}
        <span>{$t('common.noMatches')}</span>
      {/each}
    </div>
  </div>
</div>
