<script lang="ts">
  import {onMount, tick} from 'svelte';
  import type {
    AttachmentDto,
    ChatDto,
    ChatMessageDto,
    ChatPageDto,
    ConversationDto,
    JsonValue,
    MessageDto,
    RunEventDto,
    BotDto,
  } from '@polymux/protocol';
  import ChatList from './lib/ChatList.svelte';
  import Composer from './lib/Composer.svelte';
  import Icon from './lib/Icon.svelte';
  import HubMessageView from './lib/HubMessageView.svelte';
  import MessageView from './lib/MessageView.svelte';
  import LockerScreen from './lib/LockerScreen.svelte';
  import PairScreen from './lib/PairScreen.svelte';
  import SignInScreen from './lib/SignInScreen.svelte';
  import {pairAccountHost} from './lib/host';
  import PolymuxMark from './lib/PolymuxMark.svelte';
  import TeamAvatar from './lib/TeamAvatar.svelte';
  import {clearConnection, hostHealth, loadConnection, pairHost, pairHostByCode, rpc, type SavedConnection} from './lib/host';
  import {readCache, writeCache, type PhoneCache} from './lib/cache';
  import {applyRunEvent, contentText, createLiveRun, type LiveRun} from './lib/run';
  import {renderMarkdown} from './lib/markdown';

  type Destination = {
    kind: 'assistant' | 'team' | 'hub';
    conversationId: string;
    title: string;
    subtitle: string;
    preview: string;
    updatedAt: string;
    unreadCount: number;
    member: BotDto | null;
    platform: string | null;
    avatarUrl: string | null;
  };

  type ActiveRun = {runId: string; conversationId: string};
  type UploadResult = {path: string; name: string; mimeType: string | null; size: number};

  let connection: SavedConnection | null = null;
  let booting = true;
  let pairing = false;
  let pairError = '';
  let online = false;
  let syncing = false;
  let error = '';
  let connectedScreen: 'chats' | 'chat' = 'chats';
  let conversations: ConversationDto[] = [];
  let team: BotDto[] = [];
  let messages: Record<string, MessageDto[]> = {};
  let hubChats: ChatDto[] = [];
  let hubMessages: Record<string, ChatMessageDto[]> = {};
  let selected = '';
  let liveRun: LiveRun | null = null;
  let transcript: HTMLElement;
  let pollVersion = 0;
  let reconnectTimer: ReturnType<typeof setInterval> | undefined;

  $: destinations = buildDestinations(conversations, team, messages, hubChats);
  $: activeDestination = destinations.find((item) => item.conversationId === selected) ?? null;
  $: activeMessages = activeDestination?.kind !== 'hub' && selected ? messages[selected] ?? [] : [];
  $: activeHubMessages = activeDestination?.kind === 'hub' && selected ? hubMessages[selected] ?? [] : [];
  $: activeMessageCount = activeDestination?.kind === 'hub' ? activeHubMessages.length : activeMessages.length;
  $: liveHtml = liveRun?.text ? renderMarkdown(liveRun.text) : '';

  onMount(() => {
    void boot();
    reconnectTimer = setInterval(() => {
      if (connection && !syncing) void synchronize(false);
    }, 5_000);
    const visibility = () => {
      if (document.visibilityState === 'visible' && connection) void synchronize(false);
    };
    const back = () => {
      if (connectedScreen === 'chat') connectedScreen = 'chats';
    };
    const signedOut = () => {
      if (!connection?.accountUserId) return;
      pollVersion += 1;
      connection = null; online = false; liveRun = null;
      conversations = []; messages = {}; team = []; hubChats = []; hubMessages = {}; selected = '';
    };
    window.addEventListener('polymux-account-signed-out', signedOut);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('popstate', back);
    return () => {
      if (reconnectTimer) clearInterval(reconnectTimer);
      pollVersion += 1;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('popstate', back);
      window.removeEventListener('polymux-account-signed-out', signedOut);
    };
  });

  async function boot(): Promise<void> {
    try {
      connection = await loadConnection();
      if (connection?.accountUserId) {
        const {phoneAccount} = await import('./lib/account');
        const account = phoneAccount();
        await account?.ready;
        if (account?.client.status().profile?.userId !== connection.accountUserId) {
          await clearConnection();
          connection = null;
        }
      }
      if (connection) {
        applyCache(readCache(connection.hostId));
        await synchronize(true);
      }
    } catch (cause) {
      error = readableError(cause);
    } finally {
      booting = false;
    }
  }

  let phoneLocker = false;
  let showPairing = false;
  let pairingNumber = '';
  let pairingAbort: AbortController | null = null;
  async function connect(endpoint: string | null, code: string): Promise<void> {
    pairing = true;
    pairError = '';
    pairingNumber = '';
    pairingAbort = new AbortController();
    try {
      const pending = (number: string) => pairingNumber = number;
      connection = endpoint ? await pairHost(endpoint, code, pending, pairingAbort.signal) : await pairHostByCode(code, undefined, pending, pairingAbort.signal);
      applyCache(readCache(connection.hostId));
      await synchronize(true);
    } catch (cause) {
      pairError = readableError(cause);
      connection = null;
    } finally {
      pairing = false;
      pairingNumber = "";
      pairingAbort = null;
    }
  }

  async function synchronize(openDefault: boolean): Promise<void> {
    if (!connection || syncing) return;
    syncing = true;
    try {
      await hostHealth(connection.endpoint);
      const [nextConversations, nextTeam, nextHubChats, activeRuns] = await Promise.all([
        rpc<ConversationDto[]>(connection, 'conversations.list'),
        rpc<BotDto[]>(connection, 'team.list'),
        rpc<ChatDto[]>(connection, 'hub.chats').catch(() => hubChats),
        rpc<ActiveRun[]>(connection, 'runs.activeAll'),
      ]);
      conversations = nextConversations;
      team = nextTeam;
      hubChats = nextHubChats;
      online = true;
      error = '';

      const available = buildDestinations(conversations, team, messages, hubChats);
      if (!available.some((item) => item.conversationId === selected))
        selected = available[0]?.conversationId ?? '';
      if (!selected && openDefault) await newChat();
      else if (selected) await loadDestinationMessages(selected, openDefault);

      const selectedDestination = available.find((item) => item.conversationId === selected);
      const active = selectedDestination?.kind === 'hub'
        ? undefined
        : activeRuns.find((run) => run.conversationId === selected);
      if (active && (!liveRun || liveRun.runId !== active.runId)) beginPolling(active.runId, active.conversationId);
      if (!active && liveRun?.conversationId === selected) liveRun = null;
      persistCache();
    } catch (cause) {
      online = false;
      error = readableError(cause);
    } finally {
      syncing = false;
    }
  }

  async function selectDestination(conversationId: string): Promise<void> {
    const destination = destinations.find((item) => item.conversationId === conversationId);
    selected = conversationId;
    liveRun = null;
    pollVersion += 1;
    const member = team.find((item) => item.conversationId === conversationId);
    if (member?.unread) {
      team = team.map((item) => item.id === member.id ? {...item, unread: false, unreadCount: 0} : item);
      if (connection && online) void rpc<BotDto>(connection, 'team.markRead', [member.id])
        .then((updated) => { team = team.map((item) => item.id === updated.id ? updated : item); })
        .catch(() => {});
    }
    if (destination?.kind === 'hub' && destination.unreadCount > 0) {
      hubChats = hubChats.map((chat) => chat.id === conversationId ? {...chat, unread: 0} : chat);
    }
    if (online) await loadDestinationMessages(conversationId);
    if (connection && online && destination?.kind === 'hub') {
      const conversationMessages = hubMessages[conversationId] ?? [];
      const latest = conversationMessages[conversationMessages.length - 1];
      if (latest) void rpc(connection, 'hub.markRead', [conversationId, latest.id]).catch(() => {});
    }
    persistCache();
    if (connection && online && destination?.kind !== 'hub') {
      const activeRuns = await rpc<ActiveRun[]>(connection, 'runs.activeAll').catch(() => []);
      const active = activeRuns.find((run) => run.conversationId === conversationId);
      if (active) beginPolling(active.runId, conversationId);
    }
  }

  async function openDestination(conversationId: string): Promise<void> {
    if (connectedScreen === 'chats')
      history.pushState({...history.state, polymuxPhoneChat: true}, '');
    connectedScreen = 'chat';
    await selectDestination(conversationId);
  }

  function showChats(): void {
    if (history.state?.polymuxPhoneChat) history.back();
    else connectedScreen = 'chats';
  }

  async function newChat(): Promise<void> {
    if (!connection || !online) throw new Error('Reconnect to create a conversation.');
    const created = await rpc<ConversationDto>(connection, 'conversations.create', ['New chat']);
    conversations = [created, ...conversations];
    messages = {...messages, [created.id]: []};
    await openDestination(created.id);
  }

  async function loadMessages(conversationId: string, scroll = true): Promise<void> {
    if (!connection) return;
    try {
      const stored = await rpc<MessageDto[]>(connection, 'conversations.messages', [conversationId]);
      messages = {...messages, [conversationId]: stored.filter((message) => message.role !== 'system')};
      persistCache();
      if (scroll) await scrollToBottom(false);
    } catch (cause) {
      online = false;
      error = readableError(cause);
    }
  }

  async function loadDestinationMessages(conversationId: string, scroll = true): Promise<void> {
    const destination = buildDestinations(conversations, team, messages, hubChats)
      .find((item) => item.conversationId === conversationId);
    if (destination?.kind === 'hub') await loadHubMessages(conversationId, scroll);
    else await loadMessages(conversationId, scroll);
  }

  async function loadHubMessages(chatId: string, scroll = true): Promise<void> {
    if (!connection) return;
    try {
      const page = await rpc<ChatPageDto>(connection, 'hub.messages', [chatId, 50]);
      hubMessages = {...hubMessages, [chatId]: [...page.messages].reverse()};
      persistCache();
      if (scroll) await scrollToBottom(false);
    } catch (cause) {
      online = false;
      error = readableError(cause);
    }
  }

  async function send(text: string, files: File[]): Promise<void> {
    if (!connection || !online || !activeDestination)
      throw new Error('Reconnect to send a message.');
    const target = activeDestination;
    const targetId = target.conversationId;
    const host = connection;
    if (target.kind === 'hub') {
      await sendHubMessage(targetId, text, files, host);
      return;
    }
    const targetRun = liveRun?.conversationId === targetId ? liveRun : null;
    if (targetRun?.status === 'running') {
      if (files.length) throw new Error('Wait for the current run before attaching another file.');
      await rpc(host, 'runs.steer', [targetRun.runId, text]);
      await loadMessages(targetId, selected === targetId);
      return;
    }

    const uploads: UploadResult[] = [];
    for (const file of files) uploads.push(await uploadFile(targetId, file, host));
    const prompt = text || (files.length === 1 ? 'Please review the attached file.' : 'Please review the attached files.');
    const messageId = crypto.randomUUID();
    const optimistic: MessageDto = {
      id: messageId,
      conversationId: targetId,
      runId: null,
      role: 'user',
      content: prompt,
      createdAt: new Date().toISOString(),
      sequence: Number.MAX_SAFE_INTEGER,
      attachments: uploads.map((upload, index): AttachmentDto => ({
        id: `pending-${index}`,
        messageId,
        name: upload.name,
        path: upload.path,
        mimeType: upload.mimeType,
        size: upload.size,
        sha256: null,
        createdAt: new Date().toISOString(),
      })),
      metadata: {},
    };
    const targetMessages = messages[targetId] ?? [];
    messages = {...messages, [targetId]: [...targetMessages, optimistic]};
    if (selected === targetId) await scrollToBottom(true);

    try {
      const started = await rpc<{runId: string}>(host, 'runs.start', [{
        conversationId: targetId,
        text: prompt,
        messageId,
        attachments: uploads.map((upload) => upload.path),
      } as unknown as JsonValue]);
      if (selected === targetId) beginPolling(started.runId, targetId);
      else void synchronize(false);
    } catch (cause) {
      messages = {
        ...messages,
        [targetId]: (messages[targetId] ?? []).filter((message) => message.id !== messageId),
      };
      throw cause;
    }
  }

  async function uploadFile(
    conversationId: string,
    file: File,
    host: SavedConnection,
  ): Promise<UploadResult> {
    if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} is larger than 12 MB.`);
    const data = await encodeFile(file);
    return rpc<UploadResult>(host, 'conversations.upload', [{
      conversationId,
      name: file.name,
      mimeType: file.type || null,
      data,
    } as unknown as JsonValue]);
  }

  async function sendHubMessage(
    chatId: string,
    text: string,
    files: File[],
    host: SavedConnection,
  ): Promise<void> {
    if (files.length) {
      const encoded = [];
      for (const file of files) {
        encoded.push({name: file.name, mimeType: file.type || null, data: await encodeFile(file)});
      }
      await rpc(host, 'hub.sendFiles', [chatId, encoded as unknown as JsonValue]);
      await loadHubMessages(chatId, false);
    }
    if (text) {
      const sent = await rpc<ChatMessageDto>(host, 'hub.send', [chatId, text]);
      hubMessages = {...hubMessages, [chatId]: [...(hubMessages[chatId] ?? []), sent]};
    }
    const chatMessages = hubMessages[chatId] ?? [];
    const latest = chatMessages[chatMessages.length - 1];
    hubChats = hubChats.map((chat) => chat.id === chatId ? {
      ...chat,
      unread: 0,
      lastActivity: latest?.sentAt ?? new Date().toISOString(),
      preview: latest?.body || chat.preview,
    } : chat);
    persistCache();
    if (selected === chatId) await scrollToBottom(true);
  }

  async function encodeFile(file: File): Promise<string> {
    if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} is larger than 12 MB.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32_768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    return btoa(binary);
  }

  function beginPolling(runId: string, conversationId: string): void {
    pollVersion += 1;
    const version = pollVersion;
    liveRun = createLiveRun(runId, conversationId);
    void pollRun(version);
    void scrollToBottom(true);
  }

  async function pollRun(version: number): Promise<void> {
    while (connection && online && liveRun && version === pollVersion) {
      try {
        const events = await rpc<RunEventDto[]>(connection, 'runs.events', [liveRun.runId, liveRun.sequence]);
        for (const event of events) {
          if (!liveRun || version !== pollVersion) return;
          liveRun = applyRunEvent(liveRun, event);
          if (event.type === 'run.settled') {
            await loadMessages(event.conversationId);
            await synchronize(false);
            liveRun = null;
            return;
          }
        }
        if (events.length) await scrollToBottom(false);
        await pause(300);
      } catch (cause) {
        online = false;
        error = readableError(cause);
        return;
      }
    }
  }

  async function stopRun(): Promise<void> {
    if (!connection || !liveRun) return;
    await rpc(connection, 'runs.cancel', [liveRun.runId]);
  }

  async function disconnect(): Promise<void> {
    if (!confirm('Disconnect this phone from the current Host?')) return;
    pollVersion += 1;
    if (connection) await rpc(connection, 'notifications.unregister').catch(() => {});
    await clearConnection();
    connection = null;
    online = false;
    connectedScreen = 'chats';
    conversations = [];
    team = [];
    messages = {};
    hubChats = [];
    hubMessages = {};
    selected = '';
    liveRun = null;
    error = '';
  }

  function applyCache(cache: PhoneCache): void {
    conversations = cache.conversations;
    team = cache.team;
    messages = cache.messages;
    hubChats = cache.hubChats;
    hubMessages = cache.hubMessages;
    selected = cache.selected ?? '';
  }

  function persistCache(): void {
    if (!connection) return;
    writeCache(connection.hostId, {conversations, team, messages, hubChats, hubMessages, selected: selected || null});
  }

  async function scrollToBottom(smooth: boolean): Promise<void> {
    await tick();
    if (!transcript) return;
    transcript.scrollTo({top: transcript.scrollHeight, behavior: smooth ? 'smooth' : 'auto'});
  }

  function buildDestinations(
    chats: ConversationDto[],
    members: BotDto[],
    storedMessages: Record<string, MessageDto[]>,
    externalChats: ChatDto[],
  ): Destination[] {
    const teamConversationIds = new Set(members.map((member) => member.conversationId));
    return [
      ...chats.filter((conversation) => !teamConversationIds.has(conversation.id)).map((conversation): Destination => {
        const visibleMessages = (storedMessages[conversation.id] ?? []).filter((message) => message.role !== 'system');
        const latest = visibleMessages[visibleMessages.length - 1];
        return {
          kind: 'assistant',
          conversationId: conversation.id,
          title: conversation.title || 'New chat',
          subtitle: 'Assistant',
          preview: latest ? messagePreview(contentText(latest.content)) : 'Assistant',
          updatedAt: latest?.createdAt ?? conversation.updatedAt,
          unreadCount: 0,
          member: null,
          platform: null,
          avatarUrl: null,
        };
      }),
      ...members.map((member): Destination => ({
        kind: 'team',
        conversationId: member.conversationId,
        title: member.name,
        subtitle: member.role,
        preview: singleLine(member.preview) || member.role,
        updatedAt: member.updatedAt,
        unreadCount: member.unreadCount ?? (member.unread ? 1 : 0),
        member,
        platform: null,
        avatarUrl: null,
      })),
      ...externalChats.filter((chat) => !chat.space).map((chat): Destination => ({
        kind: 'hub',
        conversationId: chat.id,
        title: chat.name || 'Conversation',
        subtitle: chat.platform,
        preview: singleLine(chat.preview ?? '') || chat.platform,
        updatedAt: chat.lastActivity ?? '1970-01-01T00:00:00.000Z',
        unreadCount: Math.max(0, chat.unread ?? 0),
        member: null,
        platform: chat.platform,
        avatarUrl: chat.avatarUrl ?? null,
      })),
    ].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  function singleLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  function messagePreview(value: string): string {
    return singleLine(value).replace(/\*\*|__|~~|`/g, '');
  }

  function readableError(cause: unknown): string {
    if (cause instanceof TypeError && /fetch|network|load/i.test(cause.message))
      return 'The Host could not be reached. Check its address and private network.';
    return cause instanceof Error ? cause.message : String(cause);
  }

  function pause(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
</script>

{#if booting}
  <main class="boot-screen" aria-label="Opening Polymux"><div class="boot-logo"><PolymuxMark size={50} /></div></main>
{:else if phoneLocker && !connection}
  <div class="phone-locker">
    <header class="phone-locker-bar">
      <button type="button" class="quiet" onclick={() => phoneLocker = false}>Back</button>
      <strong>Locker</strong>
    </header>
    <div class="phone-locker-body">
      <LockerScreen />
    </div>
  </div>
{:else if !connection && !showPairing}
  <SignInScreen onPair={() => showPairing = true} onLocker={() => phoneLocker = true} onConnect={async (host) => {
    connection = await pairAccountHost(host);
    applyCache(readCache(connection.hostId));
    await synchronize(true);
  }} />
{:else if !connection}
  <button class="quiet" onclick={() => showPairing = false}>Back to sign in</button>
  <PairScreen busy={pairing} error={pairError} onPair={connect} confirmationNumber={pairingNumber} onCancel={() => pairingAbort?.abort()} onLocker={() => phoneLocker = true} />
{:else}
  <div class:chat-open={connectedScreen === 'chat'} class="connected-shell">
    <ChatList
      {connection}
      {destinations}
      {selected}
      connectionName={connection.deviceName}
      {online}
      {syncing}
      onSelect={openDestination}
      onNewChat={newChat}
      onDisconnect={disconnect}
      lockerCall={(method, args) => connection ? rpc(connection, method, args ?? []) : Promise.reject(new Error('Host disconnected'))}
    />

    <main class="phone-shell">
    <header class="floating-header">
      <button class="chat-back-button" type="button" onclick={showChats} aria-label="Back to chats">
        <Icon name="back" size={22} />
      </button>
      <span class="chat-title-state">
        <strong class="chat-title">{activeDestination?.title || 'Polymux'}</strong>
        {#if activeDestination && activeDestination.kind !== 'hub'}
          <span
            class:offline={!online && !syncing}
            class:syncing={syncing && !online}
            class="network-state"
            role="status"
            aria-live="polite"
          >
            <i aria-hidden="true"></i>
            <span class="visually-hidden">{online ? 'Connected' : syncing ? 'Reconnecting' : 'Offline'}</span>
          </span>
        {/if}
      </span>
      <span class="chat-header-spacer" aria-hidden="true"></span>
    </header>

    {#if error}
      <button class="error-banner" type="button" onclick={() => synchronize(false)}>
        <span>{error}</span><strong>Retry</strong>
      </button>
    {/if}

    <section class:has-error={Boolean(error)} class="transcript" bind:this={transcript} aria-live="polite">
      {#if !activeDestination}
        <div class="empty-state"><h1>Polymux</h1><p>Create an Assistant chat on desktop or reconnect to your Host.</p></div>
      {:else if !activeMessageCount && !liveRun}
        <div class="empty-state">
          {#if activeDestination.member}
            <TeamAvatar avatar={activeDestination.member.avatar} name={activeDestination.member.name} size={62} />
          {:else if activeDestination.kind === 'hub'}
            <Icon name="hub" size={50} strokeWidth={1.45} />
          {:else}
            <PolymuxMark size={62} />
          {/if}
          <h1>{activeDestination.kind === 'assistant' ? 'What can I help with?' : activeDestination.title}</h1>
          <p>{activeDestination.kind === 'assistant' ? 'Ask, delegate, or continue something from your computer.' : activeDestination.subtitle}</p>
        </div>
      {:else}
        <div class="message-list">
          {#if activeDestination.kind === 'hub'}
            {#each activeHubMessages as message (message.id)}
              <HubMessageView {message} />
            {/each}
          {:else}
            {#each activeMessages as message (message.id)}
              <MessageView {message} variant={activeDestination.kind} member={activeDestination.member} />
            {/each}
          {/if}
          {#if liveRun && activeDestination.kind !== 'hub'}
            <article class="live-response">
              {#if liveRun.activities.length}
                <details open={!liveRun.text} class="activity-group">
                  <summary>
                    <span class:failed={liveRun.status === 'failed'} class="activity-pulse"></span>
                    {liveRun.status === 'running' ? 'Working' : liveRun.status === 'completed' ? 'Worked' : liveRun.status}
                  </summary>
                  <div class="activity-list">
                    {#each liveRun.activities as activity (activity.id)}
                      <div class:failed={activity.status === 'failed'} class="activity-row">
                        <span class:active={activity.status === 'active'}></span>
                        <div><strong>{activity.label}</strong>{#if activity.detail}<small>{activity.detail}</small>{/if}</div>
                      </div>
                    {/each}
                  </div>
                </details>
              {:else if !liveRun.text}
                <div class="thinking-row"><span></span><span></span><span></span></div>
              {/if}
              {#if liveRun.notice}<p class="run-notice">{liveRun.notice}</p>{/if}
              {#if liveRun.text}<div class="live-markdown">{@html liveHtml}</div>{/if}
            </article>
          {/if}
        </div>
      {/if}
    </section>

    {#if activeDestination}
      <Composer
        active={activeDestination.kind !== 'hub' && liveRun?.status === 'running'}
        disabled={!online}
        destination={activeDestination.title}
        onSend={send}
        onStop={stopRun}
      />
    {/if}
    </main>
  </div>
{/if}

<style>
  .phone-locker {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--surface);
  }
  .phone-locker-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: calc(env(safe-area-inset-top) + 8px) 18px 8px;
  }
  .phone-locker-body { min-height: 0; flex: 1; display: flex; flex-direction: column; }
  .phone-locker-bar strong { font-size: 1.0625rem; letter-spacing: -.02em; }
  .quiet { border: 0; padding: 0; background: transparent; color: var(--ink); font: inherit; font-weight: 650; }
</style>
