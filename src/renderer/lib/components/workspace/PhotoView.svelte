<script lang="ts">
  export let title = 'Photo';
</script>

<section class="workspace-view" aria-label={title}>
  <div class="placeholder-icon">▧</div>
  <h2>{title}</h2>
  <p>Photo preview will appear here.</p>
</section>

<style>
  .workspace-view { min-height: 100%; display: grid; place-content: center; justify-items: center; gap: 8px; padding: 32px; color: var(--neutral-700, #404040); text-align: center; }
  .placeholder-icon { display: grid; width: 42px; height: 42px; place-items: center; border: 1px solid var(--neutral-200, #e5e5e5); border-radius: 12px; color: var(--neutral-500, #737373); font-size: 18px; }
  h2 { margin: 0; color: var(--neutral-900, #171717); font-size: 16px; font-weight: 600; }
  p { margin: 0; color: var(--neutral-500, #737373); font-size: 13px; }
</style>
