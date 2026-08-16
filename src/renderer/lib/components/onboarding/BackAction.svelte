<script lang="ts">
  import {getContext} from 'svelte';
  import {t} from '../../i18n';

  /**
   * The way back to the screen before this one. It rides in the step's own
   * action row, beside the way forward, because leaving a screen unanswered is
   * part of the same decision — the way out of setup entirely lives in the
   * window's corner instead.
   *
   * Every step that renders one keeps it for as long as it is on the deck: it
   * belongs to the screen, not to wherever the deck currently is, so pressing
   * it cannot make it disappear out from under the pan it just started.
   */
  const context = getContext<{back: () => void} | undefined>('onb-deck');
</script>

{#if context}
  <button type="button" class="onb-quiet onb-step-back" onclick={context.back}>
    {$t('onboarding.back')}
  </button>
{/if}
