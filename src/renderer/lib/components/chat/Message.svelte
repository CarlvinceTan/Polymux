<script module lang="ts">
  import {flareaiApi} from '../../api/flareai';

  /** Site icons for links, asked for once per site and shared by every message
   * on screen — the same handful of sites recur across a conversation. */
  const linkFavicons = new Map<string, Promise<string | null>>();

  function linkFavicon(url: string): Promise<string | null> {
    let pending = linkFavicons.get(url);
    if (!pending) {
      pending = flareaiApi().browser.favicon(url).catch(() => null);
      linkFavicons.set(url, pending);
    }
    return pending;
  }

  export type MessageRole = 'user' | 'assistant';
  export type MessageFeedback = 'up' | 'down' | null;

  export type MessageData = {
    id: string;
    role: MessageRole;
    text: string;
    files?: string[];
    feedback?: MessageFeedback;
    sentAt?: string;
    asGoal?: boolean;
    runId?: string;
  };
</script>

<script lang="ts">
  import {onDestroy, tick} from 'svelte';
  import {copyText} from '../../clipboard';
  import {renderMarkdown} from '../../conversation/markdown';
  import Icon from '../shared/Icon.svelte';
  import MessageAction from './MessageAction.svelte';

  export let message: MessageData;
  export let streaming = false;
  /** True when an AgentActivity block is rendered above this message; its
   * live shimmer row is the working indicator, so the dots stand down. */
  export let activityVisible = false;
  export let onEdit: (id: string, text: string, files: File[]) => void = () => {};
  export let onFeedback: (id: string, feedback: MessageFeedback) => void = () => {};
  export let onOpenFile: (name: string) => void = () => {};
  export let onOpenLink: (url: string, title: string) => void = () => {};

  let editing = false;
  let draft = '';
  let copied = false;
  let editArea: HTMLTextAreaElement;
  let editFileInput: HTMLInputElement;
  let editFiles: File[] = [];
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let renderedMarkdown = '';
  let renderFrame = 0;
  let pendingSource = '';

  $: scheduleMarkdown(message.role === 'assistant' ? message.text : '', streaming);
  $: sentTime = formatMessageTime(message.sentAt);

  /**
   * Re-parsing the whole message for every streamed token saturates the main
   * thread, which stalls the activity timer and stutters its gradient. While
   * streaming, renders are coalesced to one per animation frame; a settled
   * message renders immediately so the final output is never a frame behind.
   */
  function scheduleMarkdown(source: string, isStreaming: boolean): void {
    if (!source) {
      cancelPendingRender();
      renderedMarkdown = '';
      return;
    }
    pendingSource = source;
    if (!isStreaming || typeof requestAnimationFrame === 'undefined') {
      cancelPendingRender();
      renderedMarkdown = renderMarkdown(pendingSource);
      return;
    }
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      renderedMarkdown = renderMarkdown(pendingSource);
    });
  }

  function cancelPendingRender(): void {
    if (!renderFrame) return;
    cancelAnimationFrame(renderFrame);
    renderFrame = 0;
  }

  onDestroy(() => {
    cancelPendingRender();
    if (copyTimer) clearTimeout(copyTimer);
  });

  async function startEdit(): Promise<void> {
    draft = message.text;
    editFiles = [];
    editing = true;
    await tick();
    editArea?.focus();
  }

  function submitEdit(): void {
    const text = draft.trim();
    if (!text && !message.files?.length && !editFiles.length) return;
    editing = false;
    onEdit(message.id, text, editFiles);
    editFiles = [];
  }

  function cancelEdit(): void {
    editing = false;
    editFiles = [];
  }

  function selectEditFiles(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const next = Array.from(input.files ?? []);
    const seen = new Set(editFiles.map((file) => `${file.name}\0${file.size}\0${file.lastModified}`));
    editFiles = [...editFiles, ...next.filter((file) => !seen.has(`${file.name}\0${file.size}\0${file.lastModified}`))];
    input.value = '';
  }

  function editKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') cancelEdit();
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitEdit();
    }
  }

  async function copyMessage(): Promise<void> {
    // The label only flips to Copied once the text is actually on the clipboard.
    if (!await copyText(message.text)) return;
    copied = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => copied = false, 1400);
  }

  function toggleFeedback(value: 'up' | 'down'): void {
    onFeedback(message.id, message.feedback === value ? null : value);
  }

  async function interactWithMarkdown(event: MouseEvent): Promise<void> {
    const target = event.target instanceof Element ? event.target : null;
    const copy = target?.closest<HTMLButtonElement>('[data-markdown-copy]');
    if (copy) {
      // Resolved from the block rather than the button's sibling, so the copy
      // action keeps working wherever it sits inside the code block header.
      const code = copy.closest('.markdown-code-block')?.querySelector('pre code')?.textContent ?? '';
      copy.textContent = await copyText(code) ? 'Copied' : 'Copy failed';
      setTimeout(() => copy.textContent = 'Copy', 1400);
      return;
    }

    const anchor = target?.closest<HTMLAnchorElement>('.markdown-body a[href]');
    if (!anchor) return;
    const url = new URL(anchor.href, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    event.preventDefault();
    onOpenLink(url.href, anchor.textContent?.trim() || url.hostname);
  }

  function markdownInteractions(node: HTMLElement) {
    const click = (event: MouseEvent) => void interactWithMarkdown(event);
    // A link shows its globe until the site's own icon actually arrives,
    // so a missing or broken favicon needs no handling of its own. Load fires
    // on the image rather than bubbling, so it is caught on the way down.
    const loaded = (event: Event) => {
      const image = event.target;
      if (image instanceof HTMLImageElement && image.dataset.linkFavicon !== undefined) image.classList.add('loaded');
    };
    // The markdown carries which site each link icon belongs to, not the icon
    // itself, so the bytes are asked for here. A streaming message rewrites
    // its html as it arrives, so new links are picked up as they appear.
    const fillFavicons = () => {
      for (const image of node.querySelectorAll<HTMLImageElement>('img[data-link-favicon]')) {
        const source = image.dataset.linkFavicon;
        if (!source || image.dataset.faviconAsked !== undefined) continue;
        image.dataset.faviconAsked = '';
        void linkFavicon(source).then((dataUrl) => {
          if (dataUrl) image.src = dataUrl;
        });
      }
    };
    const observer = new MutationObserver(fillFavicons);
    observer.observe(node, {childList: true, subtree: true});
    fillFavicons();
    node.addEventListener('click', click);
    node.addEventListener('load', loaded, true);
    return {destroy: () => {
      observer.disconnect();
      node.removeEventListener('click', click);
      node.removeEventListener('load', loaded, true);
    }};
  }

  function formatMessageTime(value?: string): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const time = new Intl.DateTimeFormat(undefined, {hour: 'numeric', minute: '2-digit', hour12: true}).format(date);
    const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const now = new Date();
    const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
    if (days === 0) return time;
    if (days > 0 && days < 7) return `${new Intl.DateTimeFormat(undefined, {weekday: 'long'}).format(date)} ${time}`;
    const day = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short', ...(date.getFullYear() === now.getFullYear() ? {} : {year: 'numeric'})}).format(date);
    return `${day}, ${time}`;
  }
</script>

<article id={`message-${message.id}`} class:assistant={message.role === 'assistant'} class:editing class="message message-group">
  {#if editing}
    <div class="message-edit-shell">
      <textarea bind:this={editArea} bind:value={draft} aria-label="Edit message" rows="3" onkeydown={editKeydown}></textarea>
      {#if editFiles.length}
        <div class="message-edit-attachments" aria-label="New attachments">
          {#each editFiles as file (`${file.name}-${file.size}-${file.lastModified}`)}<span><Icon name="file" size={12}/>{file.name}</span>{/each}
        </div>
      {/if}
      <div class="message-edit-controls">
        <input bind:this={editFileInput} class="visually-hidden" type="file" multiple tabindex="-1" aria-hidden="true" onchange={selectEditFiles}/>
        <button type="button" class="edit-attach" aria-label="Attach files" data-tooltip-label="Attach" onclick={() => editFileInput.click()}><Icon name="attach" size={16}/></button>
        <span class="message-edit-actions">
          <button type="button" onclick={cancelEdit}>Cancel</button>
          <button type="button" class="save" onclick={submitEdit}>Send</button>
        </span>
      </div>
    </div>
  {:else}
    {#if message.text || message.role === 'assistant'}
      <div class="message-content" use:markdownInteractions>
        {#if message.text}
          {#if message.role === 'assistant'}
            <div class="markdown-body">{@html renderedMarkdown}</div>
          {:else}
            <p>{message.text}</p>
          {/if}
        {:else if streaming && !activityVisible}
          <span class="thinking" role="status" aria-label="Assistant is responding"><i></i><i></i><i></i></span>
        {:else if streaming}
          <!-- The live activity row above carries the working shimmer; pulse
               dots beneath it would be a second, redundant indicator. -->
        {:else}
          <!-- A stopped or cancelled turn leaves no text behind: say so rather
               than pulse dots at a run that is already over. -->
          <p class="message-stopped">Stopped</p>
        {/if}
      </div>
    {/if}

    {#if message.files?.length}
      <div class:standalone={!message.text} class="message-files">
        {#each message.files as file (file)}
          <button type="button" class="file-card" onclick={() => onOpenFile(file)}>
            <span class="file-icon"><Icon name="file" size={22}/></span>
            <span class="file-copy"><strong>{file}</strong><small>Attachment</small></span>
            <span class="open-in"><Icon name="expand" size={14}/>Open</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if sentTime || message.role === 'user' || (message.text && !streaming)}
      <div class="message-footer">
        {#if sentTime}<time class="message-time" datetime={message.sentAt}>{sentTime}</time>{/if}
        {#if message.role === 'user' || (message.text && !streaming)}
          <div class="message-actions" aria-label={`${message.role === 'user' ? 'User' : 'Assistant'} message actions`}>
            <MessageAction icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy'} onAction={copyMessage}/>
            {#if message.role === 'user'}<MessageAction icon="edit" label="Edit" onAction={startEdit}/>{/if}
            {#if message.role === 'assistant'}
              <MessageAction icon="thumb-up" label="Good response" active={message.feedback === 'up'} onAction={() => toggleFeedback('up')}/>
              <MessageAction icon="thumb-down" label="Bad response" active={message.feedback === 'down'} onAction={() => toggleFeedback('down')}/>
            {/if}
          </div>
        {/if}
        {#if message.asGoal}<span class="message-goal-label"><Icon name="goal" size={15}/>Sent as goal</span>{/if}
      </div>
    {/if}
  {/if}
</article>
