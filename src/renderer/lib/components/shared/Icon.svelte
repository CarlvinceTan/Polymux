<script lang="ts">
  export let name:
    | 'summary' | 'panel' | 'plus' | 'close' | 'send' | 'mic' | 'waveform' | 'stop'
    | 'attach' | 'options' | 'verified' | 'globe' | 'file' | 'task' | 'back'
    | 'forward' | 'reload' | 'download' | 'more' | 'ellipsis' | 'trash' | 'expand' | 'collapse' | 'chevron' | 'arrow-down'
    | 'bolt' | 'document-text' | 'paper-airplane' | 'history' | 'new-chat'
    | 'copy' | 'check' | 'edit' | 'thumb-up' | 'thumb-down' | 'search' | 'terminal' | 'wrench' | 'book-open'
    | 'connections' | 'link' | 'grip' | 'steer' | 'play' | 'pause' | 'speaker' | 'speaker-off' | 'mic-off' | 'chat'
    | 'document' | 'presentation' | 'folder' | 'pdf' | 'spreadsheet' | 'image' | 'audio' | 'video' | 'code'
    | 'calendar' | 'clock' | 'sun' | 'goal' | 'users' | 'briefcase' | 'banknote' | 'workflow' | 'survey' | 'chart' | 'filter' | 'sort'
    | 'mail';
  export let size = 20;
  export let strokeWidth = 1.7;
  export let filled = false;
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  data-icon={name}
>
  {#if name === 'summary'}
    <circle cx="6" cy="5" r="1.5"/><circle cx="6" cy="12" r="1.5"/><circle cx="6" cy="19" r="1.5"/><path d="M10 5h9M10 12h9M10 19h9"/>
  {:else if name === 'panel'}
    <rect x="4" y="4.5" width="16" height="15" rx="3"/><path d="M15 5v14"/>
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14"/>
  {:else if name === 'close'}
    <path d="m7 7 10 10M17 7 7 17"/>
  {:else if name === 'send'}
    <path d="M7 17 17 7M17 7H9M17 7v8"/>
  {:else if name === 'mic'}
    <rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>
  {:else if name === 'mic-off'}
    <path d="m4 4 16 16M9 6v5a3 3 0 0 0 4.7 2.5M15 10V6a3 3 0 0 0-5.7-1.3M5.5 11a6.5 6.5 0 0 0 10.7 5M12 17.5V21M9 21h6"/>
  {:else if name === 'play'}
    <path d="m9 6 9 6-9 6z" fill="currentColor" stroke="none"/>
  {:else if name === 'pause'}
    <path d="M8 6v12M16 6v12" stroke-width="2.4"/>
  {:else if name === 'speaker'}
    <path d="M5 10v4h4l5 4V6l-5 4zM17 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/>
  {:else if name === 'speaker-off'}
    <path d="M5 10v4h4l5 4V6l-5 4zM17 10l4 4M21 10l-4 4"/>
  {:else if name === 'chat'}
    <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>
  {:else if name === 'waveform'}
    <path d="M4 9.8v4.4M7.2 6.4v11.2M10.4 8.7v6.6M13.6 4.8v14.4M16.8 7.3v9.4M20 10.1v3.8" stroke-width="2.5"/>
  {:else if name === 'stop'}
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>
  {:else if name === 'attach'}
    <path d="m20.5 11.5-8.2 8.2a6 6 0 0 1-8.5-8.5l8.5-8.5a4 4 0 0 1 5.7 5.7l-8.5 8.5a2 2 0 0 1-2.9-2.8l7.8-7.8"/>
  {:else if name === 'options'}
    <!-- The original Polymux glyph, authored on a 20x20 grid; scaled 1.2 onto
         this component's 24x24 viewBox. The transform scales the stroke too,
         so 1.5 here renders at the same weight it did originally. -->
    <path d="M4 5h8m3 0h1M4 10h1m3 0h8M4 15h5m3 0h4M12 3v4M5 8v4M9 13v4" transform="scale(1.2)" stroke-width="1.5"/>
  {:else if name === 'verified'}
    <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>
  {:else if name === 'globe'}
    <circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>
  {:else if name === 'file'}
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M15 2v5h5"/>
  {:else if name === 'task'}
    <circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h4a4 4 0 0 1 4 4v0M16 14v0a4 4 0 0 1-4 4H8"/>
  {:else if name === 'back'}
    <path d="m15 18-6-6 6-6"/>
  {:else if name === 'forward'}
    <path d="m9 18 6-6-6-6"/>
  {:else if name === 'reload'}
    <path d="M20 11a8 8 0 1 1-2.34-5.66L20 7.7M20 3v4.7h-4.7"/>
  {:else if name === 'download'}
    <path d="M12 3v12M7 10l5 5 5-5M5 20h14"/>
  {:else if name === 'more'}
    <circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/>
  {:else if name === 'ellipsis'}
    <!-- Proportioned like the old Polymux solid ellipsis: chunkier dots set a
         little tighter than a hairline three-dot glyph. -->
    <circle cx="5.4" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="18.6" cy="12" r="2" fill="currentColor" stroke="none"/>
  {:else if name === 'trash'}
    <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>
  {:else if name === 'expand'}
    <path d="M14 4h6v6M10 20H4v-6"/>
  {:else if name === 'collapse'}
    <path d="M20 14h-6v6M4 10h6V4"/>
  {:else if name === 'chevron'}
    <path d="m8 10 4 4 4-4"/>
  {:else if name === 'arrow-down'}
    <path d="M12 4v16M6 14l6 6 6-6"/>
  {:else if name === 'bolt'}
    <path d="M13 2 4.5 13h7L11 22l8.5-12h-7z"/>
  {:else if name === 'document-text'}
    <path d="M7 3h7l4 4v14H7zM14 3v5h5M10 12h5M10 16h5"/>
  {:else if name === 'paper-airplane'}
    <path d="m21 3-7.5 18-3.8-7.7L2 9.5zM9.7 13.3 21 3"/>
  {:else if name === 'history'}
    <circle cx="12" cy="12" r="8.25"/><path d="M12 7v5l-3 2"/>
  {:else if name === 'new-chat'}
    <g transform="translate(1.435 1.415) scale(.9)">
      <path d="M13 3H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-7"/><path d="m11 13 1.1-3.4L18.7 3a1.6 1.6 0 0 1 2.3 2.3l-6.6 6.6z"/>
    </g>
  {:else if name === 'copy'}
    <rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>
  {:else if name === 'check'}
    <path d="m5 12 4 4L19 6"/>
  {:else if name === 'edit'}
    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>
  {:else if name === 'thumb-up'}
    <path d="M7 10v11H3V10h4Zm0 9h9.2a2 2 0 0 0 1.9-1.4l2.2-7A2 2 0 0 0 18.4 8H14l.7-3.1A2.4 2.4 0 0 0 10.2 3L7 10Z"/>
  {:else if name === 'thumb-down'}
    <path d="M17 14V3h4v11h-4Zm0-9H7.8a2 2 0 0 0-1.9 1.4l-2.2 7A2 2 0 0 0 5.6 16H10l-.7 3.1a2.4 2.4 0 0 0 4.5 1.9L17 14Z"/>
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>
  {:else if name === 'terminal'}
    <rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3M13 15h4"/>
  {:else if name === 'wrench'}
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>
  {:else if name === 'book-open'}
    <path d="M3 5.5A3.5 3.5 0 0 1 6.5 2H11v17H6.5A3.5 3.5 0 0 0 3 22zM21 5.5A3.5 3.5 0 0 0 17.5 2H13v17h4.5a3.5 3.5 0 0 1 3.5 3z"/>
  {:else if name === 'connections'}
    <path d="m10 13 4-4M7.5 15.5l-1 1a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M16.5 8.5l1-1a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0"/>
  {:else if name === 'link'}
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" transform="translate(1.68 1.68) scale(.86)" vector-effect="non-scaling-stroke"/>
  {:else if name === 'grip'}
    <circle cx="9" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1" fill="currentColor" stroke="none"/>
  {:else if name === 'steer'}
    <path d="M4 6v4a5 5 0 0 0 5 5h10M16 12l3 3-3 3"/>
  {:else if name === 'document'}
    <rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h4"/>
  {:else if name === 'presentation'}
    <rect x="4" y="4" width="16" height="12" rx="2"/><path d="M8 20l4-4 4 4M12 16v4M8 9h8M8 12h5"/>
  {:else if name === 'folder'}
    <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
  {:else if name === 'pdf'}
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M15 2v5h5M8 14h8M8 18h5"/>
  {:else if name === 'spreadsheet'}
    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>
  {:else if name === 'image'}
    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="m20 15-4.5-4.5a2 2 0 0 0-2.8 0L5 18"/>
  {:else if name === 'audio'}
    <path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>
  {:else if name === 'video'}
    <rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>
  {:else if name === 'code'}
    <path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>
  {:else if name === 'calendar'}
    <rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M8 14h3M8 17h6"/>
  {:else if name === 'clock'}
    <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
  {:else if name === 'sun'}
    <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/>
  {:else if name === 'goal'}
    <path d="M20.9 10.5a9 9 0 1 1-7.4-7.4"/><path d="M16.4 11.1a4.5 4.5 0 1 1-3.6-3.6"/><circle cx="12" cy="12" r="1.4"/><path d="m12 12 5-5"/><path d="M17 7V3.5L20.5 7H17Z" fill="currentColor"/>
  {:else if name === 'users'}
    <circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M15 5.5a3 3 0 0 1 0 5.8M16 15a5 5 0 0 1 4.5 5"/>
  {:else if name === 'briefcase'}
    <rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2"/>
  {:else if name === 'banknote'}
    <rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M7 9H6v1M17 15h1v-1"/>
  {:else if name === 'workflow'}
    <rect x="3" y="9.5" width="5" height="5" rx="1.5"/><rect x="16" y="3.5" width="5" height="5" rx="1.5"/><rect x="16" y="15.5" width="5" height="5" rx="1.5"/><path d="M8 12h3.5a1.5 1.5 0 0 0 1.5-1.5v-2A2 2 0 0 1 15 6M8 12h3.5a1.5 1.5 0 0 1 1.5 1.5v2a2 2 0 0 0 2 2h1"/>
  {:else if name === 'survey'}
    <path d="M4 4h16v12H8l-4 4z"/><path d="M8 8h8M8 12h5"/>
  {:else if name === 'chart'}
    <path d="M3 20h18"/><rect x="5" y="11" width="3.6" height="9" rx="1"/><rect x="10.2" y="6" width="3.6" height="14" rx="1"/><rect x="15.4" y="9" width="3.6" height="11" rx="1"/>
  {:else if name === 'mail'}
    <rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4.5 8.2 6.6 4.6a1.6 1.6 0 0 0 1.8 0l6.6-4.6"/>
  {:else if name === 'filter'}
    <path d="M4 6h16M7 12h10M10 18h4"/>
  {:else if name === 'sort'}
    <path d="M8 6h10M8 12h7M8 18h4M4 5v14M2 17l2 2 2-2"/>
  {/if}
</svg>
