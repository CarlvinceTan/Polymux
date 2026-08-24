<script module lang="ts">
  import type {DriveProviderId} from '@polymux/protocol';
  import {activeLocale, translate, type MessageKey} from '../../../i18n';
  import type {MenuOption} from '../../shared/components/Menu.svelte';

  export type DriveEntryKind = 'folder' | 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'image' | 'audio' | 'video' | 'code' | 'file';
  export type DriveEntry = {
    id: string;
    name: string;
    kind: DriveEntryKind;
    /** Epoch milliseconds; folders may omit it. */
    modifiedAt?: number;
    /** Bytes. Folders report their recursive total, or omit it. */
    size?: number;
    uri?: string;
    children?: DriveEntry[];
    /** Which backend the entry lives on. Absent for the conversation's own
     * files, which belong to no storage provider. */
    provider?: DriveProviderId;
    /** The provider's own page for this file, when it has one. Only the cloud
     * providers do; a file on a volume is opened from the volume instead. */
    webUrl?: string | null;
  };

  /** One storage backend the drive can be pointed at. Only backends that can
   * actually be opened are passed, so there is no state to carry: offering a
   * source is the host saying it is reachable. */
  export type DriveSource = {
    id: string;
    name: string;
    icon?: MenuOption['icon'];
    /** Which backend it is, so the switch can wear that backend's mark. */
    provider?: DriveProviderId;
    /** The account or share this source speaks for, named the way the user
     * knows it. Shown when a file is selected, to say where it lives. */
    accountLabel?: string | null;
  };

  export type DriveSortKey = 'name' | 'size' | 'kind' | 'modified';
  export type DriveFilter = 'all' | 'images' | 'documents' | 'videos';

  const KIND_BY_EXTENSION: Record<string, DriveEntryKind> = {
    doc: 'document', docx: 'document', md: 'document', odt: 'document', rtf: 'document', txt: 'document',
    csv: 'spreadsheet', numbers: 'spreadsheet', tsv: 'spreadsheet', xls: 'spreadsheet', xlsx: 'spreadsheet',
    key: 'presentation', ppt: 'presentation', pptx: 'presentation',
    pdf: 'pdf',
    gif: 'image', heic: 'image', jpeg: 'image', jpg: 'image', png: 'image', svg: 'image', webp: 'image',
    aac: 'audio', flac: 'audio', m4a: 'audio', mp3: 'audio', wav: 'audio',
    avi: 'video', mkv: 'video', mov: 'video', mp4: 'video', webm: 'video',
    css: 'code', go: 'code', html: 'code', js: 'code', json: 'code', jsx: 'code', py: 'code', rs: 'code', svelte: 'code', ts: 'code', tsx: 'code', vue: 'code', yaml: 'code', yml: 'code',
  };

  const KIND_LABELS: Record<DriveEntryKind, MessageKey> = {
    folder: 'drive.kind.folder',
    document: 'drive.kind.document',
    spreadsheet: 'drive.kind.spreadsheet',
    presentation: 'drive.kind.presentation',
    pdf: 'drive.kind.pdf',
    image: 'drive.kind.image',
    audio: 'drive.kind.audio',
    video: 'drive.kind.video',
    code: 'drive.kind.code',
    file: 'drive.kind.file',
  };

  /** Names are all the drive gets from most sources, so the extension is what
   * decides which icon and kind a row wears. */
  export function driveEntryKind(name: string): DriveEntryKind {
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    return KIND_BY_EXTENSION[extension] ?? 'file';
  }

  export function driveKindLabel(kind: DriveEntryKind): string {
    return translate(KIND_LABELS[kind]);
  }

  /** Sizes are written with the language's own decimal separator and unit
   * wording — a comma rather than a point in most of Europe. */
  export function formatDriveSize(bytes: number): string {
    if (bytes < 1024) return translate('drive.sizeBytes', {size: formatNumber(bytes, 0)});
    if (bytes < 1024 * 1024) return translate('drive.sizeKilobytes', {size: formatNumber(bytes / 1024, 1)});
    return translate('drive.sizeMegabytes', {size: formatNumber(bytes / (1024 * 1024), 1)});
  }

  function formatNumber(value: number, decimals: number): string {
    return value.toLocaleString(activeLocale(), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  export function formatDriveDate(epochMs: number): string {
    const date = new Date(epochMs);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(activeLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<script lang="ts">
  import {onDestroy, tick} from 'svelte';
  import Icon from '../../shared/components/Icon.svelte';
  import Menu from '../../shared/components/Menu.svelte';
  import OpenMenu, {type OpenAnchor, type OpenChoice} from '../../shared/components/OpenMenu.svelte';
  import DriveProviderLogo from '../../shared/components/DriveProviderLogo.svelte';
  import {MAIN_UI_ICON_SIZE, MAIN_UI_ICON_STROKE_WIDTH} from '../../shared/layout/iconSizing';
  import {t} from '../../../i18n';

  export let title = '';
  /** The top of the tree. Its own name is the first breadcrumb. */
  export let root: DriveEntry = {id: 'drive-root', name: translate('workspace.drive'), kind: 'folder', children: []};
  /**
   * The storage backends the drive can show, which is what makes the first
   * breadcrumb a switch rather than a label. An empty list keeps the old
   * single-source drive exactly as it was.
   */
  export let sources: DriveSource[] = [];
  export let activeSourceId = '';
  export let onSelectSource: (id: string) => void = () => {};
  /** Opens the selected entry where it actually lives — the OS file browser
   * for this Mac and for a share. */
  export let onReveal: (entry: DriveEntry) => void = () => {};
  /**
   * Fired when a folder is opened, before its contents are shown. Cloud
   * providers list one folder at a time, so the host uses this to fill in
   * `children` for the folder the user just walked into.
   */
  export let onNavigate: (entry: DriveEntry) => void = () => {};
  /** Set while the host is fetching a folder, so an empty one that has simply
   * not arrived yet does not claim to be empty. */
  export let loading = false;
  /** What went wrong with the last action, shown above the list. Empty hides
   * it. Dismissing it is the host's to clear. */
  export let error = '';
  export let onDismissError: () => void = () => {};
  /** Opening a file is the host's business — the drive only browses. */
  /** `point` is where the pointer was, in the viewport: opening a file offers
   * a choice, and the menu that asks belongs under the pointer that asked. */
  export let onOpenEntry: (entry: DriveEntry, point?: {x: number; y: number}) => void = () => {};
  /**
   * Every action stays in the toolbar and goes live as soon as a handler is
   * passed. Naming and confirming happen here rather than in the host: the
   * drive is where the row is, and Electron has no `prompt` to fall back on.
   */
  export let onNewFolder: ((parent: DriveEntry, name: string) => void) | null = null;
  export let onUpload: ((files: File[], parent: DriveEntry, onProgress?: (fraction: number) => void) => Promise<void>) | null = null;
  export let onRename: ((entry: DriveEntry, name: string) => void) | null = null;
  /**
   * Moves the entries into `destination`. The destination may belong to
   * another provider: the drive underneath turns that into a transfer, so the
   * list never has to refuse a drop for crossing accounts.
   */
  export let onMove: ((entries: DriveEntry[], destination: DriveEntry, onProgress?: (fraction: number) => void) => void | Promise<void>) | null = null;
  /** Files and folders dragged in from the Finder, dropped on `destination`. */
  export let onDropFiles: ((files: File[], destination: DriveEntry, onProgress?: (fraction: number) => void) => Promise<void>) | null = null;
  export let onDuplicate: ((entries: DriveEntry[]) => void) | null = null;
  export let onDownload: ((entry: DriveEntry) => void) | null = null;
  export let onDelete: ((entries: DriveEntry[]) => void) | null = null;

  /** Ids from the root down to the folder on screen; empty means the root. */
  let trail: string[] = [];
  let searchQuery = '';
  let searchExpanded = false;
  let searchFocused = false;
  let searchInput: HTMLInputElement;
  let filterWrapper: HTMLDivElement;
  let searchWrapper: HTMLDivElement;
  let activeFilter: DriveFilter = 'all';
  let filterOpen = false;
  /**
   * Naming, confirming and picking a destination all happen in the drive
   * itself. Electron supports no `window.prompt`, so a browser-style dialog is
   * not an option even where one would do.
   */
  /** Id of the row being renamed, or 'new' while a folder is being named. */
  let renaming: string | null = null;
  let nameDraft = '';
  let nameInput: HTMLInputElement;
  let confirmingDelete = false;
  let moveOpen = false;
  let moveWrapper: HTMLDivElement;
  let moveQuery = '';
  let moveConfirmDestination: DriveEntry | null = null;
  let infoEntry: DriveEntry | null = null;
  let sortKey: DriveSortKey = 'name';
  let sortAscending = true;
  /** The whole highlighted set. `primaryId` is the one single-target actions
   * aim at, and the anchor a shift-click ranges from. */
  let selectedIds = new Set<string>();
  let primaryId: string | null = null;
  let uploadInput: HTMLInputElement;
  let pendingUploads: Array<DriveEntry & {uploadId: string; progress: number}> = [];
  let pendingTransfers: Record<string, number> = {};
  let rowMenuAnchor: OpenAnchor | null = null;

  $: rowMenuChoices = [
    ...(!isMultiSelection && onRename ? [{value: 'rename', label: $t('common.rename'), icon: 'edit' as const}] : []),
    ...(onMove ? [{value: 'move', label: $t('drive.move'), icon: 'folder-move' as const}] : []),
    ...(onDuplicate ? [{value: 'duplicate', label: $t('drive.duplicate'), icon: 'copy' as const}] : []),
    ...(!isMultiSelection && primary?.kind !== 'folder' && onDownload ? [{value: 'download', label: $t('drive.download'), icon: 'download' as const}] : []),
    ...(!isMultiSelection ? [{value: 'info', label: $t('drive.info'), icon: 'info' as const}] : []),
    ...(onDelete ? [{value: 'delete', label: $t('common.delete'), icon: 'trash' as const}] : []),
  ] satisfies OpenChoice[];

  // Marquee. Coordinates are kept relative to the scroll container so the box
  // stays put against the rows if the list scrolls mid-drag.
  let rowsEl: HTMLElement;
  let marquee: {startX: number; startY: number; curX: number; curY: number} | null = null;
  /** Hit-tests replace the selection every tick, so the set held at pointerdown
   * has to be kept to union against while a modifier is down. */
  let marqueeInitialIds = new Set<string>();
  let marqueeAdditive = false;
  let marqueePointerId = -1;
  /** After a drag the browser still fires a click on the pointerdown target,
   * which would run the whitespace-click deselect and wipe what was just
   * selected. */
  let suppressNextClick = false;

  /** Stands in for the folder being named, which has no id until it exists. */
  const NEW_FOLDER_ROW = 'new';

  /** Product names, not words: they read the same in every language. Only the
   * two that describe something — this machine, generic S3 storage — are
   * translated. */
  $: PROVIDER_LABELS = {
    local: $t('drive.thisMac'),
    'google-drive': 'Google Drive',
    dropbox: 'Dropbox',
    onedrive: 'OneDrive',
    s3: $t('drive.s3'),
  } as Record<DriveProviderId, string>;

  $: providerLabel = (provider: DriveProviderId): string => PROVIDER_LABELS[provider] ?? provider;

  $: filterItems = [
    {id: 'all' as DriveFilter, label: $t('drive.filterAll')},
    {id: 'images' as DriveFilter, label: $t('drive.filterImages')},
    {id: 'documents' as DriveFilter, label: $t('drive.filterDocuments')},
    {id: 'videos' as DriveFilter, label: $t('drive.filterVideos')},
  ];

  const filterKinds: Record<Exclude<DriveFilter, 'all'>, DriveEntryKind[]> = {
    images: ['image'],
    documents: ['document', 'spreadsheet', 'presentation', 'pdf'],
    videos: ['video'],
  };

  const entryIcons: Record<DriveEntryKind, 'folder' | 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'image' | 'audio' | 'video' | 'code' | 'file'> = {
    folder: 'folder',
    document: 'document',
    spreadsheet: 'spreadsheet',
    presentation: 'presentation',
    pdf: 'pdf',
    image: 'image',
    audio: 'audio',
    video: 'video',
    code: 'code',
    file: 'file',
  };

  /** A trail can outlive the folder it points at when the tree reloads, so it
   * is resolved against the current root and truncated where it stops matching. */
  $: crumbs = resolveTrail(root, trail);
  $: current = crumbs[crumbs.length - 1] ?? root;
  $: items = sortEntries(filterEntries(current.children ?? [], searchQuery, activeFilter), sortKey, sortAscending);
  /** The switch only earns its place once there is something to switch to. */
  /* Every connected place is listed together now, so there is nothing to
     switch between and the root is just Home. The switch is kept only for a
     build with no virtual drive to fall back on. */
  $: showSourceMenu = sources.length > 1 && !sources.some((source) => source.provider === 'all');
  $: sourceOptions = sources.map((source) => ({
    value: source.id,
    label: source.name,
    // A source without a glyph of its own wears its backend's mark: the brand
    // tile for a cloud account, and — since local storage is not a brand — the
    // same outline drive glyph the workspace tab carries.
    icon: source.icon ?? (source.provider && source.provider !== 'local' ? undefined : ('drive' as const)),
    provider: source.icon || !source.provider || source.provider === 'local' ? undefined : source.provider,
  }));
  /** The switch stands in for the root crumb where it is shown, so the crumb
   * only names the source when there is no switch to do it. */
  $: rootLabel = showSourceMenu
    ? (sources.find((source) => source.id === activeSourceId)?.name ?? title)
    : $t('drive.home');
  /** A folder still being fetched is not an empty one, and saying so would be
   * wrong for exactly as long as the request takes. */
  $: showEmptyOverlay = items.length === 0 && !loading;
  $: selection = items.filter((entry) => selectedIds.has(entry.id));
  $: primary = selection.find((entry) => entry.id === primaryId) ?? selection[0] ?? null;
  $: isMultiSelection = selection.length > 1;
  /** The selected entry's own place, when it has one. Local files get no
   * button: they are already on this Mac, which is the assumption the row
   * badge spends nothing on either. */
  $: selectedSource =
    primary && primary.provider && primary.provider !== 'local'
      ? (sources.find((source) => primary!.id.startsWith(`${source.id}/`)) ?? null)
      : null;
  /** One selected item names itself at the end of the path, the way the old
   * browser trailed the breadcrumb with it. */
  $: selectedCrumbLabel = selection.length === 1 ? selection[0].name : '';

  function resolveTrail(from: DriveEntry, ids: string[]): DriveEntry[] {
    const resolved: DriveEntry[] = [from];
    for (const id of ids) {
      const next = resolved[resolved.length - 1].children?.find((entry) => entry.id === id);
      if (!next) break;
      resolved.push(next);
    }
    return resolved;
  }

  /** Folders survive the kind filter: filtering narrows what you are looking
   * at, not where you can go. */
  function filterEntries(list: DriveEntry[], text: string, filter: DriveFilter): DriveEntry[] {
    const needle = text.trim().toLowerCase();
    return list.filter((entry) => {
      if (needle && !entry.name.toLowerCase().includes(needle)) return false;
      if (filter === 'all' || entry.kind === 'folder') return true;
      return filterKinds[filter].includes(entry.kind);
    });
  }

  /** Folders lead regardless of the column being sorted: they are the shape of
   * the folder, not rows competing with the files inside it. */
  function sortEntries(list: DriveEntry[], key: DriveSortKey, ascending: boolean): DriveEntry[] {
    const direction = ascending ? 1 : -1;
    return [...list].sort((a, b) => {
      if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
      if (key === 'size') return ((a.size ?? 0) - (b.size ?? 0)) * direction;
      if (key === 'modified') return ((a.modifiedAt ?? 0) - (b.modifiedAt ?? 0)) * direction;
      if (key === 'kind') return driveKindLabel(a.kind).localeCompare(driveKindLabel(b.kind), activeLocale()) * direction;
      return a.name.localeCompare(b.name, activeLocale(), {numeric: true, sensitivity: 'base'}) * direction;
    });
  }

  function sortBy(key: DriveSortKey): void {
    if (sortKey === key) sortAscending = !sortAscending;
    else {
      sortKey = key;
      // Names and kinds read naturally from A downwards; dates and sizes are
      // asked for newest-and-largest first.
      sortAscending = key === 'name' || key === 'kind';
    }
  }

  /**
   * Plain click selects and stays selected on repeated clicks. ⌘/Ctrl extends
   * the set one row at a time, Shift takes the run between the anchor and the
   * row. Whitespace, Escape, and the toolbar's explicit deselect action are the
   * ways back to the no-selection toolbar.
   */
  function selectEntry(entry: DriveEntry, event: MouseEvent): void {
    if (event.shiftKey && primaryId) {
      const from = items.findIndex((item) => item.id === primaryId);
      const to = items.findIndex((item) => item.id === entry.id);
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from];
        selectedIds = new Set(items.slice(start, end + 1).map((item) => item.id));
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(selectedIds);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      selectedIds = next;
      primaryId = next.has(entry.id) ? entry.id : [...next][0] ?? null;
      return;
    }
    selectedIds = new Set([entry.id]);
    primaryId = entry.id;
    // Selecting hands the toolbar over to the item's actions, so the search
    // gives its space back rather than fighting them for room.
    searchExpanded = false;
    searchQuery = '';
  }

  function clearSelection(): void {
    selectedIds = new Set();
    primaryId = null;
    // These all belong to the selection's toolbar, which is about to be
    // replaced by the create actions; leaving one armed would apply it to
    // nothing, or to whatever gets selected next.
    confirmingDelete = false;
    moveOpen = false;
    infoEntry = null;
    if (renaming && renaming !== NEW_FOLDER_ROW) cancelNaming();
  }

  /** Replaces the selection wholesale. Ids arrive in DOM order so the primary
   * lands on the topmost row, which is what single-target actions fall back to. */
  function setSelection(ids: string[]): void {
    if (!ids.length) {
      clearSelection();
      return;
    }
    selectedIds = new Set(ids);
    primaryId = ids[0];
    searchExpanded = false;
    searchQuery = '';
  }

  function openRowMenu(event: MouseEvent, entry: DriveEntry): void {
    event.preventDefault();
    if (!selectedIds.has(entry.id)) setSelection([entry.id]);
    rowMenuAnchor = {point: {x: event.clientX, y: event.clientY}};
  }

  function chooseRowMenu(action: string): void {
    rowMenuAnchor = null;
    const entry = primary;
    if (action === 'rename' && entry) void startNaming(entry.id, entry.name);
    else if (action === 'move') moveOpen = true;
    else if (action === 'duplicate') onDuplicate?.(selection);
    else if (action === 'download' && entry) onDownload?.(entry);
    else if (action === 'info' && entry) infoEntry = entry;
    else if (action === 'delete') confirmingDelete = true;
  }

  $: marqueeBox = marquee
    ? {
        left: Math.min(marquee.startX, marquee.curX),
        top: Math.min(marquee.startY, marquee.curY),
        width: Math.abs(marquee.curX - marquee.startX),
        height: Math.abs(marquee.curY - marquee.startY),
      }
    : null;

  function containerPoint(clientX: number, clientY: number): {x: number; y: number} {
    const rect = rowsEl.getBoundingClientRect();
    return {x: clientX - rect.left + rowsEl.scrollLeft, y: clientY - rect.top + rowsEl.scrollTop};
  }

  function startMarquee(event: PointerEvent): void {
    // The guard below is armed for exactly one click, but that click only
    // arrives if the pointer comes up over the same target. Clearing it as the
    // next gesture starts stops a stale flag from eating a later row click.
    suppressNextClick = false;
    // Left button only; a row owns its own gesture, and chrome inside the list
    // should never begin a drag either.
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target || !rowsEl?.contains(target)) return;
    if (target.closest('button, input, textarea, [contenteditable="true"]')) return;
    // Marquee setup prevents the pointer event's default focus change. Commit
    // first so clicking empty list space still accepts the inline name and
    // returns the row to its ordinary, non-editing state.
    if (renaming) commitName();

    const point = containerPoint(event.clientX, event.clientY);
    marquee = {startX: point.x, startY: point.y, curX: point.x, curY: point.y};
    marqueeAdditive = event.shiftKey || event.metaKey || event.ctrlKey;
    marqueeInitialIds = marqueeAdditive ? new Set(selectedIds) : new Set();
    marqueePointerId = event.pointerId;
    try {
      rowsEl.setPointerCapture(event.pointerId);
    } catch {
      // A capture the browser refuses costs nothing: window listeners still run.
    }
    window.addEventListener('pointermove', dragMarquee);
    window.addEventListener('pointerup', endMarquee);
    window.addEventListener('pointercancel', endMarquee);
    event.preventDefault();
  }

  function dragMarquee(event: PointerEvent): void {
    if (!marquee) return;
    const point = containerPoint(event.clientX, event.clientY);
    marquee = {...marquee, curX: point.x, curY: point.y};
    applyMarqueeSelection();
  }

  function endMarquee(): void {
    window.removeEventListener('pointermove', dragMarquee);
    window.removeEventListener('pointerup', endMarquee);
    window.removeEventListener('pointercancel', endMarquee);
    if (rowsEl && marqueePointerId !== -1) {
      try {
        rowsEl.releasePointerCapture(marqueePointerId);
      } catch {
        // Already released when the pointer left the window.
      }
    }
    marqueePointerId = -1;
    if (!marquee) return;
    const moved = Math.abs(marquee.curX - marquee.startX) + Math.abs(marquee.curY - marquee.startY) > 3;
    if (moved) suppressNextClick = true;
    // A plain click on whitespace is the way back to the no-selection toolbar.
    else if (!marqueeAdditive) clearSelection();
    marquee = null;
    marqueeInitialIds = new Set();
    marqueeAdditive = false;
  }

  function swallowClickAfterDrag(event: MouseEvent): void {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  function applyMarqueeSelection(): void {
    if (!marquee || !rowsEl) return;
    const box = {
      left: Math.min(marquee.startX, marquee.curX),
      right: Math.max(marquee.startX, marquee.curX),
      top: Math.min(marquee.startY, marquee.curY),
      bottom: Math.max(marquee.startY, marquee.curY),
    };
    const containerRect = rowsEl.getBoundingClientRect();
    const inDomOrder: string[] = [];
    const hits: string[] = [];
    for (const row of rowsEl.querySelectorAll<HTMLElement>('[data-drive-id]')) {
      const id = row.dataset.driveId;
      if (!id) continue;
      inDomOrder.push(id);
      const rect = row.getBoundingClientRect();
      const rowBox = {
        left: rect.left - containerRect.left + rowsEl.scrollLeft,
        right: rect.right - containerRect.left + rowsEl.scrollLeft,
        top: rect.top - containerRect.top + rowsEl.scrollTop,
        bottom: rect.bottom - containerRect.top + rowsEl.scrollTop,
      };
      if (rowBox.left <= box.right && rowBox.right >= box.left && rowBox.top <= box.bottom && rowBox.bottom >= box.top)
        hits.push(id);
    }
    const finalIds = marqueeAdditive ? new Set([...marqueeInitialIds, ...hits]) : new Set(hits);
    setSelection(inDomOrder.filter((id) => finalIds.has(id)));
  }

  onDestroy(() => {
    window.removeEventListener('pointermove', dragMarquee);
    window.removeEventListener('pointerup', endMarquee);
    window.removeEventListener('pointercancel', endMarquee);
  });

  function openEntry(entry: DriveEntry, point?: {x: number; y: number}): void {
    if (entry.kind === 'folder') {
      trail = [...crumbs.slice(1).map((crumb) => crumb.id), entry.id];
      searchQuery = '';
      clearSelection();
      // A cloud folder arrives empty and is filled by the host; asking for it
      // here is what makes descending into one work at all.
      onNavigate(entry);
    } else {
      selectedIds = new Set([entry.id]);
      primaryId = entry.id;
      onOpenEntry(entry, point);
    }
  }

  function openCrumb(index: number): void {
    trail = crumbs.slice(1, index + 1).map((crumb) => crumb.id);
    searchQuery = '';
    clearSelection();
    // Going back is arriving too. Only descending used to ask the host for a
    // folder, so a listing seen once was shown from memory forever after: a
    // file added while the app was open never appeared, however many times you
    // stepped out of the folder and back into it.
    onNavigate(crumbs[index] ?? root);
  }

  /** One context measures every row; the font is read off the element so it
   * tracks the stylesheet rather than repeating it. */
  let textRuler: CanvasRenderingContext2D | null = null;

  /**
   * `scrollWidth` and `clientWidth` are integers, so a name overflowing by a
   * fraction of a pixel reads as fitting — even though the ellipsis has already
   * eaten several characters to make room for itself. Measuring the text
   * against the box's fractional width is what actually catches a clip.
   */
  function isClipped(label: HTMLElement): boolean {
    textRuler ??= document.createElement('canvas').getContext('2d');
    if (!textRuler) return label.scrollWidth > label.clientWidth;
    const style = getComputedStyle(label);
    textRuler.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    // A quarter pixel absorbs the drift between canvas metrics and layout
    // without swallowing a real overflow, which starts at half a pixel.
    return textRuler.measureText(label.textContent ?? '').width > label.getBoundingClientRect().width + .25;
  }

  /**
   * A name that fits needs no tooltip, so the row only carries a label while
   * its text is actually clipped. The observer watches the name rather than the
   * row because that is what the column widths resize.
   */
  function overflowTooltip(node: HTMLElement, name: string) {
    const label = node.querySelector<HTMLElement>('.fb-name');
    let current = name;
    const sync = (): void => {
      if (!label) return;
      if (isClipped(label)) node.setAttribute('data-tooltip-label', current);
      else node.removeAttribute('data-tooltip-label');
    };
    const observer = new ResizeObserver(sync);
    if (label) observer.observe(label);
    sync();
    return {
      update(next: string) {
        current = next;
        sync();
      },
      destroy() {
        observer.disconnect();
      },
    };
  }

  async function toggleSearch(): Promise<void> {
    searchExpanded = !searchExpanded;
    if (searchExpanded) {
      await tick();
      searchInput?.focus();
    } else {
      searchQuery = '';
    }
  }

  function setFilter(filter: DriveFilter): void {
    activeFilter = filter;
    filterOpen = false;
  }

  /** Opens the inline field, either on a row being renamed or on the
   * placeholder row a new folder is named in. */
  async function startNaming(target: string, initial: string): Promise<void> {
    renaming = target;
    nameDraft = initial;
    await tick();
    nameInput?.focus();
    // A rename starts with the name selected up to its extension, so typing
    // replaces the part being changed rather than the file's type.
    const dot = initial.lastIndexOf('.');
    nameInput?.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }

  /**
   * The name the New Folder field opens on: the suggestion, stepped past the
   * siblings already using it. The drive itself does the same on the way in,
   * so what is typed here is what lands rather than a name silently changed
   * underneath.
   */
  function suggestedFolderName(): string {
    const suggestion = $t('drive.untitledFolder');
    const taken = new Set(
      (current.children ?? []).map((entry) => entry.name.toLowerCase()),
    );
    if (!taken.has(suggestion.toLowerCase())) return suggestion;
    let index = 1;
    while (taken.has(`${suggestion} ${index}`.toLowerCase())) index += 1;
    return `${suggestion} ${index}`;
  }

  function cancelNaming(): void {
    renaming = null;
    nameDraft = '';
  }

  function submitName(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancelNaming();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    // Committed directly rather than by blurring the field: keydown is a
    // delegated event, so `currentTarget` is the root the handler is attached
    // to rather than the input, and blurring it would do nothing. The blur
    // that follows re-entering commitName is harmless — it has already been
    // cleared, and the guard turns the second call into a no-op.
    commitName();
  }

  /**
   * Takes whatever is in the field. Blur is the commit, so clicking away
   * saves rather than silently discarding what was typed. The prefilled folder
   * name is valid as-is; only an empty name cancels.
   */
  function commitName(): void {
    const target = renaming;
    const name = nameDraft.trim();
    if (!target) return;
    cancelNaming();
    if (!name) return;
    if (target === NEW_FOLDER_ROW) {
      onNewFolder?.(current, name);
      return;
    }
    const entry = items.find((item) => item.id === target);
    if (entry && entry.name !== name) onRename?.(entry, name);
  }

  /** Folders the selection can be moved into: the ones in view, plus the way
   * back up when there is somewhere above to go. */
  $: moveTargets = [
    ...(crumbs.length > 1 ? [crumbs[crumbs.length - 2]] : []),
    ...items.filter((entry) => entry.kind === 'folder' && !selectedIds.has(entry.id)),
  ];
  $: filteredMoveTargets = moveTargets.filter((entry) =>
    entry.name.toLowerCase().includes(moveQuery.trim().toLowerCase()));
  $: moveProviderTargets = sources.filter((source) => source.provider && source.provider !== 'all' && source.id !== 'local#home');
  $: currentMoveSourceId = primary?.id.includes('/')
    ? primary.id.slice(0, primary.id.indexOf('/'))
    : activeSourceId;

  async function transferEntries(entries: DriveEntry[], destination: DriveEntry): Promise<void> {
    if (!onMove || entries.length === 0) return;
    const ids = entries.map((entry) => entry.id);
    pendingTransfers = {...pendingTransfers, ...Object.fromEntries(ids.map((id) => [id, 0]))};
    clearSelection();
    try {
      await onMove(entries, destination, (fraction) => {
        pendingTransfers = {...pendingTransfers, ...Object.fromEntries(ids.map((id) => [id, fraction]))};
      });
    } finally {
      const remaining = {...pendingTransfers};
      for (const id of ids) delete remaining[id];
      pendingTransfers = remaining;
    }
  }

  function moveTo(destination: DriveEntry): void {
    moveOpen = false;
    moveQuery = '';
    void transferEntries([...selection], destination);
  }

  function destinationSourceId(destination: DriveEntry): string {
    if (destination.id.includes('/')) return destination.id.slice(0, destination.id.indexOf('/'));
    if (sources.some((source) => source.id === destination.id)) return destination.id;
    return activeSourceId;
  }

  function requestMove(destination: DriveEntry): void {
    moveOpen = false;
    moveQuery = '';
    if (destinationSourceId(destination) !== currentMoveSourceId) {
      moveConfirmDestination = destination;
      return;
    }
    moveTo(destination);
  }

  function chooseMoveProvider(source: DriveSource): void {
    if (source.id === currentMoveSourceId) return;
    requestMove({
      id: source.id,
      name: source.provider === 'local' ? providerLabel('local') : source.name,
      kind: 'folder',
      provider: source.provider,
    });
  }

  function confirmProviderMove(): void {
    const destination = moveConfirmDestination;
    if (!destination) return;
    moveConfirmDestination = null;
    moveTo(destination);
  }

  /**
   * Drag and drop. Two gestures share the list: rows dragged onto a folder
   * move there, and files dragged in from the Finder are added to whichever
   * folder they land on. Which one is happening is read off the drag itself,
   * so a folder highlights the same way for both.
   */
  const DRIVE_DRAG_TYPE = 'application/x-polymux-drive';

  /** Ids being dragged out of the list. Held here rather than read back from
   * `dataTransfer`, which refuses to be read until the drop lands. */
  let draggingIds = new Set<string>();
  /** The folder — row or crumb — currently under the pointer. */
  let dropTargetId: string | null = null;
  /** `dragenter`/`dragleave` fire again for every child the pointer crosses,
   * so the list's own highlight counts depth rather than trusting one leave. */
  let externalDepth = 0;
  $: externalDrag = externalDepth > 0;

  function draggingFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }

  function startRowDrag(event: DragEvent, entry: DriveEntry): void {
    if (!onMove || renaming) {
      event.preventDefault();
      return;
    }
    // A row dragged from outside the selection becomes the selection: what
    // moves is what is highlighted, and anything else moves rows the user
    // cannot see the drag carrying.
    if (!selectedIds.has(entry.id)) setSelection([entry.id]);
    draggingIds = new Set(selectedIds);
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    // A marker, not a payload: the entries never leave this list.
    event.dataTransfer.setData(DRIVE_DRAG_TYPE, [...draggingIds].join('\n'));
  }

  function endRowDrag(): void {
    draggingIds = new Set();
    dropTargetId = null;
  }

  /** Whether `folder` will take what is being dragged right now. */
  function acceptsDrop(event: DragEvent, folder: DriveEntry): boolean {
    if (folder.kind !== 'folder') return false;
    // Into itself is not a move, and neither is into the folder the rows are
    // already in — which is what the open folder's own crumb would be.
    if (draggingIds.size)
      return Boolean(onMove) && !draggingIds.has(folder.id) && folder.id !== current.id;
    return Boolean(onDropFiles) && draggingFiles(event);
  }

  function overFolder(event: DragEvent, folder: DriveEntry): void {
    if (!acceptsDrop(event, folder)) return;
    // Stopped here so the list behind it does not also light up: the folder
    // under the pointer is the destination, not the one it is sitting in.
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer)
      event.dataTransfer.dropEffect = draggingIds.size ? 'move' : 'copy';
    dropTargetId = folder.id;
  }

  function leaveFolder(folder: DriveEntry): void {
    if (dropTargetId === folder.id) dropTargetId = null;
  }

  function dropOnFolder(event: DragEvent, folder: DriveEntry): void {
    if (!acceptsDrop(event, folder)) return;
    event.preventDefault();
    event.stopPropagation();
    dropTargetId = null;
    externalDepth = 0;
    if (draggingIds.size) {
      const moving = items.filter((entry) => draggingIds.has(entry.id));
      draggingIds = new Set();
      if (moving.length) void transferEntries(moving, folder);
      return;
    }
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) void uploadFiles(files, folder, onDropFiles);
  }

  /** Anywhere in the list that is not a folder means the folder on screen. */
  function enterList(event: DragEvent): void {
    if (!onDropFiles || !draggingFiles(event)) return;
    externalDepth += 1;
  }

  function overList(event: DragEvent): void {
    if (!onDropFiles || !draggingFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function leaveList(event: DragEvent): void {
    if (!onDropFiles || !draggingFiles(event)) return;
    externalDepth = Math.max(0, externalDepth - 1);
    if (!externalDepth) dropTargetId = null;
  }

  function dropOnList(event: DragEvent): void {
    externalDepth = 0;
    dropTargetId = null;
    if (!onDropFiles || !draggingFiles(event)) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) void uploadFiles(files, current, onDropFiles);
  }

  async function chooseUploads(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // Selecting the same file twice must still fire change the second time.
    input.value = '';
    if (files.length) await uploadFiles(files, current, onUpload);
  }

  async function uploadFiles(
    files: File[],
    destination: DriveEntry,
    upload: ((files: File[], destination: DriveEntry, onProgress?: (fraction: number) => void) => Promise<void>) | null,
  ): Promise<void> {
    if (!upload) return;
    const visible = destination.id === current.id;
    const placeholders = visible
      ? files.map((file) => ({
          id: `upload:${crypto.randomUUID()}`,
          uploadId: crypto.randomUUID(),
          name: file.name,
          kind: driveEntryKind(file.name),
          size: file.size,
          progress: 0,
        } satisfies DriveEntry & {uploadId: string; progress: number}))
      : [];
    if (placeholders.length) pendingUploads = [...pendingUploads, ...placeholders];
    try {
      await upload(files, destination, (fraction) => {
        const ids = new Set<string>(placeholders.map((entry) => entry.uploadId));
        pendingUploads = pendingUploads.map((entry) => ids.has(entry.uploadId) ? {...entry, progress: fraction} : entry);
      });
    } finally {
      if (placeholders.length) {
        const finished = new Set<string>(placeholders.map((entry) => entry.uploadId));
        pendingUploads = pendingUploads.filter((entry) => !finished.has(entry.uploadId));
      }
    }
  }

  function confirmDelete(): void {
    confirmingDelete = false;
    onDelete?.(selection);
    clearSelection();
  }

  function selectSource(id: string): void {
    if (id === activeSourceId) return;
    // The tree belongs to the source that is going away, so the path into it
    // cannot survive the switch.
    trail = [];
    searchQuery = '';
    clearSelection();
    onSelectSource(id);
  }

  /** The menus and the expanded search all give up their space to the first
   * click that lands elsewhere. */
  function dismiss(event: MouseEvent | KeyboardEvent): void {
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // Escape backs out of one thing at a time, innermost first, so it never
      // clears a selection the user was still working with.
      // The storage switch is a Menu, which takes its own Escape before this
      // ever runs, so there is nothing to close for it here.
      if (renaming) cancelNaming();
      else if (moveConfirmDestination) moveConfirmDestination = null;
      else if (moveOpen) moveOpen = false;
      else if (confirmingDelete) confirmingDelete = false;
      else if (infoEntry) infoEntry = null;
      else if (filterOpen) filterOpen = false;
      else clearSelection();
      return;
    }
    if (!moveWrapper?.contains(event.target as Node)) moveOpen = false;
    if (!filterWrapper?.contains(event.target as Node)) filterOpen = false;
    if (searchExpanded && !searchQuery && !searchWrapper?.contains(event.target as Node)) searchExpanded = false;
  }
</script>

<svelte:window onclick={dismiss} onkeydown={dismiss}/>

<div class="fb">
  {#if loading && items.length === 0}
    <!-- A folder being fetched shows that it is being fetched: the pane was
         simply blank until whatever it holds arrived. -->
    <div class="fb-loading" role="status" aria-label={$t('common.loading')}>
      <span class="loading-dots"><i></i><i></i><i></i></span>
    </div>
  {/if}

  {#if showEmptyOverlay}
    <div class="fb-empty" aria-hidden="true">
      <Icon name={searchQuery.trim() ? 'search' : 'folder'} size={56} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
      <p>{searchQuery.trim() ? $t('drive.noMatches') : $t('drive.emptyFolder')}</p>
    </div>
  {/if}

  {#if error}
    <!-- Above the list rather than over it: what failed is about the folder
         you are looking at, which stays readable underneath. -->
    <div class="fb-error" role="alert">
      <span>{error}</span>
      <button type="button" aria-label={$t('common.dismissError')} onclick={onDismissError}>
        <Icon name="close" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
      </button>
    </div>
  {/if}

  <div class="fb-toolbar">
    <!-- With more than one backend connected the root of the path is which
         storage you are looking at, so the switch between them stands where
         that root would be. It sits outside the breadcrumbs because they clip
         their overflow to ellipsize a long path, which would cut the menu off
         too — and because the shared Menu positions its own list. -->
    {#if showSourceMenu}
      <!-- Plain, so it reads as the first crumb of the path rather than as a
           form control sitting in front of one. -->
      <Menu
        options={sourceOptions}
        value={activeSourceId}
        label="Storage"
        icon="drive"
        plain
        onChange={selectSource}
        onTriggerClick={crumbs.length > 1 ? () => openCrumb(0) : null}
      />
    {/if}

    {#if selectedSource && primary}
      <!-- Only once something is selected, and only when it is somewhere other
           than this Mac: the icon names where, the tooltip names which account
           or share, and pressing it opens that place. -->
      <button
        type="button"
        class="fb-where"
        aria-label={selectedSource.accountLabel
          ? `${providerLabel(primary.provider!)} · ${selectedSource.accountLabel}`
          : providerLabel(primary.provider!)}
        data-tooltip-label={selectedSource.accountLabel
          ? `${providerLabel(primary.provider!)} · ${selectedSource.accountLabel}`
          : providerLabel(primary.provider!)}
        onclick={() => onReveal(primary!)}
      >
        <Icon
          name={primary.provider === 'network' ? 'globe' : 'cloud'}
          size={MAIN_UI_ICON_SIZE}
          strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}
        />
      </button>
    {/if}

    <nav class="fb-breadcrumbs" aria-label={$t('drive.files')}>
      {#each crumbs as crumb, index (crumb.id)}
        <!-- The switch already names the root, so the crumb for it would only
             say the same thing twice. -->
        {#if !(index === 0 && showSourceMenu)}
          {#if index > 0}<span class="fb-crumb-separator" aria-hidden="true">/</span>{/if}
          <!-- A crumb takes a drop too, which is the way back up: dragging
               onto the folder above is how something leaves the one it is in. -->
          <button
            type="button"
            class="fb-crumb"
            class:current={index === crumbs.length - 1}
            class:drop-target={dropTargetId === crumb.id}
            aria-current={index === crumbs.length - 1 ? 'page' : undefined}
            onclick={() => openCrumb(index)}
            ondragenter={(event) => overFolder(event, crumb)}
            ondragover={(event) => overFolder(event, crumb)}
            ondragleave={() => leaveFolder(crumb)}
            ondrop={(event) => dropOnFolder(event, crumb)}
          >
            {#if index === 0}
              <span class="fb-home"><Icon name="home" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></span>
            {/if}
            <!-- The root crumb names the storage being browsed, not the tab it
                 is in: "Drive" is where you are, which the tab already says. -->
            <span>{index === 0 ? rootLabel : crumb.name}</span>
          </button>
        {/if}
      {/each}
      {#if selectedCrumbLabel}
        <!-- The row is already highlighted, so at a narrow dock the path is
             worth more than repeating the selection's name. -->
        <span class="fb-crumb-tail">
          <span class="fb-crumb-separator" aria-hidden="true">/</span>
          <span class="fb-crumb-selected">{selectedCrumbLabel}</span>
        </span>
      {/if}
    </nav>

    <!-- With something selected the toolbar belongs to it: the create actions
         step aside for what you can do to the selection. -->
    {#if selection.length}
      <div class="fb-actions">
        {#if confirmingDelete}
          <!-- The confirmation takes the toolbar over rather than opening a
               dialog: what is about to be deleted is the highlighted rows,
               already on screen behind it. -->
          <span class="fb-confirm-text">
            Delete {isMultiSelection ? `${selection.length} items` : primary?.name}?
          </span>
          <button type="button" class="fb-confirm-cancel" onclick={() => (confirmingDelete = false)}>{$t('common.cancel')}</button>
          <button type="button" class="fb-confirm-go" onclick={confirmDelete}>{$t('common.delete')}</button>
        {:else}
          {#if isMultiSelection}
            <span class="fb-selected-count">{selection.length} selected</span>
          {/if}
          {#if !isMultiSelection}
            <button type="button" class="fb-action" aria-label={$t('common.rename')} data-tooltip-label={$t('common.rename')} disabled={!onRename || !primary} onclick={() => primary && void startNaming(primary.id, primary.name)}>
              <Icon name="edit" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
            </button>
          {/if}
          <div bind:this={moveWrapper} class="fb-move">
            <button
              type="button"
              class="fb-action"
              class:on={moveOpen}
              aria-label={$t('drive.move')}
              data-tooltip-label={$t('drive.move')}
              aria-haspopup="menu"
              aria-expanded={moveOpen}
              disabled={!onMove || (moveTargets.length === 0 && moveProviderTargets.length < 2)}
              onclick={() => { moveOpen = !moveOpen; if (!moveOpen) moveQuery = ''; }}
            >
              <Icon name="folder-move" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
            </button>
            {#if moveOpen}
              <div class="polymux-dropdown-menu fb-move-menu" role="menu">
                <label class="fb-move-search">
                  <Icon name="search" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
                  <input bind:value={moveQuery} type="search" placeholder={$t('drive.searchPlaceholder')} aria-label={$t('drive.searchFiles')}/>
                </label>
                <div class="fb-move-folders">
                {#each filteredMoveTargets as target, index (target.id)}
                  <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => requestMove(target)}>
                    <span class="fb-move-name">
                      <Icon name="folder" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
                      <!-- The first entry is the way back up when there is one,
                           and it is the folder's name that says where that is. -->
                      <span>{index === 0 && crumbs.length > 1 ? `↑ ${target.name}` : target.name}</span>
                    </span>
                  </button>
                {/each}
                {#if filteredMoveTargets.length === 0}
                  <span class="fb-move-empty">{$t('drive.noMatches')}</span>
                {/if}
                </div>
                <div class="fb-move-providers" role="group" aria-label={$t('drive.storage')}>
                  {#each moveProviderTargets as source (source.id)}
                    <button type="button" class="polymux-dropdown-item" role="menuitemradio" aria-checked={source.id === currentMoveSourceId} onclick={() => chooseMoveProvider(source)}>
                      <span class="fb-move-name">
                        {#if source.provider}<DriveProviderLogo provider={source.provider} size={13} plain/>{/if}
                        <span>{source.provider === 'local' ? providerLabel('local') : source.name}</span>
                      </span>
                      {#if source.id === currentMoveSourceId}<Icon name="check" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>{/if}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
          <button type="button" class="fb-action" aria-label={$t('drive.duplicate')} data-tooltip-label={$t('drive.duplicate')} disabled={!onDuplicate} onclick={() => onDuplicate?.(selection)}>
            <Icon name="copy" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
          </button>
          {#if !isMultiSelection && primary?.kind !== 'folder'}
            <button type="button" class="fb-action" aria-label={$t('drive.download')} data-tooltip-label={$t('drive.download')} disabled={!onDownload || !primary} onclick={() => primary && onDownload?.(primary)}>
              <Icon name="download" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
            </button>
          {/if}
          {#if !isMultiSelection}
            <!-- Info needs no handler: everything it shows is already on the
                 row, so the drive answers it itself. -->
            <button type="button" class="fb-action" class:on={infoEntry !== null} aria-label={$t('drive.info')} data-tooltip-label={$t('drive.info')} disabled={!primary} onclick={() => (infoEntry = infoEntry ? null : primary)}>
              <Icon name="info" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
            </button>
          {/if}
          <button type="button" class="fb-action danger" aria-label={$t('common.delete')} data-tooltip-label={$t('common.delete')} disabled={!onDelete} onclick={() => (confirmingDelete = true)}>
            <Icon name="trash" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
          </button>
          <span class="fb-action-divider" aria-hidden="true"></span>
          <button type="button" class="fb-action muted" aria-label={$t('drive.clearSelection')} data-tooltip-label={$t('drive.deselect')} onclick={clearSelection}>
            <Icon name="close" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
          </button>
        {/if}
      </div>
    {:else}
    <div class="fb-actions">
      <button
        type="button"
        class="fb-action"
        aria-label={$t('drive.newFolder')}
        data-tooltip-label={$t('drive.newFolder')}
        disabled={!onNewFolder}
        onclick={() => void startNaming(NEW_FOLDER_ROW, suggestedFolderName())}
      ><Icon name="folder-plus" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>

      <button
        type="button"
        class="fb-action"
        aria-label={$t('drive.upload')}
        data-tooltip-label={$t('drive.upload')}
        disabled={!onUpload}
        onclick={() => uploadInput?.click()}
      ><Icon name="upload" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
      <input
        bind:this={uploadInput}
        class="fb-upload-input"
        type="file"
        multiple
        tabindex="-1"
        onchange={(event) => void chooseUploads(event)}
      />

      <div bind:this={filterWrapper} class="fb-filter">
        <button
          type="button"
          class="fb-action"
          class:on={activeFilter !== 'all'}
          aria-label={$t('drive.filterFiles')}
          data-tooltip-label={$t('drive.filter')}
          aria-haspopup="menu"
          aria-expanded={filterOpen}
          onclick={() => filterOpen = !filterOpen}
        ><Icon name="filter" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
        {#if filterOpen}
          <div class="fb-filter-menu" role="menu">
            {#each filterItems as item (item.id)}
              <button type="button" class="fb-filter-item" class:active={activeFilter === item.id} role="menuitemradio" aria-checked={activeFilter === item.id} onclick={() => setFilter(item.id)}>
                <span>{item.label}</span>
                {#if activeFilter === item.id}<Icon name="check" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>{/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="fb-search" class:expanded={searchExpanded}>
        <div bind:this={searchWrapper} class="fb-search-field" class:expanded={searchExpanded} class:focused={searchFocused}>
          <button
            type="button"
            class="fb-action"
            class:quiet={searchExpanded}
            aria-label={$t('drive.searchFiles')}
            data-tooltip-label={searchExpanded ? undefined : $t('common.search')}
            onclick={toggleSearch}
          ><Icon name="search" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
          <div class="fb-search-slot">
            <input
              bind:this={searchInput}
              bind:value={searchQuery}
              type="text"
              placeholder={$t('drive.searchPlaceholder')}
              aria-label={$t('drive.searchFiles')}
              tabindex={searchExpanded ? 0 : -1}
              onfocus={() => searchFocused = true}
              onblur={() => searchFocused = false}
              onkeydown={(event) => { if (event.key === 'Escape') toggleSearch(); }}
            />
            {#if searchQuery}
              <button
                type="button"
                class="fb-search-clear"
                aria-label={$t('common.clearSearch')}
                data-tooltip="none"
                onclick={() => { searchQuery = ''; searchInput?.focus(); }}
              ><Icon name="close" size={12}/></button>
            {/if}
          </div>
        </div>
      </div>
    </div>
    {/if}
  </div>

  <!-- Dropped onto the list rather than onto a folder in it, files land in
       the folder on screen. -->
  <div
    class="fb-list"
    role="presentation"
    ondragenter={enterList}
    ondragover={overList}
    ondragleave={leaveList}
    ondrop={dropOnList}
  >
    <div class="fb-head" role="row">
      {#each [{key: 'name', label: $t('drive.columnName')}, {key: 'size', label: $t('drive.columnSize')}, {key: 'kind', label: $t('drive.columnKind')}, {key: 'modified', label: $t('drive.columnModified')}] as column (column.key)}
        <span
          class={`fb-head-cell ${column.key}`}
          role="columnheader"
          aria-sort={sortKey === column.key ? (sortAscending ? 'ascending' : 'descending') : 'none'}
        >
          <button type="button" class="fb-head-button" class:sorted={sortKey === column.key} class:descending={sortKey === column.key && !sortAscending} onclick={() => sortBy(column.key as DriveSortKey)}>
            <span>{column.label}</span>{#if sortKey === column.key}<Icon name="chevron" size={12} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>{/if}
          </button>
        </span>
      {/each}
    </div>

    <!-- Dragging across the whitespace between and below rows sweeps a
         selection box, the way the old browser did. -->
    <div
      bind:this={rowsEl}
      class="fb-rows"
      class:dropping={externalDrag && !dropTargetId}
      role="presentation"
      onpointerdown={startMarquee}
      onclickcapture={swallowClickAfterDrag}
    >
      {#if renaming === NEW_FOLDER_ROW}
        <!-- The folder does not exist until it is named, so it is a row rather
             than a dialog: it appears where it will end up. -->
        <div class="fb-row naming" role="presentation">
          <span class="fb-cell name">
            <span class="fb-icon"><Icon name="folder" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></span>
            <input
              bind:this={nameInput}
              bind:value={nameDraft}
              class="fb-name-input"
              type="text"
              aria-label={$t('drive.folderName')}
              onkeydown={submitName}
              onblur={commitName}
            />
          </span>
          <span class="fb-cell size">—</span>
          <span class="fb-cell kind">{$t('drive.kind.folder')}</span>
          <span class="fb-cell modified">—</span>
        </div>
      {/if}
      {#each pendingUploads as entry (entry.uploadId)}
        <div class="fb-row uploading" role="status" aria-label={`${$t('drive.upload')}: ${entry.name}`}>
          <span class="fb-cell name">
            <span class="fb-icon"><Icon name={entryIcons[entry.kind]} size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></span>
            <span class="fb-name">{entry.name}</span>
            <span class="fb-progress-ring" style:--progress={`${entry.progress * 360}deg`} aria-hidden="true"></span>
          </span>
          <span class="fb-cell size">{entry.size === undefined ? '—' : formatDriveSize(entry.size)}</span>
          <span class="fb-cell kind">{driveKindLabel(entry.kind)}</span>
          <span class="fb-cell modified">{$t('drive.upload')}…</span>
        </div>
      {/each}
      {#each items as entry, index (entry.id)}
        <!-- A real button so the shared tooltip, which only tracks buttons,
             can pick the row up when its name is clipped. -->
        <button
          type="button"
          class="fb-row"
          class:odd={index % 2 === 1}
          class:selected={selectedIds.has(entry.id)}
          class:dragging={draggingIds.has(entry.id)}
          class:transferring={pendingTransfers[entry.id] !== undefined}
          class:drop-target={dropTargetId === entry.id}
          draggable={Boolean(onMove) && renaming !== entry.id && pendingTransfers[entry.id] === undefined}
          data-drive-id={entry.id}
          aria-label={entry.kind === 'folder' ? $t('drive.openFolder', {name: entry.name}) : $t('drive.openEntry', {name: entry.name})}
          aria-pressed={selectedIds.has(entry.id)}
          use:overflowTooltip={entry.name}
          onclick={(event) => selectEntry(entry, event)}
          oncontextmenu={(event) => openRowMenu(event, entry)}
          ondblclick={(event) => openEntry(entry, {x: event.clientX, y: event.clientY})}
          ondragstart={(event) => startRowDrag(event, entry)}
          ondragend={endRowDrag}
          ondragenter={(event) => overFolder(event, entry)}
          ondragover={(event) => overFolder(event, entry)}
          ondragleave={() => leaveFolder(entry)}
          ondrop={(event) => dropOnFolder(event, entry)}
        >
          <span class="fb-cell name">
            <!-- A folder holding something draws filled, an empty one stays an
                 outline — the same tell the old browser used. -->
            <span class="fb-icon"><Icon name={entryIcons[entry.kind]} size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} filled={entry.kind === 'folder' && Boolean(entry.children?.length)}/></span>
            {#if renaming === entry.id}
              <!-- Renaming happens in place: the row is already the thing being
                   named, so nothing has to say which file the field belongs to. -->
              <input
                bind:this={nameInput}
                bind:value={nameDraft}
                class="fb-name-input"
                type="text"
                aria-label={$t('drive.newName')}
                onclick={(event) => event.stopPropagation()}
                ondblclick={(event) => event.stopPropagation()}
                onkeydown={submitName}
                onblur={commitName}
              />
            {:else}
              <span class="fb-name">{entry.name}</span>
              {#if pendingTransfers[entry.id] !== undefined || (entry.provider && entry.provider !== 'local')}
                <span class="fb-file-status">
                {#if pendingTransfers[entry.id] !== undefined}
                  <!-- Progress replaces provenance while bytes are moving: two
                       marks here would describe two states at once. -->
                  <span class="fb-progress-ring" style:--progress={`${pendingTransfers[entry.id] * 360}deg`} aria-hidden="true"></span>
                {:else if entry.provider && entry.provider !== 'local'}
                  <span class="fb-provider-badge">
                    <Icon
                      name={entry.provider === 'network' ? 'globe' : 'cloud'}
                      size={12}
                      strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}
                    />
                  </span>
                  <span class="fb-provider-name">{providerLabel(entry.provider)}</span>
                {/if}
                </span>
              {/if}
            {/if}
          </span>
          <span class="fb-cell size">{entry.size === undefined ? '—' : formatDriveSize(entry.size)}</span>
          <span class="fb-cell kind">{driveKindLabel(entry.kind)}</span>
          <span class="fb-cell modified">{entry.modifiedAt ? formatDriveDate(entry.modifiedAt) : '—'}</span>
        </button>
      {/each}
      {#if marqueeBox}
        <div
          class="fb-marquee"
          aria-hidden="true"
          style={`left:${marqueeBox.left}px;top:${marqueeBox.top}px;width:${marqueeBox.width}px;height:${marqueeBox.height}px`}
        ></div>
      {/if}
    </div>
  </div>

  <OpenMenu
    choices={rowMenuChoices}
    anchor={rowMenuAnchor}
    compact
    onChoose={chooseRowMenu}
    onClose={() => (rowMenuAnchor = null)}
  />

  {#if moveConfirmDestination}
    <div class="fb-transfer-backdrop" role="presentation" onclick={(event) => { if (event.currentTarget === event.target) moveConfirmDestination = null; }}>
      <div class="fb-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="drive-transfer-title">
        <h3 id="drive-transfer-title">{$t('drive.move')}</h3>
        <p>Move {selection.length > 1 ? `${selection.length} items` : primary?.name} to {moveConfirmDestination.name}?</p>
        <div class="fb-transfer-destination">
          {#if moveConfirmDestination.provider}<DriveProviderLogo provider={moveConfirmDestination.provider} size={16} plain/>{/if}
          <span>{moveConfirmDestination.name}</span>
        </div>
        <footer>
          <button type="button" class="fb-confirm-cancel" onclick={() => (moveConfirmDestination = null)}>{$t('common.cancel')}</button>
          <button type="button" class="fb-transfer-confirm" onclick={confirmProviderMove}>{$t('drive.move')}</button>
        </footer>
      </div>
    </div>
  {/if}

  <!-- Everything here is already on the row; the panel is a place to read it
       in full, so it needs nothing from the host to open. -->
  {#if infoEntry}
    <aside class="fb-info" aria-label={$t('drive.fileInformation')}>
      <header>
        <span class="fb-icon"><Icon name={entryIcons[infoEntry.kind]} size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></span>
        <strong>{infoEntry.name}</strong>
        <button type="button" aria-label={$t('drive.closeInformation')} onclick={() => (infoEntry = null)}>
          <Icon name="close" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
        </button>
      </header>
      <dl>
        <dt>{$t('drive.columnKind')}</dt><dd>{driveKindLabel(infoEntry.kind)}</dd>
        <dt>{$t('drive.columnSize')}</dt><dd>{infoEntry.size === undefined ? '—' : formatDriveSize(infoEntry.size)}</dd>
        <dt>{$t('drive.modified')}</dt><dd>{infoEntry.modifiedAt ? formatDriveDate(infoEntry.modifiedAt) : '—'}</dd>
        {#if infoEntry.provider}
          <dt>{$t('drive.storage')}</dt>
          <dd class="fb-info-provider">
            <DriveProviderLogo provider={infoEntry.provider} size={13} plain/>
            <span>{providerLabel(infoEntry.provider)}</span>
          </dd>
        {/if}
        {#if infoEntry.uri}<dt>{$t('drive.source')}</dt><dd class="fb-info-path">{infoEntry.uri}</dd>{/if}
      </dl>
    </aside>
  {/if}
</div>
