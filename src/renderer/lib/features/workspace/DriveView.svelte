<script module lang="ts">
  import type {DriveProviderId} from '@flareai/protocol';
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
  export let onOpenEntry: (entry: DriveEntry) => void = () => {};
  /**
   * Every action stays in the toolbar and goes live as soon as a handler is
   * passed. Naming and confirming happen here rather than in the host: the
   * drive is where the row is, and Electron has no `prompt` to fall back on.
   */
  export let onNewFolder: ((parent: DriveEntry, name: string) => void) | null = null;
  export let onUpload: ((parent: DriveEntry) => void) | null = null;
  export let onRename: ((entry: DriveEntry, name: string) => void) | null = null;
  /** Moves the entries into `destination`, a folder of the same provider. */
  export let onMove: ((entries: DriveEntry[], destination: DriveEntry) => void) | null = null;
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
  let infoEntry: DriveEntry | null = null;
  let sortKey: DriveSortKey = 'name';
  let sortAscending = true;
  /** The whole highlighted set. `primaryId` is the one single-target actions
   * aim at, and the anchor a shift-click ranges from. */
  let selectedIds = new Set<string>();
  let primaryId: string | null = null;

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
  $: showSourceMenu = sources.length > 1;
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
  $: rootLabel = sources.find((source) => source.id === activeSourceId)?.name ?? title;
  /** A folder still being fetched is not an empty one, and saying so would be
   * wrong for exactly as long as the request takes. */
  $: showEmptyOverlay = items.length === 0 && !loading;
  $: selection = items.filter((entry) => selectedIds.has(entry.id));
  $: primary = selection.find((entry) => entry.id === primaryId) ?? selection[0] ?? null;
  $: isMultiSelection = selection.length > 1;
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
   * Plain click selects, and clicking the lone selected row again clears it.
   * ⌘/Ctrl extends the set one row at a time, Shift takes the run between the
   * anchor and the row — the same grammar the old browser used.
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
    if (selectedIds.size === 1 && selectedIds.has(entry.id)) {
      clearSelection();
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

  function openEntry(entry: DriveEntry): void {
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
      onOpenEntry(entry);
    }
  }

  function openCrumb(index: number): void {
    trail = crumbs.slice(1, index + 1).map((crumb) => crumb.id);
    searchQuery = '';
    clearSelection();
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
   * saves rather than silently discarding what was typed — but an unchanged
   * or empty name is simply a cancel.
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

  function moveTo(destination: DriveEntry): void {
    moveOpen = false;
    onMove?.(selection, destination);
    clearSelection();
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

    <nav class="fb-breadcrumbs" aria-label={$t('drive.files')}>
      {#each crumbs as crumb, index (crumb.id)}
        <!-- The switch already names the root, so the crumb for it would only
             say the same thing twice. -->
        {#if !(index === 0 && showSourceMenu)}
          {#if index > 0}<span class="fb-crumb-separator" aria-hidden="true">/</span>{/if}
          <button
            type="button"
            class="fb-crumb"
            class:current={index === crumbs.length - 1}
            aria-current={index === crumbs.length - 1 ? 'page' : undefined}
            onclick={() => openCrumb(index)}
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
              disabled={!onMove || moveTargets.length === 0}
              onclick={() => (moveOpen = !moveOpen)}
            >
              <Icon name="folder-move" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
            </button>
            {#if moveOpen}
              <div class="fb-filter-menu" role="menu">
                {#each moveTargets as target, index (target.id)}
                  <button type="button" class="fb-filter-item" role="menuitem" onclick={() => moveTo(target)}>
                    <span class="fb-move-name">
                      <Icon name="folder" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
                      <!-- The first entry is the way back up when there is one,
                           and it is the folder's name that says where that is. -->
                      <span>{index === 0 && crumbs.length > 1 ? `↑ ${target.name}` : target.name}</span>
                    </span>
                  </button>
                {/each}
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
        onclick={() => void startNaming(NEW_FOLDER_ROW, $t('drive.untitledFolder'))}
      ><Icon name="folder-plus" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>

      <button
        type="button"
        class="fb-action"
        aria-label={$t('drive.upload')}
        data-tooltip-label={$t('drive.upload')}
        disabled={!onUpload}
        onclick={() => onUpload?.(current)}
      ><Icon name="upload" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>

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

  <div class="fb-list">
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
      {#each items as entry, index (entry.id)}
        <!-- A real button so the shared tooltip, which only tracks buttons,
             can pick the row up when its name is clipped. -->
        <button
          type="button"
          class="fb-row"
          class:odd={index % 2 === 1}
          class:selected={selectedIds.has(entry.id)}
          data-drive-id={entry.id}
          aria-label={entry.kind === 'folder' ? $t('drive.openFolder', {name: entry.name}) : $t('drive.openEntry', {name: entry.name})}
          aria-pressed={selectedIds.has(entry.id)}
          use:overflowTooltip={entry.name}
          onclick={(event) => selectEntry(entry, event)}
          ondblclick={() => openEntry(entry)}
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
              {#if entry.provider && entry.provider !== 'local'}
                <!-- The badge trails the name as the last token of it, so it
                     reads as part of the filename rather than as a column. The
                     local disk gets none: an unmarked file is already on this
                     Mac, which is the assumption worth not spending a mark on. -->
                <!-- A plain `title`: the shared tooltip only reads buttons, and
                     this badge is part of the row's label rather than a control. -->
                <span class="fb-provider-badge" title={providerLabel(entry.provider)}>
                  <DriveProviderLogo provider={entry.provider} size={11} plain/>
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
