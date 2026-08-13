<script module lang="ts">
  export type FileAttachmentStatus = 'uploading' | 'done' | 'error';
</script>

<script lang="ts">
  export let name: string;
  export let status: FileAttachmentStatus = 'done';
  export let progress = 100;
  export let removable = true;
  export let halfRow = false;
  export let onRemove: () => void = () => {};

  const radius = 5;
  const circumference = 2 * Math.PI * radius;
  $: boundedProgress = Math.min(100, Math.max(0, progress));
  $: dashOffset = circumference - (boundedProgress / 100) * circumference;
</script>

<span class:half-row={halfRow} class:is-error={status === 'error'} class="file-attachment">
  {#if status === 'uploading'}
    <svg class="file-status upload-progress" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r={radius} fill="none" stroke="currentColor" stroke-width="1.5" class="progress-track"/>
      <circle
        cx="6"
        cy="6"
        r={radius}
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        class="progress-value"
        stroke-dasharray={circumference}
        stroke-dashoffset={dashOffset}
      />
    </svg>
  {:else if status === 'error'}
    <svg class="file-status error-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-11.75a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0V7a.75.75 0 0 1 .75-.75Zm0 7a.875.875 0 1 0 0 1.75.875.875 0 0 0 0-1.75Z" clip-rule="evenodd"/>
    </svg>
  {:else}
    <svg class="file-status document-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fill-rule="evenodd" d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V8.5h-5.75A2.25 2.25 0 0 1 10 6.25V2H4.25Zm7.25.19v4.06c0 .414.336.75.75.75h5.56a2.25 2.25 0 0 0-.47-.66l-3.68-3.68a2.25 2.25 0 0 0-2.16-.47Z" clip-rule="evenodd"/>
    </svg>
  {/if}

  <span class="file-label" title={name}>{name}</span>

  {#if removable}
    <button
      type="button"
      class="file-remove"
      aria-label={`Remove ${name}`}
      onclick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z"/>
      </svg>
    </button>
  {/if}
</span>

<style>
  .file-attachment {
    width: fit-content;
    max-width: min(280px, 100%);
    height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    vertical-align: top;
    border: 1px solid var(--neutral-200, #e5e5e5);
    border-radius: 9px;
    margin-inline: 2px;
    padding: 0 5px 0 8px;
    background: #fff;
    color: var(--neutral-700, #404040);
    user-select: none;
  }

  .file-attachment.half-row { max-width: min(180px, 50%); }
  .file-attachment.is-error { border-color: #efb2aa; color: #a5301f; }

  .file-status {
    width: 14px;
    height: 14px;
    flex: none;
  }

  .upload-progress { transform: rotate(-90deg); color: var(--neutral-700, #404040); }
  .progress-track { opacity: 0.2; }
  .progress-value { transition: stroke-dashoffset 180ms ease; }
  .document-icon { color: var(--neutral-500, #737373); }
  .error-icon { color: #b42318; }

  .file-label {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-remove {
    width: 18px;
    height: 18px;
    display: grid;
    flex: none;
    place-items: center;
    border: 0;
    border-radius: 5px;
    padding: 0;
    background: transparent;
    color: var(--neutral-400, #a3a3a3);
    cursor: pointer;
  }

  .file-remove:hover,
  .file-remove:focus-visible {
    outline: none;
    background: var(--neutral-100, #f5f5f5);
    color: var(--neutral-800, #262626);
  }

  .file-remove svg { width: 13px; height: 13px; }
</style>
