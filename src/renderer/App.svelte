<script lang="ts">
  import {onDestroy} from 'svelte';
  import TitleBar from './lib/components/chat/TitleBar.svelte';
  import ChatPane, {type ChatMessage} from './lib/components/chat/ChatPane.svelte';
  import SpeechOrb, {type SpeechOrbSize} from './lib/components/chat/SpeechOrb.svelte';
  import HistoryDrawer, {type HistoryChat} from './lib/components/shell/HistoryDrawer.svelte';
  import SummaryPanel, {type SummarySection, type ReferenceItem} from './lib/components/workspace/SummaryPanel.svelte';
  import WorkspaceDrawer, {type WorkspaceTab, type WorkspaceTabKind} from './lib/components/workspace/WorkspaceDrawer.svelte';
  import Tooltip from './lib/components/shared/Tooltip.svelte';

  type Conversation = HistoryChat & {messages: ChatMessage[]};

  const now = Date.now();
  let conversations: Conversation[] = [
    {id: 'welcome', title: 'Planning a product launch', updatedAt: now - 86_400_000, messages: [
      {id: 'm1', role: 'user', text: 'Help me outline a simple launch plan.'},
      {id: 'm2', role: 'assistant', text: 'I can turn that into a concise plan with milestones, owners, and launch-day checks.', startedAt: new Date(now - 5000).toISOString(), completedAt: new Date(now - 2000).toISOString(), activities: [{id: 'a1', kind: 'thinking', status: 'completed', label: 'Planned the response'}]},
    ]},
    {id: 'research', title: 'Research notes', updatedAt: now - 3 * 86_400_000, messages: []},
  ];
  let activeId = '';
  let draftConversation: Conversation = {id: crypto.randomUUID(), title: 'New chat', updatedAt: now, messages: []};
  let historyOpen = false;
  let panel: 'none' | 'summary' | 'workspace' = 'none';
  let historyWidth = 280;
  let workspaceWidth = 540;
  let workspaceExpanded = false;
  let running = false;
  let voiceOpen = false;
  let voiceMinimised = false;
  let voiceMuted = false;
  let outputMuted = false;
  let voicePaused = false;
  let optionsOpen = false;
  let responseTimer: ReturnType<typeof setTimeout> | undefined;

  let outputs = [{id: 'launch-brief', name: 'Launch brief.docx'}];
  let references: ReferenceItem[] = [{id: 'polymux-site', title: 'polymux.com', kind: 'web'}];
  let tasks = [{id: 'task-1', title: 'Prepare the response', status: 'completed' as const}];
  let workspaceTabs: WorkspaceTab[] = [{id: 'launch-brief', title: 'Launch brief', kind: 'document'}];
  let activeTabId: string | null = 'launch-brief';
  let expandedVoiceSize: SpeechOrbSize = {width: 760, height: 640};
  let minimisedVoiceSize: SpeechOrbSize = {width: 520, height: 260};

  $: active = activeId ? conversations.find((chat) => chat.id === activeId) ?? draftConversation : draftConversation;
  $: historyChats = conversations.map(({id, title, updatedAt}) => ({id, title, updatedAt}));
  $: timeline = active.messages.filter((message) => message.text).map((message) => ({id: message.id, title: message.role === 'user' ? 'You' : 'Midas', preview: message.text.slice(0, 80)}));

  onDestroy(() => responseTimer && clearTimeout(responseTimer));

  function updateActive(mutator: (chat: Conversation) => Conversation): void {
    if (activeId) conversations = conversations.map((chat) => chat.id === activeId ? mutator(chat) : chat);
    else draftConversation = mutator(draftConversation);
  }

  function newChat(): void {
    if (draftConversation.messages.length) conversations = [draftConversation, ...conversations];
    activeId = '';
    draftConversation = {id: crypto.randomUUID(), title: 'New chat', updatedAt: Date.now(), messages: []};
    running = false;
    panel = 'none';
    optionsOpen = false;
    if (responseTimer) clearTimeout(responseTimer);
  }

  function openChat(id: string): void { activeId = id; historyOpen = false; running = false; }

  function send(text: string, files: File[]): void {
    if (!text && !files.length) return;
    const sentAt = new Date().toISOString();
    const userMessage: ChatMessage = {id: crypto.randomUUID(), role: 'user', text, files: files.map((file) => file.name)};
    const assistantId = crypto.randomUUID();
    const title = active.title === 'New chat' ? (text || files[0]?.name || 'New chat').slice(0, 42) : active.title;
    updateActive((chat) => ({...chat, title, updatedAt: Date.now(), messages: [...chat.messages, userMessage, {id: assistantId, role: 'assistant', text: '', startedAt: sentAt, activities: [{id: crypto.randomUUID(), kind: 'thinking', status: 'active', label: 'Thinking'}]}]}));
    running = true;
    optionsOpen = false;
    responseTimer = setTimeout(() => {
      updateActive((chat) => ({...chat, messages: chat.messages.map((message) => message.id === assistantId ? {...message, text: 'This is the assembled Midas chat surface. Connect the send handler to your agent backend when it is ready.', completedAt: new Date().toISOString(), activities: [{id: crypto.randomUUID(), kind: 'thinking', status: 'completed', label: 'Prepared the response'}]} : message)}));
      running = false;
    }, 900);
  }

  function stop(): void { if (responseTimer) clearTimeout(responseTimer); running = false; }
  function rename(title: string): void { updateActive((chat) => ({...chat, title})); }
  function renameHistory(id: string, title: string): void { conversations = conversations.map((chat) => chat.id === id ? {...chat, title} : chat); }
  function deleteHistory(id: string): void { conversations = conversations.filter((chat) => chat.id !== id); if (activeId === id) newChat(); }
  function togglePanel(next: 'summary' | 'workspace'): void { panel = panel === next ? 'none' : next; optionsOpen = false; }

  function openTab(tab: WorkspaceTab): void {
    if (!workspaceTabs.some((current) => current.id === tab.id)) workspaceTabs = [...workspaceTabs, tab];
    activeTabId = tab.id;
    panel = 'workspace';
  }

  function closeTab(id: string): void {
    const index = workspaceTabs.findIndex((tab) => tab.id === id);
    workspaceTabs = workspaceTabs.filter((tab) => tab.id !== id);
    if (activeTabId === id) activeTabId = workspaceTabs[Math.max(0, index - 1)]?.id ?? null;
    if (!workspaceTabs.length) panel = 'none';
  }

  function viewSummary(section: SummarySection): void { openTab({id: `summary-${section}`, title: section[0].toUpperCase() + section.slice(1), kind: 'summary', section}); }
  function createOutput(kind: 'document' | 'presentation' | 'spreadsheet'): void {
    const mapped: Record<typeof kind, WorkspaceTabKind> = {document: 'document', presentation: 'slides', spreadsheet: 'sheet'};
    const id = crypto.randomUUID();
    const name = `Untitled ${kind}`;
    outputs = [...outputs, {id, name}];
    openTab({id, title: name, kind: mapped[kind]});
  }
</script>

<main class="app-shell">
  <TitleBar title={active.title} {historyOpen} {panel} onRename={rename} onToggleHistory={() => historyOpen = !historyOpen} onNewChat={newChat} onToggleSummary={() => togglePanel('summary')} onToggleWorkspace={() => togglePanel('workspace')}/>
  <ChatPane messages={active.messages} {running} {timeline} onSend={send} onStop={stop} onVoice={() => voiceOpen = true} onOptions={() => optionsOpen = !optionsOpen} onEdit={(id, text) => updateActive((chat) => ({...chat, messages: chat.messages.map((message) => message.id === id ? {...message, text} : message)}))} onFeedback={(id, feedback) => updateActive((chat) => ({...chat, messages: chat.messages.map((message) => message.id === id ? {...message, feedback} : message)}))}/>

  <HistoryDrawer chats={historyChats} {activeId} open={historyOpen} width={historyWidth} onOpen={openChat} onRename={renameHistory} onDelete={deleteHistory} onResize={(value) => historyWidth = value} onToggle={() => historyOpen = false} onNewChat={newChat}/>

  {#if panel === 'summary'}
    <SummaryPanel {outputs} {references} {tasks} onOpenOutput={(output) => openTab({id: output.id, title: output.name, kind: 'document'})} onOpenReference={(reference) => openTab({id: reference.id, title: reference.title, kind: reference.kind === 'web' ? 'browser' : 'document'})} onViewAll={viewSummary} onCreateOutput={createOutput} onAttachReferences={(files) => references = [...references, ...files.map((file) => ({id: crypto.randomUUID(), title: file.name, kind: 'file' as const}))]}/>
  {/if}

  <WorkspaceDrawer tabs={workspaceTabs} {activeTabId} open={panel === 'workspace'} width={workspaceWidth} expanded={workspaceExpanded} summaryData={{outputs, references, tasks}} onSelect={(id) => activeTabId = id} onClose={closeTab} onDismiss={() => panel = 'none'} onToggleExpand={() => workspaceExpanded = !workspaceExpanded} onResize={(value) => workspaceWidth = value}/>

  {#if optionsOpen}
    <div class="options-card" role="dialog" aria-label="Chat options">
      <strong>Chat options</strong>
      <label><span>Concise responses</span><input type="checkbox" checked/></label>
      <label><span>Show agent activity</span><input type="checkbox" checked/></label>
    </div>
  {/if}

  {#if voiceOpen}
    <div class="voice-scrim" aria-hidden="true"></div>
    <SpeechOrb state="listening" minimised={voiceMinimised} muted={voiceMuted} {outputMuted} paused={voicePaused} expandedSize={expandedVoiceSize} minimisedSize={minimisedVoiceSize} onToggleMinimised={() => voiceMinimised = !voiceMinimised} onToggleMuted={() => voiceMuted = !voiceMuted} onToggleOutputMuted={() => outputMuted = !outputMuted} onTogglePaused={() => voicePaused = !voicePaused} onClose={() => voiceOpen = false} onResize={(size, minimised) => minimised ? minimisedVoiceSize = size : expandedVoiceSize = size}/>
  {/if}
  <Tooltip/>
</main>

<style>
  .app-shell { width: 100vw; height: 100vh; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; background: #fff; color: #171717; }
  .options-card { position: fixed; z-index: 90; right: max(18px, calc((100vw - 750px) / 2)); bottom: 92px; width: 230px; border: 1px solid #e5e5e5; border-radius: 14px; padding: 10px; background: #fff; box-shadow: 0 12px 40px rgb(0 0 0 / 12%); font-size: 12px; }
  .options-card strong { display: block; padding: 5px 7px 9px; font-size: 12px; }
  .options-card label { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-radius: 8px; padding: 8px 7px; }
  .options-card label:hover { background: #f5f5f5; }
  .voice-scrim { position: fixed; z-index: 1100; inset: 0; background: rgb(255 255 255 / 55%); backdrop-filter: blur(3px); }
  @media (max-width: 680px) { .options-card { right: 14px; bottom: 82px; } }
</style>
