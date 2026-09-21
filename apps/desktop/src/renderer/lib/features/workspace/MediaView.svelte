<script lang="ts">
  import AppSettingsButton from './AppSettingsButton.svelte';
  import {downloadHubMedia} from './mediaDownload';
  import {onDestroy, tick} from 'svelte';
  import {on} from 'svelte/events';
  import Icon from '../../shared/components/Icon.svelte';
  import {MAIN_UI_ICON_SIZE, MAIN_UI_ICON_STROKE_WIDTH} from '../../shared/layout/iconSizing';
  import {polymuxApi} from '../../api/polymux';
  import {t} from '../../../i18n';
  import {
    formatPlaybackRate,
    mediaClipboardContent,
    mediaFileName,
    mediaKind,
    MEDIA_ZOOM_MAX,
    MEDIA_ZOOM_MIN,
    mediaZoomFromWheel,
    nextMediaZoom,
    PLAYBACK_RATES,
    scrollAfterPan,
    zoomedMediaSize,
  } from './mediaView';

  let {
    onOpenSettings,
    title = '',
    src = '',
    fitted = true,
    onOpen = () => {},
  }: {
    onOpenSettings?: () => void;
    title?: string;
    src?: string;
    fitted?: boolean;
    onOpen?: (next: {title: string; url: string}) => void;
  } = $props();

  const api = polymuxApi();

  let zoom = $state(1);
  let rate = $state(1);
  let speedOpen = $state(false);
  let pictureInPicture = $state(false);
  let copied = $state(false);
  let panning = $state(false);
  let player = $state<HTMLVideoElement | undefined>();
  let imageEl = $state<HTMLImageElement | undefined>();
  let previewEl = $state<HTMLDivElement | undefined>();
  let speedWrap = $state<HTMLDivElement | undefined>();
  let fittedSize = $state({width: 0, height: 0});
  let copyTimer = 0;
  let drag = {left: 0, top: 0, x: 0, y: 0};

  const kind = $derived(mediaKind(src) === 'video' || mediaKind(title) === 'video' ? 'video' : 'image');
  const name = $derived(title || (kind === 'video' ? $t('view.video') : $t('view.photo')));
  const fileName = $derived(mediaFileName(src, title));
  const canZoomOut = $derived(zoom > MEDIA_ZOOM_MIN);
  const canZoomIn = $derived(zoom < MEDIA_ZOOM_MAX);
  const zoomed = $derived(zoomedMediaSize(fittedSize, zoom));
  const pipAvailable = $derived(typeof document !== 'undefined' && document.pictureInPictureEnabled);

  $effect(() => {
    if (!player) return;
    const enter = on(player, 'enterpictureinpicture', () => pictureInPicture = true);
    const leave = on(player, 'leavepictureinpicture', () => pictureInPicture = false);
    return () => { enter(); leave(); };
  });

  function applyRate(next: number): void {
    rate = next;
    if (player) player.playbackRate = next;
  }

  function chooseRate(next: number): void {
    applyRate(next);
    speedOpen = false;
  }

  function onPlayerReady(): void {
    if (player) player.playbackRate = rate;
  }

  function captureFittedSize(): void {
    const el = imageEl;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    fittedSize = {width: rect.width, height: rect.height};
  }

  async function applyZoomAt(next: number, clientX: number, clientY: number): Promise<void> {
    const preview = previewEl;
    const img = imageEl;
    if (next <= MEDIA_ZOOM_MIN) {
      zoom = 1;
      panning = false;
      await tick();
      if (preview) {
        preview.scrollLeft = 0;
        preview.scrollTop = 0;
      }
      return;
    }
    if (zoom === 1) captureFittedSize();
    const through = img
      ? (() => {
          const rect = img.getBoundingClientRect();
          return {
            x: rect.width ? (clientX - rect.left) / rect.width : 0.5,
            y: rect.height ? (clientY - rect.top) / rect.height : 0.5,
          };
        })()
      : {x: 0.5, y: 0.5};
    zoom = next;
    await tick();
    if (!preview || !img) return;
    const rect = img.getBoundingClientRect();
    preview.scrollLeft += rect.left + through.x * rect.width - clientX;
    preview.scrollTop += rect.top + through.y * rect.height - clientY;
  }

  function bumpZoom(direction: 1 | -1): void {
    const next = nextMediaZoom(zoom, direction);
    const preview = previewEl;
    if (!preview) {
      if (direction > 0 && zoom === 1) captureFittedSize();
      zoom = next;
      return;
    }
    const rect = preview.getBoundingClientRect();
    void applyZoomAt(next, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function onPhotoWheel(event: WheelEvent): void {
    event.preventDefault();
    const next = mediaZoomFromWheel(zoom, event.deltaY, event.ctrlKey);
    if (next === zoom) return;
    void applyZoomAt(next, event.clientX, event.clientY);
  }

  function attachPhotoPreview(element: HTMLDivElement): () => void {
    return on(element, 'wheel', onPhotoWheel, {passive: false});
  }

  function onPhotoPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || zoom <= 1) return;
    const preview = previewEl;
    if (!preview) return;
    event.preventDefault();
    preview.setPointerCapture(event.pointerId);
    panning = true;
    drag = {left: preview.scrollLeft, top: preview.scrollTop, x: event.clientX, y: event.clientY};
  }

  function onPhotoPointerMove(event: PointerEvent): void {
    if (!panning || !previewEl) return;
    const next = scrollAfterPan(drag, {x: event.clientX, y: event.clientY});
    previewEl.scrollLeft = next.left;
    previewEl.scrollTop = next.top;
  }

  function endPan(event: PointerEvent): void {
    if (!panning) return;
    panning = false;
    if (previewEl?.hasPointerCapture(event.pointerId))
      previewEl.releasePointerCapture(event.pointerId);
  }

  async function togglePictureInPicture(): Promise<void> {
    if (!player || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement === player) {
        await document.exitPictureInPicture();
        return;
      }
      await player.requestPictureInPicture();
    } catch {
      // The player refused; the clip stays in the pane.
    }
  }

  async function copyMedia(): Promise<void> {
    const succeeded = await api.clipboard.write(mediaClipboardContent(src, fileName, kind));
    if (!succeeded) return;
    copied = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => copied = false, 1400);
  }

  async function downloadMedia(): Promise<void> {
    try {
      if (src.startsWith('polymux-media://')) {
        await downloadHubMedia(src, fileName);
        return;
      }
      await api.workspace.saveAs(src);
    } catch {
      // The save was cancelled or the grant had gone.
    }
  }

  async function pickMedia(): Promise<void> {
    const picked = await api.workspace.pick();
    if (!picked) return;
    onOpen({title: picked.name, url: picked.url});
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!speedOpen) return;
    if (speedWrap?.contains(event.target as Node)) return;
    speedOpen = false;
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && speedOpen) speedOpen = false;
  }

  function onWindowResize(): void {
    if (zoom === 1) captureFittedSize();
  }

  onDestroy(() => { if (copyTimer) clearTimeout(copyTimer); });
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} onresize={onWindowResize}/>

{#if src && kind === 'video'}
  <div class="media-view">
    <div class="media-toolbar"><AppSettingsButton name="Media" onclick={onOpenSettings}/>
      <div bind:this={speedWrap} class="media-speed">
        <button
          type="button"
          class="media-tool rate"
          class:active={rate !== 1 || speedOpen}
          aria-label={$t('view.playbackSpeed')}
          aria-haspopup="menu"
          aria-expanded={speedOpen}
          data-tooltip-label={speedOpen ? undefined : $t('view.playbackSpeed')}
          data-tooltip-align="end"
          onclick={() => speedOpen = !speedOpen}
        >{formatPlaybackRate(rate)}</button>
        {#if speedOpen}
          <div class="polymux-dropdown-menu media-speed-menu" role="menu" aria-label={$t('view.playbackSpeed')}>
            {#each PLAYBACK_RATES as option (option)}
              <button
                type="button"
                class="polymux-dropdown-item"
                role="menuitemradio"
                aria-checked={rate === option}
                onclick={() => chooseRate(option)}
              >
                <span>{formatPlaybackRate(option)}</span>
                {#if rate === option}<Icon name="check" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>{/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <button
        type="button"
        class="media-tool"
        class:active={pictureInPicture}
        aria-label={$t('view.pictureInPicture')}
        aria-pressed={pictureInPicture}
        data-tooltip-label={$t('view.pictureInPicture')}
        data-tooltip-align="end"
        disabled={!pipAvailable}
        onclick={() => void togglePictureInPicture()}
      ><Icon name="picture-in-picture" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
      <button
        type="button"
        class="media-tool"
        aria-label={copied ? $t('common.copied') : $t('common.copy')}
        data-tooltip-label={copied ? $t('common.copied') : $t('common.copy')}
        data-tooltip-align="end"
        onclick={() => void copyMedia()}
      ><Icon name={copied ? 'check' : 'copy'} size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
      <button
        type="button"
        class="media-tool"
        aria-label={$t('drive.download')}
        data-tooltip-label={$t('drive.download')}
        data-tooltip-align="end"
        onclick={() => void downloadMedia()}
      ><Icon name="download" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
    </div>
    <div class="media-preview">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={player}
        {src}
        controls
        aria-label={name}
        onloadedmetadata={onPlayerReady}
      ></video>
    </div>
  </div>
{:else if src}
  <div class="media-view">
    <div class="media-toolbar"><AppSettingsButton name="Media" onclick={onOpenSettings}/>
      <button
        type="button"
        class="media-tool"
        aria-label={$t('view.zoomOut')}
        data-tooltip-label={$t('view.zoomOut')}
        data-tooltip-align="end"
        disabled={!canZoomOut}
        onclick={() => bumpZoom(-1)}
      ><Icon name="zoom-out" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
      <button
        type="button"
        class="media-tool"
        aria-label={$t('view.zoomIn')}
        data-tooltip-label={$t('view.zoomIn')}
        data-tooltip-align="end"
        disabled={!canZoomIn}
        onclick={() => bumpZoom(1)}
      ><Icon name="zoom-in" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
      <button
        type="button"
        class="media-tool"
        aria-label={copied ? $t('common.copied') : $t('common.copy')}
        data-tooltip-label={copied ? $t('common.copied') : $t('common.copy')}
        data-tooltip-align="end"
        onclick={() => void copyMedia()}
      ><Icon name={copied ? 'check' : 'copy'} size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
      <button
        type="button"
        class="media-tool"
        aria-label={$t('drive.download')}
        data-tooltip-label={$t('drive.download')}
        data-tooltip-align="end"
        onclick={() => void downloadMedia()}
      ><Icon name="download" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
    </div>
    <div
      bind:this={previewEl}
      class="media-preview image-preview"
      class:is-zoomed={zoom > 1}
      class:is-panning={panning}
      role="region"
      aria-label={name}
      {@attach attachPhotoPreview}
      onpointerdown={onPhotoPointerDown}
      onpointermove={onPhotoPointerMove}
      onpointerup={endPan}
      onpointercancel={endPan}
    >
      <img
        bind:this={imageEl}
        class:fitted={fitted && zoom === 1}
        class="workspace-image"
        style:width={zoomed ? `${zoomed.width}px` : undefined}
        style:height={zoomed ? `${zoomed.height}px` : undefined}
        {src}
        alt={name}
        draggable="false"
        onload={captureFittedSize}
      />
    </div>
  </div>
{:else}
  <div class="new-tab-empty app-empty-view">
    <div class="app-empty-settings"><AppSettingsButton name="Media" onclick={onOpenSettings}/></div>
    <Icon name="image" size={30}/>
    <h2>{title || $t('workspace.media')}</h2>
    <button type="button" class="new-tab-empty-text" onclick={() => void pickMedia()}>{$t('common.open')}</button>
  </div>
{/if}
