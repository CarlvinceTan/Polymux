<script module lang="ts">
  let rememberedRoot = '';
  let rememberedOpenPath = '';
  let rememberedTreeWidth = 220;
</script>

<script lang="ts">
  import {onDestroy, onMount, tick} from 'svelte';
  import {SvelteSet} from 'svelte/reactivity';
  import type {IdeEntryDto, IdeFileDto} from '@polymux/protocol';
  import {polymuxApi} from '../../api/polymux';
  import {languageForName} from '../../../../main/ide/language';
  import {readableError} from '../../shared/errors';
  import Icon from '../../shared/components/Icon.svelte';
  import {MAIN_UI_ICON_SIZE, MAIN_UI_ICON_STROKE_WIDTH} from '../../shared/layout/iconSizing';
  import {t} from '../../../i18n';
  import FileKindIcon from './FileKindIcon.svelte';
  import TerminalView from './TerminalView.svelte';
  import {afterSessionClosed} from './terminalSessionClose';
  import {
    isFileDirty,
    joinPath,
    moveDestination,
    nextUntitledName,
    parentPath,
    validFileName,
  } from './ideFileTabs';

  type TreeNode = IdeEntryDto & {children?: TreeNode[]};
  type IdeTerminalSession = {id: string; label: string};
  type IdeFileTab = {
    path: string;
    name: string;
    language: string;
    binary: boolean;
    content: string;
    savedContent: string | null;
    cursorLine: number;
    cursorColumn: number;
  };

  const api = polymuxApi();
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TERMINAL_HEIGHT = 220;
  const TREE_MIN = 140;
  const TREE_MAX = 480;
  const EDITOR_MIN = 240;
  const FILE_DRAG = 'application/x-polymux-ide-file';

  let root = $state(rememberedRoot);
  let treeWidth = $state(rememberedTreeWidth);
  let treeResizing = $state(false);
  let workEl = $state<HTMLElement | null>(null);
  let resizeFrame = 0;
  let pendingResizeX: number | null = null;
  let entries = $state<TreeNode[]>([]);
  const expanded = new SvelteSet<string>();
  const loadingPaths = new SvelteSet<string>();
  let projectOpen = $state(true);
  let terminalOpen = $state(false);
  let terminalSessions = $state<IdeTerminalSession[]>([]);
  let activeTerminalId = $state('');
  let terminalSeq = 0;
  let unsubscribeTerminal: (() => void) | undefined;
  let busy = $state(false);
  let error = $state('');
  let fileTabs = $state<IdeFileTab[]>([]);
  const pendingSaves = new Map<IdeFileTab, Promise<boolean>>();
  let activePath = $state('');
  let cursorLine = $state(1);
  let cursorColumn = $state(1);
  let renamingPath = $state('');
  let renameDraft = $state('');
  let renameInput = $state<HTMLInputElement | null>(null);
  let renamingTerminalId = $state('');
  let terminalRenameDraft = $state('');
  let terminalRenameInput = $state<HTMLInputElement | null>(null);
  let draggingPath = $state('');
  let dropTarget = $state<string | null>(null);
  let suppressTreeClick = false;

  const projectName = $derived(root ? root.split(/[/\\]/).filter(Boolean).at(-1) ?? root : '');
  const activeFile = $derived(fileTabs.find((tab) => tab.path === activePath));
  const openName = $derived(activeFile?.name ?? '');
  const language = $derived(activeFile?.language ?? '');
  const binary = $derived(activeFile?.binary ?? false);
  const ideEditorImport = import('./IdeEditor.svelte');

  onMount(() => {
    if (rememberedRoot) void restoreSession();
    unsubscribeTerminal = api.terminal.subscribe((event) => {
      if (event.type === 'exit') closeTerminalSession(event.id);
    });
  });

  onDestroy(() => {
    unsubscribeTerminal?.();
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    for (const tab of fileTabs) {
      if (tab.savedContent !== null) void saveTab(tab);
    }
    for (const session of terminalSessions)
      void api.terminal.close(session.id).catch(() => {});
  });

  async function restoreSession(): Promise<void> {
    await loadFolder('');
    if (rememberedOpenPath) await readFile(rememberedOpenPath);
  }

  async function chooseProject(): Promise<void> {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const chosen = await api.ide.pickFolder();
      if (!chosen) return;
      rememberedRoot = chosen;
      rememberedOpenPath = '';
      root = chosen;
      expanded.clear();
      resetFiles();
      await loadFolder('');
    } catch (reason) {
      error = readableError(reason);
    } finally {
      busy = false;
    }
  }

  function resetFiles(): void {
    fileTabs = [];
    activePath = '';
    cursorLine = 1;
    cursorColumn = 1;
    renamingPath = '';
    renameDraft = '';
  }

  async function loadFolder(relative: string, quiet = false): Promise<void> {
    loadingPaths.add(relative);
    try {
      const listed = await api.ide.list(root, relative);
      if (relative === '') entries = listed;
      else attachChildren(relative, listed);
    } catch (reason) {
      if (quiet) {
        if (relative) expanded.delete(relative);
        return;
      }
      error = readableError(reason);
    } finally {
      loadingPaths.delete(relative);
    }
  }

  async function reloadTree(): Promise<void> {
    await loadFolder('');
    const folders = [...expanded].sort((a, b) => a.split('/').length - b.split('/').length);
    for (const folder of folders) await loadFolder(folder, true);
  }

  function attachChildren(relative: string, children: TreeNode[]): void {
    const visit = (nodes: TreeNode[]): TreeNode[] => nodes.map((node) => {
      if (node.path === relative) return {...node, children};
      if (node.children) return {...node, children: visit(node.children)};
      return node;
    });
    entries = visit(entries);
  }

  async function toggleFolder(node: TreeNode): Promise<void> {
    if (expanded.has(node.path)) {
      expanded.delete(node.path);
      return;
    }
    expanded.add(node.path);
    if (!node.children) await loadFolder(node.path);
  }

  function consumeDragClick(): boolean {
    if (!suppressTreeClick) return false;
    suppressTreeClick = false;
    return true;
  }

  async function openEntry(node: TreeNode): Promise<void> {
    if (consumeDragClick()) return;
    if (node.kind === 'folder') {
      await toggleFolder(node);
      return;
    }
    const open = fileTabs.find((tab) => tab.path === node.path);
    if (open) {
      activateFile(open.path);
      return;
    }
    await readFile(node.path);
  }

  function adoptFile(file: IdeFileDto, saved = true): void {
    const existing = fileTabs.find((tab) => tab.path === file.path);
    if (existing) {
      activateFile(existing.path);
      return;
    }
    fileTabs = [...fileTabs, {
      path: file.path,
      name: file.name,
      language: file.language,
      binary: file.binary,
      content: file.content ?? '',
      savedContent: saved ? file.content ?? '' : null,
      cursorLine: 1,
      cursorColumn: 1,
    }];
    activateFile(file.path);
  }

  async function readFile(relative: string): Promise<void> {
    error = '';
    try {
      const file = await api.ide.read(root, relative);
      adoptFile(file);
    } catch (reason) {
      error = readableError(reason);
    }
  }

  function activateFile(path: string): void {
    const current = fileTabs.find((tab) => tab.path === activePath);
    if (current) {
      current.cursorLine = cursorLine;
      current.cursorColumn = cursorColumn;
    }
    activePath = path;
    const next = fileTabs.find((tab) => tab.path === path);
    rememberedOpenPath = next?.savedContent !== null ? path : '';
    cursorLine = next?.cursorLine ?? 1;
    cursorColumn = next?.cursorColumn ?? 1;
  }

  async function saveTab(tab: IdeFileTab): Promise<boolean> {
    const pending = pendingSaves.get(tab);
    if (pending) return pending;
    if (!root || tab.binary || !isFileDirty(tab)) return true;
    const saving = persistTab(tab);
    pendingSaves.set(tab, saving);
    try {
      return await saving;
    } finally {
      pendingSaves.delete(tab);
    }
  }

  async function persistTab(tab: IdeFileTab): Promise<boolean> {
    const content = tab.content;
    const isNew = tab.savedContent === null;
    try {
      if (isNew) await api.ide.create(root, tab.path, content);
      else await api.ide.write(root, tab.path, content);
      // Edits made while the write is pending must keep their dirty indicator.
      tab.savedContent = content;
      if (activePath === tab.path) rememberedOpenPath = tab.path;
      error = '';
      if (isNew) await reloadTree();
      return true;
    } catch (reason) {
      error = readableError(reason);
      return false;
    }
  }

  async function saveOpenFile(): Promise<void> {
    const tab = fileTabs.find((item) => item.path === activePath);
    if (tab) await saveTab(tab);
  }

  function addFile(): void {
    if (!root) return;
    const taken = [
      ...entries.map((entry) => entry.name),
      ...fileTabs.filter((tab) => !parentPath(tab.path)).map((tab) => tab.name),
    ];
    const name = nextUntitledName(taken, $t('ide.untitledFile'));
    adoptFile({path: name, name, language: 'Text', binary: false, content: ''}, false);
    error = '';
  }

  async function closeFileTab(path: string): Promise<void> {
    const tab = fileTabs.find((item) => item.path === path);
    if (tab) {
      const pending = pendingSaves.get(tab);
      if (pending && !(await pending)) return;
      // Closing a draft must not create a file as a side effect.
      if (tab.savedContent !== null && !(await saveTab(tab))) return;
    }
    const next = afterSessionClosed(
      fileTabs.map((item) => ({id: item.path})),
      activePath,
      path,
    );
    if (!next) return;
    // Keep other tab objects stable while their saves may still be pending.
    fileTabs = fileTabs.filter((item) => item.path !== path);
    activePath = next.activeId ?? '';
    const active = fileTabs.find((item) => item.path === activePath);
    rememberedOpenPath = active?.savedContent !== null ? activePath : '';
    if (renamingPath === path) renamingPath = '';
  }

  async function startFileRename(tab: IdeFileTab): Promise<void> {
    activateFile(tab.path);
    renamingTerminalId = '';
    renamingPath = tab.path;
    renameDraft = tab.name;
    await tick();
    renameInput?.focus();
    const dot = tab.name.lastIndexOf('.');
    renameInput?.setSelectionRange(0, dot > 0 ? dot : tab.name.length);
  }

  async function commitFileRename(): Promise<void> {
    const path = renamingPath;
    const name = renameDraft.trim();
    if (!path) return;
    renamingPath = '';
    const tab = fileTabs.find((item) => item.path === path);
    if (!tab || !validFileName(name) || name === tab.name) return;
    await moveOpenFile(tab.path, joinPath(parentPath(tab.path), name));
  }

  async function moveOpenFile(from: string, to: string): Promise<void> {
    if (!root || from === to) return;
    try {
      const tab = fileTabs.find((item) => item.path === from);
      if (fileTabs.some((item) => item.path !== from && item.path.toLowerCase() === to.toLowerCase()))
        throw new Error('Already exists');
      const pending = tab && pendingSaves.get(tab);
      if (pending && !(await pending)) return;
      if (tab?.savedContent === null) {
        const folder = parentPath(to);
        const siblings = await api.ide.list(root, folder);
        if (siblings.some((entry) => entry.path.toLowerCase() === to.toLowerCase()))
          throw new Error('Already exists');
        if (!fileTabs.includes(tab)) return;
        const saving = pendingSaves.get(tab);
        if (saving && !(await saving)) return;
        if (tab.savedContent !== null) {
          await moveOpenFile(from, to);
          return;
        }
        const name = to.slice(folder ? folder.length + 1 : 0);
        fileTabs = fileTabs.map((item) => item === tab
          ? {...item, path: to, name, language: languageForName(name)}
          : item);
        if (activePath === from) activePath = to;
        error = '';
        return;
      }
      const file = await api.ide.move(root, from, to);
      fileTabs = fileTabs.map((tab) => tab.path === from
        ? {
            ...tab,
            path: file.path,
            name: file.name,
            language: file.language,
            binary: file.binary,
            ...(file.binary
              ? {content: '', savedContent: ''}
              : tab.binary
                ? {content: file.content ?? '', savedContent: file.content ?? ''}
                : {}),
          }
        : tab);
      if (activePath === from) activePath = file.path;
      if (rememberedOpenPath === from) rememberedOpenPath = file.path;
      const folder = parentPath(file.path);
      if (folder) expanded.add(folder);
      await reloadTree();
      error = '';
    } catch (reason) {
      error = readableError(reason);
    }
  }

  function startFileDrag(event: DragEvent, node: TreeNode): void {
    if (node.kind !== 'file' || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    draggingPath = node.path;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(FILE_DRAG, node.path);
    event.dataTransfer.setData('text/plain', node.path);
  }

  function endFileDrag(): void {
    if (draggingPath) suppressTreeClick = true;
    draggingPath = '';
    dropTarget = null;
  }

  function overFolder(event: DragEvent, folder: string): void {
    if (!draggingPath) return;
    event.stopPropagation();
    if (!moveDestination(draggingPath, folder)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dropTarget = folder;
  }

  function overTreeRow(event: DragEvent, node: TreeNode): void {
    overFolder(event, node.kind === 'folder' ? node.path : parentPath(node.path));
  }

  function dropOnTreeRow(event: DragEvent, node: TreeNode): void {
    dropOnFolder(event, node.kind === 'folder' ? node.path : parentPath(node.path));
  }

  function leaveFolder(folder: string): void {
    if (dropTarget === folder) dropTarget = null;
  }

  function dropOnFolder(event: DragEvent, folder: string): void {
    const from = draggingPath || event.dataTransfer?.getData(FILE_DRAG) || event.dataTransfer?.getData('text/plain');
    if (!from) return;
    event.stopPropagation();
    const dest = moveDestination(from, folder);
    if (!dest) return;
    event.preventDefault();
    draggingPath = '';
    dropTarget = null;
    suppressTreeClick = true;
    void moveOpenFile(from, dest);
  }

  async function startTerminalRename(session: IdeTerminalSession): Promise<void> {
    renamingPath = '';
    renamingTerminalId = session.id;
    terminalRenameDraft = session.label;
    await tick();
    terminalRenameInput?.focus();
    terminalRenameInput?.select();
  }

  function commitTerminalRename(): void {
    const id = renamingTerminalId;
    const label = terminalRenameDraft.trim();
    if (!id) return;
    renamingTerminalId = '';
    if (!label) return;
    terminalSessions = terminalSessions.map((session) => session.id === id ? {...session, label} : session);
  }

  function renameKeydown(event: KeyboardEvent, commit: () => void | Promise<void>, cancel: () => void): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancel();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void commit();
  }

  function toggleProject(): void {
    projectOpen = !projectOpen;
  }

  function toggleTerminal(): void {
    if (terminalOpen) {
      terminalOpen = false;
      return;
    }
    terminalOpen = true;
    if (terminalSessions.length === 0) void addTerminalSession();
  }

  async function addTerminalSession(): Promise<void> {
    try {
      const {id} = await api.terminal.create(root || undefined);
      terminalSeq += 1;
      const label = terminalSeq === 1 ? 'T' : `T${terminalSeq}`;
      terminalSessions = [...terminalSessions, {id, label}];
      activeTerminalId = id;
      terminalOpen = true;
    } catch (reason) {
      error = readableError(reason);
    }
  }

  function closeTerminalSession(id: string): void {
    const next = afterSessionClosed(terminalSessions, activeTerminalId, id);
    if (!next) return;
    void api.terminal.close(id).catch(() => {});
    terminalSessions = next.items;
    activeTerminalId = next.activeId ?? '';
    if (renamingTerminalId === id) renamingTerminalId = '';
    if (next.items.length === 0) {
      terminalOpen = false;
      terminalSeq = 0;
    }
  }

  function onEditorChange(next: string, line: number, column: number): void {
    const tab = fileTabs.find((item) => item.path === activePath);
    if (tab) {
      if (tab.content !== next) tab.content = next;
      tab.cursorLine = line;
      tab.cursorColumn = column;
    }
    cursorLine = line;
    cursorColumn = column;
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (!(event.target instanceof Node) || !workEl?.closest('.ide')?.contains(event.target)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveOpenFile();
    }
  }

  function attachWork(node: HTMLElement): () => void {
    workEl = node;
    return () => {
      if (workEl === node) workEl = null;
    };
  }

  function clampTreeWidth(width: number): number {
    const available = workEl?.getBoundingClientRect().width ?? TREE_MAX + EDITOR_MIN;
    const max = Math.max(TREE_MIN, Math.min(TREE_MAX, available - EDITOR_MIN));
    return Math.round(Math.max(TREE_MIN, Math.min(max, width)));
  }

  function treeWidthFromPointer(clientX: number): number {
    const bounds = workEl?.getBoundingClientRect();
    if (!bounds) return treeWidth;
    const rtl = document.documentElement.dir === 'rtl';
    return clampTreeWidth(rtl ? bounds.right - clientX : clientX - bounds.left);
  }

  function latestClientX(event: PointerEvent): number {
    const samples = event.getCoalescedEvents?.();
    return samples?.length ? samples[samples.length - 1].clientX : event.clientX;
  }

  function applyTreeWidth(width: number): void {
    treeWidth = width;
    rememberedTreeWidth = width;
  }

  function startTreeResize(event: PointerEvent): void {
    if (event.button !== 0 || !projectOpen) return;
    treeResizing = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    applyTreeWidth(treeWidthFromPointer(latestClientX(event)));
    event.preventDefault();
  }

  function dragTreeResize(event: PointerEvent): void {
    if (!treeResizing) return;
    pendingResizeX = latestClientX(event);
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!treeResizing || pendingResizeX === null) return;
      applyTreeWidth(treeWidthFromPointer(pendingResizeX));
      pendingResizeX = null;
    });
    event.preventDefault();
  }

  function stopTreeResize(event: PointerEvent): void {
    if (!treeResizing) return;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    applyTreeWidth(treeWidthFromPointer(latestClientX(event)));
    pendingResizeX = null;
    treeResizing = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  function resizeTreeWithKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const rtl = document.documentElement.dir === 'rtl';
    const shrink = rtl ? event.key === 'ArrowRight' : event.key === 'ArrowLeft';
    applyTreeWidth(clampTreeWidth(treeWidth + (shrink ? -16 : 16)));
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={onWindowKeydown}/>

{#if !root}
  <div class="ide-empty" role="status">
    <button type="button" class="ide-text-action" onclick={() => void chooseProject()} disabled={busy}>
      {$t('ide.openProject')}
    </button>
    {#if error}<p class="ide-error" role="alert">{error}</p>{/if}
  </div>
{:else}
  <div
    class="ide"
    style:--tree-width={projectOpen ? `${treeWidth}px` : '0px'}
    style:--terminal-height={terminalOpen ? `${TERMINAL_HEIGHT}px` : '0px'}
    style:--terminal-pane={`${TERMINAL_HEIGHT}px`}
    style:--ide-motion={reducedMotion || treeResizing ? '0ms' : '180ms'}
  >
    <div class={['ide-body', treeResizing && 'resizing']} {@attach attachWork}>
      <aside
        class="ide-tree"
        aria-label={$t('ide.project')}
        inert={!projectOpen}
      >
        <button
          type="button"
          class={['ide-tree-root', dropTarget === '' && 'drop-target']}
          aria-label={$t('ide.changeProject')}
          onclick={() => {
            if (consumeDragClick()) return;
            void chooseProject();
          }}
          ondragover={(event) => overFolder(event, '')}
          ondragleave={() => leaveFolder('')}
          ondrop={(event) => dropOnFolder(event, '')}
        >{projectName}</button>
        <div
          class="ide-tree-list"
          role="presentation"
          ondragover={(event) => overFolder(event, '')}
          ondragleave={() => leaveFolder('')}
          ondrop={(event) => dropOnFolder(event, '')}
        >
          {#snippet tree(nodes: TreeNode[], depth: number)}
            {#each nodes as node (node.path)}
              {@const open = expanded.has(node.path)}
              <button
                type="button"
                class={[
                  'ide-tree-row',
                  activePath === node.path && 'selected',
                  draggingPath === node.path && 'dragging',
                  node.kind === 'folder' && dropTarget === node.path && 'drop-target',
                ]}
                style:--depth={depth}
                draggable={node.kind === 'file'}
                aria-current={activePath === node.path ? 'page' : undefined}
                aria-expanded={node.kind === 'folder' ? open : undefined}
                onclick={() => void openEntry(node)}
                ondragstart={(event) => startFileDrag(event, node)}
                ondragend={endFileDrag}
                ondragover={(event) => overTreeRow(event, node)}
                ondragleave={() => leaveFolder(node.kind === 'folder' ? node.path : parentPath(node.path))}
                ondrop={(event) => dropOnTreeRow(event, node)}
              >
                <span
                  class="ide-tree-icon"
                  style:width="{MAIN_UI_ICON_SIZE}px"
                  style:height="{MAIN_UI_ICON_SIZE}px"
                >
                  <FileKindIcon name={node.name} kind={node.kind} {open}/>
                </span>
                <span class="ide-tree-name">{node.name}</span>
              </button>
              {#if node.kind === 'folder' && open}
                {#if node.children}
                  {@render tree(node.children, depth + 1)}
                {:else if loadingPaths.has(node.path)}
                  <p class="ide-tree-loading" style:--depth={depth + 1}>{$t('common.loading')}</p>
                {/if}
              {/if}
            {/each}
          {/snippet}
          {@render tree(entries, 0)}
        </div>
      </aside>
      {#if projectOpen}
        <button
          type="button"
          class={['ide-tree-resize', treeResizing && 'resizing']}
          aria-label={$t('ide.resizeProject')}
          data-tooltip="none"
          onpointerdown={startTreeResize}
          onpointermove={dragTreeResize}
          onpointerup={stopTreeResize}
          onpointercancel={stopTreeResize}
          onkeydown={resizeTreeWithKeyboard}
        ></button>
      {/if}
      <div class="ide-main">
        <section class="ide-editor" aria-label={openName || $t('ide.editor')}>
          <div class="ide-strip">
            <div class="ide-tabs" role="tablist" aria-label={$t('ide.editor')}>
              {#each fileTabs as tab (tab.path)}
                <div class={['ide-tab', tab.path === activePath && 'active']}>
                  {#if renamingPath === tab.path}
                    <input
                      bind:this={renameInput}
                      bind:value={renameDraft}
                      class="ide-tab-rename"
                      aria-label={$t('ide.renameFile', {name: tab.name})}
                      onkeydown={(event) => renameKeydown(event, commitFileRename, () => (renamingPath = ''))}
                      onblur={() => void commitFileRename()}
                      onclick={(event) => event.stopPropagation()}
                      ondblclick={(event) => event.stopPropagation()}
                    />
                  {:else}
                    <button
                      type="button"
                      class="ide-tab-main"
                      role="tab"
                      aria-selected={tab.path === activePath}
                      onclick={() => activateFile(tab.path)}
                      ondblclick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void startFileRename(tab);
                      }}
                    >
                      <span class={['ide-tab-dirty', isFileDirty(tab) && 'on']} aria-hidden="true"></span>
                      <span class="ide-tab-label">{tab.name}</span>
                    </button>
                    <button
                      type="button"
                      class="ide-tab-close"
                      aria-label={$t('workspace.closeTab', {title: tab.name})}
                      data-tooltip="none"
                      onclick={() => void closeFileTab(tab.path)}
                    >
                      <Icon name="close" size={10}/>
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
            <button
              type="button"
              class="ide-tab-add"
              aria-label={$t('ide.addFile')}
              data-tooltip="none"
              onclick={() => void addFile()}
            >
              <Icon name="plus" size={12} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
            </button>
          </div>
          {#if error}<p class="ide-error ide-error-inline" role="alert">{error}</p>{/if}
          {#if !activeFile}
            <div class="ide-empty ide-empty-pane" role="status">{$t('ide.openFile')}</div>
          {:else if binary}
            <div class="ide-empty ide-empty-pane" role="status">{$t('ide.binaryFile')}</div>
          {:else}
            {#await ideEditorImport}
              <div class="ide-empty ide-empty-pane" role="status">{$t('common.loading')}</div>
            {:then {default: IdeEditor}}
              {#key activePath}
                <IdeEditor
                  name={openName}
                  language={language}
                  fileName={openName}
                  content={activeFile.content}
                  cursorLine={activeFile.cursorLine}
                  cursorColumn={activeFile.cursorColumn}
                  onChange={onEditorChange}
                />
              {/key}
            {/await}
          {/if}
        </section>
        <div class={['ide-terminal', terminalOpen && 'open']}>
          {#if terminalOpen || terminalSessions.length}
            <div class="ide-terminal-inner">
              <div class="ide-strip">
                <div class="ide-tabs" role="tablist" aria-label={$t('ide.toggleTerminal')}>
                  {#each terminalSessions as session (session.id)}
                    <div class={['ide-tab', session.id === activeTerminalId && 'active']}>
                      {#if renamingTerminalId === session.id}
                        <input
                          bind:this={terminalRenameInput}
                          bind:value={terminalRenameDraft}
                          class="ide-tab-rename"
                          aria-label={$t('ide.renameTerminal', {name: session.label})}
                          onkeydown={(event) => renameKeydown(event, commitTerminalRename, () => (renamingTerminalId = ''))}
                          onblur={commitTerminalRename}
                          onclick={(event) => event.stopPropagation()}
                          ondblclick={(event) => event.stopPropagation()}
                        />
                      {:else}
                        <button
                          type="button"
                          class="ide-tab-main"
                          role="tab"
                          aria-selected={session.id === activeTerminalId}
                          onclick={() => (activeTerminalId = session.id)}
                          ondblclick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void startTerminalRename(session);
                          }}
                        >
                          <span class="ide-tab-icon">
                            <Icon name="terminal" size={12} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
                          </span>
                          <span class="ide-tab-label">{session.label}</span>
                        </button>
                        <button
                          type="button"
                          class="ide-tab-close"
                          aria-label={$t('workspace.closeTab', {title: session.label})}
                          data-tooltip="none"
                          onclick={() => closeTerminalSession(session.id)}
                        >
                          <Icon name="close" size={10}/>
                        </button>
                      {/if}
                    </div>
                  {/each}
                </div>
                <button
                  type="button"
                  class="ide-tab-add"
                  aria-label={$t('ide.addTerminal')}
                  data-tooltip="none"
                  onclick={() => void addTerminalSession()}
                >
                  <Icon name="plus" size={12} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
                </button>
              </div>
              <div class="ide-terminal-panes">
                {#each terminalSessions as session (session.id)}
                  <div class="ide-terminal-pane" hidden={session.id !== activeTerminalId}>
                    <TerminalView sessionId={session.id}/>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
    <footer class="ide-status">
      <button
        type="button"
        class={['ide-status-icon', projectOpen && 'on']}
        aria-pressed={projectOpen}
        aria-label={$t('ide.toggleProject')}
        onclick={toggleProject}
      >
        <Icon name="folder" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
      </button>
      <span class="ide-status-spacer"></span>
      {#if activeFile}
        {#if !binary}
          <span class="ide-status-meta">{cursorLine}:{cursorColumn}</span>
        {/if}
        <span class="ide-status-meta">{language}</span>
      {/if}
      <button
        type="button"
        class={['ide-status-icon', terminalOpen && 'on']}
        aria-pressed={terminalOpen}
        aria-label={$t('ide.toggleTerminal')}
        onclick={toggleTerminal}
      >
        <Icon name="terminal" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
      </button>
    </footer>
  </div>
{/if}

<style>
  .ide {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--main-panel-background);
    color: var(--neutral-900);
  }
  .ide-body {
    position: relative;
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: var(--tree-width) minmax(0, 1fr);
    transition: grid-template-columns var(--ide-motion) ease;
  }
  .ide-body.resizing {
    cursor: col-resize;
    user-select: none;
    transition: none;
  }
  .ide-tree {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--neutral-50);
  }
  .ide-tree-resize {
    position: absolute;
    z-index: 6;
    inset-block: 0;
    inset-inline-start: calc(var(--tree-width) - 9px);
    width: 18px;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: col-resize;
    touch-action: none;
  }
  .ide-tree-resize::after {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: 9px;
    width: 1px;
    background: var(--neutral-200);
    transition: background-color .16s ease;
  }
  .ide-tree-resize:hover::after,
  .ide-tree-resize:focus-visible::after,
  .ide-tree-resize.resizing::after {
    background: var(--neutral-400);
  }
  .ide-tree-resize:focus-visible { outline: none; }
  .ide-main {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .ide-tree-root {
    width: 100%;
    min-height: 28px;
    flex: none;
    display: flex;
    align-items: center;
    padding: 0 12px;
    border: 0;
    background: none;
    color: var(--neutral-700);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    font-weight: 560;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ide-tree-root:hover { color: var(--neutral-950); }
  .ide-tree-root:focus-visible { outline: 2px solid var(--neutral-400); outline-offset: -2px; }
  .ide-tree-root.drop-target { color: var(--neutral-950); background: var(--neutral-100); }
  .ide-tree-list {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: 2px 0 8px;
    scrollbar-width: none;
  }
  .ide-tree-list::-webkit-scrollbar { display: none; }
  .ide-tree-row {
    width: calc(100% - 8px);
    min-height: 24px;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 4px;
    padding: 0 8px 0 calc(8px + (var(--depth) * 12px));
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    text-align: left;
  }
  .ide-tree-row:hover, .ide-tree-row.selected { background: var(--neutral-100); }
  .ide-tree-row.drop-target { background: var(--neutral-200); }
  .ide-tree-row.dragging { opacity: .45; }
  .ide-tree-row:focus-visible { outline: 2px solid var(--neutral-400); outline-offset: -2px; }
  .ide-tree-icon {
    flex: none;
    display: grid;
    place-items: center;
    overflow: visible;
  }
  .ide-tree-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ide-tree-loading {
    margin: 0;
    padding: 4px 8px 4px calc(8px + (var(--depth) * 12px));
    color: var(--neutral-400);
    font-size: 11px;
  }
  .ide-editor {
    min-width: 0;
    min-height: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .ide-strip {
    height: 28px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px 0 6px;
    border-bottom: 1px solid var(--neutral-200);
  }
  .ide-tabs {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: center;
    overflow: auto;
    scrollbar-width: none;
  }
  .ide-tabs::-webkit-scrollbar { display: none; }
  .ide-tab {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 28px;
    flex: none;
  }
  .ide-tab-main {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    border: 0;
    padding: 0 4px;
    background: none;
    color: var(--neutral-500);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }
  .ide-tab.active .ide-tab-main,
  .ide-tab-main:hover { color: var(--neutral-950); }
  .ide-tab-main:focus-visible { outline: 2px solid var(--neutral-400); outline-offset: -2px; }
  .ide-tab-icon {
    flex: none;
    display: grid;
    place-items: center;
  }
  .ide-tab-dirty {
    width: 5px;
    height: 5px;
    flex: none;
    border-radius: 50%;
    background: transparent;
  }
  .ide-tab-dirty.on { background: var(--accent-500, #2f6df6); }
  .ide-tab-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ide-tab-rename {
    width: 9em;
    height: 18px;
    margin: 0 4px;
    border: 0;
    padding: 0 4px;
    background: var(--neutral-100);
    color: var(--neutral-950);
    font: inherit;
    font-size: 11px;
  }
  .ide-tab-rename:focus-visible { outline: 2px solid var(--neutral-400); outline-offset: 0; }
  .ide-tab-close,
  .ide-tab-add {
    width: 18px;
    height: 18px;
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    padding: 0;
    background: none;
    color: var(--neutral-500);
    cursor: pointer;
  }
  .ide-tab-close:hover,
  .ide-tab-add:hover { color: var(--neutral-950); }
  .ide-tab-close:focus-visible,
  .ide-tab-add:focus-visible { outline: 2px solid var(--neutral-400); outline-offset: 1px; }
  .ide-tab-add { margin-inline-start: auto; }
  .ide-terminal {
    height: var(--terminal-height);
    min-height: 0;
    overflow: hidden;
    border-top: 1px solid var(--neutral-200);
    transition: height var(--ide-motion) ease;
  }
  .ide-terminal:not(.open) { border-top-width: 0; }
  .ide-terminal-inner {
    height: var(--terminal-pane);
    display: flex;
    flex-direction: column;
  }
  .ide-terminal-panes {
    min-height: 0;
    flex: 1;
    position: relative;
  }
  .ide-terminal-pane {
    position: absolute;
    inset: 0;
  }
  .ide-terminal-pane[hidden] { display: none; }
  .ide-status {
    height: 28px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 8px;
    border-top: 1px solid var(--neutral-200);
    background: var(--neutral-50);
  }
  .ide-status-spacer { flex: 1; min-width: 0; }
  .ide-status-icon {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border: 0;
    padding: 0;
    background: none;
    color: var(--neutral-500);
    cursor: pointer;
  }
  .ide-status-icon:hover, .ide-status-icon.on { color: var(--neutral-950); }
  .ide-status-icon:focus-visible { outline: 2px solid var(--neutral-400); outline-offset: 1px; }
  .ide-status-meta {
    flex: none;
    color: var(--neutral-600);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
  }
  .ide-empty {
    height: 100%;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--neutral-500);
  }
  .ide-empty-pane { min-height: 0; flex: 1; font-size: 12.5px; }
  .ide-text-action {
    border: 0;
    padding: 0;
    background: none;
    color: var(--neutral-800);
    cursor: pointer;
    font: inherit;
    font-size: 13.5px;
  }
  .ide-text-action:hover { color: var(--neutral-950); }
  .ide-text-action:disabled { color: var(--neutral-400); cursor: default; }
  .ide-text-action:focus-visible { outline: 2px solid var(--neutral-400); outline-offset: 3px; }
  .ide-error {
    max-width: 36ch;
    margin: 0;
    color: var(--status-error-text);
    font-size: 12px;
    text-align: center;
  }
  .ide-error-inline { padding: 8px 12px; text-align: left; }
</style>
