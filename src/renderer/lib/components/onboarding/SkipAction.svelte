<script lang="ts">
  import {getContext} from 'svelte';

  /**
   * Past this step, not out of setup: skipping answers the screen in front of
   * you with "nothing", and the deck moves on. It rides in the step's own
   * action row, beside the way forward, because that is the decision it is
   * part of — the way back lives in the window's corner instead.
   *
   * Every step that renders one keeps it for as long as it is on the deck: it
   * belongs to the screen, not to wherever the deck currently is, so pressing
   * it cannot make it disappear out from under the pan it just started.
   */
  const context = getContext<{skip: () => void} | undefined>('onb-skip');
</script>

{#if context}
  <button type="button" class="onb-quiet onb-skip" onclick={context.skip}>Skip</button>
{/if}
