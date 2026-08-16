<script lang="ts">
  import {t} from '../../i18n';

  /** Empty falls back to the catalog, so the view follows the language. */
  export let title = '';
  export let heading = '';
  export let body = '';
</script>

<div class="artifact-draft presentation-draft" aria-label={title || $t('view.slides')}>
  <div class="draft-slide">
    <div class="draft-slide-title" contenteditable="true" role="textbox" aria-label={$t('view.slideTitle')}>{heading || $t('view.slideTitle')}</div>
    <div class="draft-slide-body" contenteditable="true" role="textbox" aria-label={$t('view.slideBody')}>{body || $t('view.slideBodyPlaceholder')}</div>
  </div>
</div>
