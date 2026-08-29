<script module lang="ts">
  import type {
    ChatDto as CachedChatDto,
    ChatMessageDto as CachedMessageDto,
    ContactLinkDto as CachedContactLinkDto,
    BroadcastDto as CachedBroadcastDto,
    BroadcastMessageDto as CachedBroadcastMessageDto,
    CommsStatusDto as CachedStatusDto,
    MailEnvelopeDto as CachedEnvelopeDto,
    MailFolderDto as CachedFolderDto,
    MailImportance as CachedImportance,
    MailMessageDto as CachedMailDto,
  } from '@polymux/protocol';
  import {polymuxApi} from '../../api/polymux';
  import {onHubCacheInvalidated} from '../../shared/state/hubCache';
  import {rememberChatPlatforms} from '../../shared/state/chatPlatforms';
  import {MailDraftAutosave} from './mailDraftAutosave';

  /** Which source the rail has selected: a platform, or a mailbox folder. */
  export type Source =
    | {kind: 'all'}
    | {kind: 'broadcasts'}
    | {kind: 'contacts'}
    | {kind: 'platform'; platform: string; account?: string; space?: string}
    | {kind: 'mail'; account: string; folder: string};

  /**
   * What the hub already knows, kept outside the component.
   *
   * The hub is a workspace tab, so leaving it and coming back mounts a fresh
   * one — and every mount used to start from nothing: status, then the room
   * list, then the conversation, each a round trip before anything appeared.
   * Holding the last answers here means a return paints immediately and the
   * fetches behind it only correct what changed.
   *
   * `seedHub` fills it from disk before the first paint, so the same is true
   * of the first open after a launch rather than only of the second open in a
   * session. Everything in it is a copy: stale by definition, replaced by the
   * fetch that follows it, and safe to be empty.
   */
  const session: {
    status: CachedStatusDto | null;
    chats: CachedChatDto[];
    broadcasts: CachedBroadcastDto[];
    contactLinks: CachedContactLinkDto[];
    broadcastMessages: Map<string, CachedBroadcastMessageDto[]>;
    messages: Map<string, {messages: CachedMessageDto[]; nextBefore: string | null}>;
    mailboxes: Map<
      string,
      {folders: CachedFolderDto[]; envelopes: CachedEnvelopeDto[]; page: number; moreToLoad: boolean}
    >;
    /** Message bodies already fetched, keyed account, folder and id. */
    mail: Map<string, CachedMailDto>;
    /**
     * Where the user was. Data alone is not enough to come back to: without
     * this a return starts on no source at all, picks a default, and rebuilds
     * the pane the user had already been looking at.
     */
    source: Source | null;
    activeChatId: string | null;
    activeBroadcastId: string | null;
    openGroups: Record<string, boolean>;
  } = {
    status: null,
    chats: [],
    broadcasts: [],
    contactLinks: [],
    broadcastMessages: new Map(),
    messages: new Map(),
    mailboxes: new Map(),
    mail: new Map(),
    source: null,
    activeChatId: null,
    activeBroadcastId: null,
    openGroups: {},
  };

  /** How a message body is keyed wherever it is held: in the session cache
   * here, and in the snapshot the main process writes. */
  export function mailKey(account: string, folder: string, id: string): string {
    return `${account}|${folder}|${id}`;
  }

  /** How deep the launch warm goes. Deep enough that the first click into
   * mail or a conversation paints from memory, shallow enough that it is over
   * long before anyone notices it running. */
  const WARM_BODIES = 3;
  const WARM_CHATS = 4;

  /** Guards against two callers warming the hub at once. */
  let warming: Promise<void> | null = null;
  let seeded: Promise<void> | null = null;
  /** One autosave queue survives Hub tab mounts, so leaving the workspace does
   * not cancel the mailbox write it just triggered. */
  const mailDraftAutosave = new MailDraftAutosave((request) => polymuxApi().comms.mailSend(request));

  /**
   * What the hub knew when the app last quit, put back before anything is
   * fetched.
   *
   * This is the difference between a launch that opens on a skeleton and one
   * that opens on mail. Nothing here is trusted to be current — every pane
   * still fetches — but a pane with last week's inbox on it while this
   * morning's arrives beats an empty one, and most of the time the two are
   * the same. Only empty slots are filled: a session that has already fetched
   * something holds the newer answer.
   */
  export async function seedHub(): Promise<void> {
    if (seeded) return seeded;
    seeded = (async () => {
      try {
        const snapshot = await polymuxApi().comms.snapshot();
        session.status ??= snapshot.status;
        if (!session.chats.length) session.chats = snapshot.chats;
        rememberChatPlatforms(session.chats);
        for (const mailbox of snapshot.mailboxes) {
          const key = `${mailbox.account}|${mailbox.folder}`;
          if (session.mailboxes.has(key)) continue;
          session.mailboxes.set(key, {
            folders: mailbox.folders,
            envelopes: mailbox.envelopes,
            page: 1,
            moreToLoad: mailbox.envelopes.length >= 50,
          });
        }
        for (const body of snapshot.mail) {
          const key = mailKey(body.account, body.folder, body.message.id);
          if (!session.mail.has(key)) session.mail.set(key, body.message);
        }
        for (const page of snapshot.messages)
          if (!session.messages.has(page.chatId))
            session.messages.set(page.chatId, {messages: page.messages, nextBefore: page.nextBefore});
      } catch {
        // A cache that will not read is a hub that opens the way it used to.
      }
    })();
    return seeded;
  }

  /**
   * Drops everything the session holds about accounts, leaving where the user
   * was alone. Armed for the life of the module rather than a mount, because
   * the account is unlinked from Settings and the hub tab is usually not open
   * at the time — a reset that only ran while mounted would miss exactly the
   * case it exists for.
   *
   * `seeded` is cleared too: without that the next mount short-circuits and
   * the disk snapshot — already emptied by the main process — is never read,
   * which is harmless but leaves the flag lying about what has happened.
   */
  onHubCacheInvalidated(() => {
    session.status = null;
    session.chats = [];
    session.messages.clear();
    session.broadcasts = [];
    session.contactLinks = [];
    session.broadcastMessages.clear();
    session.mailboxes.clear();
    session.mail.clear();
    session.activeChatId = null;
    session.activeBroadcastId = null;
    seeded = null;
  });

  /**
   * Where the agent asked the hub to land, and the mounted hub's way of going
   * there. The tab and the request arrive together — the app opens the tab in
   * the same breath it forwards this — so a request that beats the mount is
   * held here and applied by it rather than dropped.
   */
  let pendingReveal: WorkspaceRevealTarget | null = null;
  let showTarget: ((target: WorkspaceRevealTarget) => void) | null = null;

  /** What "show me" means inside the hub: a mailbox and a message in it, or a
   * conversation. */
  export type WorkspaceRevealTarget = {
    mail?: {
      account: string;
      folder?: string;
      messageId?: string;
      subject?: string;
      compose?: {
        to?: string;
        cc?: string;
        bcc?: string;
        subject?: string;
        body?: string;
        attachments?: string[];
        importance?: CachedImportance;
        mode?: 'new' | 'reply' | 'reply-all' | 'forward';
      };
    };
    chat?: {id?: string; name?: string; draft?: string; replyTo?: string};
  };

  export function revealInHub(target: WorkspaceRevealTarget): void {
    if (showTarget) showTarget(target);
    else pendingReveal = target;
  }

  /**
   * Fetches what the hub opens onto, before it is opened.
   *
   * Mail is the slow half — folders, then a page of envelopes, per account —
   * and it used to start only when the tab did, so the first open sat on a
   * spinner. Called from the app once it is idle, this has the mailboxes and
   * the conversation list already in hand by the time anyone clicks Hub.
   * Every failure is silent: this is work nobody asked for yet.
   */
  export async function warmHub(): Promise<void> {
    if (warming) return warming;
    warming = (async () => {
      const api = polymuxApi();
      await seedHub();
      try {
        const status = await api.comms.status();
        session.status = status;
        session.chats = await api.comms.chats().catch(() => session.chats);
        rememberChatPlatforms(session.chats);
        for (const account of status.email.accounts) {
          try {
            const folders = await api.comms.mailFolders(account.id);
            const inbox = folders.find((item) => item.role === 'inbox')?.name ?? folders[0]?.name ?? 'INBOX';
            const envelopes = await api.comms.mailEnvelopes({
              account: account.id,
              folder: inbox,
              page: 1,
              pageSize: 50,
              sort: 'date-desc',
            });
            session.mailboxes.set(`${account.id}|${inbox}`, {
              folders,
              envelopes,
              page: 1,
              moreToLoad: envelopes.length === 50,
            });
            // The top of the inbox, which is what gets opened first. Bodies
            // are the slowest single thing the hub does — an IMAP fetch and a
            // MIME export each — so having a few in hand is the difference
            // between a click that paints and a click that waits. They are
            // fetched one at a time and only a handful deep: this is work
            // nobody asked for, and it must not crowd out work someone did.
            for (const envelope of envelopes.slice(0, WARM_BODIES)) {
              const key = mailKey(account.id, inbox, envelope.id);
              if (session.mail.has(key)) continue;
              try {
                session.mail.set(key, await api.comms.mailMessage(envelope.id, account.id, inbox));
              } catch {
                // The click that needs it will report anything real.
              }
            }
          } catch {
            // One mailbox that will not answer is not the others' problem.
          }
        }
        // The conversations at the top of the list, for the same reason: a
        // chat opens on its newest page, and that page is a round trip.
        for (const chat of session.chats.filter((item) => !item.space).slice(0, WARM_CHATS)) {
          if (session.messages.has(chat.id)) continue;
          try {
            const page = await api.comms.chatMessages(chat.id, 50);
            session.messages.set(chat.id, {messages: page.messages, nextBefore: page.nextBefore});
          } catch {
            // Same: guessed-at work reports nothing.
          }
        }
      } catch {
        // The hub will ask again itself when it opens.
      }
    })();
    return warming;
  }
</script>

<script lang="ts">
  import {onMount, tick, type ComponentProps} from 'svelte';
  import {flip} from 'svelte/animate';
  import {fade} from 'svelte/transition';
  import {
    commsPlatformLabel,
    type BroadcastDto,
    type BroadcastMessageDto,
    type BroadcastRecipientDto,
    type ChatDto,
    type ChatMemberDto,
    type ChatMessageDto,
    type ChatReactionDto,
    type ContactLinkDto,
    type CommsContactDto,
    type CommsPlatform,
    type CommsStatusDto,
    type MailAddressDto,
    type MailEnvelopeDto,
    type MailFolderDto,
    type MailImportance,
    type MailMessageDto,
    type PolymuxApi,
  } from '@polymux/protocol';
  import DOMPurify from 'dompurify';
  import {readableError} from '../../shared/errors';
  import {displayTime} from '../../shared/displayTime';
  import {scrollFade} from '../../shared/scrollFade';
  import Icon from '../../shared/components/Icon.svelte';
  import Menu from '../../shared/components/Menu.svelte';
  import PlatformLogo, {type Platform} from '../../shared/components/PlatformLogo.svelte';
  import {avatarInitial} from './avatarFallback';
  import {attachmentRenderKind} from './chatAttachments';
  import {chatClipboardContent} from './chatClipboard';
  import {dedupeContactChats, dedupePortalChats} from './chatContacts';
  import {
    contactIdentityRows,
    contactLinkForChat,
    memberForChat,
    type ContactIdentityRow,
  } from './contactLinks';
  import {
    compareConversationActivity,
    matchesConversationFilter,
    type ConversationListFilter,
    type ConversationListSort,
  } from './chatListFilters';
  import {chatSenderLabel} from './chatSenderLabel';
  import {
    searchChatMessages,
    type ChatSearchFilter,
    type ChatSearchResult,
  } from './chatSearch';
  import {mergeChatPage} from './chatMessagePages';
  import {
    activeComposerToken,
    mentionSuggestions,
    mentionsInDraft,
    mergeComposerMembers,
    replaceComposerToken,
    telegramCommandSuggestions,
    type ComposerSuggestion,
    type ComposerToken,
  } from './composerAutocomplete';
  import {chatsInSpace, spaceRootChats} from './chatSpaces';
  import {mailBodyWithSignature, mailHtmlWithSignature} from './mailSignatures';
  import MessageReactions from './MessageReactions.svelte';
  import {MAIN_UI_ICON_STROKE_WIDTH, RAIL_TILE_SIZE} from '../../shared/layout/iconSizing';
  import {activeLocale, t, translate} from '../../../i18n';
  import {
    applyOrder,
    loadRailOrder,
    moveBy,
    rememberRailOrder,
    saveAccountOrder,
    saveSourceOrder,
    type ObservedRailRow,
  } from './hubRailOrder';
  import {arrangeChats, hiddenChats, loadChatPrefs, toggleHidden, toggleMuted, togglePinned} from './chatPrefs';
  import FileAttachment from '../chat/FileAttachment.svelte';
  import {recordedVoiceWav} from './voiceWav';
  import EmojiPicker from './EmojiPicker.svelte';
  import {
    loadChatDraft,
    loadMailDraft,
    saveChatDraft,
    type MailComposerDraft,
  } from '../../shared/state/composerDrafts';

  /**
   * Hands a saved file to the app's own open menu — the one the chat and the
   * drive already use, so an attachment offers the same ways of opening as any
   * other file, under the pill that was clicked.
   */
  export let onOpenFilePath: (path: string, anchor?: DOMRect) => void = () => {};
  /** The workspace drawer changes width continuously while expanding. These
   * two values keep the Hub's list and reader on the same continuous motion
   * instead of letting its responsive breakpoint swap them mid-slide. */
  export let drawerMotionProgress = 0;
  export let dockedDrawerWidth = 420;

  type IconName = ComponentProps<typeof Icon>['name'];

  const api: PolymuxApi = polymuxApi();

  /**
   * One unified inbox over every linked platform plus every mailbox. The source
   * rail decides what the list shows, and the list decides what the reading
   * pane shows — the same three-column shape a mail client uses, because the
   * two halves of this view are the same task with different transports.
   */
  // Whatever the last mount learned, on screen before the first request.
  let status: CommsStatusDto | null = session.status;
  /** The first account order observed is already a user-visible arrangement.
   * Remember it immediately, then let only the rail's reorder controls change
   * existing positions. Bridge status responses are not an ordering signal. */
  function observedRailRows(next: CommsStatusDto | null): ObservedRailRow[] {
    if (!next) return [];
    return [
      ...next.bridges
        .filter((bridge) => bridge.state === 'connected')
        .map((bridge) => ({
          id: `platform:${bridge.platform}`,
          accountIds: bridge.accounts.map((account) => account.id),
        })),
      ...(next.email.accounts.length > 0
        ? [{id: 'mail', accountIds: next.email.accounts.map((account) => account.id)}]
        : []),
    ];
  }
  let railOrder = rememberRailOrder(loadRailOrder(), observedRailRows(status));

  function acceptStatus(next: CommsStatusDto): void {
    status = next;
    session.status = next;
    railOrder = rememberRailOrder(railOrder, observedRailRows(next));
  }
  let chats: ChatDto[] = session.chats;
  let broadcasts: BroadcastDto[] = session.broadcasts;
  let contactLinks: ContactLinkDto[] = session.contactLinks;
  let source: Source | null = session.source;
  /**
   * Captured here, at the top of the instance, because the statements that
   * keep the session in step run before `onMount` — and on a fresh mount they
   * would write `null` over the very thing the mount is about to restore.
   */
  const restoringChatId = session.activeChatId;
  const restoringBroadcastId = session.activeBroadcastId;
  /** Only the first visit has nothing to show; later ones refresh in place. */
  let loading = !session.status;
  let error = '';
  let busy = '';

  // Messaging
  let activeChat: ChatDto | null = null;
  let chatMessages: ChatMessageDto[] = [];
  type ChatTimelineEntry = {message: ChatMessageDto; index: number};
  type ChatTimelineItem =
    | {kind: 'notice'; key: string; entry: ChatTimelineEntry}
    | {kind: 'sender-run'; key: string; entries: ChatTimelineEntry[]; oldestIndex: number};
  let chatMembers: ChatMemberDto[] = [];
  /** A person's identity sheet sits over their conversation. It is also the
   * Contacts view's destination, so a profile is useful before a thread is
   * opened, not only after. */
  let profileOpen = false;
  let profileReturnsToChat = false;
  let profileContacts: CommsContactDto[] = [];
  let profileLoading = false;
  let profileMergeOpen = false;
  let profileMergeSelected = new Set<string>();
  let profileMergeName = '';
  let activeBroadcast: BroadcastDto | null = null;
  let broadcastMessages: BroadcastMessageDto[] = [];
  let broadcastDraft = '';
  let draft = '';
  /** Files waiting beside the active chat draft. Unlike the native picker,
   * dragging into Hub stages them here rather than sending on drop. */
  let chatFiles: string[] = [];
  let chatFileDragActive = false;
  /** Token for the page of older messages, null once the room's start is in. */
  let chatBefore: string | null = null;
  /** The thread's scroller, so reaching its top can pull the page before. */
  let threadEl: HTMLDivElement | null = null;
  const CHAT_PAGE = 40;
  /** Search owns a separate history copy while it walks backwards through the
   * room. Closing it leaves the ordinary thread at its previous scroll depth;
   * choosing a result promotes that history into the thread and jumps there. */
  let chatSearchOpen = false;
  let chatSearchQuery = '';
  let chatSearchFilter: ChatSearchFilter = 'all';
  let chatSearchMessages: ChatMessageDto[] = [];
  let chatSearchBefore: string | null = null;
  let chatSearchLoading = false;
  let chatSearchInput: HTMLInputElement | null = null;
  let chatSearchToken = 0;
  let chatHeaderMenuOpen = false;
  let chatHeaderMenu: HTMLUListElement | null = null;
  const CHAT_SEARCH_PAGE = 100;
  const CHAT_SEARCH_FILTERS: ChatSearchFilter[] = ['all', 'messages', 'media', 'files', 'links'];
  $: chatSearchResults = chatSearchOpen
    ? searchChatMessages(chatSearchMessages, chatSearchQuery, chatSearchFilter)
    : [];

  // Mail
  let folders: MailFolderDto[] = [];
  let envelopes: MailEnvelopeDto[] = [];
  let openMail: MailMessageDto | null = null;
  let openEnvelope: MailEnvelopeDto | null = null;
  let composing = false;
  let composeTo = '';
  let composeCc = '';
  let composeBcc = '';
  let composeSubject = '';
  let composeBody = '';
  let composeSignatureId = '';
  let composeSignatureBody = '';
  let composeSignatureHtml: string | null = null;
  let composeFiles: string[] = [];
  /** "normal" writes no header; the flag is a toggle rather than a menu
   * because the low end of the scale is asked for about once a decade. */
  let composeImportance: MailImportance = 'normal';
  /** Shown only once there is a reason to: an empty Cc line is noise. */
  let showCopies = false;
  /** What a reply must echo back for the recipient's client to thread it. */
  let composeReply: {inReplyTo: string | null; references: string[]} | null = null;
  /** The draft this compose replaces, when it was opened from one. */
  let composeDraft: {id: string; folder: string} | null = null;
  /** Stable identity for this local compose, across debounced mailbox saves. */
  let composeLocalId = '';
  let composeRevision = 0;
  let composeDirty = false;
  /** A fresh mount may recover the one composer that was open when it left.
   * Normal folder changes in the same mount should not keep reopening it. */
  let mailDraftRestoreEligible = true;
  let search = '';
  /** Ids the list has selected, for actions that act on more than one. */
  let selected = new Set<string>();
  /** Anchor for shift-click, the way every list does ranges. */
  let lastPicked = '';
  /** How many pages of the folder have been pulled in. */
  let page = 1;
  let moreToLoad = false;
  const PAGE_SIZE = 50;
  /** Other messages carrying this one's subject: the conversation it is part of. */
  let thread: MailEnvelopeDto[] = [];
  /**
   * A long chain is a wall of identical rows — a mailing list or an alert
   * sender says the same subject twenty times over. Only the nearest few show
   * until asked, so the chain reads as context rather than a second list.
   */
  const CHAIN_HEAD = 4;
  let chainExpanded = false;
  let attachmentPaths: string[] = [];
  /** Which pill is waiting on the download, so only that one shows it. */
  let pendingAttachment: number | null = null;

  /**
   * Which rail groups are expanded. A source with more than one account is a
   * group: clicking the row opens its accounts inline and clicking it again
   * folds them away. A source with a single account has nothing to expand, so
   * its row selects that account outright.
   */
  let openGroups: Record<string, boolean> = {};
  /** Chats whose avatar the homeserver would not serve, so the row falls back
   * to its initial or profile glyph rather than retrying a missing picture. */
  let brokenAvatars = new Set<string>();
  /** Media urls that failed to load, shown as a named file chip instead: a
   * picture whose bytes are gone would otherwise hold its full frame open as
   * a blank bubble. */
  let brokenMedia = new Set<string>();
  /** How many times each has been asked for, so a blip is not mistaken for a
   * missing picture. */
  const mediaAttempts = new Map<string, number>();
  const MEDIA_TRIES = 3;
  /**
   * A first failure is not proof the picture is gone. Media is fetched through
   * the main process against the homeserver, which answers 401 until the hub
   * has finished signing in — so every picture already on screen at launch
   * failed once, and giving up on the first error left them as file chips for
   * the rest of the session even though the bytes were there all along.
   */
  function retryMedia(event: Event, url: string): void {
    const element = event.currentTarget as HTMLImageElement | HTMLMediaElement | null;
    const tries = (mediaAttempts.get(url) ?? 0) + 1;
    mediaAttempts.set(url, tries);
    if (tries >= MEDIA_TRIES || !element) {
      brokenMedia = new Set(brokenMedia).add(url);
      return;
    }
    // A fresh query each time, so the failed response is not served back from
    // cache. Backing off gives sign-in the moment it needs.
    setTimeout(() => {
      element.src = `${url}${url.includes('?') ? '&' : '?'}attempt=${tries}`;
    }, 300 * tries);
  }
  /** The rail fades its edges only where the content actually runs on, the
   * same rule the settings rail follows. */
  let railElement: HTMLElement;
  let railAtTop = true;
  let railAtBottom = true;
  /** The rail has two deliberate widths: the labelled default and an icon-only
   * strip. It stays on one until the pointer crosses the midpoint, then snaps
   * straight to the other rather than exposing arbitrary widths between them. */
  const RAIL_DEFAULT_WIDTH = 156;
  const RAIL_COMPACT_WIDTH = 52;
  const RAIL_SNAP_AT = (RAIL_DEFAULT_WIDTH + RAIL_COMPACT_WIDTH) / 2;
  const HUB_SPLIT_MIN_WIDTH = 720;
  const HUB_SPLIT_LIST_WIDTH = 280;
  const RAIL_COMPACT_KEY = 'polymuxHubRailCompact';
  let railCompact = loadRailCompact();
  let railDragWidth: number | null = null;
  let railResizeStart: {x: number; width: number; direction: 1 | -1} | null = null;
  $: railWidth = railDragWidth ?? (railCompact ? RAIL_COMPACT_WIDTH : RAIL_DEFAULT_WIDTH);
  $: railIconOnly = railWidth < RAIL_SNAP_AT;
  $: hubReading = !!openMail || !!openEnvelope || !!activeChat || !!activeBroadcast || composing;
  $: settledListWidth = dockedDrawerWidth >= HUB_SPLIT_MIN_WIDTH
    ? HUB_SPLIT_LIST_WIDTH
    : hubReading ? 0 : Math.max(0, dockedDrawerWidth - railWidth);
  $: motionListWidth = Math.round(
    settledListWidth +
    (HUB_SPLIT_LIST_WIDTH - settledListWidth) * Math.max(0, Math.min(1, drawerMotionProgress)),
  );
  /** Whether the mailbox dropdown over the message list is showing. */
  let folderMenu = false;
  /** Which slice of the folder the list shows. Applied here rather than in the
   * IMAP query so switching back is instant and costs no round trip. */
  type Filter = 'all' | 'unread' | 'flagged' | 'attachments';
  $: FILTERS = [
    {id: 'all' as Filter, label: $t('hub.filterAll'), icon: 'mail' as IconName},
    {id: 'unread' as Filter, label: $t('hub.filterUnread'), icon: 'bolt' as IconName},
    {id: 'flagged' as Filter, label: $t('hub.filterFlagged'), icon: 'flag' as IconName},
    {id: 'attachments' as Filter, label: $t('hub.filterAttachments'), icon: 'attach' as IconName},
  ];
  type Sort = 'date-desc' | 'date-asc' | 'subject' | 'from';
  $: SORTS = [
    {id: 'date-desc' as Sort, label: $t('hub.sortNewest')},
    {id: 'date-asc' as Sort, label: $t('hub.sortOldest')},
    {id: 'subject' as Sort, label: $t('hub.sortSubject')},
    {id: 'from' as Sort, label: $t('hub.sortSender')},
  ];
  let filter: Filter = 'all';
  let sort: Sort = 'date-desc';
  let filterMenu = false;
  $: CONVERSATION_FILTERS = [
    {id: 'all' as ConversationListFilter, label: $t('hub.filterAll'), icon: 'platforms' as IconName},
    {id: 'unread' as ConversationListFilter, label: $t('hub.filterUnread'), icon: 'bolt' as IconName},
    {id: 'read' as ConversationListFilter, label: $t('hub.filterRead'), icon: 'check' as IconName},
  ];
  $: CONVERSATION_SORTS = [
    {id: 'latest' as ConversationListSort, label: $t('hub.sortLatestMessage'), icon: 'arrow-down' as IconName},
    {id: 'earliest' as ConversationListSort, label: $t('hub.sortEarliestMessage'), icon: 'arrow-up' as IconName},
  ];
  let conversationFilter: ConversationListFilter = 'all';
  let conversationSort: ConversationListSort = 'latest';
  let conversationFilterMenu = false;
  let moveMenu = false;
  let selectionBusy = false;

  $: visibleEnvelopes = envelopes.filter((envelope) =>
    filter === 'unread'
      ? !envelope.seen
      : filter === 'flagged'
        ? envelope.flagged
        : filter === 'attachments'
          ? envelope.hasAttachment
          : true,
  );

  /** Conversation sizes for the rows on screen, redone as the folder changes. */
  $: chainCounts = chainSizes(envelopes);

  /** How many messages the row's conversation holds; 1 when it stands alone. */
  function chainCount(envelope: MailEnvelopeDto): number {
    return chainCounts.get(baseSubject(envelope.subject)) ?? 1;
  }

  $: safeHtml = openMail?.html ? sanitiseMail(openMail.html) : '';
  $: safeComposeSignatureHtml = composeSignatureHtml ? sanitiseMail(composeSignatureHtml) : '';

  /**
   * Strips everything a message has no business carrying — scripts, frames,
   * forms, stylesheets that would escape into the app's own styling.
   *
   * Images are not among them. A mail that arrives as half a layout with a bar
   * asking permission to be a mail is a worse thing to read than one that
   * loads, and every mail client the user came from loads them; the cost is
   * that a sender's tracking pixel learns the message was opened, which is the
   * same cost those clients pay.
   */
  function sanitiseMail(html: string): string {
    const clean = DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'style', 'iframe', 'frame', 'object', 'embed', 'form', 'base', 'link', 'meta'],
      FORBID_ATTR: ['srcset', 'background', 'ping'],
      ALLOW_DATA_ATTR: false,
    });
    const holder = document.createElement('div');
    holder.innerHTML = clean;
    for (const image of holder.querySelectorAll('img')) {
      const src = image.getAttribute('src') ?? '';
      // `cid:` addresses a MIME part of this very message. Nothing in a
      // browser can fetch that, so the image would sit there as a broken
      // glyph with the sender's alt text beside it — worse than absent.
      // `http:` is refused by the app's own policy and would break the same
      // way, and both are usually a logo nobody misses.
      if (!src || /^(cid|http):/i.test(src)) {
        image.remove();
        continue;
      }
      // The sender learns a mail was opened either way; they need not also
      // learn which page it was opened from.
      image.setAttribute('referrerpolicy', 'no-referrer');
      image.setAttribute('decoding', 'async');
    }
    return holder.innerHTML;
  }

  /**
   * An image that will not load — expired, moved, or refused — leaves a broken
   * glyph and the sender's alt text in the middle of the layout. Nothing can
   * be done about the miss, so the space is given back instead.
   *
   * Capture, because `error` does not bubble; on the container, because the
   * markup is `{@html}` and its images have no handlers of their own.
   */
  function hideBrokenImage(event: Event): void {
    const image = event.target;
    if (image instanceof HTMLImageElement) image.style.display = 'none';
  }

  /**
   * A link in a message belongs in the browser, not in this pane: following it
   * here would navigate the app itself out of existence.
   */
  function openLink(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    const href = anchor?.getAttribute('href') ?? '';
    if (!anchor) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(href)) void api.browser.openExternal(href);
  }

  /**
   * Splits authored text without turning it into HTML. Linkification belongs
   * to the shared renderer, while escaping remains Svelte's responsibility.
   */
  function messageParts(body: string): Array<{text: string; url: string | null}> {
    const parts: Array<{text: string; url: string | null}> = [];
    const links = /https?:\/\/[^\s<>]+/gi;
    let from = 0;
    for (const match of body.matchAll(links)) {
      const index = match.index ?? 0;
      if (index > from) parts.push({text: body.slice(from, index), url: null});
      // Sentence punctuation is not part of the URL. Balanced `)` remains,
      // while the common trailing one in prose stays ordinary text.
      let url = match[0];
      let trailing = '';
      while (/[.,!?;:]$/.test(url)) {
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
      }
      if (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
        trailing = ')' + trailing;
        url = url.slice(0, -1);
      }
      parts.push({text: url, url});
      if (trailing) parts.push({text: trailing, url: null});
      from = index + match[0].length;
    }
    if (from < body.length) parts.push({text: body.slice(from), url: null});
    return parts.length > 0 ? parts : [{text: body, url: null}];
  }

  $: accounts = status?.email.accounts ?? [];
  $: linked = (status?.bridges ?? []).filter((bridge) => bridge.state === 'connected');

  /**
   * The rail as one arranged list. A platform and the mail group are the same
   * kind of thing to someone dragging them past each other, so they are built
   * as one shape here rather than as two blocks the markup keeps in step.
   */
  type RailRow = {
    id: string;
    platform: CommsPlatform | 'mail';
    name: string;
    /** `id` selects, `label` and `avatarUrl` identify the account row. */
    accounts: {id: string; label: string; avatarUrl?: string | null}[];
  };
  $: railRows = applyOrder<RailRow>(
    [
      ...linked.map((bridge) => ({
        id: `platform:${bridge.platform}`,
        platform: bridge.platform,
        name: bridge.name,
        accounts: bridge.accounts.map((account) => ({
          id: account.id,
          label: account.name,
          avatarUrl: account.avatarUrl,
        })),
      })),
      ...(accounts.length > 0
        ? [
            {
              id: 'mail',
              platform: 'mail' as const,
              name: $t('hub.mail'),
              accounts: accounts.map((account) => ({id: account.id, label: account.email})),
            },
          ]
        : []),
    ],
    (row) => row.id,
    railOrder.sources,
  ).map((row) => ({...row, accounts: applyOrder(row.accounts, (item) => item.id, railOrder.accounts[row.id] ?? [])}));
  /** The accounts moved out of an icon-only rail and into the list header. */
  $: currentRailPlatform = source?.kind === 'platform' ? source.platform : '';
  $: currentRailRow = source?.kind === 'mail'
    ? railRows.find((row) => row.id === 'mail') ?? null
    : currentRailPlatform
      ? railRows.find((row) => row.platform === currentRailPlatform) ?? null
      : null;
  $: currentRailAccount = source?.kind === 'mail'
    ? source.account
    : source?.kind === 'platform'
      ? source.account ?? ''
      : '';
  $: compactAccountOptions = currentRailRow?.accounts.map((account) => ({
    value: account.id,
    label: account.label,
  })) ?? [];
  // Expanding a group changes how far the rail scrolls, so the edges are
  // re-read whenever its content does.
  $: if (railRows.length || openGroups) void tick().then(measureRailEdges);

  /** Opening Hub is a paint, not a reveal: its already-known sources arrive
   * with no entrance motion. Once that first rail has painted, a real account
   * change cross-fades and gives the surrounding rows enough time to settle
   * into their new positions without snapping. */
  const RAIL_LIVE_FADE_MS = 220;
  const RAIL_LIVE_REFLOW_MS = 260;
  /** How long a row takes to slide to the place a drag has made for it. A drag
   * remains more direct than a background settings change. */
  const RAIL_DRAG_SHUFFLE_MS = 160;
  let railMotionReady = false;
  let railMotionArming = false;
  let railMotionFrame = 0;
  let railMotionDisposed = false;
  let initialRailHydrated = false;

  function armRailMotionAfterPaint(): void {
    if (railMotionReady || railMotionArming || railMotionDisposed) return;
    railMotionArming = true;
    void tick().then(() => {
      if (railMotionDisposed) return;
      if (typeof requestAnimationFrame !== 'function') {
        railMotionReady = true;
        return;
      }
      railMotionFrame = requestAnimationFrame(() => {
        railMotionFrame = 0;
        if (!railMotionDisposed) railMotionReady = true;
      });
    });
  }

  function railFadeDuration(): number {
    return railMotionReady ? RAIL_LIVE_FADE_MS : 0;
  }

  function railReflowDuration(carried: boolean): number {
    if (!railMotionReady || carried) return 0;
    return dragging ? RAIL_DRAG_SHUFFLE_MS : RAIL_LIVE_REFLOW_MS;
  }
  /** How far the pointer travels before a press becomes a drag. */
  const RAIL_DRAG_SLOP = 4;
  /** How near an edge the pointer has to come before the rail scrolls under it,
   * and how fast it scrolls once it is hard against that edge. */
  const RAIL_EDGE_ZONE = 26;
  const RAIL_EDGE_SPEED = 14;
  function loadRailCompact(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem(RAIL_COMPACT_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function saveRailCompact(compact: boolean): void {
    railCompact = compact;
    try {
      localStorage.setItem(RAIL_COMPACT_KEY, String(compact));
    } catch {
      // An unavailable store costs persistence, not the resize itself.
    }
  }

  function startRailResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    const direction = document.documentElement.dir === 'rtl' ? -1 : 1;
    railResizeStart = {x: event.clientX, width: railWidth, direction};
    railDragWidth = railWidth;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function dragRailResize(event: PointerEvent): void {
    if (!railResizeStart) return;
    const requestedWidth = railResizeStart.width +
      (event.clientX - railResizeStart.x) * railResizeStart.direction;
    railDragWidth = requestedWidth < RAIL_SNAP_AT
      ? RAIL_COMPACT_WIDTH
      : RAIL_DEFAULT_WIDTH;
  }

  function stopRailResize(event: PointerEvent): void {
    if (!railResizeStart) return;
    saveRailCompact((railDragWidth ?? railWidth) === RAIL_COMPACT_WIDTH);
    railResizeStart = null;
    railDragWidth = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  function resizeRailWithKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const compact = document.documentElement.dir === 'rtl'
      ? event.key === 'ArrowRight'
      : event.key === 'ArrowLeft';
    saveRailCompact(compact);
    event.preventDefault();
  }

  function chooseCompactAccount(account: string): void {
    if (!currentRailRow) return;
    if (currentRailRow.id === 'mail') void selectMail(account);
    else selectPlatform(currentRailRow.platform, account);
  }
  /**
   * What is being dragged, and the layout it is being dragged through: its
   * scope (`sources`, or a row id for the accounts inside it), its id, and the
   * slot geometry read once when the drag began. Measuring once is the point —
   * the rows are animating to their new places while the drag continues, so
   * measuring them live means aiming at a moving target and reads as jitter.
   * A drag never crosses scopes: an account cannot become a source, and a
   * source cannot land inside one.
   */
  let dragging: {
    scope: string;
    id: string;
    /** Pointer position, in rail content space, when the drag began. */
    startY: number;
    /** The slots the drag moves through, top and height of each. */
    tops: number[];
    heights: number[];
    /** The order those slots were read in. */
    order: string[];
    /** How far the carried row is drawn from the slot it currently occupies. */
    offset: number;
  } | null = null;

  /** The row settling back into place after a release, kept for as long as that
   * takes so it slides home rather than snapping there. */
  let settling: {scope: string; id: string} | null = null;

  /** Where the press began, so a click is told apart from a drag. */
  let pressed: {scope: string; id: string; y: number} | null = null;
  /** Set by a drag so the click it ends with does not also select the row. */
  let dragged = false;
  /** The last pointer position, which the edge scroll re-reads each frame. */
  let pointerY = 0;
  let edgeFrame = 0;

  /**
   * The rail drags with the pointer rather than with HTML5 drag-and-drop: that
   * API paints its own translucent, drop-shadowed copy of the row under the
   * cursor, which is not what this rail should look like, and it offers no say
   * in when a row counts as passed.
   */
  function pressRow(event: PointerEvent, scope: string, id: string): void {
    if (event.button !== 0) return;
    pressed = {scope, id, y: event.clientY};
    dragged = false;
  }

  /** A pointer position in the rail's own content space, so a scroll during a
   * drag moves the pointer and the rows it is measured against together. */
  function contentY(clientY: number): number {
    if (!railElement) return clientY;
    return clientY - railElement.getBoundingClientRect().top + railElement.scrollTop;
  }

  function dragRow(event: PointerEvent): void {
    if (!pressed) return;
    pointerY = event.clientY;
    if (dragging) {
      stepTowards(event.clientY);
      return;
    }
    // A few pixels of slop, so a click that trembles stays a click.
    if (Math.abs(event.clientY - pressed.y) < RAIL_DRAG_SLOP) return;
    // A source with its accounts showing is a block tall enough to cover the
    // rows a drag is aiming between — the one being carried and every other
    // one alike — so grabbing a source folds the whole rail down to its
    // source rows, and what moves is a row past rows.
    if (pressed.scope === 'sources' && Object.values(openGroups).some(Boolean)) openGroups = {};
    railElement?.setPointerCapture?.(event.pointerId);
    const {scope, id} = pressed;
    // Measured after the fold, not before it: the slots the drag moves through
    // are the ones it will actually see.
    void tick().then(() => beginDrag(scope, id));
  }

  function beginDrag(scope: string, id: string): void {
    if (!pressed || pressed.scope !== scope || pressed.id !== id) return;
    const order = currentOrder(scope);
    const boxes = order.map((rowId) => rowBox(scope, rowId));
    if (order.indexOf(id) < 0 || boxes.some((box) => !box)) return;
    dragging = {
      scope,
      id,
      startY: contentY(pointerY),
      tops: boxes.map((box) => contentY(box!.top)),
      heights: boxes.map((box) => box!.height),
      order,
      offset: 0,
    };
    settling = null;
    dragged = true;
    edgeFrame ||= requestAnimationFrame(edgeScroll);
  }

  /**
   * Places the carried row wherever the pointer has taken it: it is drawn under
   * the pointer, and the slot it belongs in is however many rows' centres it
   * has passed. Counting the rows passed rather than swapping with a neighbour
   * per event is what keeps a fast drag from lagging one row per frame.
   */
  function stepTowards(clientY: number): void {
    if (!dragging) return;
    const {scope, id, startY, tops, heights, order} = dragging;
    const from = order.indexOf(id);
    if (from < 0) return;
    const top = tops[from] + (contentY(clientY) - startY);
    const centre = top + heights[from] / 2;
    let index = 0;
    for (let slot = 0; slot < order.length; slot += 1) {
      if (slot !== from && tops[slot] + heights[slot] / 2 < centre) index += 1;
    }
    dragging = {...dragging, offset: top - tops[index]};
    const moved = order.filter((rowId) => rowId !== id);
    moved.splice(index, 0, id);
    const shown = currentOrder(scope);
    if (moved.every((rowId, slot) => rowId === shown[slot])) return;
    railOrder =
      scope === 'sources' ? saveSourceOrder(railOrder, moved) : saveAccountOrder(railOrder, scope, moved);
  }

  /** Dragging to the end of a rail taller than its window has to be possible
   * without letting go, so the rail scrolls itself while the pointer is held
   * against an edge — faster the harder against it the pointer is. */
  function edgeScroll(): void {
    edgeFrame = 0;
    if (!dragging || !railElement) return;
    const box = railElement.getBoundingClientRect();
    const above = pointerY - box.top;
    const below = box.bottom - pointerY;
    const step =
      above < RAIL_EDGE_ZONE
        ? -RAIL_EDGE_SPEED * Math.min(1, (RAIL_EDGE_ZONE - above) / RAIL_EDGE_ZONE)
        : below < RAIL_EDGE_ZONE
          ? RAIL_EDGE_SPEED * Math.min(1, (RAIL_EDGE_ZONE - below) / RAIL_EDGE_ZONE)
          : 0;
    if (step) {
      const before = railElement.scrollTop;
      railElement.scrollTop += step;
      if (railElement.scrollTop !== before) stepTowards(pointerY);
    }
    edgeFrame = requestAnimationFrame(edgeScroll);
  }

  /** Where a row currently sits on screen, which is what the drag's slots are
   * read from — once, before anything has started animating. */
  function rowBox(scope: string, id: string): DOMRect | null {
    if (!railElement) return null;
    const selector =
      scope === 'sources'
        ? `[data-rail-source="${CSS.escape(id)}"]`
        : `[data-rail-source="${CSS.escape(scope)}"] [data-rail-account="${CSS.escape(id)}"]`;
    return railElement.querySelector(selector)?.getBoundingClientRect() ?? null;
  }

  function releaseRow(): void {
    pressed = null;
    if (edgeFrame) cancelAnimationFrame(edgeFrame);
    edgeFrame = 0;
    if (!dragging) return;
    // The carried row settles into the place it was let go over rather than
    // snapping there, so a drag ends where the eye is already looking.
    const landed = {scope: dragging.scope, id: dragging.id};
    settling = landed;
    dragging = null;
    setTimeout(() => {
      if (settling === landed) settling = null;
    }, RAIL_DRAG_SHUFFLE_MS);
  }

  /** The ids of a scope as the rail currently shows them, which is what a move
   * is applied to — the stored list alone omits anything never dragged. */
  function currentOrder(scope: string): string[] {
    if (scope === 'sources') return railRows.map((row) => row.id);
    return railRows.find((row) => row.id === scope)?.accounts.map((account) => account.id) ?? [];
  }

  /** Keyboard equivalent of the drag, on the focused row. */
  function nudge(event: KeyboardEvent, scope: string, id: string): void {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const step = event.key === 'ArrowUp' ? -1 : 1;
    const moved = moveBy(currentOrder(scope), id, step);
    railOrder =
      scope === 'sources' ? saveSourceOrder(railOrder, moved) : saveAccountOrder(railOrder, scope, moved);
  }
  /** Chats belonging to whichever platform the rail has selected, pinned rows
   * first and hidden ones collected under their own row below. */
  $: platformChats = chatsFor(source, chats);
  $: selectedSpaceId = source?.kind === 'platform' ? source.space ?? null : null;
  $: focusedSpace = selectedSpaceId
    ? platformChats.find((chat) => chat.space && chat.id === selectedSpaceId) ?? null
    : null;
  $: currentChatRows = focusedSpace
    ? chatsInSpace(platformChats, focusedSpace.id, chatSearch)
    : spaceRootChats(platformChats, chatSearch);
  $: uniqueChatRows = dedupePortalChats(currentChatRows);
  $: filteredChatRows = uniqueChatRows.filter((chat) =>
    matchesConversationFilter(chatUnread(chat), conversationFilter));
  $: orderedChatRows = [...filteredChatRows].sort((left, right) =>
    compareConversationActivity(left.lastActivity, right.lastActivity, conversationSort));
  $: visibleChats = arrangeChats(orderedChatRows, (chat) => chat.id, chatPrefs, activeChat?.id ?? null);
  $: hiddenRows = hiddenChats(orderedChatRows, (chat) => chat.id, chatPrefs, activeChat?.id ?? null);
  type UnifiedRow =
    | {kind: 'chat'; at: string; chat: ChatDto}
    | {kind: 'mail'; at: string; account: string; folder: string; envelope: MailEnvelopeDto};
  // A group with nothing left in it takes its expanded state with it, so it
  // does not reappear open the next time something is hidden.
  $: if (hiddenRows.length === 0) hiddenOpen = false;
  /**
   * The reading pane's actions as data, so the strip and the overflow menu are
   * the same list said twice rather than two lists to keep in step.
   *
   * `move` is the one that opens something of its own; everything else runs
   * and closes.
   */
  type MailAction = {
    id: string;
    icon: IconName;
    label: string;
    run?: () => void;
    disabled?: boolean;
    destructive?: boolean;
    on?: boolean;
    filled?: boolean;
  };

  /** Menu open over the collapsed strip. */
  let overflowMenu = false;
  /** The strip's own width, watched so it can fold before it overflows. */
  let actionsWidth = 0;
  /** One icon button, plus the gap after it. */
  const ACTION_WIDTH = 30;
  $: mailActions = readerActions(openMail, openEnvelope, currentFolder);
  // Below what the row needs, every action goes behind one ⋮ rather than
  // wrapping onto a second line or being cut off at the edge.
  $: compactActions = actionsWidth > 0 && actionsWidth < mailActions.length * ACTION_WIDTH;
  // A strip that has grown back has nothing to hold a menu open over.
  $: if (!compactActions && overflowMenu) overflowMenu = false;

  function readerActions(
    message: MailMessageDto | null,
    envelope: MailEnvelopeDto | null,
    folder: MailFolderDto | null,
  ): MailAction[] {
    const actions: MailAction[] = [
      {id: 'reply', icon: 'reply', label: $t('hub.reply'), disabled: !message, run: () => startCompose('reply')},
      {id: 'reply-all', icon: 'reply-all', label: $t('hub.replyAll'), disabled: !message, run: () => startCompose('reply-all')},
      {id: 'forward', icon: 'mail-forward', label: $t('hub.forward'), disabled: !message, run: () => startCompose('forward')},
    ];
    if (!envelope) return actions;
    actions.push(
      {id: 'archive', icon: 'archive', label: $t('hub.archive'), run: () => void moveMail(envelope, 'archive')},
      {id: 'junk', icon: 'spam', label: $t('hub.junk'), run: () => void moveMail(envelope, 'junk')},
      {id: 'trash', icon: 'trash', label: $t('common.delete'), destructive: true, run: () => void moveMail(envelope, 'trash')},
      {id: 'move', icon: 'folder-move', label: $t('hub.moveToFolder')},
      {
        id: 'flag',
        icon: 'flag',
        label: envelope.flagged ? $t('hub.unflag') : $t('hub.flag'),
        on: envelope.flagged,
        filled: envelope.flagged,
        run: () => void toggleFlag(envelope),
      },
      {id: 'unread', icon: 'mail', label: $t('hub.markUnread'), run: () => void markUnread(envelope)},
    );
    if (folder?.role === 'trash' || folder?.role === 'junk')
      actions.push({
        id: 'erase',
        icon: 'close',
        label: $t('hub.deletePermanently'),
        destructive: true,
        run: () => void erase([envelope.id]),
      });
    return actions;
  }

  /** Runs one action from the overflow menu and puts the menu away — except
   * `move`, whose own list replaces it in place. */
  function runAction(action: MailAction): void {
    if (action.id === 'move') {
      moveMenu = true;
      return;
    }
    overflowMenu = false;
    action.run?.();
  }

  /** What the box over the conversation list is filtering on. */
  let chatSearch = '';
  /** Contacts have their own query so leaving the address book does not filter
   * the platform or combined lists the user returns to. */
  let contactSearch = '';
  /** The list pane temporarily becomes a contact picker. Its selection stays
   * local to the picker and is discarded when it closes. */
  let newChatOpen = false;
  let newChatLoading = false;
  let newChatCreating = false;
  let newChatSearch = '';
  let newChatSearchInput: HTMLInputElement | null = null;
  let newChatContacts: CommsContactDto[] = [];
  let newChatSelected = new Set<string>();
  let newChatGroupName = '';
  let newChatError = '';
  /** Broadcast creation resembles the contact picker, but deliberately has no
   * compatibility gate: every person retains their own platform and account. */
  let broadcastCreateOpen = false;
  let broadcastLoading = false;
  let broadcastCreating = false;
  let broadcastSearch = '';
  let broadcastListSearch = '';
  let broadcastName = '';
  let broadcastSearchInput: HTMLInputElement | null = null;
  let broadcastContacts: CommsContactDto[] = [];
  let broadcastSelected = new Set<string>();
  let broadcastError = '';

  function chatsFor(current: Source | null, list: ChatDto[]): ChatDto[] {
    if (current?.kind !== 'platform') return [];
    const accountCount = status?.bridges.find((bridge) => bridge.platform === current.platform)?.accounts.length ?? 0;
    return list.filter(
      (chat) =>
        chat.platform === current.platform &&
        (!current.account || chat.accountIds?.includes(current.account) || (!chat.accountIds && accountCount <= 1)),
    );
  }

  /** Direct conversations become one row only through a saved identity link.
   * Matching names still remain separate: a label is not identity evidence. */
  function contactsFor(list: ChatDto[], links: ContactLinkDto[], query: string): ContactIdentityRow[] {
    const needle = query.trim().toLowerCase();
    return contactIdentityRows(list, links)
      .filter((contact) =>
        !needle ||
        contact.name.toLowerCase().includes(needle) ||
        contact.chats.some((chat) =>
          chat.name.toLowerCase().includes(needle) ||
          commsPlatformLabel(chat.platform as CommsPlatform).toLowerCase().includes(needle)),
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name) ||
        commsPlatformLabel(a.primary.platform as CommsPlatform).localeCompare(
          commsPlatformLabel(b.primary.platform as CommsPlatform),
        ),
      );
  }

  $: contactRows = contactsFor(chats, contactLinks, contactSearch);
  $: activeProfileLink = activeChat ? contactLinkForChat(activeChat, contactLinks) : null;
  $: activeProfileChats = activeChat
    ? activeProfileLink
      ? dedupeContactChats(chats).filter((chat) =>
          activeProfileLink!.members.some((member) =>
            member.platform === chat.platform &&
            (member.remoteId && chat.remoteId
              ? member.remoteId.trim().normalize('NFKC').toLowerCase() === chat.remoteId.trim().normalize('NFKC').toLowerCase()
              : member.chatId === chat.id)))
      : [activeChat]
    : [];
  $: profileName = activeProfileLink?.name ?? activeChat?.name ?? '';
  $: activeProfilePlatformCount = new Set(activeProfileChats.map((chat) => chat.platform)).size;
  $: profileIdentifiers = [...new Set(activeProfileChats.flatMap((chat) => {
    const remote = chat.remoteId?.trim().normalize('NFKC').toLowerCase();
    return profileContacts
      .filter((contact) => contact.platform === chat.platform && contact.accounts.some((account) =>
        account.chatId === chat.id ||
        (remote && account.remoteId?.trim().normalize('NFKC').toLowerCase() === remote)))
      .flatMap((contact) => contact.identifiers);
  }))];
  $: profileMergeCandidates = dedupeContactChats(chats).filter((chat) => !chat.group && !chat.space);
  $: selectedNewChatContacts = newChatContacts.filter((contact) => newChatSelected.has(contact.id));
  $: selectedBroadcastContacts = broadcastContacts.filter((contact) => broadcastSelected.has(contact.id));
  $: broadcastRows = broadcasts.filter((broadcast) => {
    const needle = broadcastListSearch.trim().toLowerCase();
    return !needle ||
      broadcast.name.toLowerCase().includes(needle) ||
      broadcast.recipients.some((recipient) =>
        recipient.name.toLowerCase().includes(needle) ||
        commsPlatformLabel(recipient.platform).toLowerCase().includes(needle));
  });
  $: broadcastContactRows = broadcastContacts.filter((contact) => {
    const needle = broadcastSearch.trim().toLowerCase();
    return !needle ||
      contact.name.toLowerCase().includes(needle) ||
      commsPlatformLabel(contact.platform).toLowerCase().includes(needle) ||
      contact.accounts.some((account) => account.accountName.toLowerCase().includes(needle)) ||
      contact.identifiers.some((identifier) => identifier.toLowerCase().includes(needle));
  });
  $: canCreateBroadcast = Boolean(broadcastName.trim()) &&
    selectedBroadcastContacts.length > 0 &&
    selectedBroadcastContacts.every((contact) => Boolean(broadcastRoute(contact)));
  /** A picker opened from one platform stays in that platform. The combined
   * and Contacts sources are deliberately cross-platform address books. */
  function newChatContactsFor(current: Source | null, contacts: CommsContactDto[]): CommsContactDto[] {
    if (current?.kind !== 'platform') return contacts;
    return contacts.filter((contact) => contact.platform === current.platform);
  }

  $: availableNewChatContacts = newChatContactsFor(source, newChatContacts);
  $: newChatRows = availableNewChatContacts.filter((contact) => {
    const needle = newChatSearch.trim().toLowerCase();
    return !needle ||
      contact.name.toLowerCase().includes(needle) ||
      commsPlatformLabel(contact.platform).toLowerCase().includes(needle) ||
      contact.accounts.some((account) => account.accountName.toLowerCase().includes(needle)) ||
      contact.identifiers.some((identifier) => identifier.toLowerCase().includes(needle));
  });

  type NewChatRoute = {
    accountId: string;
    accountName: string;
    contacts: CommsContactDto['accounts'];
  };

  /** Finds one linked account that can reach every selected person. A contact
   * imported by two WhatsApp logins remains one row, and the second selection
   * is free to move the prospective group onto whichever login they share. */
  function newChatRouteFor(contacts: CommsContactDto[]): NewChatRoute | null {
    if (contacts.length === 0) return null;
    const platform = contacts[0]!.platform;
    if (contacts.some((contact) => contact.platform !== platform)) return null;
    const preferredAccount = source?.kind === 'platform' && source.platform === platform
      ? source.account
      : null;
    const candidates = [...contacts[0]!.accounts].sort((left, right) =>
      Number(right.accountId === preferredAccount) - Number(left.accountId === preferredAccount));
    for (const candidate of candidates) {
      const routes = contacts.map((contact) =>
        contact.accounts.find((account) => account.accountId === candidate.accountId));
      if (routes.some((route) => !route)) continue;
      const resolved = routes as CommsContactDto['accounts'];
      if (contacts.length === 1
        ? !resolved[0]!.chatId && !resolved[0]!.remoteId
        : resolved.some((route) => !route.remoteId)) continue;
      return {
        accountId: candidate.accountId,
        accountName: candidate.accountName,
        contacts: resolved,
      };
    }
    return null;
  }

  $: selectedNewChatRoute = newChatRouteFor(selectedNewChatContacts);
  $: canCreateNewChat = Boolean(selectedNewChatRoute) &&
    (selectedNewChatContacts.length === 1 || Boolean(newChatGroupName.trim()));

  /** A remote group belongs to one platform login. Once the first person is
   * chosen, incompatible rows remain visible but cannot be mixed into it. */
  function compatibleNewChatContact(contact: CommsContactDto): boolean {
    if (newChatSelected.has(contact.id) || selectedNewChatContacts.length === 0) return true;
    return Boolean(newChatRouteFor([...selectedNewChatContacts, contact]));
  }

  function toggleNewChatContact(contact: CommsContactDto): void {
    if (!compatibleNewChatContact(contact)) return;
    const next = new Set(newChatSelected);
    if (next.has(contact.id)) next.delete(contact.id);
    else next.add(contact.id);
    newChatSelected = next;
    newChatError = '';
  }

  async function openNewChatPicker(): Promise<void> {
    newChatOpen = true;
    newChatLoading = true;
    newChatSearch = '';
    newChatSelected = new Set();
    newChatGroupName = '';
    newChatError = '';
    try {
      await tick();
      newChatSearchInput?.focus();
      newChatContacts = await api.comms.chatContacts();
    } catch (cause) {
      newChatContacts = [];
      newChatError = readableError(cause);
    } finally {
      newChatLoading = false;
    }
  }

  function closeNewChatPicker(): void {
    newChatOpen = false;
    newChatSearch = '';
    newChatSelected = new Set();
    newChatGroupName = '';
    newChatError = '';
  }

  async function createSelectedChat(): Promise<void> {
    if (!canCreateNewChat || !selectedNewChatRoute || newChatCreating) return;
    const selectedContacts = selectedNewChatContacts;
    const first = selectedContacts[0]!;
    const routes = selectedNewChatRoute.contacts;
    newChatCreating = true;
    newChatError = '';
    try {
      const roomId = selectedContacts.length === 1 && routes[0]!.chatId
        ? routes[0]!.chatId
        : await api.comms.chatCreate({
            platform: first.platform,
            accountId: selectedNewChatRoute.accountId,
            participantIds: routes.map((route) => route.remoteId!),
            ...(selectedContacts.length > 1 ? {name: newChatGroupName.trim()} : {}),
          });
      await refreshChats();
      const opened = chats.find((chat) => chat.id === roomId) ?? {
        id: roomId,
        name: selectedContacts.length > 1 ? newChatGroupName.trim() : first.name,
        platform: first.platform,
        accountIds: [selectedNewChatRoute.accountId],
        avatarUrl: selectedContacts.length === 1 ? first.avatarUrl : null,
        unread: 0,
        lastActivity: null,
        preview: null,
        group: selectedContacts.length > 1,
      };
      closeNewChatPicker();
      await openChat(opened);
    } catch (cause) {
      newChatError = readableError(cause);
    } finally {
      newChatCreating = false;
    }
  }

  /** Prefer an existing DM, then the contact's primary linked account. Each
   * contact is resolved alone because a broadcast does not need a shared route. */
  function broadcastRoute(contact: CommsContactDto): CommsContactDto['accounts'][number] | null {
    return contact.accounts.find((route) => Boolean(route.chatId)) ??
      contact.accounts.find((route) => route.accountId === contact.accountId && Boolean(route.remoteId)) ??
      contact.accounts.find((route) => Boolean(route.remoteId)) ??
      null;
  }

  function toggleBroadcastContact(contact: CommsContactDto): void {
    if (!broadcastRoute(contact)) return;
    const next = new Set(broadcastSelected);
    if (next.has(contact.id)) next.delete(contact.id);
    else next.add(contact.id);
    broadcastSelected = next;
    broadcastError = '';
  }

  async function openBroadcastPicker(): Promise<void> {
    if (newChatOpen) closeNewChatPicker();
    broadcastCreateOpen = true;
    broadcastLoading = true;
    broadcastSearch = '';
    broadcastName = '';
    broadcastSelected = new Set();
    broadcastError = '';
    try {
      await tick();
      broadcastSearchInput?.focus();
      broadcastContacts = await api.comms.chatContacts();
    } catch (cause) {
      broadcastContacts = [];
      broadcastError = readableError(cause);
    } finally {
      broadcastLoading = false;
    }
  }

  function closeBroadcastPicker(): void {
    broadcastCreateOpen = false;
    broadcastSearch = '';
    broadcastName = '';
    broadcastSelected = new Set();
    broadcastError = '';
  }

  async function createBroadcast(): Promise<void> {
    if (!canCreateBroadcast || broadcastCreating) return;
    const recipients = selectedBroadcastContacts.flatMap((contact): BroadcastRecipientDto[] => {
      const route = broadcastRoute(contact);
      if (!route) return [];
      return [{
        id: contact.id,
        name: contact.name,
        platform: contact.platform,
        accountId: route.accountId,
        accountName: route.accountName,
        remoteId: route.remoteId,
        chatId: route.chatId,
        avatarUrl: contact.avatarUrl,
      }];
    });
    broadcastCreating = true;
    broadcastError = '';
    try {
      const created = await api.comms.broadcastCreate({name: broadcastName.trim(), recipients});
      broadcasts = [created, ...broadcasts.filter((item) => item.id !== created.id)];
      session.broadcasts = broadcasts;
      closeBroadcastPicker();
      await openBroadcast(created);
    } catch (cause) {
      broadcastError = readableError(cause);
    } finally {
      broadcastCreating = false;
    }
  }

  /** A shared portal can have different read state on each linked account. */
  function chatUnread(chat: ChatDto): number {
    if (source?.kind === 'platform' && source.account) {
      return chat.unreadByAccount?.[source.account] ?? chat.unread ?? 0;
    }
    return chat.unread ?? 0;
  }

  function clearChatUnread(chat: ChatDto): ChatDto {
    if (
      source?.kind === 'platform' &&
      source.account &&
      chat.unreadByAccount?.[source.account] !== undefined
    ) {
      const unreadByAccount = {...chat.unreadByAccount, [source.account]: 0};
      return {...chat, unreadByAccount, unread: Math.max(0, ...Object.values(unreadByAccount))};
    }
    return {...chat, unread: 0};
  }
  $: mailAccount = source?.kind === 'mail' ? source.account : '';
  $: mailFolder = source?.kind === 'mail' ? source.folder : '';
  /** The folders worth surfacing, in the order a mail client shows them. */
  $: railFolders = orderFolders(folders);
  $: currentFolder = folders.find((folder) => folder.name === mailFolder) ?? null;

  /**
   * A folder's name as it should be read — applied to every folder label the
   * pane draws, not only to the IMAP name it falls back on before the folder
   * list arrives.
   *
   * IMAP calls the inbox "INBOX" and Gmail prefixes its own folders with
   * "[Gmail]/". The backend already resolves both into a label, but that comes
   * with the folder list — a beat after the pane commits to the mailbox — so
   * showing the raw name meanwhile flashes INBOX and then corrects itself to
   * Inbox. A label cached before the backend learned this rule shouts the same
   * way, which is why it runs over labels too. Same rule as `leafName` in the
   * hub package, applied here so there is nothing to correct.
   */
  function folderLabel(name: string): string {
    const leaf = name.split('/').pop() ?? name;
    const trimmed = leaf.replace(/^\[[^\]]+\]\s*/, '') || name;
    return /^[A-Z]+$/.test(trimmed) ? trimmed.charAt(0) + trimmed.slice(1).toLowerCase() : trimmed;
  }
  $: currentAccount = accounts.find((account) => account.id === mailAccount) ?? null;
  $: signatureOptions = [
    {value: '', label: $t('hub.noSignature')},
    ...(currentAccount?.signatures ?? []).map((signature) => ({
      value: signature.id,
      label: signature.name,
    })),
  ];
  $: readerLoading = !!openEnvelope && busy === `mail:${openEnvelope.id}`;

  /** Ragged widths, so the placeholder reads as prose rather than a block. */
  const SKELETON_LINES = ['92%', '84%', '96%', '61%', '88%', '73%', '90%', '46%'];
  /** Placeholder rows, in the shape of the rows that are coming. */
  const SKELETON_ROWS = [0, 1, 2, 3, 4, 5, 6, 7];
  /** Placeholder bubbles: alternating sides, so the thread reads as a thread. */
  const SKELETON_BUBBLES = [
    {mine: false, width: '58%'},
    {mine: true, width: '44%'},
    {mine: false, width: '72%'},
    {mine: true, width: '38%'},
    {mine: false, width: '50%'},
  ];

  const FOLDER_ORDER: MailFolderDto['role'][] = [
    'inbox',
    'drafts',
    'sent',
    'archive',
    'junk',
    'trash',
  ];
  const FOLDER_ICONS: Record<MailFolderDto['role'], IconName> = {
    inbox: 'inbox',
    drafts: 'file',
    sent: 'paper-airplane',
    archive: 'archive',
    junk: 'spam',
    trash: 'trash',
    flagged: 'flag',
    other: 'folder',
  };

  function orderFolders(list: MailFolderDto[]): MailFolderDto[] {
    const ranked = list.filter((folder) => FOLDER_ORDER.includes(folder.role));
    return ranked.sort(
      (a, b) => FOLDER_ORDER.indexOf(a.role) - FOLDER_ORDER.indexOf(b.role),
    );
  }

  function mailComposerSnapshot(pending: boolean): MailComposerDraft | null {
    if (!composing || !composeLocalId || !source || source.kind !== 'mail') return null;
    const stored = loadMailDraft(source.account);
    const remoteDraft =
      mailDraftAutosave.reference(composeLocalId, source.account) ??
      (stored?.localId === composeLocalId ? stored.remoteDraft : null) ??
      composeDraft;
    return {
      localId: composeLocalId,
      revision: composeRevision,
      pending,
      account: source.account,
      folder: source.folder,
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      body: composeBody,
      signatureId: composeSignatureId,
      signatureBody: composeSignatureBody,
      signatureHtml: composeSignatureHtml,
      files: [...composeFiles],
      importance: composeImportance,
      reply: composeReply ? {...composeReply, references: [...composeReply.references]} : null,
      remoteDraft,
    };
  }

  /** Every edit is durable locally in the same event and reaches the mailbox
   * after a short quiet period. */
  function composeChanged(): void {
    composeDirty = true;
    composeRevision += 1;
    const snapshot = mailComposerSnapshot(true);
    if (snapshot) mailDraftAutosave.update(snapshot);
  }

  /** Svelte applies a bind after a user input listener. Wait one microtask so
   * the snapshot contains the character that caused this event. */
  function composeFieldChanged(): void {
    void tick().then(() => {
      if (composing) composeChanged();
    });
  }

  function restoreMailComposer(account: string): boolean {
    if (!mailDraftRestoreEligible) return false;
    mailDraftRestoreEligible = false;
    const saved = loadMailDraft(account);
    if (!saved) return false;
    composing = true;
    composeLocalId = saved.localId;
    composeRevision = saved.revision;
    composeDirty = saved.pending;
    composeTo = saved.to;
    composeCc = saved.cc;
    composeBcc = saved.bcc;
    showCopies = Boolean(saved.cc || saved.bcc);
    composeSubject = saved.subject;
    composeBody = saved.body;
    composeSignatureId = saved.signatureId;
    composeSignatureBody = saved.signatureBody;
    composeSignatureHtml = saved.signatureHtml;
    composeFiles = [...saved.files];
    composeImportance = saved.importance;
    composeReply = saved.reply
      ? {...saved.reply, references: [...saved.reply.references]}
      : null;
    composeDraft = saved.remoteDraft;
    if (saved.pending) mailDraftAutosave.update(saved);
    else mailDraftAutosave.seed(saved);
    return true;
  }

  /** Leaving the pane never discards mail. The write continues through a Hub
   * remount because its queue lives in the module above. */
  function leaveMailComposer(): void {
    if (!composing) return;
    const localId = composeLocalId;
    composing = false;
    if (!composeDirty || !localId) return;
    void mailDraftAutosave.flush(localId).catch((cause: unknown) => {
      error = readableError(cause);
    });
  }

  onMount(() => {
    // What the last visit was looking at, back on screen before a single
    // request goes out. `load` corrects it behind this.
    restoreView();
    void load();
    const unsubscribe = api.comms.subscribe((next) => {
      // Into the session cache as well, or the next mount paints the rail from
      // a snapshot older than the push that has already corrected it.
      acceptStatus(next);
      // With no cached status, the first push is hydration too. It paints
      // still, then arms motion for the next actual configuration change.
      if (initialRailHydrated) armRailMotionAfterPaint();
    });
    // Pushed the moment a message lands, whichever platform it came from: the
    // homeserver is where every bridge delivers, so it knows before any poll
    // would. The timer below stays as the backstop for anything that never
    // reaches the homeserver at all.
    const unsubscribeActivity = api.comms.subscribeActivity((activity) => {
      if (document.hidden) return;
      if (activeChat && activity.chatId === activeChat.id) void refreshChat();
      else void refreshChats();
    });
    const timer = setInterval(() => {
      if (!document.hidden) void refreshOpen();
    }, REFRESH_MS);
    // Coming back to the window is when stale content is most obvious, so it
    // does not wait out the rest of the interval.
    const onVisible = (): void => {
      if (!document.hidden) void refreshOpen();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // From here on the agent's "show me" lands in this instance; anything it
    // asked for while the tab was being created is waiting.
    showTarget = (target) => void goTo(target);
    if (pendingReveal) {
      const waiting = pendingReveal;
      pendingReveal = null;
      void goTo(waiting);
    }
    return () => {
      railMotionDisposed = true;
      if (railMotionFrame) cancelAnimationFrame(railMotionFrame);
      leaveMailComposer();
      showTarget = null;
      unsubscribe();
      unsubscribeActivity();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  });

  /**
   * Goes where the agent asked: a mailbox and the message in it, or a
   * conversation.
   *
   * A message is named by its folder-relative id when the agent has one. It
   * often does not — a draft it saved through the mail tool comes back without
   * one — so a subject, or failing that the newest message in the folder,
   * stands in. That is what "the draft you just wrote" means, and the folder
   * has just been refetched, so the newest is the one it saved. A draft opens
   * in the composer rather than the reader, the same as clicking it does.
   */
  async function goTo(target: WorkspaceRevealTarget): Promise<void> {
    if (target.chat) {
      const wanted = target.chat;
      if (chats.length === 0) await refreshChats();
      const findChat = (): ChatDto | undefined => chats.find(
        (item) =>
          (wanted.id && item.id === wanted.id) ||
          (wanted.name && item.name.toLowerCase() === wanted.name.toLowerCase()),
      );
      let found = findChat();
      // An incoming message can name a room that was created while the app
      // was hidden, before the session cache has seen it. Refresh once rather
      // than letting that notification open Hub on the wrong conversation.
      if (!found) {
        await refreshChats();
        found = findChat();
      }
      if (!found) return;
      await openChat(found);
      // A draft is written into the box, never sent: the user reads it where
      // they would have typed it and presses send themselves. Whatever they had
      // half-typed stays put rather than being overwritten.
      // Answering a particular message rather than the thread's end: the
      // composer shows what is being replied to, and the send carries it, the
      // same as picking Reply on the message would.
      const answering = wanted.replyTo
        ? (chatMessages.find((message) => message.id === wanted.replyTo) ?? null)
        : null;
      if (answering) replyTo = answering;
      if (wanted.draft && !draft.trim()) {
        draft = wanted.draft;
        await tick();
        composerInput?.focus();
      }
      persistChatComposer();
      return;
    }
    if (!target.mail) return;
    const {account, folder, messageId, subject, compose} = target.mail;
    await selectMail(account, folder);
    // `selectMail` reports failure through `error` rather than throwing, and a
    // mailbox that would not open has nothing to land on.
    if (!source || source.kind !== 'mail' || envelopes.length === 0) return;
    const wanted = subject?.trim().toLowerCase();
    const found = messageId
      ? envelopes.find((item) => item.id === messageId)
      : wanted
        ? envelopes.find((item) => item.subject.trim().toLowerCase() === wanted)
        : envelopes[0];
    // The mail half's equivalent of a chat draft: the composer opens already
    // written, saved nowhere. A reply or forward opens the message it answers
    // first, so the composer is the real one — recipients, Re:/Fwd: subject,
    // quoted body and the headers that thread it — with the drafted words
    // above the quote where a person would have typed them.
    if (compose) {
      const mode = compose.mode ?? 'new';
      if (mode !== 'new') {
        if (!found) return;
        await readMail(found);
        startCompose(mode);
        if (compose.body) composeBody = `${compose.body}\n${composeBody}`;
      } else {
        startCompose('new');
        if (compose.subject) composeSubject = compose.subject;
        if (compose.body) composeBody = compose.body;
      }
      // A reply already knows who it answers; an address given anyway wins.
      if (compose.to) composeTo = compose.to;
      if (compose.cc) composeCc = compose.cc;
      if (compose.bcc) composeBcc = compose.bcc;
      // Copies stay hidden until there is something in them to read.
      showCopies = Boolean(composeCc || composeBcc);
      if (compose.attachments?.length) composeFiles = [...compose.attachments];
      if (compose.importance) composeImportance = compose.importance;
      composeChanged();
      return;
    }
    if (!found) return;
    if (found.draft) await editDraft(found);
    else await readMail(found);
  }

  /**
   * Puts the pane back the way it was left: the same source, the same folder
   * or conversation, painted from what the session already holds. Returning to
   * the hub should look like coming back to a window, not like opening one.
   */
  function restoreView(): void {
    openGroups = {...session.openGroups};
    if (!source) return;
    if (source.kind === 'mail') {
      const warmed = mailCache.get(cacheKey(source.account, source.folder));
      if (warmed) {
        folders = warmed.folders;
        envelopes = warmed.envelopes;
        page = warmed.page;
        moreToLoad = warmed.moreToLoad;
      }
      restoreMailComposer(source.account);
    }
    if (source.kind === 'broadcasts' && restoringBroadcastId) {
      const broadcast = broadcasts.find((item) => item.id === restoringBroadcastId);
      if (broadcast) {
        activeBroadcast = broadcast;
        broadcastMessages = session.broadcastMessages.get(broadcast.id) ?? [];
        broadcastDraft = loadChatDraft(`broadcast:${broadcast.id}`).text;
      }
    }
    const chat = restoringChatId ? chats.find((item) => item.id === restoringChatId) : null;
    if (!chat) return;
    const known = session.messages.get(chat.id);
    activeChat = chat;
    chatMessages = known?.messages ?? [];
    chatBefore = known?.nextBefore ?? null;
    restoreChatComposer(chat.id);
  }

  async function load(): Promise<void> {
    loading = !session.status;
    try {
      acceptStatus(await api.comms.status());
      chats = await api.comms.chats().catch(() => session.chats);
      broadcasts = await api.comms.broadcasts().catch(() => session.broadcasts);
      contactLinks = await api.comms.contactLinks().catch(() => session.contactLinks);
      rememberChatPlatforms(chats);
      session.chats = chats;
      session.broadcasts = broadcasts;
      session.contactLinks = contactLinks;
      if (source) {
        // Already looking at something, restored above: bring it up to date
        // rather than choosing somewhere else to be.
        await refreshOpen();
      } else {
        // This fixed overview is the stable landing place; the rows beneath it
        // remain in whatever order the user chose.
        source = {kind: 'all'};
      }
      error = '';
      // Warms what the user is most likely to open next, behind whatever is on
      // screen now: the other mailboxes, and the conversations at the top of
      // the list. Both are ordinary reads — the same ones opening them would
      // make — done before they are asked for rather than after.
      void prefetchMail();
      void prefetchChats();
    } catch (cause) {
      error = readableError(cause);
    } finally {
      loading = false;
      // Both the cached paint and its first authoritative correction belong to
      // opening Hub. Only changes after that complete initial read may move.
      initialRailHydrated = true;
      if (status) armRailMotionAfterPaint();
    }
  }

  /**
   * The head of the most recent conversations, fetched one at a time so a busy
   * account does not open twenty requests at once. Only ones never read this
   * session are fetched, and only while nothing else is loading — a prefetch
   * that slows the thing the user actually clicked is worse than no prefetch.
   */
  const PREFETCH_CHATS = 8;

  /**
   * The bodies around where the reader is, fetched before they are asked for.
   * A read is one round trip on a connection the app already holds open, so
   * this is no longer hiding a two-second stall — but a few hundred
   * milliseconds is still the difference between a message that is there and
   * one that arrives.
   *
   * The window follows the reader rather than sitting at the top of the
   * folder: opening a message re-arms it around what was opened, because the
   * next click is almost always a neighbour. What it must never do is race the
   * click itself — a guess that delays the real read is worse than no guess —
   * so it yields while a message fetch is in flight and resumes after.
   */
  const PREFETCH_MAIL = 12;

  /**
   * How many warms are in the air at once. They do not overlap on the wire —
   * an account has one connection and IMAP carries one command at a time, so
   * the backend queues them — but issuing several keeps that connection busy
   * instead of idling between round trips. Bounded because a queue longer than
   * the user's patience is work nobody is waiting for.
   */
  const PREFETCH_LANES = 3;

  /** One prefetch walk at a time, whatever re-arms it. */
  let prefetching = false;

  async function prefetchMailBodies(anchor = 0): Promise<void> {
    if (!source || source.kind !== 'mail' || prefetching) return;
    const mailbox = source;
    prefetching = true;
    try {
      // Ahead of the anchor first — the direction reading travels — then the
      // one behind it, for a click that goes back up the list.
      const queue = envelopes
        .slice(Math.max(0, anchor - 1), anchor + PREFETCH_MAIL)
        .filter((item) => !session.mail.has(mailKey(mailbox.account, mailbox.folder, item.id)));
      const lanes = Array.from({length: PREFETCH_LANES}, async () => {
        for (;;) {
          const envelope = queue.shift();
          if (!envelope) return;
          const now = source;
          if (!now || now.kind !== 'mail' || now.folder !== mailbox.folder) return;
          try {
            session.mail.set(
              mailKey(mailbox.account, mailbox.folder, envelope.id),
              await api.comms.mailMessage(envelope.id, mailbox.account, mailbox.folder),
            );
          } catch {
            // Guessed-at work; the click that needs it will report any trouble.
          }
        }
      });
      await Promise.all(lanes);
    } finally {
      prefetching = false;
    }
  }

  async function prefetchChats(): Promise<void> {
    for (const chat of chats.filter((item) => !item.space).slice(0, PREFETCH_CHATS)) {
      if (session.messages.has(chat.id)) continue;
      if (activeChat) return;
      try {
        const page = await api.comms.chatMessages(chat.id, CHAT_PAGE);
        session.messages.set(chat.id, {messages: page.messages, nextBefore: page.nextBefore});
      } catch {
        // Work done ahead of being asked for: the real read reports anything
        // genuinely wrong.
      }
    }
  }

  function selectPlatform(platform: string, account?: string): void {
    if (newChatOpen) closeNewChatPicker();
    if (broadcastCreateOpen) closeBroadcastPicker();
    leaveMailComposer();
    source = {kind: 'platform', platform, account};
    activeChat = null;
    activeBroadcast = null;
    broadcastMessages = [];
    chatMessages = [];
    openMail = null;
    openEnvelope = null;
  }

  /** A Space is navigation, not a conversation: replace the platform's root
   * list with its child chats and keep the reading pane empty until one opens. */
  function openSpace(space: ChatDto): void {
    if (broadcastCreateOpen) closeBroadcastPicker();
    leaveMailComposer();
    const currentAccount = source?.kind === 'platform' && source.platform === space.platform
      ? source.account
      : space.accountIds?.length === 1
        ? space.accountIds[0]
        : undefined;
    source = {kind: 'platform', platform: space.platform, account: currentAccount, space: space.id};
    activeChat = null;
    activeBroadcast = null;
    broadcastMessages = [];
    chatMessages = [];
    openMail = null;
    openEnvelope = null;
    chatSearch = '';
  }

  function leaveSpace(): void {
    if (source?.kind !== 'platform') return;
    source = {kind: 'platform', platform: source.platform, account: source.account};
    activeChat = null;
    activeBroadcast = null;
    broadcastMessages = [];
    chatMessages = [];
    chatSearch = '';
  }

  /** Count only the children available through the selected account. */
  function spaceChildCount(space: ChatDto): number {
    const available = source?.kind === 'platform' && source.platform === space.platform
      ? platformChats
      : chats;
    return chatsInSpace(available, space.id).length;
  }

  function selectAll(): void {
    if (newChatOpen) closeNewChatPicker();
    if (broadcastCreateOpen) closeBroadcastPicker();
    leaveMailComposer();
    source = {kind: 'all'};
    activeChat = null;
    activeBroadcast = null;
    broadcastMessages = [];
    chatMessages = [];
    openMail = null;
    openEnvelope = null;
    chatSearch = '';
    void refreshChats();
    void prefetchMail();
  }

  function selectContacts(): void {
    if (newChatOpen) closeNewChatPicker();
    if (broadcastCreateOpen) closeBroadcastPicker();
    leaveMailComposer();
    source = {kind: 'contacts'};
    activeChat = null;
    activeBroadcast = null;
    broadcastMessages = [];
    chatMessages = [];
    openMail = null;
    openEnvelope = null;
    contactSearch = '';
    void refreshChats();
  }

  function selectBroadcasts(): void {
    if (newChatOpen) closeNewChatPicker();
    if (broadcastCreateOpen) closeBroadcastPicker();
    leaveMailComposer();
    source = {kind: 'broadcasts'};
    activeChat = null;
    chatMessages = [];
    activeBroadcast = null;
    broadcastMessages = [];
    openMail = null;
    openEnvelope = null;
    broadcastListSearch = '';
    void refreshBroadcasts();
  }

  async function openUnifiedMail(row: Extract<UnifiedRow, {kind: 'mail'}>): Promise<void> {
    await selectMail(row.account, row.folder);
    await readMail(envelopes.find((item) => item.id === row.envelope.id) ?? row.envelope);
  }

  function toggleGroup(key: string): void {
    openGroups = {...openGroups, [key]: !openGroups[key]};
  }

  // Whatever the pane is showing is what a return should show.
  $: session.source = source;
  $: session.activeChatId = activeChat?.id ?? null;
  $: session.activeBroadcastId = activeBroadcast?.id ?? null;
  $: session.openGroups = openGroups;

  /**
   * One click on a rail row: expand the accounts when there is a choice to
   * make, otherwise go straight to the only account there is.
   */
  /** Reassigns the set: Svelte tracks the binding, not the mutation. */
  function markAvatarBroken(id: string): void {
    brokenAvatars = new Set(brokenAvatars).add(id);
  }

  function measureRailEdges(): void {
    if (!railElement) return;
    railAtTop = railElement.scrollTop <= 1;
    railAtBottom =
      railElement.scrollHeight - railElement.scrollTop - railElement.clientHeight <= 1;
  }

  function pickPlatform(platform: string, ids: string[]): void {
    if (broadcastCreateOpen) closeBroadcastPicker();
    if (ids.length > 1 && railCompact) {
      const current = source?.kind === 'platform' && source.platform === platform
        ? source.account
        : undefined;
      selectPlatform(platform, current && ids.includes(current) ? current : ids[0]);
    }
    else if (ids.length > 1) toggleGroup(`platform:${platform}`);
    else selectPlatform(platform, ids[0]);
  }

  function pickMail(): void {
    if (broadcastCreateOpen) closeBroadcastPicker();
    if (accounts.length > 1 && railCompact) {
      const current = source?.kind === 'mail' ? source.account : undefined;
      void selectMail(current && accounts.some((account) => account.id === current) ? current : accounts[0].id);
    }
    else if (accounts.length > 1) toggleGroup('mail');
    else if (accounts[0]) void selectMail(accounts[0].id);
  }

  /**
   * What has already been fetched for a mailbox, so opening one is instant
   * rather than a wait. Filled in the background once the hub knows which
   * accounts exist, and kept up to date by whatever the list loads afterwards.
   */
  const mailCache = session.mailboxes;
  /** Map mutations are invisible to Svelte; this makes newly warmed inboxes
   * participate in the combined list immediately. */
  let mailCacheRevision = 0;

  /** One recency-ordered overview assembled from the same chat rows and cached
   * inbox pages the source-specific lists use. */
  $: unifiedRows = mailCacheRevision >= 0 && source?.kind === 'all'
    ? [
        ...spaceRootChats(chats)
          .filter((chat) => !chatPrefs.hidden.includes(chat.id) || activeChat?.id === chat.id)
          .map((chat): UnifiedRow => ({kind: 'chat', at: chat.lastActivity ?? '', chat})),
        ...[...mailCache.entries()].flatMap(([key, mailbox]) => {
          const split = key.indexOf('|');
          const account = key.slice(0, split);
          const folder = key.slice(split + 1);
          return mailbox.envelopes.map((envelope): UnifiedRow => ({
            kind: 'mail', at: envelope.date, account, folder, envelope,
          }));
        }),
      ]
        .filter((row) => {
          const needle = chatSearch.trim().toLowerCase();
          if (!needle) return true;
          return row.kind === 'chat'
            ? row.chat.name.toLowerCase().includes(needle) || (row.chat.preview ?? '').toLowerCase().includes(needle)
            : sender(row.envelope).toLowerCase().includes(needle) ||
                row.envelope.subject.toLowerCase().includes(needle) ||
                (row.envelope.preview ?? '').toLowerCase().includes(needle);
        })
        .filter((row) => matchesConversationFilter(
          row.kind === 'chat' ? chatUnread(row.chat) : Number(!row.envelope.seen),
          conversationFilter,
        ))
        .sort((left, right) => compareUnifiedRows(left, right, conversationSort))
    : [];

  function compareUnifiedRows(
    a: UnifiedRow,
    b: UnifiedRow,
    activitySort: ConversationListSort,
  ): number {
    const pinnedA = a.kind === 'chat' ? chatPrefs.pinned.indexOf(a.chat.id) : -1;
    const pinnedB = b.kind === 'chat' ? chatPrefs.pinned.indexOf(b.chat.id) : -1;
    if (pinnedA >= 0 || pinnedB >= 0) {
      if (pinnedA < 0) return 1;
      if (pinnedB < 0) return -1;
      return pinnedA - pinnedB;
    }
    return compareConversationActivity(a.at, b.at, activitySort);
  }

  function cacheKey(account: string, folder: string): string {
    return `${account}|${folder}`;
  }

  /**
   * Pulls each account's inbox in the background, one at a time so a machine
   * with ten mailboxes does not open ten IMAP connections at once. Failures are
   * silent: this is work done ahead of being asked for, and the real fetch on
   * click reports anything genuinely wrong.
   */
  async function prefetchMail(): Promise<void> {
    for (const account of status?.email.accounts ?? []) {
      if (source?.kind === 'mail' && source.account === account.id) continue;
      try {
        const list = await api.comms.mailFolders(account.id);
        const inbox = list.find((item) => item.role === 'inbox')?.name ?? list[0]?.name ?? 'INBOX';
        const batch = await api.comms.mailEnvelopes({
          account: account.id,
          folder: inbox,
          page: 1,
          pageSize: PAGE_SIZE,
          sort: 'date-desc',
        });
        mailCache.set(cacheKey(account.id, inbox), {
          folders: list,
          envelopes: batch,
          page: 1,
          moreToLoad: batch.length === PAGE_SIZE,
        });
        mailCacheRevision += 1;
      } catch {
        // Nothing to report: the mailbox is simply not warmed.
      }
    }
  }

  async function selectMail(account: string, folder?: string): Promise<void> {
    if (newChatOpen) closeNewChatPicker();
    if (broadcastCreateOpen) closeBroadcastPicker();
    leaveMailComposer();
    openMail = null;
    openEnvelope = null;
    activeChat = null;
    activeBroadcast = null;
    broadcastMessages = [];
    const switching = !source || source.kind !== 'mail' || source.account !== account;
    // Commit to the mailbox before fetching it, so the list keeps its header —
    // picker, search, compose — while the folders load rather than dropping
    // back to the placeholder pane and rebuilding it a moment later.
    if (switching) folders = [];
    // The rows on screen belong to the folder being left; keeping them under
    // the new folder's name would misreport what is in it.
    envelopes = [];
    search = '';
    rowsScrolled = false;
    source = {kind: 'mail', account, folder: folder ?? 'INBOX'};
    // A mailbox warmed in the background paints now; only one that was never
    // reached has to be waited for.
    const warmed = warmMailbox(account, folder);
    busy = warmed ? '' : 'folders';
    try {
      if (folders.length === 0) folders = await api.comms.mailFolders(account);
      const target =
        folder ?? folders.find((item) => item.role === 'inbox')?.name ?? folders[0]?.name ?? 'INBOX';
      source = {kind: 'mail', account, folder: target};
      // Warmed rows are already on screen; the fetch behind them only replaces
      // what changed, so the list does not blink back to empty.
      if (warmed) await refreshEnvelopes();
      else await loadEnvelopes();
      restoreMailComposer(account);
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /** Paints a prefetched mailbox, and says whether there was one. */
  function warmMailbox(account: string, folder?: string): boolean {
    for (const [key, entry] of mailCache) {
      const [cachedAccount, cachedFolder] = key.split('|');
      if (cachedAccount !== account) continue;
      if (folder && cachedFolder !== folder) continue;
      folders = entry.folders;
      envelopes = entry.envelopes;
      page = entry.page;
      moreToLoad = entry.moreToLoad;
      selected = new Set();
      source = {kind: 'mail', account, folder: cachedFolder};
      return true;
    }
    return false;
  }

  // Guards overlapping list fetches (search vs. sort change): only the most
  // recently started request may write the results, same as readMail's guard.
  let envelopeFetch = 0;

  async function loadEnvelopes(more = false): Promise<void> {
    if (!source || source.kind !== 'mail') return;
    const wanted = more ? page + 1 : 1;
    const fetchId = ++envelopeFetch;
    busy = more ? 'more' : 'envelopes';
    try {
      const batch = await api.comms.mailEnvelopes({
        account: source.account,
        folder: source.folder,
        page: wanted,
        pageSize: PAGE_SIZE,
        sort,
        query: search.trim() || undefined,
      });
      if (fetchId !== envelopeFetch) return;
      // A short page is the end of the folder; a full one may not be.
      moreToLoad = batch.length === PAGE_SIZE;
      page = wanted;
      envelopes = more ? [...envelopes, ...batch] : batch;
      if (!more) selected = new Set();
      rememberMailbox();
      error = '';
      if (!more) void prefetchMailBodies();
    } catch (cause) {
      if (fetchId !== envelopeFetch) return;
      error = readableError(cause);
      if (!more) envelopes = [];
    } finally {
      busy = '';
    }
  }

  /** The message list's scroller, so reaching its end pulls the next page. */
  let rowsEl: HTMLUListElement | null = null;

  /** Whether the list has been scrolled far enough to offer a way back up. */
  let rowsScrolled = false;

  function scrollRowsToTop(): void {
    rowsEl?.scrollTo({top: 0, behavior: 'smooth'});
  }

  function onRowsScroll(): void {
    if (!rowsEl) return;
    rowsScrolled = rowsEl.scrollTop > 400;
    if (!moreToLoad || busy === 'more' || busy === 'envelopes') return;
    const fromEnd = rowsEl.scrollHeight - rowsEl.clientHeight - rowsEl.scrollTop;
    if (fromEnd < 240) void loadEnvelopes(true);
  }

  /**
   * Mail that landed since the list was drawn. The first page is re-read and
   * merged in at the top; the pages already scrolled past keep their place,
   * which a plain reload would throw away.
   */
  async function refreshEnvelopes(): Promise<void> {
    if (!source || source.kind !== 'mail' || busy) return;
    const mailbox = source;
    const fetchId = ++envelopeFetch;
    try {
      const batch = await api.comms.mailEnvelopes({
        account: mailbox.account,
        folder: mailbox.folder,
        page: 1,
        pageSize: PAGE_SIZE,
        sort,
        query: search.trim() || undefined,
      });
      if (fetchId !== envelopeFetch) return;
      if (source.kind !== 'mail' || source.account !== mailbox.account || source.folder !== mailbox.folder)
        return;
      const byId = new Map(batch.map((item) => [item.id, item]));
      // The fresh copy wins for anything the first page still covers — that is
      // how a message read or flagged on the phone stops looking unread here.
      const rest = envelopes.filter((item) => !byId.has(item.id));
      envelopes = [...batch, ...rest];
      rememberMailbox();
    } catch {
      // Same as the chat poll: a missed refresh is not an error worth showing.
    }
  }

  /** Keeps the warm copy of the open mailbox in step with what is on screen. */
  function rememberMailbox(): void {
    if (!source || source.kind !== 'mail' || search.trim()) return;
    mailCache.set(cacheKey(source.account, source.folder), {folders, envelopes, page, moreToLoad});
  }

  /**
   * Live-ish updates. The main process pushes bridge state, not traffic, so
   * new messages are found by asking — on a timer while the window has focus,
   * and once more the moment it regains it after being away.
   */
  const REFRESH_MS = 20_000;

  async function refreshOpen(): Promise<void> {
    if (typeof document !== 'undefined' && document.hidden) return;
    await Promise.all([refreshSources(), refreshContactLinks()]);
    if (activeChat) {
      // A read or "mark unread" performed in the native app changes bridge
      // state without adding a Matrix timeline event. Keep the list polling
      // while its reader is open, or the visible badge can stay stale forever.
      await Promise.all([refreshChats(), refreshChat()]);
    }
    else if (source?.kind === 'all') {
      await refreshChats();
      await prefetchMail();
    }
    else if (source?.kind === 'mail') await refreshEnvelopes();
    else if (source?.kind === 'broadcasts') {
      await refreshBroadcasts();
      if (activeBroadcast) await refreshBroadcastMessages(activeBroadcast.id);
    }
    else if (source?.kind === 'platform' || source?.kind === 'contacts') await refreshChats();
  }

  /**
   * The rail itself. A platform can arrive without anyone linking it here —
   * WeChat comes up as a relay against the app on this Mac, and reading the
   * status is what starts it — so a rail that only ever reflects the status
   * this mount opened with leaves a working platform off the list until the
   * tab is left and come back to.
   */
  async function refreshSources(): Promise<void> {
    try {
      acceptStatus(await api.comms.status());
    } catch {
      // Quiet, for the same reason as the other polls.
    }
  }

  /** Contact identities are local shared state, so a merge in another Hub
   * window must reach this one without requiring a remount. */
  async function refreshContactLinks(): Promise<void> {
    try {
      contactLinks = await api.comms.contactLinks();
      session.contactLinks = contactLinks;
    } catch {
      // Keep the last complete identity map during a transient IPC failure.
    }
  }

  /** The conversation list's own unread counts and previews. */
  async function refreshChats(): Promise<void> {
    try {
      chats = await api.comms.chats();
      rememberChatPlatforms(chats);
      session.chats = chats;
    } catch {
      // Quiet, for the same reason as the other polls.
    }
  }

  async function refreshBroadcasts(): Promise<void> {
    try {
      broadcasts = await api.comms.broadcasts();
      session.broadcasts = broadcasts;
      if (activeBroadcast) {
        activeBroadcast = broadcasts.find((item) => item.id === activeBroadcast?.id) ?? null;
      }
    } catch {
      // Local storage will be asked again on the next refresh.
    }
  }

  async function refreshBroadcastMessages(id: string): Promise<void> {
    try {
      const messages = await api.comms.broadcastMessages(id);
      if (activeBroadcast?.id !== id) return;
      broadcastMessages = messages;
      session.broadcastMessages.set(id, messages);
    } catch {
      // Keep the last local copy on screen.
    }
  }

  /**
   * The conversation a message belongs to: everything in this folder carrying
   * the same subject once Re:/Fwd: are stripped. IMAP threading proper needs
   * References on every envelope, which the list does not carry, so the
   * subject is how the members are found.
   *
   * Finding them is not the same as there being a conversation, though. Twenty
   * three notifications all titled "Security alert" share a subject and answer
   * nothing; listing them as a thread says the sender was talking to itself.
   * So a chain has to show evidence of a reply — a Re:/Fwd: among its members,
   * or one the user answered — before it is shown as one.
   */
  async function loadThread(envelope: MailEnvelopeDto): Promise<void> {
    if (!source || source.kind !== 'mail') return;
    const base = baseSubject(envelope.subject);
    thread = [];
    chainExpanded = false;
    if (!base) return;
    const found = await api.comms
      .mailEnvelopes({
        account: source.account,
        folder: source.folder,
        pageSize: 30,
        query: `subject "${base.replace(/"/g, '')}"`,
      })
      .catch(() => [] as MailEnvelopeDto[]);
    // A slower earlier click must not put its chain under a newer message.
    if (openEnvelope?.id !== envelope.id) return;
    const chain = found.filter((item) => baseSubject(item.subject) === base);
    const replied = chain.some((item) => REPLY_PREFIX.test(item.subject) || item.answered);
    thread = chain.length > 1 && replied ? chain : [];
  }

  /** A subject that answers or passes on another one. */
  const REPLY_PREFIX = /^\s*(re|fwd|fw)\s*:/i;

  /**
   * How many messages each conversation in this folder holds, keyed by the
   * subject its members share. Counted off the rows already listed rather than
   * asked of the server: the number is a hint on a row, and a round trip per
   * row to draw it would cost more than the hint is worth.
   *
   * Same rule as the reading pane's chain — a run of identically titled
   * notifications is not a conversation until something in it is a reply — so
   * a row's count and the chain it opens agree.
   */
  function chainSizes(list: MailEnvelopeDto[]): Map<string, number> {
    const groups = new Map<string, {count: number; replied: boolean}>();
    for (const item of list) {
      const base = baseSubject(item.subject);
      if (!base) continue;
      const found = groups.get(base) ?? {count: 0, replied: false};
      found.count++;
      found.replied ||= REPLY_PREFIX.test(item.subject) || item.answered;
      groups.set(base, found);
    }
    return new Map(
      [...groups].map(([base, found]) => [base, found.replied ? found.count : 1]),
    );
  }

  function baseSubject(subject: string): string {
    return subject.replace(/^\s*(re|fwd|fw)\s*:\s*/gi, '').trim().toLowerCase();
  }

  async function openChat(chat: ChatDto): Promise<void> {
    if (chat.space) {
      openSpace(chat);
      return;
    }
    closeChatSearch();
    closeChatHeaderMenu();
    profileOpen = false;
    profileMergeOpen = false;
    activeChat = chat;
    activeBroadcast = null;
    broadcastMessages = [];
    awayFromLatest = false;
    // A conversation read earlier in this session opens on what it said then,
    // including however far back it had been scrolled, and is corrected by the
    // read behind it. Only a conversation never opened waits.
    const known = session.messages.get(chat.id);
    chatMessages = known?.messages ?? [];
    chatBefore = known?.nextBefore ?? null;
    restoreChatComposer(chat.id);
    chatMembers = [];
    void api.comms.chatMembers(chat.id).then((members) => {
      if (activeChat?.id === chat.id) chatMembers = members;
    }).catch(() => {
      // Already-loaded messages remain a useful fallback for known Matrix ids.
    });
    busy = known ? '' : `chat:${chat.id}`;
    try {
      const page = await api.comms.chatMessages(chat.id, CHAT_PAGE);
      if (activeChat?.id !== chat.id) return;
      chatMessages = known ? mergeChatPage(known.messages, page.messages) : page.messages;
      chatBefore = known ? known.nextBefore : page.nextBefore;
      restoreChatReply(chat.id);
      rememberChat(chat.id);
      error = '';
      // Reading it is what makes it read — on the homeserver as well as here,
      // so the count clears on the phone too. The badge is cleared locally
      // rather than re-listing every room for one number.
      // The page arrives newest first, so the read marker is the head of it.
      const newest = chatMessages[0];
      if (newest && chatUnread(chat) > 0) {
        const marked = await api.comms.chatMarkRead(chat.id, newest.id).catch(() => false);
        if (marked)
          chats = chats.map((item) => (item.id === chat.id ? clearChatUnread(item) : item));
      }
    } catch (cause) {
      // A cached conversation stays on screen: it is what the room said a
      // moment ago, which beats an empty pane and an error.
      if (!known) chatMessages = [];
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /** Opens the identity sheet without pretending that reading a profile also
   * reads the conversation. From a thread, back returns to the thread; from
   * Contacts, back returns to the contact list. */
  async function openProfile(chat: ChatDto, returnsToChat: boolean): Promise<void> {
    if (chat.group || chat.space) return;
    activeChat = chat;
    activeBroadcast = null;
    profileOpen = true;
    profileReturnsToChat = returnsToChat;
    profileMergeOpen = false;
    profileMergeSelected = new Set();
    profileLoading = profileContacts.length === 0;
    try {
      profileContacts = await api.comms.chatContacts();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      profileLoading = false;
    }
  }

  function closeProfile(): void {
    profileMergeOpen = false;
    profileOpen = false;
    if (profileReturnsToChat) return;
    activeChat = null;
    chatMessages = [];
  }

  function startProfileMerge(): void {
    profileMergeName = profileName;
    profileMergeSelected = new Set(activeProfileChats.map((chat) => chat.id));
    profileMergeOpen = true;
  }

  function toggleProfileMergeChat(chat: ChatDto): void {
    const selected = new Set(profileMergeSelected);
    if (selected.has(chat.id)) selected.delete(chat.id);
    else selected.add(chat.id);
    profileMergeSelected = selected;
  }

  async function saveProfileMerge(): Promise<void> {
    const selected = profileMergeCandidates.filter((chat) => profileMergeSelected.has(chat.id));
    if (selected.length < 2) return;
    busy = 'contact-merge';
    try {
      await api.comms.contactLinkMerge({
        name: profileMergeName.trim() || profileName,
        members: selected.map(memberForChat),
      });
      contactLinks = await api.comms.contactLinks();
      session.contactLinks = contactLinks;
      profileMergeOpen = false;
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function removeProfileLink(): Promise<void> {
    if (!activeProfileLink) return;
    busy = 'contact-unmerge';
    try {
      await api.comms.contactLinkRemove(activeProfileLink.id);
      contactLinks = await api.comms.contactLinks();
      session.contactLinks = contactLinks;
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function messageProfileChat(chat: ChatDto): Promise<void> {
    profileOpen = false;
    profileMergeOpen = false;
    await openChat(chat);
  }

  async function openBroadcast(broadcast: BroadcastDto): Promise<void> {
    activeBroadcast = broadcast;
    activeChat = null;
    chatMessages = [];
    awayFromLatest = false;
    const known = session.broadcastMessages.get(broadcast.id);
    broadcastMessages = known ?? [];
    broadcastDraft = loadChatDraft(`broadcast:${broadcast.id}`).text;
    busy = known ? '' : `broadcast:${broadcast.id}`;
    try {
      const messages = await api.comms.broadcastMessages(broadcast.id);
      if (activeBroadcast?.id !== broadcast.id) return;
      broadcastMessages = messages;
      session.broadcastMessages.set(broadcast.id, messages);
      error = '';
    } catch (cause) {
      if (!known) broadcastMessages = [];
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  function rememberChat(chatId: string): void {
    session.messages.set(chatId, {messages: chatMessages, nextBefore: chatBefore});
  }

  /**
   * Whether this message begins a run from one person. The thread is newest
   * first, so the message above it is the next in the array; a name repeated
   * over every bubble of someone's five-message burst is noise, and every
   * messenger names the first and lets the rest follow.
   */
  function startsSenderRun(index: number): boolean {
    const message = chatMessages[index];
    const above = chatMessages[index + 1];
    if (!message) return false;
    // A stamp between them starts a new run whoever sent it.
    return !above || above.sender !== message.sender || startsRun(index);
  }

  /**
   * Consecutive messages from one sender share one hover target and one header.
   * The source list is newest first, matching the thread's column-reverse
   * layout; each run keeps that order and records its oldest, visually first
   * message for the identity and time above it.
   */
  function messageTimeline(messages: ChatMessageDto[]): ChatTimelineItem[] {
    const items: ChatTimelineItem[] = [];
    let index = 0;
    while (index < messages.length) {
      const message = messages[index]!;
      if (message.notice) {
        items.push({kind: 'notice', key: `notice:${message.id}`, entry: {message, index}});
        index += 1;
        continue;
      }

      const entries: ChatTimelineEntry[] = [];
      while (index < messages.length) {
        const current = messages[index]!;
        if (current.notice || (entries.length > 0 && current.sender !== message.sender)) break;
        entries.push({message: current, index});
        const closesRun = startsSenderRun(index) || messages[index + 1]?.notice;
        index += 1;
        if (closesRun) break;
      }
      const oldestIndex = entries[entries.length - 1]!.index;
      items.push({
        kind: 'sender-run',
        key: `sender-run:${entries[entries.length - 1]!.message.id}`,
        entries,
        oldestIndex,
      });
    }
    return items;
  }

  $: chatTimeline = messageTimeline(chatMessages);

  /**
   * The name to put over a message. Falls back to the local part of the
   * sender id, so a bridge that never resolved a profile still shows
   * something a person can tell apart rather than a full `@id:server`.
   */
  function senderLabel(message: ChatMessageDto): string {
    return chatSenderLabel(message, activeChat);
  }

  /**
   * The page before the one on screen. The thread is `column-reverse`, so
   * older messages append to the end of the array and the browser holds the
   * reader's place for them — nothing has to be measured or restored.
   */
  async function loadOlderChat(): Promise<void> {
    if (!activeChat || !chatBefore || busy === 'chat-older') return;
    const chatId = activeChat.id;
    const from = chatBefore;
    busy = 'chat-older';
    try {
      const page = await api.comms.chatMessages(chatId, CHAT_PAGE, from);
      if (activeChat?.id !== chatId || chatBefore !== from) return;
      const known = new Set(chatMessages.map((item) => item.id));
      chatMessages = [...chatMessages, ...page.messages.filter((item) => !known.has(item.id))];
      if (activeChat) rememberChat(activeChat.id);
      // A page that adds nothing new is the end of what the bridge backfilled;
      // trusting only the token would spin on it forever.
      chatBefore = page.messages.length === 0 ? null : page.nextBefore;
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /** Whether the thread has been scrolled up far enough to offer a way back. */
  let awayFromLatest = false;
  /** The reply target currently receiving its short arrival pulse. */
  let replyTargetHighlight = '';
  let replyTargetHighlightTimer: ReturnType<typeof setTimeout> | null = null;
  /** Invalidates an older scroll watcher when another reply target is chosen. */
  let replyScrollToken = 0;

  function scrollToLatest(): void {
    // `column-reverse` puts the newest message at offset zero.
    threadEl?.scrollTo({top: 0, behavior: 'smooth'});
  }

  /** Returns from the composer preview to the message being answered. */
  function scrollToChatMessage(messageId: string): void {
    if (!threadEl) return;
    const target = [...threadEl.querySelectorAll<HTMLElement>('[data-message-id]')]
      .find((item) => item.dataset.messageId === messageId);
    if (!target) return;
    const scroller = threadEl;
    const token = ++replyScrollToken;
    replyTargetHighlight = '';
    if (replyTargetHighlightTimer) clearTimeout(replyTargetHighlightTimer);
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    });
    waitForReplyScroll(scroller, messageId, token);
  }

  /** Waits for the native smooth scroll to settle before identifying the
   * destination. Watching the scroller works for both motion preferences and
   * does not guess how long Chromium will make a particular journey. */
  function waitForReplyScroll(scroller: HTMLElement, messageId: string, token: number): void {
    let lastTop = scroller.scrollTop;
    let stableFrames = 0;
    const startedAt = performance.now();
    const watch = (): void => {
      if (token !== replyScrollToken || threadEl !== scroller || !scroller.isConnected) return;
      const currentTop = scroller.scrollTop;
      if (Math.abs(currentTop - lastTop) < 0.5) stableFrames += 1;
      else {
        lastTop = currentTop;
        stableFrames = 0;
      }
      const elapsed = performance.now() - startedAt;
      if ((elapsed >= 120 && stableFrames >= 4) || elapsed >= 1_500) {
        void highlightReplyTarget(messageId, token);
        return;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }

  /** Restarts the pulse even when the same reply pill is clicked twice. */
  async function highlightReplyTarget(messageId: string, token: number): Promise<void> {
    replyTargetHighlight = '';
    await tick();
    if (token !== replyScrollToken) return;
    replyTargetHighlight = messageId;
    replyTargetHighlightTimer = setTimeout(() => {
      if (replyTargetHighlight === messageId) replyTargetHighlight = '';
      replyTargetHighlightTimer = null;
    }, 1_300);
  }

  function onThreadScroll(): void {
    if (!threadEl) return;
    // The menu is pinned to the viewport, so scrolling the thread out from
    // under it would leave it pointing at the wrong message.
    if (messageMenu) closeMessageMenu();
    awayFromLatest = Math.abs(threadEl.scrollTop) > 240;
    if (!chatBefore) return;
    // `column-reverse` puts the newest at scrollTop 0 and counts away from it;
    // the sign of that offset differs by engine, so distance is what is read.
    const fromTop = threadEl.scrollHeight - threadEl.clientHeight - Math.abs(threadEl.scrollTop);
    if (fromTop < 240) void loadOlderChat();
  }

  /** Newly arrived messages and relation changes in the open conversation. */
  async function refreshChat(): Promise<void> {
    if (!activeChat || busy) return;
    const chatId = activeChat.id;
    try {
      // Refresh the whole span already on screen. Reactions and redactions are
      // room activity even when their target is far behind the newest twenty
      // messages, so a head-only merge leaves an old visible bubble stale.
      const page = await api.comms.chatMessages(
        chatId,
        Math.max(20, Math.min(1_000, chatMessages.length)),
      );
      if (activeChat?.id !== chatId) return;
      const known = new Set(chatMessages.map((item) => item.id));
      const fresh = page.messages.filter((item) => !known.has(item.id));
      chatMessages = mergeChatPage(chatMessages, page.messages);
      if (chatSearchOpen) chatSearchMessages = mergeChatPage(chatSearchMessages, page.messages);
      if (activeChat) rememberChat(activeChat.id);
      const newest = fresh[0];
      if (newest) await api.comms.chatMarkRead(chatId, newest.id).catch(() => {});
    } catch {
      // A failed poll is not worth a banner; the next one takes its place.
    }
  }

  /** Opens a conversation-local content browser. The first paint uses the
   * messages already on screen, then older pages join it quietly until the
   * bridge says the room's start has been reached. */
  async function openChatSearch(): Promise<void> {
    if (!activeChat || busy.startsWith('chat:')) return;
    closeChatHeaderMenu();
    const chatId = activeChat.id;
    chatSearchOpen = true;
    chatSearchQuery = '';
    chatSearchFilter = 'all';
    chatSearchMessages = [...chatMessages];
    chatSearchBefore = chatBefore;
    const token = ++chatSearchToken;
    await tick();
    chatSearchInput?.focus();
    void loadChatSearchHistory(chatId, token);
  }

  function closeChatSearch(): void {
    chatSearchOpen = false;
    chatSearchQuery = '';
    chatSearchFilter = 'all';
    chatSearchLoading = false;
    chatSearchToken += 1;
  }

  async function toggleChatHeaderMenu(): Promise<void> {
    if (chatHeaderMenuOpen) {
      closeChatHeaderMenu();
      return;
    }
    closeMessageMenu();
    closeChatMenu();
    composerToolsOpen = false;
    composerEmojiOpen = false;
    chatHeaderMenuOpen = true;
    await tick();
    chatHeaderMenu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }

  function closeChatHeaderMenu(): void {
    chatHeaderMenuOpen = false;
  }

  async function loadChatSearchHistory(chatId: string, token: number): Promise<void> {
    if (!chatSearchBefore || token !== chatSearchToken || activeChat?.id !== chatId || !chatSearchOpen) return;
    chatSearchLoading = true;
    try {
      while (chatSearchBefore && token === chatSearchToken && activeChat?.id === chatId) {
        const before: string = chatSearchBefore;
        const page = await api.comms.chatMessages(chatId, CHAT_SEARCH_PAGE, before);
        if (token !== chatSearchToken || activeChat?.id !== chatId) return;
        const known = new Set(chatSearchMessages.map((item) => item.id));
        const older = page.messages.filter((item) => !known.has(item.id));
        chatSearchMessages = [...chatSearchMessages, ...older];
        chatSearchBefore = page.messages.length === 0 || !page.nextBefore || page.nextBefore === before
          ? null
          : page.nextBefore;
      }
    } catch (cause) {
      if (token === chatSearchToken && activeChat?.id === chatId) error = readableError(cause);
    } finally {
      if (token === chatSearchToken) chatSearchLoading = false;
    }
  }

  /** A result is useful in context. Keep everything search fetched, return to
   * the thread, then identify the exact bubble after Svelte has painted it. */
  async function revealChatSearchResult(result: ChatSearchResult): Promise<void> {
    if (!activeChat) return;
    chatMessages = [...chatSearchMessages];
    chatBefore = chatSearchBefore;
    rememberChat(activeChat.id);
    closeChatSearch();
    await tick();
    scrollToChatMessage(result.message.id);
  }

  function chatSearchResultIcon(result: ChatSearchResult): IconName {
    if (result.kind === 'message') return 'chat';
    if (result.kind === 'link') return 'link';
    if (result.kind === 'file') return 'file';
    const kind = result.attachment ? attachmentRenderKind(result.attachment) : 'image';
    return kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : 'image';
  }

  function persistChatComposer(): void {
    if (!activeChat) return;
    saveChatDraft(activeChat.id, {
      text: draft,
      replyTo: replyTo?.id ?? null,
      files: [...chatFiles],
    });
  }

  function chatComposerChanged(event: Event): void {
    updateComposerCursor(event);
    // Returning to the draft is allowed while browsing emoji; entering the
    // first character commits that return and clears every composer popover.
    composerToolsOpen = false;
    composerEmojiOpen = false;
    void tick().then(persistChatComposer);
  }

  function restoreChatComposer(chatId: string): void {
    const saved = loadChatDraft(chatId);
    draft = saved.text;
    chatFiles = [...saved.files];
    composerCursor = draft.length;
    replyTo = saved.replyTo
      ? (chatMessages.find((message) => message.id === saved.replyTo) ?? null)
      : null;
  }

  /** The first cached paint may not include the message being answered. Try
   * again after the fresh page arrives without changing the recovered text. */
  function restoreChatReply(chatId: string): void {
    const saved = loadChatDraft(chatId);
    replyTo = saved.replyTo
      ? (chatMessages.find((message) => message.id === saved.replyTo) ?? null)
      : null;
  }

  async function sendChat(): Promise<void> {
    const text = draft.trim();
    const files = [...chatFiles];
    if (!activeChat || (!text && files.length === 0)) return;
    composerToolsOpen = false;
    composerEmojiOpen = false;
    busy = 'send-chat';
    const chatId = activeChat.id;
    const answering = replyTo?.id;
    let sentFiles = false;
    try {
      if (files.length > 0) {
        await api.comms.chatSendFiles(chatId, files);
        chatFiles = [];
        sentFiles = true;
      }
      if (text) {
        const mentions = mentionsInDraft(text, composerMembers, activeChat.group === true);
        const sent = await api.comms.chatSend(chatId, text, answering, mentions);
        chatMessages = [sent, ...chatMessages];
        if (activeChat) rememberChat(activeChat.id);
        draft = '';
        composerCursor = 0;
        replyTo = null;
      }
      saveChatDraft(chatId, {text: draft, replyTo: replyTo?.id ?? null, files: [...chatFiles]});
      error = '';
    } catch (cause) {
      saveChatDraft(chatId, {text: draft, replyTo: replyTo?.id ?? null, files: [...chatFiles]});
      error = readableError(cause);
    } finally {
      busy = '';
    }
    if (sentFiles) await refreshChat();
  }

  function broadcastComposerChanged(): void {
    if (!activeBroadcast) return;
    saveChatDraft(`broadcast:${activeBroadcast.id}`, {
      text: broadcastDraft,
      replyTo: null,
      files: [],
    });
  }

  async function sendBroadcast(): Promise<void> {
    const text = broadcastDraft.trim();
    if (!activeBroadcast || !text || busy === 'send-broadcast') return;
    const broadcastId = activeBroadcast.id;
    busy = 'send-broadcast';
    try {
      const result = await api.comms.broadcastSend(broadcastId, text);
      activeBroadcast = result.broadcast;
      broadcasts = [result.broadcast, ...broadcasts.filter((item) => item.id !== broadcastId)];
      broadcastMessages = [result.message, ...broadcastMessages];
      session.broadcasts = broadcasts;
      session.broadcastMessages.set(broadcastId, broadcastMessages);
      broadcastDraft = '';
      broadcastComposerChanged();
      const failed = result.message.deliveries.filter((delivery) => delivery.status === 'failed');
      error = failed.length > 0
        ? $t('hub.broadcastPartialFailure', {count: failed.length})
        : '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  // ---- message actions ----------------------------------------------------

  /**
   * The actions offered on a message are the ones every network in the hub
   * carries: an emoji on it, an answer to it, and its text on the clipboard.
   * Anything one platform has and the others do not would be a button that
   * fails on most of the list, so it is not offered.
   */
  const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '🙏'];

  /** The message the composer is answering, if any. */
  let replyTo: ChatMessageDto | null = null;
  /** Which message has its emoji row open. */
  let reactingTo = '';
  /** Whether the quick strip has expanded into the compact searchable grid. */
  let reactionPickerOpen = false;
  /** The extension normally grows above the fixed quick strip, like the
   * reference. Near the top edge it grows below the unchanged menu instead. */
  let reactionPickerDirection: 'above' | 'below' = 'above';
  /**
   * The message actions, as a context menu rather than a row of icons under
   * every bubble: they are occasional, and a permanent row of them competes
   * with the conversation it is attached to. The anchor stays at the click
   * while `x`/`y` may move as an expanding menu is placed around it.
   */
  let messageMenu: {
    message: ChatMessageDto;
    anchorX: number;
    anchorY: number;
    x: number;
    y: number;
    placed?: boolean;
  } | null = null;
  let messageMenuEl: HTMLDivElement | undefined;
  /** When the picker grows upward, anchor the real menu by its bottom edge.
   * Its contents then stay physically still while only its top edge moves. */
  let messageMenuBottom: number | null = null;

  /**
   * The chat row's own actions, opened the same way and drawn from the same
   * styles as the message menu: pinning and hiding are occasional enough that a
   * permanent control on every row would cost more than it gives.
   */
  let chatMenu: {chat: ChatDto; x: number; y: number; placed?: boolean} | null = null;
  let chatMenuEl: HTMLDivElement | undefined;
  /** Which chats are pinned or hidden, remembered between runs. */
  let chatPrefs = loadChatPrefs();
  /** Whether the hidden group at the foot of the list is expanded. */
  let hiddenOpen = false;

  function openChatMenu(event: MouseEvent, chat: ChatDto): void {
    event.preventDefault();
    closeMessageMenu();
    chatMenu = {chat, x: event.clientX, y: event.clientY};
    void tick().then(() => {
      if (!chatMenu || !chatMenuEl) return;
      chatMenu = {...chatMenu, ...placeMenu(chatMenu.x, chatMenu.y, chatMenuEl), placed: true};
    });
  }

  function closeChatMenu(): void {
    chatMenu = null;
  }

  function openMessageMenu(event: MouseEvent, message: ChatMessageDto): void {
    event.preventDefault();
    reactingTo = '';
    reactionPickerOpen = false;
    messageMenuBottom = null;
    messageMenu = {
      message,
      anchorX: event.clientX,
      anchorY: event.clientY,
      x: event.clientX,
      y: event.clientY,
    };
    void tick().then(clampMessageMenu);
  }

  /**
   * Where a menu opened at `x`/`y` actually goes.
   *
   * A menu opens down and to the right of the pointer, which is where one is
   * expected. When there is no room for it there it flips to the other side of
   * the same point — up, or to the left — rather than sliding along the edge:
   * a menu that has slid is still under the pointer but no longer says which
   * row it belongs to, and one that has flipped says it exactly. Sliding is
   * what is left when neither side fits, which only happens on a window
   * shorter than the menu.
   */
  function placeMenu(
    x: number,
    y: number,
    element: HTMLElement,
    currentX = x,
    currentY = y,
  ): {x: number; y: number} {
    const rect = element.getBoundingClientRect();
    const margin = 8;
    // `position: fixed` is not always relative to the viewport: an ancestor
    // that establishes a containing block — `.hub-view` does, through
    // `container-type` — makes the coordinates relative to itself instead, and
    // a menu placed at the pointer's viewport coordinates then opens that far
    // down and to the right of it, running off the window near an edge. Rather
    // than name the ancestor, measure it: the gap between where the menu was
    // asked to sit and where it actually landed is that origin, whatever
    // produced it, and is zero when there is none.
    const originX = rect.left - currentX;
    const originY = rect.top - currentY;
    const flippedX = x + rect.width > window.innerWidth - margin ? x - rect.width : x;
    const flippedY = y + rect.height > window.innerHeight - margin ? y - rect.height : y;
    return {
      x: Math.max(margin, Math.min(flippedX, window.innerWidth - rect.width - margin)) - originX,
      y: Math.max(margin, Math.min(flippedY, window.innerHeight - rect.height - margin)) - originY,
    };
  }

  /** Keeps the menu on screen when the click lands near an edge — a menu that
   * opens half outside the window is worse than one on the other side of the
   * pointer. */
  function clampMessageMenu(): void {
    if (!messageMenu || !messageMenuEl) return;
    messageMenu = {
      ...messageMenu,
      ...placeMenu(
        messageMenu.anchorX,
        messageMenu.anchorY,
        messageMenuEl,
        messageMenu.x,
        messageMenu.y,
      ),
      placed: true,
    };
  }

  function closeMessageMenu(): void {
    messageMenu = null;
    reactingTo = '';
    reactionPickerOpen = false;
    messageMenuBottom = null;
  }

  function toggleReactionPicker(): void {
    if (reactionPickerOpen) {
      reactionPickerOpen = false;
      return;
    }
    if (messageMenuEl) {
      const rect = messageMenuEl.getBoundingClientRect();
      const margin = 8;
      const pickerHeight = 168;
      const spaceAbove = rect.top - margin;
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      reactionPickerDirection = spaceAbove >= pickerHeight || spaceAbove >= spaceBelow
        ? 'above'
        : 'below';
      if (reactionPickerDirection === 'above') {
        const containingBlock = messageMenuEl.closest<HTMLElement>('.hub-view');
        messageMenuBottom = (containingBlock?.getBoundingClientRect().bottom ?? window.innerHeight)
          - rect.bottom;
      } else {
        messageMenuBottom = null;
      }
    }
    reactionPickerOpen = true;
  }

  function pickExpandedReaction(message: ChatMessageDto, key: string): void {
    void react(message, key);
    closeMessageMenu();
  }

  function startReply(message: ChatMessageDto): void {
    replyTo = message;
    reactingTo = '';
    persistChatComposer();
    composerInput?.focus();
  }

  function jumpToChatReply(): void {
    if (replyTo) scrollToChatMessage(replyTo.id);
  }

  function cancelChatReply(): void {
    replyTo = null;
    persistChatComposer();
  }

  async function copyMessage(message: ChatMessageDto): Promise<void> {
    const content = chatClipboardContent(message);
    if (!content) return;
    if (!await api.clipboard.write(content)) error = translate('common.copyFailed');
  }

  async function recallMessage(message: ChatMessageDto): Promise<void> {
    if (!activeChat || activeChat.platform !== 'wechat' || !message.mine) return;
    const chatId = activeChat.id;
    closeMessageMenu();
    busy = `recall:${message.id}`;
    try {
      await api.comms.chatRecall(chatId, message.id);
      chatMessages = chatMessages.filter((item) => item.id !== message.id);
      session.messages.set(chatId, {messages: chatMessages, nextBefore: chatBefore});
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /**
   * Adds the emoji, or takes it back when it is already ours — the same tap
   * doing both, as every messenger behaves. The bubble is updated first so the
   * reaction lands under the pointer rather than a round trip later.
   */
  async function react(message: ChatMessageDto, key: string): Promise<void> {
    // WeChat exposes no reaction write route. A local-only reaction looks
    // delivered while the other person never receives it, which is worse than
    // leaving the unsupported action out of this platform's menu.
    if (!activeChat || activeChat.platform === 'wechat') return;
    const chatId = activeChat.id;
    const previousReactions = message.reactions ?? [];
    const existing = previousReactions.find((item) => item.key === key);
    reactingTo = '';
    const mineEventId = existing?.mineEventId ?? null;
    updateMessage(message.id, (item) => ({
      ...item,
      reactions: applyReaction(item.reactions ?? [], key, mineEventId ? null : 'pending'),
    }));
    try {
      if (mineEventId) {
        await api.comms.chatUnreact(chatId, mineEventId);
      } else {
        const id = await api.comms.chatReact(chatId, message.id, key);
        updateMessage(message.id, (item) => ({
          ...item,
          reactions: (item.reactions ?? []).map((entry) =>
            entry.key === key ? {...entry, mineEventId: id} : entry,
          ),
        }));
      }
    } catch (cause) {
      error = readableError(cause);
      // Put the bubble back the way it was rather than leaving a reaction that
      // only exists here.
      updateMessage(message.id, (item) => ({
        ...item,
        reactions: previousReactions,
      }));
    }
  }

  /** Adds or removes one emoji from a message's tally. */
  function applyReaction(
    reactions: ChatReactionDto[],
    key: string,
    mineEventId: string | null,
  ): ChatReactionDto[] {
    const existing = reactions.find((item) => item.key === key);
    const self = {id: '@polymux-self', name: 'You', avatarUrl: null, mine: true};
    if (!existing) return [...reactions, {key, count: 1, reactors: [self], mineEventId}];
    // Adding when it is already ours is the undo, and vice versa.
    const adding = !existing.mineEventId;
    const count = existing.count + (adding ? 1 : -1);
    if (count <= 0) return reactions.filter((item) => item.key !== key);
    return reactions.map((item) =>
      item.key === key
        ? {
            ...item,
            count,
            reactors: adding
              ? [...(item.reactors ?? []), self]
              : item.reactors?.filter((reactor) => !reactor.mine),
            mineEventId: adding ? mineEventId : null,
          }
        : item,
    );
  }

  function updateMessage(id: string, change: (message: ChatMessageDto) => ChatMessageDto): void {
    chatMessages = chatMessages.map((item) => (item.id === id ? change(item) : item));
  }

  /** The line quoted above a reply, when the message it answers is loaded. */
  function quoted(message: ChatMessageDto): ChatMessageDto | null {
    if (!message.replyTo) return null;
    return chatMessages.find((item) => item.id === message.replyTo) ?? null;
  }

  // ---- composer -----------------------------------------------------------

  let composerInput: HTMLTextAreaElement | null = null;
  let composerCursor = 0;
  let composerMembers: ChatMemberDto[] = [];
  let composerToken: ComposerToken | null = null;
  let composerSuggestions: ComposerSuggestion[] = [];
  let composerAutocompleteIndex = 0;
  let composerAutocompleteKey = '';
  let composerAutocompletePreviousKey = '';
  let composerAutocompleteDismissed = '';
  let composerAutocompleteOpen = false;
  let composerToolsMenu: HTMLDivElement | null = null;
  /** The add menu and searchable emoji grid belong to the chat that opened
   * them. Remembering that owner prevents either popover following the user
   * into another chat. */
  let composerToolsOpen = false;
  let composerEmojiOpen = false;
  let composerPopoverChatId = '';
  $: if ((composerToolsOpen || composerEmojiOpen) && activeChat?.id !== composerPopoverChatId) {
    composerToolsOpen = false;
    composerEmojiOpen = false;
  }
  $: composerMembers = mergeComposerMembers(chatMembers, chatMessages);
  $: composerToken = activeComposerToken(draft, composerCursor, activeChat?.platform ?? '');
  $: composerSuggestions = composerToken?.kind === 'mention'
    ? mentionSuggestions(composerToken, composerMembers, activeChat?.group === true)
    : composerToken?.kind === 'command'
      ? telegramCommandSuggestions(composerToken, chatMessages)
      : [];
  $: composerAutocompleteKey = composerToken
    ? `${activeChat?.id ?? ''}:${composerToken.kind}:${composerToken.start}:${composerToken.query}`
    : '';
  $: if (composerAutocompleteKey !== composerAutocompletePreviousKey) {
    composerAutocompletePreviousKey = composerAutocompleteKey;
    composerAutocompleteIndex = 0;
  }
  $: composerAutocompleteOpen = Boolean(
    composerAutocompleteKey &&
    composerAutocompleteKey !== composerAutocompleteDismissed &&
    composerSuggestions.length > 0,
  );

  function updateComposerCursor(event: Event): void {
    const input = event.currentTarget as HTMLTextAreaElement | null;
    composerCursor = input?.selectionStart ?? draft.length;
  }

  function chatComposerKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (composerAutocompleteOpen && composerSuggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        composerAutocompleteIndex = (
          composerAutocompleteIndex + direction + composerSuggestions.length
        ) % composerSuggestions.length;
        void tick().then(() => {
          document
            .getElementById(`hub-composer-suggestion-${composerAutocompleteIndex}`)
            ?.scrollIntoView({block: 'nearest'});
        });
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        chooseComposerSuggestion(composerSuggestions[composerAutocompleteIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        composerAutocompleteDismissed = composerAutocompleteKey;
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendChat();
    }
  }

  function chooseComposerSuggestion(suggestion: ComposerSuggestion | undefined): void {
    if (!suggestion || !composerToken) return;
    const replacement = replaceComposerToken(draft, composerToken, suggestion.value);
    draft = replacement.text;
    composerCursor = replacement.caret;
    composerAutocompleteDismissed = '';
    composerToolsOpen = false;
    composerEmojiOpen = false;
    persistChatComposer();
    void tick().then(() => {
      composerInput?.focus();
      composerInput?.setSelectionRange(replacement.caret, replacement.caret);
    });
  }

  async function toggleComposerTools(): Promise<void> {
    if (composerToolsOpen) {
      composerToolsOpen = false;
      return;
    }
    closeMessageMenu();
    closeChatMenu();
    composerPopoverChatId = activeChat?.id ?? '';
    composerEmojiOpen = false;
    composerToolsOpen = true;
    await tick();
    composerToolsMenu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }

  function openComposerEmojiPicker(): void {
    composerToolsOpen = false;
    composerEmojiOpen = true;
  }

  /** Inserts where typing would have continued, replacing a selected range and
   * restoring the caret after the picker hands focus back to the composer. */
  function insertComposerEmoji(emoji: string): void {
    const input = composerInput;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? start;
    draft = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    composerToolsOpen = false;
    composerEmojiOpen = false;
    persistChatComposer();
    void tick().then(() => {
      input?.focus();
      const caret = start + emoji.length;
      input?.setSelectionRange(caret, caret);
    });
  }

  function stageChatFiles(paths: string[]): void {
    const next = paths.filter((path) => path && !chatFiles.includes(path));
    if (next.length === 0) return;
    chatFiles = [...chatFiles, ...next];
    persistChatComposer();
  }

  function removeChatFile(path: string): void {
    chatFiles = chatFiles.filter((item) => item !== path);
    persistChatComposer();
  }

  function isChatFileDrag(event: DragEvent): boolean {
    return Boolean(activeChat) && voiceState === 'idle' &&
      (Array.from(event.dataTransfer?.types ?? []).includes('Files') || Boolean(event.dataTransfer?.files.length));
  }

  function chatDragEnter(event: DragEvent): void {
    if (!isChatFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    chatFileDragActive = true;
  }

  function chatDragOver(event: DragEvent): void {
    if (!isChatFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    chatFileDragActive = true;
  }

  function chatDragLeave(event: DragEvent): void {
    const target = event.currentTarget as HTMLElement;
    const related = event.relatedTarget;
    if (related instanceof Node && target.contains(related)) return;
    chatFileDragActive = false;
  }

  async function dropIntoChat(event: DragEvent): Promise<void> {
    if (!isChatFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    chatFileDragActive = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    try {
      stageChatFiles(await api.files.paths(files));
      error = '';
    } catch (cause) {
      error = readableError(cause);
    }
  }

  /** The recorder, while a voice note is being taken. */
  async function attachToChat(): Promise<void> {
    if (!activeChat) return;
    composerToolsOpen = false;
    composerEmojiOpen = false;
    busy = 'attach';
    try {
      stageChatFiles(await api.comms.chatPickFiles());
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function sendSticker(): Promise<void> {
    if (!activeChat || activeChat.platform !== 'wechat') return;
    const chatId = activeChat.id;
    composerToolsOpen = false;
    busy = 'sticker';
    try {
      const [file] = await api.comms.chatPickFiles();
      if (!file) return;
      await api.comms.chatSendSticker(chatId, file);
      await refreshChat();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /**
   * A voice note, recorded in place.
   *
   * Three states, the way every messenger does it: nothing (the composer is a
   * text field), recording (the field becomes a running meter), and paused
   * (the same meter, with the take playable before it is sent). Nothing
   * touches disk — the recording lives as blob parts until it is either sent
   * or thrown away.
   */
  type VoiceState = 'idle' | 'recording' | 'paused';
  let voiceState: VoiceState = 'idle';
  let recorder: MediaRecorder | null = null;
  let voiceStream: MediaStream | null = null;
  let voiceParts: Blob[] = [];
  /** Seconds recorded, counted while running rather than measured after. */
  let elapsed = 0;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  /** Loudness samples, oldest first, drawn as the bars across the field. */
  let levels: number[] = [];
  let meter: {context: AudioContext; analyser: AnalyserNode; timer: number} | null = null;
  /** The take so far, for playing back before sending. */
  let previewUrl = '';
  let previewing = false;
  let preview: HTMLAudioElement | null = null;
  /** How many bars the meter holds before the oldest scrolls off. */
  const METER_BARS = 56;

  function clockOf(seconds: number): string {
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  async function startVoice(): Promise<void> {
    if (!activeChat || voiceState !== 'idle') return;
    composerToolsOpen = false;
    composerEmojiOpen = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      const capture = new MediaRecorder(stream);
      voiceParts = [];
      capture.ondataavailable = (event) => {
        if (event.data.size > 0) voiceParts = [...voiceParts, event.data];
      };
      // A timeslice means parts accumulate as it runs, so a pause can offer
      // the take for playback without stopping the recorder.
      capture.start(1_000);
      recorder = capture;
      voiceStream = stream;
      voiceState = 'recording';
      elapsed = 0;
      levels = [];
      startClock();
      startMeter(stream);
      error = '';
    } catch (cause) {
      error = readableError(cause);
      await discardVoice();
    }
  }

  function startClock(): void {
    stopClock();
    elapsedTimer = setInterval(() => (elapsed += 0.1), 100);
  }

  function stopClock(): void {
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  /**
   * Samples how loud the microphone is, so the bars move with the voice rather
   * than animating on their own. Uses the time-domain signal: it is the level,
   * which is what a recording meter shows, not a spectrum.
   */
  function startMeter(stream: MediaStream): void {
    stopMeter();
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const timer = window.setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += (sample - 128) ** 2;
        const rms = Math.sqrt(sum / samples.length) / 128;
        const next = [...levels, Math.min(1, rms * 3)];
        levels = next.length > METER_BARS ? next.slice(next.length - METER_BARS) : next;
      }, 100);
      meter = {context, analyser, timer};
    } catch {
      // A meter is decoration; a recording without one still records.
    }
  }

  function stopMeter(): void {
    if (!meter) return;
    window.clearInterval(meter.timer);
    void meter.context.close().catch(() => {});
    meter = null;
  }

  /** Holds the take where it is, and makes it playable. */
  function pauseVoice(): void {
    if (voiceState !== 'recording' || !recorder) return;
    recorder.pause();
    stopClock();
    stopMeter();
    voiceState = 'paused';
    // Flushes what has been captured so far into a part, so the preview is the
    // whole take rather than everything bar the last second.
    recorder.requestData();
    setTimeout(() => {
      if (voiceState !== 'paused') return;
      revokePreview();
      previewUrl = URL.createObjectURL(new Blob(voiceParts, {type: recorder?.mimeType || 'audio/webm'}));
    }, 60);
  }

  function resumeVoice(): void {
    if (voiceState !== 'paused' || !recorder || !voiceStream) return;
    stopPreview();
    recorder.resume();
    startClock();
    startMeter(voiceStream);
    voiceState = 'recording';
  }

  function togglePreview(): void {
    if (!previewUrl) return;
    if (previewing) return stopPreview();
    preview = new Audio(previewUrl);
    preview.onended = () => (previewing = false);
    void preview.play().then(() => (previewing = true)).catch(() => (previewing = false));
  }

  function stopPreview(): void {
    preview?.pause();
    preview = null;
    previewing = false;
  }

  function revokePreview(): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
  }

  /** Throws the take away without sending it. */
  async function discardVoice(): Promise<void> {
    stopClock();
    stopMeter();
    stopPreview();
    revokePreview();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    voiceStream?.getTracks().forEach((track) => track.stop());
    recorder = null;
    voiceStream = null;
    voiceParts = [];
    voiceState = 'idle';
    elapsed = 0;
    levels = [];
  }

  /** Ends the take and sends it. */
  async function sendVoice(): Promise<void> {
    if (!activeChat || voiceState === 'idle' || !recorder) return;
    const chatId = activeChat.id;
    const platform = activeChat.platform;
    const capture = recorder;
    const type = capture.mimeType || 'audio/webm';
    stopClock();
    stopMeter();
    stopPreview();
    const finished = new Promise<void>((resolve) => {
      capture.onstop = () => resolve();
    });
    if (capture.state !== 'inactive') capture.stop();
    await finished;
    voiceStream?.getTracks().forEach((track) => track.stop());
    const blob = new Blob(voiceParts, {type});
    revokePreview();
    recorder = null;
    voiceStream = null;
    voiceParts = [];
    voiceState = 'idle';
    elapsed = 0;
    levels = [];
    if (blob.size === 0) return;
    busy = 'voice';
    try {
      const bytes = platform === 'wechat'
        ? await recordedVoiceWav(blob)
        : await blob.arrayBuffer();
      await api.comms.chatSendAudio(
        chatId,
        new Uint8Array(bytes),
        platform === 'wechat' ? 'audio/wav' : blob.type,
      );
      await refreshChat();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function readMail(envelope: MailEnvelopeDto): Promise<void> {
    if (!source || source.kind !== 'mail') return;
    // Switch to the reader straight away on what the list already knows —
    // sender, subject, date — and fill the body in when it arrives. Waiting on
    // the fetch before showing anything reads as a dead click.
    openEnvelope = envelope;
    // A message read or prefetched earlier opens on its own body rather than
    // on the skeleton; the fetch behind it only replaces what changed.
    const cached = session.mail.get(mailKey(source.account, source.folder, envelope.id));
    openMail = cached ?? null;
    attachmentPaths = [];
    thread = [];
    chainExpanded = false;
    composing = false;
    busy = cached ? '' : `mail:${envelope.id}`;
    try {
      const message = await api.comms.mailMessage(envelope.id, source.account, source.folder);
      session.mail.set(mailKey(source.account, source.folder, envelope.id), message);
      // A slower earlier click must not overwrite whatever is open now.
      if (openEnvelope?.id !== envelope.id) return;
      openMail = message;
      // Opening a message is what marks it read, the same as any mail client.
      // Reading the body deliberately does not do it — the fetch peeks, so
      // that prefetching the next few messages cannot mark mail read the user
      // never opened — which leaves the flag to the one place that knows a
      // person actually looked. Not awaited: the row flips now, and the server
      // catching up is not something the reader waits on.
      if (!envelope.seen) {
        const {account, folder} = source;
        void api.comms.mailFlag([envelope.id], 'seen', true, account, folder).catch(() => {});
        envelopes = envelopes.map((item) =>
          item.id === envelope.id ? {...item, seen: true} : item,
        );
      }
      error = '';
    } catch (cause) {
      if (openEnvelope?.id === envelope.id && !cached) {
        error = readableError(cause);
        openMail = null;
      }
    } finally {
      // Only the request still on screen owns the busy flag; an overtaken one
      // clearing it would drop the newer message's skeleton.
      if (busy === `mail:${envelope.id}`) busy = '';
    }
    // Both of these are another round trip apiece down the same connection, so
    // they wait until the body the click asked for is on screen rather than
    // queueing ahead of it.
    if (openEnvelope?.id !== envelope.id) return;
    void loadThread(envelope);
    void prefetchMailBodies(Math.max(0, envelopes.findIndex((item) => item.id === envelope.id)));
  }

  async function moveMail(envelope: MailEnvelopeDto, role: 'junk' | 'trash' | 'archive'): Promise<void> {
    if (!source || source.kind !== 'mail') return;
    const target = folders.find((folder) => folder.role === role);
    if (!target) {
      error = folderMissing(role);
      return;
    }
    busy = `move:${envelope.id}`;
    const {account, folder} = source;
    try {
      await api.comms.mailMove([envelope.id], target.name, account, folder);
      envelopes = envelopes.filter((item) => item.id !== envelope.id);
      if (openEnvelope?.id === envelope.id) closeReader();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /** Moves to a named folder — what the folder menu on the message does. */
  async function moveTo(envelope: MailEnvelopeDto, target: string): Promise<void> {
    if (!source || source.kind !== 'mail' || target === source.folder) return;
    moveMenu = false;
    busy = `move:${envelope.id}`;
    const {account, folder} = source;
    try {
      await api.comms.mailMove([envelope.id], target, account, folder);
      envelopes = envelopes.filter((item) => item.id !== envelope.id);
      if (openEnvelope?.id === envelope.id) closeReader();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /**
   * Click semantics every list shares: plain click opens, cmd-click adds one,
   * shift-click takes the run between the anchor and here.
   */
  function pick(envelope: MailEnvelopeDto, event: MouseEvent): void {
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(selected);
      if (next.has(envelope.id)) next.delete(envelope.id);
      else next.add(envelope.id);
      selected = next;
      lastPicked = envelope.id;
      return;
    }
    if (event.shiftKey && lastPicked) {
      const ids = visibleEnvelopes.map((item) => item.id);
      const from = ids.indexOf(lastPicked);
      const to = ids.indexOf(envelope.id);
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from];
        selected = new Set([...selected, ...ids.slice(start, end + 1)]);
        return;
      }
    }
    selected = new Set();
    lastPicked = envelope.id;
    if (envelope.draft) void editDraft(envelope);
    else void readMail(envelope);
  }

  /** Applies one action to everything selected, then drops the selection. */
  async function bulk(action: 'archive' | 'junk' | 'trash' | 'read' | 'unread' | 'flag' | 'unflag'): Promise<void> {
    if (!source || source.kind !== 'mail' || selected.size === 0) return;
    const ids = [...selected];
    const {account, folder} = source;
    selectionBusy = true;
    try {
      if (action === 'read' || action === 'unread') {
        await api.comms.mailFlag(ids, 'seen', action === 'read', account, folder);
        envelopes = envelopes.map((item) =>
          ids.includes(item.id) ? {...item, seen: action === 'read'} : item,
        );
      } else if (action === 'flag' || action === 'unflag') {
        await api.comms.mailFlag(ids, 'flagged', action === 'flag', account, folder);
        envelopes = envelopes.map((item) =>
          ids.includes(item.id) ? {...item, flagged: action === 'flag'} : item,
        );
      } else {
        const target = folders.find((item) => item.role === action);
        if (!target) throw new Error(folderMissing(action));
        await api.comms.mailMove(ids, target.name, account, folder);
        envelopes = envelopes.filter((item) => !ids.includes(item.id));
        if (openEnvelope && ids.includes(openEnvelope.id)) closeReader();
      }
      selected = new Set();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      selectionBusy = false;
    }
  }

  /** Marks a single message unread — the one flag change that is not a move. */
  async function markUnread(envelope: MailEnvelopeDto): Promise<void> {
    if (!source || source.kind !== 'mail') return;
    envelopes = envelopes.map((item) =>
      item.id === envelope.id ? {...item, seen: false} : item,
    );
    closeReader();
    await api.comms
      .mailFlag([envelope.id], 'seen', false, source.account, source.folder)
      .catch((cause: unknown) => {
        error = readableError(cause);
      });
  }

  /**
   * Erasing outright, with nowhere to recover it from — offered only where a
   * mail client offers it, in the folders that are already the bin.
   */
  async function erase(ids: string[]): Promise<void> {
    if (!source || source.kind !== 'mail' || ids.length === 0) return;
    const {account, folder} = source;
    selectionBusy = true;
    try {
      await api.comms.mailDelete(ids, account, folder);
      envelopes = envelopes.filter((item) => !ids.includes(item.id));
      if (openEnvelope && ids.includes(openEnvelope.id)) closeReader();
      selected = new Set();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      selectionBusy = false;
    }
  }

  /**
   * Opens one of the message's attachments.
   *
   * The files live on the server until something asks for them, so the first
   * click saves the message's attachments — one command for all of them, which
   * is what the server is asked for anyway — and every click after that opens
   * from what is already on disk. The paths come back in the order the
   * attachments were announced, which is the order they are shown in.
   */
  async function openAttachment(index: number, anchor: DOMRect): Promise<void> {
    if (!source || source.kind !== 'mail' || !openEnvelope) return;
    if (attachmentPaths.length === 0) {
      busy = 'attachments';
      pendingAttachment = index;
      try {
        attachmentPaths = await api.comms.mailDownload(openEnvelope.id, source.account, source.folder);
        error = '';
      } catch (cause) {
        error = readableError(cause);
        return;
      } finally {
        busy = '';
        pendingAttachment = null;
      }
    }
    const path = attachmentPaths[index];
    if (path) onOpenFilePath(path, anchor);
  }

  async function toggleFlag(envelope: MailEnvelopeDto): Promise<void> {
    if (!source || source.kind !== 'mail') return;
    const next = !envelope.flagged;
    envelopes = envelopes.map((item) =>
      item.id === envelope.id ? {...item, flagged: next} : item,
    );
    // The reader holds its own copy of the envelope, and that copy is what the
    // flag button reads. Without this the row in the list changes and the
    // button that was just clicked does not.
    if (openEnvelope?.id === envelope.id) openEnvelope = {...openEnvelope, flagged: next};
    await api.comms
      .mailFlag([envelope.id], 'flagged', next, source.account, source.folder)
      .catch((cause: unknown) => {
        error = readableError(cause);
      });
  }

  type ComposeMode = 'new' | 'reply' | 'reply-all' | 'forward';

  function startCompose(mode: ComposeMode = 'new'): void {
    leaveMailComposer();
    const message = mode === 'new' ? null : openMail;
    mailDraftRestoreEligible = false;
    composing = true;
    composeLocalId = crypto.randomUUID();
    composeRevision = 0;
    composeDirty = false;
    composeTo = message && mode !== 'forward'
      ? replyRecipients(message, mode === 'reply-all').join(', ')
      : '';
    composeCc =
      message && mode === 'reply-all'
        ? message.cc.map((item) => item.address).filter((address) => address !== currentAccount?.email).join(', ')
        : '';
    composeBcc = '';
    showCopies = composeCc.length > 0;
    composeSubject = message ? prefixed(message.subject, mode) : '';
    // Forwarding carries the message with it; replying quotes what is being
    // answered, the way every mail client does.
    composeBody = message && mode !== 'new' ? `\n\n${quote(message)}` : '';
    const signature = currentAccount?.signatures.find(
      (item) => item.id === currentAccount.defaultSignatureId,
    );
    composeSignatureId = signature?.id ?? '';
    composeSignatureBody = signature?.body ?? '';
    composeSignatureHtml = signature?.html ?? null;
    composeFiles = [];
    composeImportance = 'normal';
    composeDraft = null;
    // Only an answer continues a chain; a forward starts its own.
    composeReply =
      message && (mode === 'reply' || mode === 'reply-all')
        ? {inReplyTo: message.messageId, references: [...message.references, ...(message.messageId ? [message.messageId] : [])]}
        : null;
  }

  /**
   * Opens a saved draft back in the composer. Sending or re-saving it replaces
   * the copy in the folder rather than leaving a trail of versions.
   */
  async function editDraft(envelope: MailEnvelopeDto): Promise<void> {
    if (!source || source.kind !== 'mail') return;
    leaveMailComposer();
    busy = `mail:${envelope.id}`;
    try {
      const message = await api.comms.mailMessage(envelope.id, source.account, source.folder);
      mailDraftRestoreEligible = false;
      composing = true;
      composeLocalId = crypto.randomUUID();
      composeRevision = 0;
      composeDirty = false;
      openMail = null;
      openEnvelope = envelope;
      composeTo = message.to.map((item) => item.address).join(', ');
      composeCc = message.cc.map((item) => item.address).join(', ');
      composeBcc = '';
      showCopies = composeCc.length > 0;
      composeSubject = message.subject === '(no subject)' ? '' : message.subject;
      composeBody = message.body;
      // A mailbox draft already has its signature folded into its body. It is
      // ordinary editable text from here, so selecting another must be an
      // explicit choice rather than silently adding the account default again.
      composeSignatureId = '';
      composeSignatureBody = '';
      composeSignatureHtml = null;
      composeFiles = [];
      composeReply = null;
      composeDraft = {id: envelope.id, folder: source.folder};
      const snapshot = mailComposerSnapshot(false);
      if (snapshot) mailDraftAutosave.seed(snapshot);
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      if (busy === `mail:${envelope.id}`) busy = '';
    }
  }

  async function attachFiles(): Promise<void> {
    const picked = await api.comms.mailPickFiles().catch((cause: unknown) => {
      error = readableError(cause);
      return [] as string[];
    });
    composeFiles = [...composeFiles, ...picked.filter((file) => !composeFiles.includes(file))];
    if (picked.length) composeChanged();
  }

  function removeComposeFile(file: string): void {
    composeFiles = composeFiles.filter((item) => item !== file);
    composeChanged();
  }

  function toggleComposeImportance(): void {
    composeImportance = composeImportance === 'high' ? 'normal' : 'high';
    composeChanged();
  }

  function chooseComposeSignature(id: string): void {
    const signature = currentAccount?.signatures.find((item) => item.id === id);
    composeSignatureId = signature?.id ?? '';
    composeSignatureBody = signature?.body ?? '';
    composeSignatureHtml = signature?.html ?? null;
    composeChanged();
  }

  function fileName(pathname: string): string {
    return pathname.split('/').pop() ?? pathname;
  }

  /**
   * Reply goes to the sender; reply-all adds everyone else who was on it,
   * minus this mailbox — answering yourself is never the intent.
   */
  function replyRecipients(message: MailMessageDto, all: boolean): string[] {
    const mine = (currentAccount?.email ?? '').toLowerCase();
    const addresses = [message.from?.address ?? ''];
    if (all) addresses.push(...[...message.to, ...message.cc].map((item) => item.address));
    const seen = new Set<string>();
    return addresses.filter((address) => {
      const key = address.trim().toLowerCase();
      if (!key || key === mine || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Which mailbox an action needs, named the way the app names it rather than
   * by the role's internal spelling. */
  function folderMissing(role: 'junk' | 'trash' | 'archive'): string {
    return translate('hub.noFolder', {folder: translate(FOLDER_ROLE_NAMES[role])});
  }

  const FOLDER_ROLE_NAMES = {
    junk: 'hub.junk',
    trash: 'hub.trash',
    archive: 'hub.archive',
  } as const;

  /** Reply and forward prefixes are conventions of the mail client, and every
   * locale has its own — "Re:" is near-universal, "Fwd:" is not. */
  function prefixed(subject: string, mode: ComposeMode): string {
    if (mode === 'forward') {
      const prefix = translate('hub.forwardPrefix');
      return subject.toLowerCase().startsWith(prefix.toLowerCase()) ? subject : `${prefix} ${subject}`;
    }
    const prefix = translate('hub.replyPrefix');
    return subject.toLowerCase().startsWith(prefix.toLowerCase()) ? subject : `${prefix} ${subject}`;
  }

  function quote(message: MailMessageDto): string {
    const who = message.from?.name ?? message.from?.address ?? translate('hub.someone');
    const head = message.date
      ? translate('hub.quoteHeadDated', {date: message.date, who})
      : translate('hub.quoteHead', {who});
    return [head, ...message.body.split('\n').map((line) => `> ${line}`)].join('\n');
  }

  function addressList(value: string): string[] {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }

  async function sendMail(draftOnly: boolean): Promise<void> {
    if (!draftOnly && !composeTo.trim()) return;
    busy = draftOnly ? 'save-draft' : 'send-mail';
    const localId = composeLocalId;
    const account = mailAccount;
    try {
      if (draftOnly) {
        const snapshot = mailComposerSnapshot(true);
        if (snapshot) mailDraftAutosave.update(snapshot);
        await mailDraftAutosave.flush(localId);
      } else {
        const saved = await mailDraftAutosave.referenceForSend(localId);
        await api.comms.mailSend({
          account: account || undefined,
          to: addressList(composeTo),
          cc: addressList(composeCc),
          bcc: addressList(composeBcc),
          subject: composeSubject,
          body: mailBodyWithSignature(composeBody, composeSignatureBody),
          html: mailHtmlWithSignature(composeBody, composeSignatureHtml),
          draft: false,
          attachments: composeFiles,
          importance: composeImportance,
          inReplyTo: composeReply?.inReplyTo ?? undefined,
          references: composeReply?.references,
          replacesDraft: saved ?? composeDraft,
        });
      }
      mailDraftAutosave.complete(localId, account);
      composing = false;
      composeLocalId = '';
      composeRevision = 0;
      composeDirty = false;
      composeTo = '';
      composeCc = '';
      composeBcc = '';
      composeSubject = '';
      composeBody = '';
      composeSignatureId = '';
      composeSignatureBody = '';
      composeSignatureHtml = null;
      composeFiles = [];
      composeImportance = 'normal';
      composeReply = null;
      composeDraft = null;
      await loadEnvelopes();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  /** Returns to the list, which is what the back affordance does when the
   * drawer is too narrow to show both at once. */
  function closeReader(): void {
    closeChatSearch();
    closeChatHeaderMenu();
    openMail = null;
    openEnvelope = null;
    activeChat = null;
    activeBroadcast = null;
    profileOpen = false;
    profileMergeOpen = false;
    broadcastMessages = [];
    leaveMailComposer();
  }

  /**
   * A mail date, whichever way it arrives.
   *
   * An envelope carries "2026-08-18 01:45+00:00"; the message itself carries
   * the RFC 5322 line its sender wrote — "Fri, 7 Aug 2026 02:24:42 +0000".
   * Only the first needs its space turned into a `T`, and doing that to the
   * second breaks it ("Fri,T7 Aug…"), so the plain reading is tried first and
   * the repair is the fallback rather than the rule.
   */
  function mailDate(value: string): Date | null {
    for (const text of [value, value.replace(' ', 'T')]) {
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
  }

  /** The stamp on a mail row: the shared display time, in its compact form
   * because the list column is narrow. */
  function when(value: string): string {
    return displayTime(value, {compact: true});
  }

  /** The clock part of every stamp in a thread: 12-hour, as asked for. */
  function clockTime(parsed: Date): string {
    return parsed.toLocaleTimeString(activeLocale(), {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  /** The time on a single bubble. */
  function messageTime(value: string): string {
    const parsed = mailDate(value);
    return parsed ? clockTime(parsed) : value;
  }

  function startOfDay(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  /** A pause this long makes the next message the start of a new run. */
  const RUN_GAP_MS = 30 * 60_000;

  /**
   * Whether a stamp belongs over this message. The thread is newest first, so
   * the message before it in time is the next one in the array — a stamp goes
   * in when that one is a different day or long enough ago to be a separate
   * sitting, and over the oldest message on screen, which always starts a run.
   */
  function startsRun(index: number): boolean {
    const message = chatMessages[index];
    const older = chatMessages[index + 1];
    if (!message) return false;
    if (!older) return true;
    const at = new Date(message.sentAt.replace(' ', 'T')).getTime();
    const before = new Date(older.sentAt.replace(' ', 'T')).getTime();
    if (Number.isNaN(at) || Number.isNaN(before)) return false;
    return (
      at - before > RUN_GAP_MS ||
      startOfDay(new Date(at)).getTime() !== startOfDay(new Date(before)).getTime()
    );
  }

  function sender(envelope: MailEnvelopeDto): string {
    return envelope.from.name ?? envelope.from.address ?? $t('hub.unknown');
  }

  /** A recipient field as one line: the name where there is one, the address otherwise. */
  function names(list: MailAddressDto[]): string {
    return list.map((item) => item.name ?? item.address).join(', ');
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key !== 'Escape') return;
    if (chatHeaderMenuOpen) {
      event.stopPropagation();
      closeChatHeaderMenu();
    }
    else if (composerEmojiOpen) {
      event.stopPropagation();
      composerEmojiOpen = false;
      composerInput?.focus();
    }
    else if (composerToolsOpen) {
      event.stopPropagation();
      composerToolsOpen = false;
    }
    else if (reactionPickerOpen) {
      event.stopPropagation();
      reactionPickerOpen = false;
    }
    else if (messageMenu) { event.stopPropagation(); closeMessageMenu(); }
    else if (chatMenu) { event.stopPropagation(); closeChatMenu(); }
    else if (conversationFilterMenu) { event.stopPropagation(); conversationFilterMenu = false; }
    else if (broadcastCreateOpen) { event.stopPropagation(); closeBroadcastPicker(); }
    else if (newChatOpen) { event.stopPropagation(); closeNewChatPicker(); }
  }}
  onclick={(event) => {
    if (messageMenu && !(event.target as HTMLElement).closest('.hub-view-message-menu')) closeMessageMenu();
    if (chatMenu && !(event.target as HTMLElement).closest('.hub-view-chat-menu')) closeChatMenu();
    const clickPath = event.composedPath();
    const insideComposerRow = clickPath.some(
      (target) => target instanceof HTMLElement && target.classList.contains('hub-view-composer-row'),
    );
    const insideComposerTools = clickPath.some(
      (target) => target instanceof HTMLElement && (
        target.classList.contains('hub-view-composer-add') ||
        target.classList.contains('hub-view-composer-tools-menu')
      ),
    );
    const insideConversationFilter = clickPath.some(
      (target) => target instanceof HTMLElement && target.classList.contains('hub-view-conversation-filter'),
    );
    const insideChatHeaderMenu = clickPath.some(
      (target) => target instanceof HTMLElement && target.classList.contains('hub-view-chat-actions'),
    );
    if (chatHeaderMenuOpen && !insideChatHeaderMenu) closeChatHeaderMenu();
    if (composerToolsOpen && !insideComposerTools) composerToolsOpen = false;
    if (composerEmojiOpen && !insideComposerRow) composerEmojiOpen = false;
    if (conversationFilterMenu && !insideConversationFilter) conversationFilterMenu = false;
  }}
/>

<div class="hub-view">
  <div
    class="hub-view-grid"
    class:reading={hubReading}
    class:rail-compact={railIconOnly}
    class:rail-resizing={railResizeStart !== null}
    style={`--hub-rail-width: ${railWidth}px; --hub-motion-list-width: ${motionListWidth}px`}
  >
  <nav
    class="hub-view-rail"
    aria-label={$t('hub.sources')}
    class:dragging={!!dragging}
  >
    <div
      class="hub-view-rail-scroll"
      role="group"
      class:at-top={railAtTop}
      class:at-bottom={railAtBottom}
      bind:this={railElement}
      onscroll={measureRailEdges}
      onpointermove={dragRow}
      onpointerup={releaseRow}
      onpointercancel={releaseRow}
    >
    <!-- Fixed outside the draggable list: no pointer or keyboard reorder can
         move a platform above the combined overview. -->
    <div class="hub-view-source-row hub-view-source-fixed">
      <button
        type="button"
        class="hub-view-source"
        class:active={source?.kind === 'all'}
        aria-label={$t('hub.allPlatforms')}
        onclick={selectAll}
      >
        <Icon name="platforms" size={15} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
        <span>{$t('hub.allPlatforms')}</span>
      </button>
    </div>
    <!-- Broadcasts stay directly beneath the combined overview. They are a
         local delivery mode across platforms, not another remote platform. -->
    <div class="hub-view-source-row hub-view-source-fixed">
      <button
        type="button"
        class="hub-view-source"
        class:active={source?.kind === 'broadcasts'}
        aria-label={$t('hub.broadcasts')}
        onclick={selectBroadcasts}
      >
        <Icon name="broadcast" size={15} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
        <span>{$t('hub.broadcasts')}</span>
      </button>
    </div>
    <!-- Rows are draggable: the rail's order is the user's, kept in
         localStorage, and ⌥↑/⌥↓ on a focused row does the same thing without a
         pointer. A drag stays in its own list — sources past sources, accounts
         within the source they belong to. -->
    {#each railRows as row (row.id)}
      <!-- The rows a drag is passing slide to their new places rather than
           jumping there, so the arrangement being made stays legible. -->
      {@const grouped = row.accounts.length > 1}
      {@const expanded = openGroups[row.id] === true}
      <div
        class="hub-view-source-row"
        class:carried={dragging?.scope === 'sources' && dragging.id === row.id}
        class:settling={settling?.scope === 'sources' && settling.id === row.id}
        data-rail-source={row.id}
        style={dragging?.scope === 'sources' && dragging.id === row.id
          ? `transform: translateY(${dragging.offset}px)`
          : undefined}
        transition:fade={{duration: railFadeDuration()}}
        animate:flip={{
          duration: railReflowDuration(dragging?.scope === 'sources' && dragging.id === row.id),
        }}
      >
      <button
        type="button"
        class="hub-view-source"
        class:active={(railIconOnly || !grouped) &&
          (row.id === 'mail'
            ? source?.kind === 'mail'
            : source?.kind === 'platform' && source.platform === row.platform)}
        aria-label={row.name}
        aria-expanded={grouped && !railIconOnly ? expanded : undefined}
        onclick={() => {
          if (dragged) return;
          if (row.id === 'mail') pickMail();
          else
            pickPlatform(
              row.platform,
              row.accounts.map((account) => account.id),
            );
        }}
        onkeydown={(event) => nudge(event, 'sources', row.id)}
        onpointerdown={(event) => pressRow(event, 'sources', row.id)}
      >
        <PlatformLogo platform={row.platform} size={RAIL_TILE_SIZE} />
        <span>{row.name}</span>
      </button>
      {#if grouped && expanded && !railIconOnly}
        <ul class="hub-view-accounts">
          {#each row.accounts as account (account.id)}
            <li
              data-rail-account={account.id}
              class:carried={dragging?.scope === row.id && dragging.id === account.id}
              class:settling={settling?.scope === row.id && settling.id === account.id}
              style={dragging?.scope === row.id && dragging.id === account.id
                ? `transform: translateY(${dragging.offset}px)`
                : undefined}
              transition:fade={{duration: railFadeDuration()}}
              animate:flip={{
                duration: railReflowDuration(dragging?.scope === row.id && dragging.id === account.id),
              }}
            >
              <button
                type="button"
                class:active={row.id === 'mail'
                  ? mailAccount === account.id
                  : source?.kind === 'platform' &&
                    source.platform === row.platform &&
                    source.account === account.id}
                onclick={() => {
                  if (dragged) return;
                  if (row.id === 'mail') void selectMail(account.id);
                  else selectPlatform(row.platform, account.id);
                }}
                onkeydown={(event) => nudge(event, row.id, account.id)}
                onpointerdown={(event) => pressRow(event, row.id, account.id)}
              >
                {#if row.id !== 'mail'}
                  {@render chatAvatar(
                    account.label,
                    account.avatarUrl,
                    `account:${row.platform}:${account.id}`,
                    true,
                  )}
                {/if}
                <span>{account.label}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      </div>
    {/each}

    {#if railRows.length === 0 && !loading}
      <p class="hub-view-rail-empty">
        {$t('hub.railEmpty')}
      </p>
    {/if}
    </div>

    <!-- Contacts is navigation over every platform rather than one more
         platform, so it remains anchored beneath the scrollable source list. -->
    <div class="hub-view-rail-footer">
      <button
        type="button"
        class="hub-view-source"
        class:active={source?.kind === 'contacts'}
        aria-label={$t('hub.contacts')}
        onclick={selectContacts}
      >
        <Icon name="contacts" size={15} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
        <span>{$t('hub.contacts')}</span>
      </button>
    </div>
  </nav>

  <!-- A wide hit area over the divider, matching the workspace drawer's
       resize affordance. It stays at one endpoint until the pointer crosses
       the midpoint, then snaps directly to the other endpoint. -->
  <button
    type="button"
    class="hub-view-rail-resize-handle"
    class:resizing={railResizeStart !== null}
    aria-label={$t('hub.resizeRail')}
    data-tooltip="none"
    onpointerdown={startRailResize}
    onpointermove={dragRailResize}
    onpointerup={stopRailResize}
    onpointercancel={stopRailResize}
    onkeydown={resizeRailWithKeyboard}
  ></button>

  <section class="hub-view-list" aria-label={$t('hub.messages')}>
    {#if broadcastCreateOpen}
      <div class="hub-view-list-head hub-view-new-chat-head">
        <input
          bind:this={broadcastSearchInput}
          bind:value={broadcastSearch}
          type="search"
          placeholder={$t('hub.searchContacts')}
          aria-label={$t('hub.searchContacts')}
        />
        <button
          type="button"
          class="hub-view-new-chat-icon"
          aria-label={$t('hub.closeBroadcast')}
          onclick={closeBroadcastPicker}
        >
          <Icon name="close" size={15} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
        </button>
      </div>
      <div class="hub-view-broadcast-create-meta">
        <input
          bind:value={broadcastName}
          placeholder={$t('hub.broadcastName')}
          aria-label={$t('hub.broadcastName')}
        />
        <p><Icon name="info" size={13} />{$t('hub.broadcastPrivacy')}</p>
      </div>
      {#if selectedBroadcastContacts.length > 0}
        <div class="hub-view-new-chat-selection">
          <div class="hub-view-new-chat-selection-row">
            <div class="hub-view-new-chat-selected" aria-label={$t('hub.selectedPeople')}>
              {#each selectedBroadcastContacts as contact (contact.id)}
                <button
                  type="button"
                  class="hub-view-new-chat-chip"
                  aria-label={$t('hub.removePerson', {name: contact.name})}
                  onclick={() => toggleBroadcastContact(contact)}
                >
                  {@render chatAvatar(contact.name, contact.avatarUrl, `broadcast-chip:${contact.id}`, true)}
                  <span>{contact.name}</span>
                  <Icon name="close" size={10} />
                </button>
              {/each}
            </div>
            <div class="hub-view-new-chat-action">
              <button
                type="button"
                disabled={!canCreateBroadcast || broadcastCreating}
                onclick={() => void createBroadcast()}
              >
                {broadcastCreating ? $t('hub.creatingBroadcast') : $t('hub.createBroadcast')}
              </button>
            </div>
          </div>
        </div>
      {/if}
      {#if broadcastError}<p class="hub-view-new-chat-error">{broadcastError}</p>{/if}
      <ul class="hub-view-rows hub-view-new-chat-rows">
        {#if broadcastLoading}
          <li class="hub-view-empty" role="status">{$t('common.loading')}</li>
        {:else}
          {#each broadcastContactRows as contact (contact.id)}
            {@const route = broadcastRoute(contact)}
            {@const picked = broadcastSelected.has(contact.id)}
            <li>
              <button
                type="button"
                class="hub-view-row hub-view-new-chat-contact"
                class:picked
                disabled={!route}
                aria-pressed={picked}
                onclick={() => toggleBroadcastContact(contact)}
              >
                <span class="hub-view-chat-avatar-wrap" aria-hidden="true">
                  {@render chatAvatar(contact.name, contact.avatarUrl, `broadcast-contact:${contact.id}`)}
                  <span class="hub-view-platform-badge">
                    <PlatformLogo platform={contact.platform as Platform} size={12} />
                  </span>
                </span>
                <span class="hub-view-chat-copy">
                  <span class="hub-view-row-top"><strong>{contact.name}</strong></span>
                  <span class="hub-view-chat-preview">
                    {commsPlatformLabel(contact.platform)} · {route?.accountName ?? $t('hub.unavailable')}
                  </span>
                </span>
                {#if picked}<Icon name="check" size={14} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />{/if}
              </button>
            </li>
          {:else}
            <li class="hub-view-empty">
              {broadcastSearch.trim() ? $t('common.noMatches') : $t('hub.noContacts')}
            </li>
          {/each}
        {/if}
      </ul>
    {:else if newChatOpen}
      <div class="hub-view-list-head hub-view-new-chat-head">
        <input
          bind:this={newChatSearchInput}
          bind:value={newChatSearch}
          type="search"
          placeholder={$t('hub.searchContacts')}
          aria-label={$t('hub.searchContacts')}
        />
        <button
          type="button"
          class="hub-view-new-chat-icon"
          aria-label={$t('hub.closeNewChat')}
          onclick={closeNewChatPicker}
        >
          <Icon name="close" size={15} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
        </button>
      </div>
      {#if selectedNewChatContacts.length > 0}
        <div class="hub-view-new-chat-selection">
          <div class="hub-view-new-chat-selection-row">
            <div class="hub-view-new-chat-selected" aria-label={$t('hub.selectedPeople')}>
              {#each selectedNewChatContacts as contact (contact.id)}
                <button
                  type="button"
                  class="hub-view-new-chat-chip"
                  aria-label={$t('hub.removePerson', {name: contact.name})}
                  onclick={() => toggleNewChatContact(contact)}
                >
                  {@render chatAvatar(contact.name, contact.avatarUrl, `new-chat-chip:${contact.id}`, true)}
                  <span>{contact.name}</span>
                  <Icon name="close" size={10} />
                </button>
              {/each}
            </div>
            <div class="hub-view-new-chat-action">
              <button
                type="button"
                disabled={!canCreateNewChat || newChatCreating}
                onclick={() => void createSelectedChat()}
              >
                {newChatCreating
                  ? $t('hub.creatingChat')
                  : selectedNewChatContacts.length > 1
                    ? $t('hub.createGroup')
                    : $t('hub.newChat')}
              </button>
            </div>
          </div>
        {#if selectedNewChatContacts.length > 1}
          <div class="hub-view-new-chat-group-name">
            <input
              bind:value={newChatGroupName}
              placeholder={$t('hub.groupName')}
              aria-label={$t('hub.groupName')}
            />
          </div>
        {/if}
        </div>
      {/if}
      {#if newChatError}<p class="hub-view-new-chat-error">{newChatError}</p>{/if}
      <ul class="hub-view-rows hub-view-new-chat-rows">
        {#if newChatLoading}
          <li class="hub-view-empty" role="status">{$t('common.loading')}</li>
        {:else}
          {#each newChatRows as contact (contact.id)}
            {@const compatible = compatibleNewChatContact(contact)}
            {@const picked = newChatSelected.has(contact.id)}
            <li>
              <button
                type="button"
                class="hub-view-row hub-view-new-chat-contact"
                class:picked
                disabled={!compatible}
                aria-pressed={picked}
                onclick={() => toggleNewChatContact(contact)}
              >
                <span class="hub-view-chat-avatar-wrap" aria-hidden="true">
                  {@render chatAvatar(contact.name, contact.avatarUrl, `new-chat:${contact.id}`)}
                  <span class="hub-view-platform-badge">
                    <PlatformLogo platform={contact.platform as Platform} size={12} />
                  </span>
                </span>
                <span class="hub-view-chat-copy">
                  <span class="hub-view-row-top"><strong>{contact.name}</strong></span>
                  <span class="hub-view-chat-preview">
                    {commsPlatformLabel(contact.platform)} ·
                    {contact.accounts.length === 1
                      ? contact.accounts[0]!.accountName
                      : $t('hub.accountCount', {count: contact.accounts.length})}
                  </span>
                </span>
                {#if picked}<Icon name="check" size={14} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />{/if}
              </button>
            </li>
          {:else}
            <li class="hub-view-empty">
              {newChatSearch.trim() ? $t('common.noMatches') : $t('hub.noContacts')}
            </li>
          {/each}
        {/if}
      </ul>
    {:else if source?.kind === 'mail'}
      <header class="hub-view-list-head">
        <!-- The mailbox picker lives with the list it filters, not in the
             rail: the rail picks the account, this picks what to show of it. -->
        <div
          class="hub-view-folder-picker"
          onfocusout={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !event.currentTarget.contains(next))
              folderMenu = false;
          }}
        >
          <button
            type="button"
            class="hub-view-folder-button"
            class:open={folderMenu}
            disabled={railFolders.length === 0}
            aria-expanded={folderMenu}
            onclick={() => (folderMenu = !folderMenu)}
          >
            <Icon
              name={FOLDER_ICONS[currentFolder?.role ?? 'other'] ?? 'folder'}
              size={13}
              strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}
            />
            <span>{folderLabel(currentFolder?.label ?? mailFolder)}</span>
            <Icon name="chevron" size={12} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
          </button>
          {#if folderMenu}
            <ul class="hub-view-folder-menu">
              {#each railFolders as folder (folder.name)}
                <li>
                  <button
                    type="button"
                    class:active={mailFolder === folder.name}
                    onclick={() => {
                      folderMenu = false;
                      void selectMail(mailAccount, folder.name);
                    }}
                  >
                    <Icon
                      name={FOLDER_ICONS[folder.role] ?? 'folder'}
                      size={13}
                      strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}
                    />
                    {folderLabel(folder.label)}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          <!-- Which mailbox this is a folder of, since the rail only says
               "Mail" once its accounts are folded away. -->
          {#if currentAccount}
            <span class="hub-view-list-account">{currentAccount.email}</span>
          {/if}
        </div>
        {#if railIconOnly && compactAccountOptions.length > 1}
          <div class="hub-view-account-picker">
            <Menu
              options={compactAccountOptions}
              value={currentRailAccount}
              label={$t('hub.chooseAccount')}
              onChange={chooseCompactAccount}
            />
          </div>
        {/if}
        <input
          type="search"
          placeholder={$t('hub.searchFolder')}
          bind:value={search}
          onkeydown={(event) => {
            if (event.key === 'Enter') void loadEnvelopes();
          }}
        />
        <div
          class="hub-view-filter"
          onfocusout={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !event.currentTarget.contains(next)) filterMenu = false;
          }}
        >
          <button
            type="button"
            class="hub-view-icon-button"
            class:on={filter !== 'all'}
            title={$t('hub.filterMessages')}
            aria-label={$t('hub.filterMessages')}
            aria-expanded={filterMenu}
            onclick={() => (filterMenu = !filterMenu)}
          >
            <Icon name="filter" size={14} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
          </button>
          {#if filterMenu}
            <ul class="hub-view-folder-menu hub-view-menu-right">
              {#each FILTERS as option (option.id)}
                <li>
                  <button
                    type="button"
                    class:active={filter === option.id}
                    onclick={() => {
                      filter = option.id;
                      filterMenu = false;
                    }}
                  >
                    <Icon name={option.icon} size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
                    {option.label}
                  </button>
                </li>
              {/each}
              <li class="hub-view-menu-heading">{$t('hub.sort')}</li>
              {#each SORTS as option (option.id)}
                <li>
                  <button
                    type="button"
                    class:active={sort === option.id}
                    onclick={() => {
                      sort = option.id;
                      filterMenu = false;
                      void loadEnvelopes();
                    }}
                  >
                    <Icon name="sort" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
                    {option.label}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <button type="button" class="hub-view-compose" onclick={() => startCompose()}>
          <Icon name="edit" size={14} />
          New
        </button>
      </header>
      {#if selected.size > 0}
        <div class="hub-view-selection">
          <span>{selected.size} selected</span>
          <button type="button" disabled={selectionBusy} onclick={() => void bulk('read')}>{$t('hub.markRead')}</button>
          <button type="button" disabled={selectionBusy} onclick={() => void bulk('unread')}>{$t('hub.markUnread')}</button>
          <button type="button" disabled={selectionBusy} onclick={() => void bulk('flag')}>{$t('hub.flag')}</button>
          <button type="button" disabled={selectionBusy} onclick={() => void bulk('archive')}>{$t('hub.archive')}</button>
          {#if currentFolder?.role === 'trash' || currentFolder?.role === 'junk'}
            <button type="button" class="destructive" disabled={selectionBusy} onclick={() => void erase([...selected])}>
              Delete
            </button>
          {:else}
            <button type="button" disabled={selectionBusy} onclick={() => void bulk('trash')}>{$t('common.delete')}</button>
          {/if}
          <button type="button" onclick={() => (selected = new Set())}>{$t('common.cancel')}</button>
        </div>
      {/if}
      <!-- This wrapper is the list's positioning context. The header can wrap
           to different heights, so anchoring the floating control to the whole
           pane would put it over the folder and search controls instead. -->
      <div class="hub-view-rows-wrap">
        {#if rowsScrolled}
          <!-- Rides over the top of the list once the reader is well down it,
               which is the only point at which getting back matters. -->
          <button type="button" class="hub-view-to-top" onclick={scrollRowsToTop}>
            <Icon name="arrow-up" size={13} />
            {$t('hub.scrollToTop')}
          </button>
        {/if}
        <ul class="hub-view-rows" bind:this={rowsEl} onscroll={onRowsScroll}>
        {#each visibleEnvelopes as envelope (envelope.id)}
          <li>
            <button
              type="button"
              class="hub-view-row"
              class:active={openEnvelope?.id === envelope.id && selected.size === 0}
              class:picked={selected.has(envelope.id)}
              class:unread={!envelope.seen}
              onclick={(event) => pick(envelope, event)}
            >
              <span class="hub-view-row-top">
                <strong>{sender(envelope)}</strong>
                <em>{when(envelope.date)}</em>
              </span>
              <span class="hub-view-row-subject">{envelope.subject}</span>
              <!-- The body's first line and the row's marks share one line: the
                   marks are about the message, and a line of their own under a
                   preview that is already one line makes every row a third
                   taller for three glyphs. -->
              <span class="hub-view-row-line">
                <span class="hub-view-row-preview">{envelope.preview ?? ''}</span>
                <span class="hub-view-row-meta">
                  {#if envelope.flagged}<Icon name="flag" size={12} filled />{/if}
                  {#if envelope.answered}<Icon name="back" size={12} />{/if}
                  {#if envelope.hasAttachment}<Icon name="attach" size={12} />{/if}
                  {#if chainCount(envelope) > 1}
                    <span class="hub-view-row-chain" title={`${chainCount(envelope)} messages`}>
                      {chainCount(envelope)}
                      <Icon name="chevron" size={11} />
                    </span>
                  {/if}
                </span>
              </span>
            </button>
          </li>
        {/each}
        {#if moreToLoad && visibleEnvelopes.length > 0}
          <li>
            <button
              type="button"
              class="hub-view-more"
              disabled={busy === 'more'}
              onclick={() => void loadEnvelopes(true)}
            >
              {#if busy === 'more'}
                <span class="loading-dots" role="status" aria-label={$t('common.loading')}><i></i><i></i><i></i></span>
              {:else}
                {$t('hub.loadMore')}
              {/if}
            </button>
          </li>
        {/if}
        {#if visibleEnvelopes.length === 0}
          {#if busy === 'envelopes' || busy === 'folders'}
            <li class="hub-view-loading-rows" role="status" aria-label={$t('common.loading')}>
              {#each SKELETON_ROWS as index (index)}
                <span class="hub-view-row hub-view-row-skeleton" aria-hidden="true">
                  <span class="hub-view-chat-copy">
                    <span class="hub-view-skeleton-line" style="width:38%"></span>
                    <span class="hub-view-skeleton-line" style="width:82%"></span>
                  </span>
                </span>
              {/each}
            </li>
          {:else}
            <li class="hub-view-empty">
              {envelopes.length > 0 ? $t('hub.noneMatchFilter') : $t('hub.nothingHere')}
            </li>
          {/if}
        {/if}
        </ul>
      </div>
    {:else if source?.kind === 'broadcasts'}
      <div class="hub-view-list-head">
        <input
          bind:value={broadcastListSearch}
          type="search"
          placeholder={$t('hub.searchBroadcasts')}
          aria-label={$t('hub.searchBroadcasts')}
        />
        <button
          type="button"
          class="hub-view-new-chat-icon"
          aria-label={$t('hub.createBroadcast')}
          onclick={() => void openBroadcastPicker()}
        >
          <Icon name="plus" size={16} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
        </button>
      </div>
      <ul class="hub-view-rows hub-view-broadcast-rows">
        {#each broadcastRows as broadcast (broadcast.id)}
          <li>
            <button
              type="button"
              class="hub-view-row"
              class:active={activeBroadcast?.id === broadcast.id}
              onclick={() => void openBroadcast(broadcast)}
            >
              <span class="hub-view-chat-avatar placeholder" aria-hidden="true">
                <Icon name="broadcast" size={14} />
              </span>
              <span class="hub-view-chat-copy">
                <span class="hub-view-row-top">
                  <strong>{broadcast.name}</strong>
                  {#if broadcast.lastActivity}<em>{when(broadcast.lastActivity)}</em>{/if}
                </span>
                <span class="hub-view-chat-preview">
                  {$t('hub.broadcastRecipientCount', {count: broadcast.recipients.length})}
                </span>
                {#if broadcast.preview}<span class="hub-view-chat-preview">{broadcast.preview}</span>{/if}
              </span>
            </button>
          </li>
        {:else}
          <li class="hub-view-empty">
            {#if broadcastListSearch.trim()}
              {$t('common.noMatches')}
            {:else}
              <div class="hub-view-broadcast-empty">
                <Icon name="broadcast" size={28} />
                <h2>{$t('hub.noBroadcasts')}</h2>
                <p>{$t('hub.noBroadcastsBody')}</p>
                <button type="button" onclick={() => void openBroadcastPicker()}>
                  {$t('hub.createBroadcast')}
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if source?.kind === 'all'}
      <div class="hub-view-list-head">
        <input bind:value={chatSearch} type="search" placeholder={$t('hub.searchAllPlatforms')} aria-label={$t('hub.searchAllPlatforms')} />
        {@render conversationFilterControl()}
        <button
          type="button"
          class="hub-view-new-chat-icon"
          aria-label={$t('hub.newChat')}
          onclick={() => void openNewChatPicker()}
        >
          <Icon name="new-chat" size={16} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
        </button>
      </div>
      <ul class="hub-view-rows">
        {#each unifiedRows as row (`${row.kind}:${row.kind === 'chat' ? row.chat.id : `${row.account}:${row.folder}:${row.envelope.id}`}`)}
          <li>
            {#if row.kind === 'chat'}
              {#if row.chat.space}
                {@render spaceRow(row.chat, true)}
              {:else}
                {@render chatRow(row.chat, false, true)}
              {/if}
            {:else}
              <button type="button" class="hub-view-row" class:unread={!row.envelope.seen} onclick={() => void openUnifiedMail(row)}>
                <span class="hub-view-chat-avatar-wrap" aria-hidden="true">
                  <span class="hub-view-chat-avatar placeholder">{sender(row.envelope).trim().charAt(0).toUpperCase()}</span>
                  <span class="hub-view-platform-badge"><PlatformLogo platform="mail" size={12} /></span>
                </span>
                <span class="hub-view-chat-copy">
                  <span class="hub-view-row-top"><strong>{sender(row.envelope)}</strong><em>{when(row.envelope.date)}</em></span>
                  <span class="hub-view-row-subject">{row.envelope.subject}</span>
                  <span class="hub-view-chat-preview">{row.envelope.preview ?? ''}</span>
                </span>
              </button>
            {/if}
          </li>
        {:else}
          <li class="hub-view-empty">
            {conversationFilter !== 'all'
              ? $t('hub.noneMatchFilter')
              : chatSearch.trim()
                ? $t('common.noMatches')
                : $t('hub.noConversations')}
          </li>
        {/each}
      </ul>
      {@render chatContextMenu()}
    {:else if source?.kind === 'contacts'}
      <div class="hub-view-list-head">
        <input
          bind:value={contactSearch}
          type="search"
          placeholder={$t('hub.searchContacts')}
          aria-label={$t('hub.searchContacts')}
        />
        <button
          type="button"
          class="hub-view-new-chat-icon"
          aria-label={$t('hub.newChat')}
          onclick={() => void openNewChatPicker()}
        >
          <Icon name="new-chat" size={16} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
        </button>
      </div>
      <ul class="hub-view-rows hub-view-contacts">
        {#each contactRows as contact (contact.id)}
          {@const platformName = contact.platforms.length === 1
            ? commsPlatformLabel(contact.platforms[0]!)
            : $t('hub.platformCount', {count: contact.platforms.length})}
          <li>
            <button
              type="button"
              class="hub-view-row hub-view-contact-row"
              class:active={contact.chats.some((chat) => activeChat?.id === chat.id)}
              aria-label={$t('hub.openContact', {name: contact.name, platform: platformName})}
              onclick={() => void openProfile(contact.primary, false)}
            >
              <span class="hub-view-chat-avatar-wrap" aria-hidden="true">
                {@render chatAvatar(contact.name, contact.primary.avatarUrl, contact.id)}
                <span class="hub-view-platform-badge hub-view-platform-badge-stack">
                  {#each contact.platforms.slice(0, 3) as platform (platform)}
                    <span><PlatformLogo platform={platform as Platform} size={12} /></span>
                  {/each}
                </span>
              </span>
              <span class="hub-view-chat-copy">
                <span class="hub-view-row-top">
                  <strong class="hub-view-name-with-badge">
                    <span>{contact.name}</span>
                    {#if contact.official}{@render officialBadge()}{/if}
                  </strong>
                </span>
                <span class="hub-view-chat-preview">{platformName}</span>
              </span>
            </button>
          </li>
        {:else}
          <li class="hub-view-empty">
            {contactSearch.trim() ? $t('common.noMatches') : $t('hub.noContacts')}
          </li>
        {/each}
      </ul>
    {:else if source?.kind === 'platform'}
      <!-- The same head, and the same bare search field, the mailbox list
           above uses: the two halves of the hub are one list with different
           transports, and a second search treatment would say otherwise. -->
      <div class="hub-view-list-head" class:space-focused={!!focusedSpace}>
        {#if focusedSpace}
          <div class="hub-view-space-heading">
            <button
              type="button"
              class="hub-view-space-back"
              aria-label={$t('hub.backToPlatform', {
                platform: commsPlatformLabel(focusedSpace.platform as CommsPlatform),
              })}
              onclick={leaveSpace}
            >
              <Icon name="back" size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
            </button>
            <strong>{focusedSpace.name}</strong>
          </div>
        {/if}
        {#if railIconOnly && !focusedSpace && compactAccountOptions.length > 1}
          <div class="hub-view-account-picker">
            <Menu
              options={compactAccountOptions}
              value={currentRailAccount}
              label={$t('hub.chooseAccount')}
              onChange={chooseCompactAccount}
            />
          </div>
        {/if}
        <input
          bind:value={chatSearch}
          type="search"
          placeholder={focusedSpace
            ? $t('hub.searchSpace', {space: focusedSpace.name})
            : $t('hub.searchConversations')}
          aria-label={focusedSpace
            ? $t('hub.searchSpace', {space: focusedSpace.name})
            : $t('hub.searchConversations')}
        />
        {@render conversationFilterControl()}
        <button
          type="button"
          class="hub-view-new-chat-icon"
          aria-label={$t('hub.newChat')}
          onclick={() => void openNewChatPicker()}
        >
          <Icon name="new-chat" size={16} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
        </button>
      </div>
      <ul class="hub-view-rows">
        {#each visibleChats as chat (chat.id)}
          <li>
            {#if chat.space}
              {@render spaceRow(chat)}
            {:else}
              {@render chatRow(chat, false)}
            {/if}
          </li>
        {:else}
          {#if loading}
            <!-- The rows that are coming, in their own shape: a spinner in the
                 middle of an empty column says less than the list arriving. -->
            {#each SKELETON_ROWS as index (index)}
              <li class="hub-view-row hub-view-row-skeleton" aria-hidden="true">
                <span class="hub-view-chat-avatar hub-view-skeleton-line"></span>
                <span class="hub-view-chat-copy">
                  <span class="hub-view-skeleton-line" style="width:42%"></span>
                  <span class="hub-view-skeleton-line" style="width:76%"></span>
                </span>
              </li>
            {/each}
          {:else}
            <li class="hub-view-empty">
              {conversationFilter !== 'all'
                ? $t('hub.noneMatchFilter')
                : chatSearch.trim()
                  ? $t('common.noMatches')
                  : focusedSpace
                    ? $t('hub.emptySpace')
                    : $t('hub.noConversations')}
            </li>
          {/if}
        {/each}
        {#if hiddenRows.length > 0}
          <!-- Hiding a chat does not remove it: what is hidden collects under
               one row at the foot of the list, which expands into the rows
               themselves the way a rail source expands into its accounts. -->
          <li>
            <button
              type="button"
              class="hub-view-row hub-view-hidden-row"
              aria-expanded={hiddenOpen}
              onclick={() => (hiddenOpen = !hiddenOpen)}
            >
              <span class="hub-view-chat-avatar placeholder" aria-hidden="true">
                <Icon name="eye-off" size={14} />
              </span>
              <span class="hub-view-chat-copy">
                <span class="hub-view-row-top">
                  <strong>{$t('hub.hiddenChats')}</strong>
                  <span class="hub-view-chat-when">
                    <em>{hiddenRows.length}</em>
                    <Icon name="chevron" size={12} />
                  </span>
                </span>
              </span>
            </button>
          </li>
          {#if hiddenOpen}
            {#each hiddenRows as chat (chat.id)}
              <li>
                {#if chat.space}
                  {@render spaceRow(chat)}
                {:else}
                  {@render chatRow(chat, true)}
                {/if}
              </li>
            {/each}
          {/if}
        {/if}
      </ul>
      {@render chatContextMenu()}
    {:else}
      <p class="hub-view-empty">
        {#if loading}
          <span class="loading-dots" role="status" aria-label={$t('common.loading')}><i></i><i></i><i></i></span>
        {:else}
          {$t('hub.pickSource')}
        {/if}
      </p>
    {/if}
  </section>

  <section
    class="hub-view-reader"
    class:file-drag-active={chatFileDragActive}
    aria-label={$t('hub.readingPane')}
    data-file-drop-scope={activeChat && !chatSearchOpen && voiceState === 'idle' ? 'hub-chat' : undefined}
    ondragenter={chatDragEnter}
    ondragover={chatDragOver}
    ondragleave={chatDragLeave}
    ondrop={(event) => void dropIntoChat(event)}
  >
    <div class="hub-file-drop-pane-overlay" aria-hidden="true"></div>
    {#if error}
      <p class="hub-view-error" role="alert">{error}</p>
    {/if}

    {#if composing}
      <header class="hub-view-reader-head">
        <button type="button" class="hub-view-back" onclick={closeReader}>
          <Icon name="back" size={13} /> Back
        </button>
        <h2>{composeDraft ? $t('hub.editDraft') : composeReply ? $t('hub.reply') : $t('hub.newMessage')}</h2>
      </header>
      <div class="hub-view-compose-form">
        <!-- The Cc toggle sits beside the field rather than inside its label:
             a control nested in a label is dropped from the accessibility
             tree, which makes it unreachable by anything but a mouse. -->
        <div class="hub-view-compose-row">
          <label>
            <span>{$t('hub.to')}</span>
            <input bind:value={composeTo} oninput={composeFieldChanged} spellcheck="false" placeholder="name@example.com" />
          </label>
          {#if !showCopies}
            <button type="button" class="hub-view-inline-link" onclick={() => (showCopies = true)}>
              Cc/Bcc
            </button>
          {/if}
        </div>
        {#if showCopies}
          <label>
            <span>{$t('hub.cc')}</span>
            <input bind:value={composeCc} oninput={composeFieldChanged} spellcheck="false" placeholder="name@example.com" />
          </label>
          <label>
            <span>{$t('hub.bcc')}</span>
            <input bind:value={composeBcc} oninput={composeFieldChanged} spellcheck="false" placeholder="name@example.com" />
          </label>
        {/if}
        <label>
          <span>{$t('hub.subject')}</span>
          <input bind:value={composeSubject} oninput={composeFieldChanged} />
        </label>
        {#if composeFiles.length > 0}
          <div class="hub-view-attachments">
            {#each composeFiles as file (file)}
              <span class="hub-view-file">
                {fileName(file)}
                <button
                  type="button"
                  title={$t('hub.removeAttachment')}
                  onclick={() => removeComposeFile(file)}
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            {/each}
          </div>
        {/if}
        {#if (currentAccount?.signatures.length ?? 0) > 0}
          <div class="hub-view-signature-control">
            <span>{$t('hub.signature')}</span>
            <Menu
              options={signatureOptions}
              value={composeSignatureId}
              label={$t('hub.chooseSignature')}
              icon="signature"
              wide
              onChange={chooseComposeSignature}
            />
          </div>
        {/if}
        <textarea bind:value={composeBody} oninput={composeFieldChanged} placeholder={$t('hub.writeMessage')}></textarea>
        {#if composeSignatureBody || safeComposeSignatureHtml}
          <div class="hub-view-signature-preview" role="region" aria-label={$t('hub.signaturePreview')}>
            <span>{$t('hub.signature')}</span>
            {#if safeComposeSignatureHtml}
              <div class="hub-view-signature-html">{@html safeComposeSignatureHtml}</div>
            {:else}
              <pre>{composeSignatureBody}</pre>
            {/if}
          </div>
        {/if}
        <footer>
          <div class="hub-view-compose-tools">
          <button type="button" onclick={() => void attachFiles()}>
            <Icon name="attach" size={13} /> Attach
          </button>
          <button
            type="button"
            class="hub-view-importance"
            class:enabled={composeImportance === 'high'}
            role="switch"
            aria-checked={composeImportance === 'high'}
            aria-label={$t('hub.markImportant')}
            data-tooltip-label={$t('hub.markImportant')}
            onclick={toggleComposeImportance}
          >
            <Icon name="flag" size={13} />
          </button>
          </div>
          <button type="button" onclick={leaveMailComposer}>{$t('common.cancel')}</button>
          <button type="button" disabled={busy === 'save-draft'} onclick={() => void sendMail(true)}>
            {busy === 'save-draft' ? $t('hub.saving') : $t('hub.saveDraft')}
          </button>
          <button
            type="button"
            class="primary"
            disabled={busy === 'send-mail' || !composeTo.trim()}
            onclick={() => void sendMail(false)}
          >
            {busy === 'send-mail' ? $t('hub.sending') : $t('composer.send')}
          </button>
        </footer>
      </div>
    {:else if openMail || openEnvelope}
      <header class="hub-view-reader-head">
        <!-- The chevron sits beside the subject rather than on a line above it,
             the same way it does in a chat: the subject is the title, and a
             labelled row of its own costs a line the message would rather have. -->
        <div class="hub-view-reader-title">
          <button
            type="button"
            class="hub-view-back hub-view-back-icon"
            aria-label={$t('browser.back')}
            onclick={closeReader}
          >
            <Icon name="back" size={15} />
          </button>
          <h2>{openMail?.subject ?? openEnvelope?.subject ?? ''}</h2>
        </div>
        <p>
          {openMail?.from?.name ??
            openMail?.from?.address ??
            (openEnvelope ? sender(openEnvelope) : $t('hub.unknownSender'))}
          {#if openMail?.date ?? openEnvelope?.date}
            <em>· {displayTime(openMail?.date ?? openEnvelope?.date ?? '')}</em>
          {/if}
        </p>
        {#if openMail && (openMail.to.length > 0 || openMail.cc.length > 0 || openMail.bcc.length > 0)}
          <!-- Each field on its own line and labelled, the way a message states
               them: a run of names is only readable once you know which field
               it belongs to. Bcc appears only on messages we sent. -->
          <p class="hub-view-recipients">
            {#if openMail.to.length > 0}
              <span><b>To:</b> {names(openMail.to)}</span>
            {/if}
            {#if openMail.cc.length > 0}
              <span><b>Cc:</b> {names(openMail.cc)}</span>
            {/if}
            {#if openMail.bcc.length > 0}
              <span><b>Bcc:</b> {names(openMail.bcc)}</span>
            {/if}
          </p>
        {/if}
        <!-- One strip of bare icons, each saying what it does on hover through
             the app's own tooltip rather than the system's: these actions are
             the same weight as every other icon control in the app, so they
             wear the same nothing — no pill, no rule between them, no label on
             the one that used to carry text.

             Too narrow for the row and the whole strip folds into one ⋮, where
             the actions get their names back beside the same icons. Folding
             all of them together keeps the reading pane's actions in one place
             at any width, rather than splitting them across a row and a menu. -->
        <div
          class="hub-view-reader-actions"
          class:compact={compactActions}
          bind:clientWidth={actionsWidth}
          onfocusout={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
              moveMenu = false;
              overflowMenu = false;
            }
          }}
        >
          {#if compactActions}
            <div class="hub-view-action-group hub-view-move">
              <button
                type="button"
                aria-label={$t('hub.moreActions')}
                aria-expanded={overflowMenu}
                onclick={() => {
                  overflowMenu = !overflowMenu;
                  moveMenu = false;
                }}
              >
                <Icon name="more" size={15} />
              </button>
              {#if overflowMenu}
                <!-- Opens rightwards: the ⋮ sits at the pane's leading edge, so
                     a menu anchored to its right edge would hang off the pane
                     and over the rail beside it. -->
                <ul class="hub-view-folder-menu">
                  {#if moveMenu && openEnvelope}
                    {@const envelope = openEnvelope}
                    {#each railFolders.filter((item) => item.name !== mailFolder) as target (target.name)}
                      <li>
                        <button
                          type="button"
                          onclick={() => {
                            overflowMenu = false;
                            void moveTo(envelope, target.name);
                          }}
                        >
                          <Icon name={FOLDER_ICONS[target.role] ?? 'folder'} size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
                          {target.label}
                        </button>
                      </li>
                    {/each}
                  {:else}
                    {#each mailActions as action (action.id)}
                      <li>
                        <button
                          type="button"
                          class:destructive={action.destructive}
                          class:on={action.on}
                          disabled={action.disabled}
                          onclick={() => runAction(action)}
                        >
                          <Icon name={action.icon} size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} filled={action.filled} />
                          {action.label}
                        </button>
                      </li>
                    {/each}
                  {/if}
                </ul>
              {/if}
            </div>
          {:else}
            {#each mailActions as action (action.id)}
              {#if action.id === 'move'}
                <div class="hub-view-action-group hub-view-move">
                  <button
                    type="button"
                    aria-label={action.label}
                    aria-expanded={moveMenu}
                    onclick={() => (moveMenu = !moveMenu)}
                  >
                    <Icon name={action.icon} size={15} />
                  </button>
                  {#if moveMenu && openEnvelope}
                    {@const envelope = openEnvelope}
                    <ul class="hub-view-folder-menu hub-view-menu-right">
                      {#each railFolders.filter((item) => item.name !== mailFolder) as target (target.name)}
                        <li>
                          <button type="button" onclick={() => void moveTo(envelope, target.name)}>
                            <Icon name={FOLDER_ICONS[target.role] ?? 'folder'} size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
                            {target.label}
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {:else}
                <button
                  type="button"
                  class:destructive={action.destructive}
                  class:on={action.on}
                  disabled={action.disabled}
                  aria-label={action.label}
                  onclick={() => action.run?.()}
                >
                  <Icon name={action.icon} size={15} filled={action.filled} />
                </button>
              {/if}
            {/each}
          {/if}
        </div>
      </header>
      {#if openMail}
        {#if openMail.attachments.length > 0}
          <!-- What came with the message, before the message: a strip of the
               same pills the composer uses, so a file reads the same wherever
               the app shows one. Clicking one hands it to the app's open menu,
               which hangs under the pill that was clicked. -->
          <div class="hub-view-mail-files">
            {#each openMail.attachments as file, index (file.name)}
              <button
                type="button"
                class="hub-view-mail-file"
                disabled={busy === 'attachments'}
                onclick={(event) => void openAttachment(index, event.currentTarget.getBoundingClientRect())}
              >
                <FileAttachment
                  name={file.name}
                  status={busy === 'attachments' && pendingAttachment === index ? 'uploading' : 'done'}
                  progress={busy === 'attachments' && pendingAttachment === index ? 40 : 100}
                  removable={false}
                />
              </button>
            {/each}
          </div>
        {/if}
        {#if safeHtml}
          <!-- The sender's own markup, sanitised: scripts, frames, forms and
               stylesheets are stripped, and links are opened in the real
               browser rather than inside the app. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="hub-view-body hub-view-html" onclick={openLink} onerrorcapture={hideBrokenImage}>
            {@html safeHtml}
          </div>
        {:else}
          <div class="hub-view-body">{openMail.body}</div>
        {/if}
        {#if thread.length > 1}
          <div class="hub-view-chain">
            <span class="hub-view-chain-head">Conversation · {thread.length} messages</span>
            {#each chainExpanded ? thread : thread.slice(0, CHAIN_HEAD) as item (item.id)}
              <button
                type="button"
                class:active={item.id === openEnvelope?.id}
                onclick={() => void readMail(item)}
              >
                <strong>{sender(item)}</strong>
                <em>{when(item.date)}</em>
              </button>
            {/each}
            {#if thread.length > CHAIN_HEAD}
              <button
                type="button"
                class="hub-view-chain-more"
                onclick={() => (chainExpanded = !chainExpanded)}
              >
                {chainExpanded ? 'Show less' : `Show all ${thread.length}`}
              </button>
            {/if}
          </div>
        {/if}
      {:else if readerLoading}
        <!-- Placeholder lines in the shape of a message, so the pane the click
             opened is already the final one and only its body fills in. -->
        <div class="hub-view-body hub-view-skeleton" aria-busy="true" aria-label={$t('hub.loadingMessage')}>
          {#each SKELETON_LINES as width, index (index)}
            <span class="hub-view-skeleton-line" style={`width:${width}`}></span>
          {/each}
        </div>
      {:else}
        <p class="hub-view-empty">{$t('hub.messageFailed')}</p>
      {/if}
    {:else if activeBroadcast}
      <header class="hub-view-reader-head hub-view-chat-head hub-view-broadcast-head">
        <button
          type="button"
          class="hub-view-back hub-view-back-icon"
          aria-label={$t('browser.back')}
          onclick={closeReader}
        >
          <Icon name="back" size={15} />
        </button>
        <div>
          <h2>{activeBroadcast.name}</h2>
          <p>
            {$t('hub.broadcastPrivateCount', {count: activeBroadcast.recipients.length})}
          </p>
        </div>
      </header>
      <div class="hub-view-thread hub-view-broadcast-thread">
        {#each broadcastMessages as message (message.id)}
          {@const failed = message.deliveries.filter((delivery) => delivery.status === 'failed')}
          {@const sent = message.deliveries.length - failed.length}
          <div class="hub-view-bubble-row mine">
            <div class="hub-view-bubble mine"><p>{message.body}</p></div>
            <span class="hub-view-broadcast-delivery" class:failed={failed.length > 0}>
              {failed.length > 0
                ? $t('hub.broadcastDeliveryPartial', {sent, total: message.deliveries.length})
                : $t('hub.broadcastDeliveryComplete', {count: sent})}
              · {messageTime(message.sentAt)}
            </span>
          </div>
        {:else}
          <p class="hub-view-empty">
            {busy === `broadcast:${activeBroadcast.id}` ? $t('common.loading') : $t('hub.noBroadcastMessages')}
          </p>
        {/each}
      </div>
      <div class="hub-view-composer-row hub-view-broadcast-composer-row">
        <div class="hub-view-composer">
          <textarea
            bind:value={broadcastDraft}
            rows="1"
            oninput={broadcastComposerChanged}
            placeholder={$t('hub.broadcastPlaceholder', {name: activeBroadcast.name})}
            onkeydown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                void sendBroadcast();
              }
            }}
          ></textarea>
          <button
            type="button"
            class="hub-view-primary"
            title={$t('hub.broadcastSend')}
            aria-label={$t('hub.broadcastSend')}
            disabled={!broadcastDraft.trim() || busy === 'send-broadcast'}
            onclick={() => void sendBroadcast()}
          >
            <Icon name="send" size={15} />
          </button>
        </div>
      </div>
    {:else if profileOpen && activeChat}
      <header class="hub-view-reader-head hub-view-profile-head">
        <button
          type="button"
          class="hub-view-back hub-view-back-icon"
          aria-label={$t('browser.back')}
          onclick={closeProfile}
        >
          <Icon name="back" size={15} />
        </button>
        <h2>{$t('hub.profile')}</h2>
      </header>
      <div class="hub-view-profile">
        <section class="hub-view-profile-hero">
          <span class="hub-view-profile-avatar">
            {@render chatAvatar(profileName, activeProfileChats[0]?.avatarUrl ?? activeChat.avatarUrl, `profile:${activeChat.id}`)}
          </span>
          <h2 class="hub-view-profile-name">
            <span>{profileName}</span>
            {#if activeProfileChats.some((chat) => chat.official)}{@render officialBadge()}{/if}
          </h2>
          <p>
            {activeProfilePlatformCount > 1
              ? $t('hub.platformCount', {count: activeProfilePlatformCount})
              : commsPlatformLabel(activeChat.platform as CommsPlatform)}
          </p>
          <div class="hub-view-profile-actions">
            <button type="button" onclick={() => void messageProfileChat(activeProfileChats[0] ?? activeChat)}>
              <Icon name="new-chat" size={15} />
              <span>{$t('hub.message')}</span>
            </button>
            <button type="button" onclick={startProfileMerge}>
              <Icon name="platforms" size={15} />
              <span>{$t('hub.mergeChats')}</span>
            </button>
          </div>
        </section>

        {#if profileMergeOpen}
          <section class="hub-view-profile-section hub-view-profile-merge">
            <h3>{$t('hub.mergeChats')}</h3>
            <label>
              <span>{$t('hub.contactName')}</span>
              <input bind:value={profileMergeName} maxlength="80" />
            </label>
            <div class="hub-view-profile-merge-list">
              {#each profileMergeCandidates as chat (chat.id)}
                <button
                  type="button"
                  class:selected={profileMergeSelected.has(chat.id)}
                  aria-pressed={profileMergeSelected.has(chat.id)}
                  onclick={() => toggleProfileMergeChat(chat)}
                >
                  <span class="hub-view-profile-check">
                    {#if profileMergeSelected.has(chat.id)}<Icon name="check" size={11} />{/if}
                  </span>
                  <PlatformLogo platform={chat.platform as Platform} size={16} />
                  <span><strong>{chat.name}</strong><small>{commsPlatformLabel(chat.platform as CommsPlatform)}</small></span>
                </button>
              {/each}
            </div>
            <footer>
              <button type="button" onclick={() => (profileMergeOpen = false)}>{$t('common.cancel')}</button>
              <button
                type="button"
                class="hub-view-primary"
                disabled={profileMergeSelected.size < 2 || busy === 'contact-merge'}
                onclick={() => void saveProfileMerge()}
              >
                {busy === 'contact-merge' ? $t('hub.saving') : $t('common.save')}
              </button>
            </footer>
          </section>
        {/if}

        <section class="hub-view-profile-section">
          <h3>{$t('hub.chatAccounts')}</h3>
          <div class="hub-view-profile-routes">
            {#each activeProfileChats as chat (chat.id)}
              <button type="button" onclick={() => void messageProfileChat(chat)}>
                <PlatformLogo platform={chat.platform as Platform} size={18} />
                <span>
                  <strong class="hub-view-name-with-badge">
                    <span>{chat.name}</span>
                    {#if chat.official}{@render officialBadge()}{/if}
                  </strong>
                  <small>{commsPlatformLabel(chat.platform as CommsPlatform)}</small>
                </span>
                <Icon name="forward" size={13} />
              </button>
            {/each}
          </div>
        </section>

        {#if profileIdentifiers.length > 0 || profileLoading}
          <section class="hub-view-profile-section">
            <h3>{$t('hub.info')}</h3>
            {#if profileLoading}
              <p class="hub-view-profile-loading">{$t('common.loading')}</p>
            {:else}
              <div class="hub-view-profile-identifiers">
                {#each profileIdentifiers as identifier (identifier)}<span>{identifier}</span>{/each}
              </div>
            {/if}
          </section>
        {/if}

        {#if activeProfileLink}
          <button
            type="button"
            class="hub-view-profile-unmerge"
            disabled={busy === 'contact-unmerge'}
            onclick={() => void removeProfileLink()}
          >
            {$t('hub.separateChats')}
          </button>
        {/if}
      </div>
    {:else if activeChat}
      <header class="hub-view-reader-head hub-view-chat-head" class:searching={chatSearchOpen}>
        {#if chatSearchOpen}
          <label class="hub-view-chat-search-field">
            <Icon name="search" size={14} />
            <input
              bind:this={chatSearchInput}
              bind:value={chatSearchQuery}
              type="search"
              placeholder={$t('hub.searchChatPlaceholder', {name: activeChat.name})}
              aria-label={$t('hub.searchChatPlaceholder', {name: activeChat.name})}
              onkeydown={(event) => {
                if (event.key === 'Escape') closeChatSearch();
              }}
            />
            {#if chatSearchQuery}
              <button
                type="button"
                aria-label={$t('common.clearSearch')}
                onclick={() => {
                  chatSearchQuery = '';
                  chatSearchInput?.focus();
                }}
              >
                <Icon name="close" size={11} />
              </button>
            {/if}
          </label>
          <button
            type="button"
            class="hub-view-chat-search-close"
            aria-label={$t('hub.closeChatSearch')}
            onclick={closeChatSearch}
          >
            <Icon name="close" size={14} />
          </button>
        {:else}
          <!-- The chevron sits beside the name rather than above it: in a
               conversation the name is the title, and a labelled row of its own
               costs a line that the thread would rather have. -->
          <button
            type="button"
            class="hub-view-back hub-view-back-icon"
            aria-label={$t('browser.back')}
            onclick={closeReader}
          >
            <Icon name="back" size={15} />
          </button>
          {#if activeChat.group}
            <h2>{activeChat.name}</h2>
          {:else}
            <button
              type="button"
              class="hub-view-chat-profile-trigger"
              aria-label={$t('hub.viewProfile', {name: activeChat.name})}
              onclick={() => void openProfile(activeChat!, true)}
            >
              <span>{activeChat.name}</span>
              {#if activeChat.official}{@render officialBadge()}{/if}
            </button>
          {/if}
          <div
            class="hub-view-chat-actions"
            onfocusout={(event) => {
              const next = event.relatedTarget;
              if (!(next instanceof Node) || !event.currentTarget.contains(next)) closeChatHeaderMenu();
            }}
          >
            <button
              type="button"
              class="hub-view-chat-more"
              aria-label={$t('hub.moreActions')}
              aria-haspopup="menu"
              aria-expanded={chatHeaderMenuOpen}
              onclick={() => void toggleChatHeaderMenu()}
            >
              <Icon name="more" size={15} />
            </button>
            {#if chatHeaderMenuOpen}
              <ul
                bind:this={chatHeaderMenu}
                class="hub-view-folder-menu hub-view-chat-actions-menu"
                role="menu"
                aria-label={$t('hub.moreActions')}
                transition:fade={{duration: 100}}
              >
                {#if !activeChat.group}
                  <li role="presentation">
                    <button
                      type="button"
                      role="menuitem"
                      onclick={() => {
                        const chat = activeChat!;
                        closeChatHeaderMenu();
                        void openProfile(chat, true);
                      }}
                    >
                      <Icon name="user" size={14} />
                      <span>{$t('hub.viewProfileAction')}</span>
                    </button>
                  </li>
                {/if}
                <li role="presentation">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy.startsWith('chat:')}
                    onclick={() => void openChatSearch()}
                  >
                    <Icon name="search" size={14} />
                    <span>{$t('hub.searchChat')}</span>
                  </button>
                </li>
                <li role="presentation">
                  <button
                    type="button"
                    role="menuitem"
                    onclick={() => {
                      chatPrefs = togglePinned(chatPrefs, activeChat!.id);
                      closeChatHeaderMenu();
                    }}
                  >
                    <Icon name={chatPrefs.pinned.includes(activeChat.id) ? 'pin-off' : 'pin'} size={14} />
                    <span>{chatPrefs.pinned.includes(activeChat.id) ? $t('hub.unpinChat') : $t('hub.pinChat')}</span>
                  </button>
                </li>
                <li role="presentation">
                  <button
                    type="button"
                    role="menuitem"
                    onclick={() => {
                      chatPrefs = toggleMuted(chatPrefs, activeChat!.id);
                      closeChatHeaderMenu();
                    }}
                  >
                    <Icon name={chatPrefs.muted.includes(activeChat.id) ? 'speaker' : 'speaker-off'} size={14} />
                    <span>{chatPrefs.muted.includes(activeChat.id) ? $t('hub.unmuteChat') : $t('hub.muteChat')}</span>
                  </button>
                </li>
              </ul>
            {/if}
          </div>
        {/if}
      </header>
      {#if chatSearchOpen}
        <nav class="hub-view-chat-search-tabs" aria-label={$t('hub.searchFilters')}>
          {#each CHAT_SEARCH_FILTERS as filter (filter)}
            <button
              type="button"
              class:active={chatSearchFilter === filter}
              aria-pressed={chatSearchFilter === filter}
              onclick={() => (chatSearchFilter = filter)}
            >
              {filter === 'all'
                ? $t('hub.searchAll')
                : filter === 'messages'
                  ? $t('hub.messages')
                  : filter === 'media'
                    ? $t('hub.media')
                    : filter === 'files'
                      ? $t('hub.files')
                      : $t('hub.links')}
            </button>
          {/each}
        </nav>
        <div class="hub-view-chat-search-results" use:scrollFade={chatSearchResults.length}>
          {#each chatSearchResults as result (result.key)}
            <button
              type="button"
              class="hub-view-chat-search-result"
              onclick={() => void revealChatSearchResult(result)}
            >
              <span class="hub-view-chat-search-preview" aria-hidden="true">
                {#if result.kind === 'media' && result.attachment?.url && attachmentRenderKind(result.attachment) === 'image' && !brokenMedia.has(result.attachment.url)}
                  <img
                    src={result.attachment.url}
                    alt=""
                    loading="lazy"
                    onerror={(event) => retryMedia(event, result.attachment!.url!)}
                  />
                {:else}
                  <Icon name={chatSearchResultIcon(result)} size={15} />
                {/if}
              </span>
              <span class="hub-view-chat-search-copy">
                <strong>{result.title}</strong>
                {#if result.detail}<small>{result.detail}</small>{/if}
                <em>{senderLabel(result.message)} · {displayTime(result.message.sentAt, {compact: true})}</em>
              </span>
            </button>
          {:else}
            {#if !chatSearchLoading}
              <p class="hub-view-empty">{$t('hub.noChatSearchResults')}</p>
            {/if}
          {/each}
          {#if chatSearchLoading}
            <p class="hub-view-chat-search-loading">
              <span class="loading-dots" role="status" aria-label={$t('common.loading')}><i></i><i></i><i></i></span>
              <span>{$t('hub.searchingChatHistory')}</span>
            </p>
          {/if}
        </div>
      {:else}
      <div class="hub-view-thread" bind:this={threadEl} onscroll={onThreadScroll}>
        {#each chatTimeline as item (item.key)}
          {@const stampEntry = item.kind === 'notice' ? item.entry : item.entries[item.entries.length - 1]!}
          {#if item.kind === 'notice'}
            <p class="hub-view-notice">{item.entry.message.body}</p>
          {:else}
          <div class="hub-view-message-run">
          {#each item.entries as entry (entry.message.id)}
          {@const message = entry.message}
          {@const index = entry.index}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="hub-view-bubble-row"
            class:mine={message.mine}
            data-message-id={message.id}
            oncontextmenu={(event) => openMessageMenu(event, message)}
          >
          <!-- Who sent it, above the bubble and aligned to its leading edge.
               Every platform and conversation type uses this same treatment;
               groups identify each participant, while a direct chat keeps the
               sender identity beside the message itself. A bridged sender id
               reads `@whatsapp_614…:server`, which names nobody, so the name
               the bridge resolved is what shows. -->
          {#if index === item.oldestIndex}
            {#if message.mine}
              <span class="hub-view-bubble-who-space" aria-hidden="true">You</span>
            {:else}
              <span class="hub-view-bubble-who">
                {@render chatAvatar(
                  senderLabel(message),
                  message.senderAvatarUrl ?? (!activeChat.group ? activeChat.avatarUrl : null),
                  `sender:${activeChat.id}:${message.sender}`,
                  true,
                )}
                <span class="hub-view-bubble-sender">{senderLabel(message)}</span>
              </span>
            {/if}
          {/if}
          <div class="hub-view-bubble-line" class:mine={message.mine}>
          {#if message.mine}
            <time class="hub-view-bubble-time" datetime={message.sentAt}>{messageTime(message.sentAt)}</time>
          {/if}
          <div
            class="hub-view-bubble"
            class:mine={message.mine}
            class:reply-target-highlight={replyTargetHighlight === message.id}
          >
            {#if quoted(message)}
              <!-- What this answers, kept short: the point is recognition, and
                   the message it quotes is a scroll away. -->
              <span class="hub-view-quote">
                <strong>{senderLabel(quoted(message)!)}</strong>
                {quoted(message)!.body || $t('hub.attachment')}
              </span>
            {:else if message.replyTo}
              <span class="hub-view-quote">{$t('hub.replyToEarlier')}</span>
            {/if}
            {#each message.attachments ?? [] as attachment (`${attachment.kind}:${attachment.url ?? attachment.name}`)}
              {@const attachmentKind = attachmentRenderKind(attachment)}
              {#if !attachment.url}
                <!-- The source network described this attachment but did not
                     expose bytes. Keep its native shape; `viewIn` below is the
                     route to the source app. -->
                <span class="hub-view-bubble-file">
                  <Icon name={attachmentKind === 'audio' ? 'mic' : attachmentKind === 'video' ? 'video' : 'attach'} size={13} />
                  <span class="hub-view-bubble-file-name">{attachment.name}</span>
                </span>
              {:else if brokenMedia.has(attachment.url)}
                <!-- The homeserver would not serve these bytes — a picture the
                     bridge referenced but never carried across. A named chip
                     says what was here; the blank full-size frame said
                     nothing, at length. -->
                <span class="hub-view-bubble-file">
                  <Icon name="attach" size={13} />
                  <span class="hub-view-bubble-file-name">{attachment.name}</span>
                </span>
              {:else if attachmentKind === 'image'}
                <img
                  class="hub-view-bubble-image"
                  class:sticker={attachment.sticker}
                  src={attachment.url}
                  alt={attachment.name}
                  width={attachment.width ?? undefined}
                  height={attachment.height ?? undefined}
                  loading="lazy"
                  onerror={(event) => retryMedia(event, attachment.url!)}
                />
              {:else if attachmentKind === 'audio'}
                <!-- Voice notes are most of what arrives on these networks, so
                     they play in place rather than downloading first. -->
                <audio
                  class="hub-view-bubble-audio"
                  controls
                  preload="metadata"
                  src={attachment.url}
                  onerror={(event) => retryMedia(event, attachment.url!)}
                ></audio>
              {:else if attachmentKind === 'video'}
                <!-- svelte-ignore a11y_media_has_caption -->
                <!-- A video someone sent over WhatsApp has no caption track to
                     offer; there is nothing to point this at. -->
                <video
                  class="hub-view-bubble-video"
                  controls
                  playsinline
                  preload="metadata"
                  src={attachment.url}
                  aria-label={attachment.name}
                  onerror={(event) => retryMedia(event, attachment.url!)}
                ></video>
              {:else}
                <a class="hub-view-bubble-file" href={attachment.url} download={attachment.name}>
                  <Icon name="attach" size={13} />
                  <span class="hub-view-bubble-file-name">{attachment.name}</span>
                </a>
              {/if}
            {/each}
            {#if message.body}
              <p>
                {#each messageParts(message.body) as part}
                  {#if part.url}<a class="hub-view-message-link" href={part.url} onclick={openLink}>{part.text}</a>{:else}{part.text}{/if}
                {/each}
              </p>
            {/if}
            {#if message.linkPreview}
              {@const preview = message.linkPreview}
              {#if preview.url}
                <a class="hub-view-link-card" class:with-image={!!preview.imageUrl} href={preview.url} onclick={openLink}>
                  <span class="hub-view-link-copy">
                    {#if preview.source}<small>{preview.source}</small>{/if}
                    <strong>{preview.title}</strong>
                    {#if preview.description}<span>{preview.description}</span>{/if}
                  </span>
                  {#if preview.imageUrl && !brokenMedia.has(preview.imageUrl)}
                    <img
                      src={preview.imageUrl}
                      alt=""
                      width={preview.imageWidth ?? undefined}
                      height={preview.imageHeight ?? undefined}
                      loading="lazy"
                      onerror={(event) => retryMedia(event, preview.imageUrl!)}
                    />
                  {/if}
                </a>
              {:else}
                <span class="hub-view-link-card" class:with-image={!!preview.imageUrl}>
                  <span class="hub-view-link-copy">
                    {#if preview.source}<small>{preview.source}</small>{/if}
                    <strong>{preview.title}</strong>
                    {#if preview.description}<span>{preview.description}</span>{/if}
                  </span>
                  {#if preview.imageUrl && !brokenMedia.has(preview.imageUrl)}
                    <img
                      src={preview.imageUrl}
                      alt=""
                      width={preview.imageWidth ?? undefined}
                      height={preview.imageHeight ?? undefined}
                      loading="lazy"
                      onerror={(event) => retryMedia(event, preview.imageUrl!)}
                    />
                  {/if}
                </span>
              {/if}
            {/if}
            {#if message.viewIn}
              <!-- Media the bridge could not carry across. The source app can
                   still show it, so the placeholder opens that app rather than
                   leaving the reader at a dead end. -->
              <button
                type="button"
                class="hub-view-bubble-viewin"
                onclick={() => void api.browser.openExternal(message.viewIn!.url)}
              >
                <Icon name="link" size={12} />
                {$t('hub.viewIn', {app: message.viewIn.app})}
              </button>
            {/if}
            {#if (message.reactions ?? []).length > 0}
              <MessageReactions
                reactions={message.reactions ?? []}
                onreact={(key) => void react(message, key)}
              />
            {/if}
          </div>
          {#if !message.mine}
            <time class="hub-view-bubble-time" datetime={message.sentAt}>{messageTime(message.sentAt)}</time>
          {/if}
          </div>
          </div>
          {/each}
          </div>
          {/if}
          <!-- After the run in the DOM, which `column-reverse` paints above it:
               the stamp introduces the run that starts here. -->
          {#if startsRun(stampEntry.index)}
            <p class="hub-view-stamp">{displayTime(stampEntry.message.sentAt)}</p>
          {/if}
        {:else}
          {#if busy.startsWith('chat:')}
            {#each SKELETON_BUBBLES as bubble, index (index)}
              <div class="hub-view-bubble-row" class:mine={bubble.mine} aria-hidden="true">
                <div class="hub-view-bubble hub-view-bubble-skeleton" class:mine={bubble.mine} style={`width:${bubble.width}`}></div>
              </div>
            {/each}
          {:else}
            <p class="hub-view-empty">{$t('hub.noMessages')}</p>
          {/if}
        {/each}
        <!-- Last in the DOM, so `column-reverse` puts it at the top of the
             thread — where the history being fetched is about to appear. -->
        {#if busy === 'chat-older'}
          <p class="hub-view-older">
            <span class="loading-dots" role="status" aria-label={$t('common.loading')}><i></i><i></i><i></i></span>
          </p>
        {/if}
      </div>

      {#if messageMenu}
        {@const target = messageMenu.message}
        <!-- Fixed to the viewport rather than to the thread: the thread
             scrolls, and a menu that scrolls with it would drift away from the
             message it was opened on. -->
        <div
          class="polymux-dropdown-menu hub-view-message-menu"
          class:has-reactions={activeChat.platform !== 'wechat'}
          role="menu"
          bind:this={messageMenuEl}
          style:left={`${messageMenu.x}px`}
          style:top={messageMenuBottom === null ? `${messageMenu.y}px` : 'auto'}
          style:bottom={messageMenuBottom === null ? 'auto' : `${messageMenuBottom}px`}
          style:visibility={messageMenu.placed ? 'visible' : 'hidden'}
        >
          {#if activeChat.platform !== 'wechat'}
            <span class="hub-view-emoji-row">
              {#each QUICK_REACTIONS as emoji (emoji)}
                <button type="button" onclick={() => { void react(target, emoji); closeMessageMenu(); }}>{emoji}</button>
              {/each}
              <button
                type="button"
                class="hub-view-emoji-more"
                class:active={reactionPickerOpen}
                aria-label={$t('hub.react')}
                aria-expanded={reactionPickerOpen}
                onclick={toggleReactionPicker}
              ><Icon name="plus" size={15} /></button>
            </span>
            {#if reactionPickerOpen}
              <EmojiPicker
                direction={reactionPickerDirection}
                onpick={(emoji) => pickExpandedReaction(target, emoji)}
              />
            {/if}
          {/if}
          <button
            class="polymux-dropdown-item"
            role="menuitem"
            onclick={() => { startReply(target); closeMessageMenu(); }}
          ><Icon name="reply" size={14} /><span>{$t('hub.reply')}</span></button>
          <button
            class="polymux-dropdown-item"
            role="menuitem"
            onclick={() => { void copyMessage(target); closeMessageMenu(); }}
          ><Icon name="copy" size={14} /><span>{$t('common.copy')}</span></button>
          {#if activeChat.platform === 'wechat' && target.mine}
            <button
              class="polymux-dropdown-item"
              role="menuitem"
              disabled={busy === `recall:${target.id}`}
              onclick={() => void recallMessage(target)}
            ><Icon name="trash" size={14} /><span>{$t('common.delete')}</span></button>
          {/if}
        </div>
      {/if}

      <div class="hub-view-chat-footer" class:replying={!!replyTo}>
        {#if awayFromLatest}
          <!-- Sits over the foot of the thread, above the composer: the way back
               to the newest message once the reader has scrolled up from it. -->
          <button type="button" class="hub-view-to-latest" onclick={scrollToLatest}>
            <Icon name="arrow-down" size={13} />
            <span>{$t('chat.scrollToBottom')}</span>
          </button>
        {/if}
        {#if replyTo}
          <!-- Floats over the thread instead of occupying an opaque row of its
               own; only the pill itself obscures the messages beneath it. -->
          <div class="hub-view-replying">
            <button
              type="button"
              class="hub-view-reply-jump"
              onclick={jumpToChatReply}
            >
              <Icon name="reply" size={12} />
              <span><strong>{senderLabel(replyTo)}</strong> {replyTo.body || $t('hub.attachment')}</span>
            </button>
            <button
              type="button"
              class="hub-view-reply-cancel"
              aria-label={$t('common.cancel')}
              onclick={cancelChatReply}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        {/if}
        {#if chatFiles.length > 0}
          <div class="hub-view-chat-files" aria-label={$t('hub.attachFiles')}>
            {#each chatFiles as file (file)}
              <span class="hub-view-file">
                <Icon name="attach" size={12} />
                <span class="hub-view-chat-file-name" title={file}>{fileName(file)}</span>
                <button
                  type="button"
                  aria-label={$t('hub.removeAttachment')}
                  onclick={() => removeChatFile(file)}
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            {/each}
          </div>
        {/if}
      <!-- The circular add control is a peer of the rounded message field. Its
           upward menu owns occasional tools; the field keeps only typing and
           its contextual voice/send action. During recording the add control
           steps aside because files and emoji do not belong to a voice take. -->
        <div class="hub-view-composer-row">
        {#if voiceState === 'idle'}
          <button
            type="button"
            class="hub-view-composer-add"
            class:active={composerToolsOpen || composerEmojiOpen}
            title={$t('hub.moreActions')}
            aria-label={$t('hub.moreActions')}
            aria-haspopup="menu"
            aria-expanded={composerToolsOpen || composerEmojiOpen}
            onclick={() => void toggleComposerTools()}
          >
            <Icon name="plus" size={16} />
          </button>
          {#if composerToolsOpen}
            <div
              bind:this={composerToolsMenu}
              class="hub-view-composer-tools-menu polymux-dropdown-menu"
              role="menu"
              aria-label={$t('hub.moreActions')}
            >
              <button
                type="button"
                class="polymux-dropdown-item"
                role="menuitem"
                disabled={busy === 'attach'}
                onclick={() => void attachToChat()}
              >
                <Icon name="attach" size={14} />
                <span>{$t('hub.attachFiles')}</span>
              </button>
              <button
                type="button"
                class="polymux-dropdown-item"
                role="menuitem"
                onclick={openComposerEmojiPicker}
              >
                <Icon name="smile" size={14} />
                <span>{$t('hub.addEmoji')}</span>
              </button>
              {#if activeChat.platform === 'wechat'}
                <button
                  type="button"
                  class="polymux-dropdown-item"
                  role="menuitem"
                  disabled={busy === 'sticker'}
                  onclick={() => void sendSticker()}
                >
                  <Icon name="image" size={14} />
                  <span>{$t('hub.sendSticker')}</span>
                </button>
              {/if}
            </div>
          {/if}
          {#if composerEmojiOpen}
            <EmojiPicker direction="above" ariaLabel={$t('hub.emoji')} onpick={insertComposerEmoji} />
          {/if}
        {/if}
        <div class="hub-view-composer" class:capturing={voiceState !== 'idle'}>
        {#if voiceState === 'idle'}
          {#if composerAutocompleteOpen}
            <div
              class="hub-view-composer-autocomplete"
              id="hub-composer-autocomplete"
              role="listbox"
              aria-label={$t('hub.composerSuggestions')}
              use:scrollFade={composerSuggestions.length}
            >
              {#each composerSuggestions as suggestion, index (suggestion.id)}
                <button
                  type="button"
                  id={`hub-composer-suggestion-${index}`}
                  class:active={index === composerAutocompleteIndex}
                  role="option"
                  aria-selected={index === composerAutocompleteIndex}
                  aria-label={suggestion.userId
                    ? `${suggestion.value}, ${suggestion.label}`
                    : suggestion.value}
                  onmouseenter={() => composerAutocompleteIndex = index}
                  onmousedown={(event) => event.preventDefault()}
                  onclick={() => chooseComposerSuggestion(suggestion)}
                >
                  {#if suggestion.avatarUrl}
                    <img class="hub-view-composer-autocomplete-avatar" src={suggestion.avatarUrl} alt="" />
                  {:else}
                    <span class="hub-view-composer-autocomplete-avatar placeholder" aria-hidden="true">
                      <Icon name={suggestion.kind === 'command' ? 'bot' : suggestion.userId ? 'user' : 'users'} size={10} />
                    </span>
                  {/if}
                  <strong>{suggestion.value}</strong>
                </button>
              {/each}
            </div>
          {/if}
          {#if !draft}
            <span class="hub-view-composer-hint" aria-hidden="true">
              {$t('hub.messagePlaceholder', {name: activeChat.name})}
            </span>
          {/if}
          <textarea
            bind:this={composerInput}
            bind:value={draft}
            rows="1"
            oninput={chatComposerChanged}
            onclick={updateComposerCursor}
            onkeyup={updateComposerCursor}
            placeholder={$t('hub.messagePlaceholder', {name: activeChat.name})}
            aria-label={$t('hub.messagePlaceholder', {name: activeChat.name})}
            aria-autocomplete="list"
            aria-controls={composerAutocompleteOpen ? 'hub-composer-autocomplete' : undefined}
            aria-activedescendant={composerAutocompleteOpen
              ? `hub-composer-suggestion-${composerAutocompleteIndex}`
              : undefined}
            onkeydown={chatComposerKeydown}
          ></textarea>
          {#if draft.trim() || chatFiles.length > 0}
            <button
              type="button"
              class="hub-view-primary"
              title={$t('hub.send')}
              aria-label={$t('hub.send')}
              disabled={busy === 'send-chat'}
              onclick={() => void sendChat()}
            >
              <Icon name="send" size={15} />
            </button>
          {:else}
            <button
              type="button"
              class="hub-view-primary"
              title={$t('hub.recordVoice')}
              aria-label={$t('hub.recordVoice')}
              disabled={busy === 'voice'}
              onclick={() => void startVoice()}
            >
              <Icon name="mic" size={15} />
            </button>
          {/if}
        {:else}
          <button
            type="button"
            class="hub-view-discard"
            title={$t('hub.discardRecording')}
            aria-label={$t('hub.discardRecording')}
            onclick={() => void discardVoice()}
          >
            <Icon name="trash" size={15} />
          </button>
          <div class="hub-view-take">
            {#if voiceState === 'paused'}
              <button
                type="button"
                class="hub-view-take-play"
                title={previewing ? $t('common.pause') : $t('hub.playRecording')}
                aria-label={previewing ? $t('common.pause') : $t('hub.playRecording')}
                onclick={togglePreview}
              >
                <Icon name={previewing ? 'pause' : 'play'} size={12} />
              </button>
            {:else}
              <!-- The dot says it is live, the way a recorder's light does. -->
              <span class="hub-view-take-live" aria-hidden="true"></span>
            {/if}
            <span class="hub-view-take-clock">{clockOf(elapsed)}</span>
            <span class="hub-view-take-wave" aria-hidden="true">
              {#each levels as level, index (index)}
                <i style={`height:${Math.max(2, Math.round(level * 18))}px`}></i>
              {/each}
            </span>
          </div>
          {#if voiceState === 'recording'}
            <button
              type="button"
              title={$t('hub.pauseRecording')}
              aria-label={$t('hub.pauseRecording')}
              onclick={pauseVoice}
            >
              <Icon name="pause" size={15} />
            </button>
          {:else}
            <button
              type="button"
              title={$t('hub.resumeRecording')}
              aria-label={$t('hub.resumeRecording')}
              onclick={resumeVoice}
            >
              <Icon name="mic" size={15} />
            </button>
          {/if}
          <button
            type="button"
            class="hub-view-primary hub-view-send-voice"
            title={$t('hub.send')}
            aria-label={$t('hub.send')}
            disabled={busy === 'voice'}
            onclick={() => void sendVoice()}
          >
            <Icon name="send" size={15} />
          </button>
        {/if}
        </div>
        </div>
      </div>
      {/if}
    {:else}
      <div class="hub-view-blank">
        <Icon name="chat" size={30} />
        <h2>{$t('hub.nothingOpen')}</h2>
        <p>{$t('hub.nothingOpenBody')}</p>
      </div>
    {/if}
  </section>
</div>
</div>

{#snippet conversationFilterControl()}
  <div
    class="hub-view-conversation-filter"
    onfocusout={(event) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !event.currentTarget.contains(next)) conversationFilterMenu = false;
    }}
  >
    <button
      type="button"
      class="hub-view-chat-filter-button"
      class:on={conversationFilter !== 'all' || conversationSort !== 'latest'}
      aria-label={$t('hub.filterConversations')}
      aria-haspopup="menu"
      aria-expanded={conversationFilterMenu}
      onclick={() => (conversationFilterMenu = !conversationFilterMenu)}
    >
      <Icon name="filter" size={15} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
    </button>
    {#if conversationFilterMenu}
      <ul
        class="hub-view-folder-menu hub-view-conversation-filter-menu"
        role="menu"
        aria-label={$t('hub.filterConversations')}
        transition:fade={{duration: 100}}
      >
        <li class="hub-view-menu-heading" role="presentation">{$t('hub.filter')}</li>
        {#each CONVERSATION_FILTERS as option (option.id)}
          <li role="presentation">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={conversationFilter === option.id}
              class:active={conversationFilter === option.id}
              onclick={() => {
                conversationFilter = option.id;
                conversationFilterMenu = false;
              }}
            >
              <Icon name={option.icon} size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
              {option.label}
            </button>
          </li>
        {/each}
        <li class="hub-view-menu-heading" role="presentation">{$t('hub.sort')}</li>
        {#each CONVERSATION_SORTS as option (option.id)}
          <li role="presentation">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={conversationSort === option.id}
              class:active={conversationSort === option.id}
              onclick={() => {
                conversationSort = option.id;
                conversationFilterMenu = false;
              }}
            >
              <Icon name={option.icon} size={13} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
              {option.label}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/snippet}

{#snippet officialBadge()}
  <span class="hub-view-official" aria-label={$t('settings.official')} title={$t('settings.official')}>
    <Icon name="verified" size={12} strokeWidth={1.8} />
  </span>
{/snippet}

{#snippet spaceRow(space: ChatDto, showPlatform = false)}
{@const unread = chatUnread(space)}
{@const childCount = spaceChildCount(space)}
<button
  type="button"
  class="hub-view-row hub-view-space-row"
  class:unread={unread > 0}
  aria-label={$t('hub.openSpace', {name: space.name, count: childCount})}
  onclick={() => openSpace(space)}
>
  <span class="hub-view-space-stack" aria-hidden="true">
    <span class="hub-view-space-layer hub-view-space-layer-back"></span>
    <span class="hub-view-space-layer hub-view-space-layer-middle"></span>
    <span class="hub-view-space-front">
      {@render chatAvatar(space.name, space.avatarUrl, space.id)}
    </span>
    {#if showPlatform}
      <span class="hub-view-platform-badge">
        <PlatformLogo platform={space.platform as Platform} size={12} />
      </span>
    {/if}
  </span>
  <span class="hub-view-chat-copy">
    <span class="hub-view-row-top">
      <strong>{space.name}</strong>
      <span class="hub-view-chat-when hub-view-space-open-mark">
        <Icon name="forward" size={12} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH} />
      </span>
    </span>
    <span class="hub-view-chat-bottom">
      <span class="hub-view-chat-preview">
        {space.preview || $t('hub.spaceChats', {count: childCount})}
      </span>
      {#if unread > 0}
        <span class="hub-view-chat-unread" aria-label={$t('hub.unreadCount', {count: unread})}
          >{unread > 99 ? '99+' : unread}</span
        >
      {/if}
    </span>
  </span>
</button>
{/snippet}

{#snippet chatRow(chat: ChatDto, nested: boolean, showPlatform = false)}
{@const unread = chatUnread(chat)}
<button
  type="button"
  class="hub-view-row"
  class:nested
  class:active={activeChat?.id === chat.id}
  class:unread={unread > 0}
  onclick={() => void openChat(chat)}
  oncontextmenu={(event) => openChatMenu(event, chat)}
>
  <span class="hub-view-chat-avatar-wrap">
  {@render chatAvatar(chat.name, chat.avatarUrl, chat.id)}
  {#if showPlatform}
    <span class="hub-view-platform-badge" aria-hidden="true">
      <PlatformLogo platform={chat.platform as Platform} size={12} />
    </span>
  {/if}
  </span>
  <!-- Two lines, each with its own right-hand element: the time
       sits against the name, the unread count against the preview,
       so both columns centre on the line they belong to. -->
  <span class="hub-view-chat-copy">
    <span class="hub-view-row-top">
      <strong class="hub-view-name-with-badge">
        <span>{chat.name}</span>
        {#if chat.official}{@render officialBadge()}{/if}
      </strong>
      <!-- The pin and the time are one trailing group, so the pin
           reads as a mark on the row's own corner rather than
           something floating between the two columns, and the two
           sit on one centre line. -->
      <span class="hub-view-chat-when">
        {#if chatPrefs.pinned.includes(chat.id)}
          <!-- The glyph is decorative, so the state it stands for is said in
               words for anyone who cannot see it. -->
          <span class="visually-hidden">{$t('hub.pinned')}</span>
          <Icon name="pin" size={11} />
        {/if}
        {#if chatPrefs.muted.includes(chat.id)}
          <span class="visually-hidden">{$t('hub.muted')}</span>
          <Icon name="speaker-off" size={11} />
        {/if}
        {#if chat.lastActivity}
          <time datetime={chat.lastActivity}>{chat.lastActivity ? when(chat.lastActivity) : ''}</time>
        {/if}
      </span>
    </span>
    <span class="hub-view-chat-bottom">
      <span class="hub-view-chat-preview">{chat.preview ?? ''}</span>
      {#if unread > 0}
        <span class="hub-view-chat-unread" aria-label={$t('hub.unreadCount', {count: unread})}
          >{unread > 99 ? '99+' : unread}</span
        >
      {/if}
    </span>
  </span>
</button>
{/snippet}

<!-- One avatar renderer for every messaging platform and every place a chat
     identity appears. The inline form only changes the scale; its rounded
     square, crop, fallback, and failed-image handling stay identical to the
     chat rail's. -->
{#snippet chatAvatar(name: string, avatarUrl: string | null | undefined, key: string, inline = false)}
  {@const initial = avatarInitial(name)}
  {#if avatarUrl && !brokenAvatars.has(key)}
    <!-- Bridged avatars are fetched from the homeserver's authenticated media
         endpoint. A stable fallback replaces a source image that is absent or
         fails, so no platform leaves a broken-image glyph behind. -->
    <img
      class="hub-view-chat-avatar"
      class:inline
      src={avatarUrl}
      alt=""
      loading="lazy"
      onerror={() => markAvatarBroken(key)}
    />
  {:else}
    <span class="hub-view-chat-avatar placeholder" class:inline aria-hidden="true">
      {#if initial}
        {initial}
      {:else}
        <Icon name="user" size={inline ? 7 : 14} />
      {/if}
    </span>
  {/if}
{/snippet}

{#snippet chatContextMenu()}
  {#if chatMenu}
    {@const target = chatMenu.chat}
    {@const pinned = chatPrefs.pinned.includes(target.id)}
    {@const muted = chatPrefs.muted.includes(target.id)}
    {@const hidden = chatPrefs.hidden.includes(target.id)}
    <!-- Fixed to the viewport rather than to the list, which scrolls: a menu
         stays attached to the row in both a platform list and All Platforms. -->
    <div
      class="polymux-dropdown-menu hub-view-chat-menu"
      role="menu"
      bind:this={chatMenuEl}
      style:left={`${chatMenu.x}px`}
      style:top={`${chatMenu.y}px`}
      style:visibility={chatMenu.placed ? 'visible' : 'hidden'}
    >
      <button class="polymux-dropdown-item" role="menuitem" onclick={() => { chatPrefs = togglePinned(chatPrefs, target.id); closeChatMenu(); }}>
        <Icon name={pinned ? 'pin-off' : 'pin'} size={14} /><span>{pinned ? $t('hub.unpinChat') : $t('hub.pinChat')}</span>
      </button>
      <button class="polymux-dropdown-item" role="menuitem" onclick={() => { chatPrefs = toggleMuted(chatPrefs, target.id); closeChatMenu(); }}>
        <Icon name={muted ? 'speaker' : 'speaker-off'} size={14} /><span>{muted ? $t('hub.unmuteChat') : $t('hub.muteChat')}</span>
      </button>
      <button class="polymux-dropdown-item" role="menuitem" onclick={() => { chatPrefs = toggleHidden(chatPrefs, target.id); closeChatMenu(); }}>
        <Icon name={hidden ? 'eye' : 'eye-off'} size={14} /><span>{hidden ? $t('hub.unhideChat') : $t('hub.hideChat')}</span>
      </button>
    </div>
  {/if}
{/snippet}
