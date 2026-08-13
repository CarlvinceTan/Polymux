<script lang="ts">
  export let title = 'Document';
  export let placeholder = 'Start writing…';
</script>

<div class="artifact-draft document-draft" aria-label={title}>
  <div class="draft-page" contenteditable="true" role="textbox" aria-label={title} aria-multiline="true" data-placeholder={placeholder}></div>
</div>
