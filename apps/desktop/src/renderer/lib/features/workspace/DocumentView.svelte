<script lang="ts">
  import {t} from '../../../i18n';

  /** Empty falls back to the catalog, so the view follows the language. */
  export let title = '';
  export let placeholder = '';

  $: name = title || $t('view.document');
</script>

<div class="artifact-draft document-draft" aria-label={name}>
  <div class="draft-page" contenteditable="true" role="textbox" aria-label={name} aria-multiline="true" data-placeholder={placeholder || $t('view.startWriting')}></div>
</div>
