<script lang="ts">
  export let title = 'Slides';
  export let heading = 'Slide title';
  export let body = 'Supporting detail for this slide.';
</script>

<div class="artifact-draft presentation-draft" aria-label={title}>
  <div class="draft-slide">
    <div class="draft-slide-title" contenteditable="true" role="textbox" aria-label="Slide title">{heading}</div>
    <div class="draft-slide-body" contenteditable="true" role="textbox" aria-label="Slide body">{body}</div>
  </div>
</div>
