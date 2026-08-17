<script module lang="ts">
  import type {
    ChatDto as CachedChatDto,
    ChatMessageDto as CachedMessageDto,
    CommsStatusDto as CachedStatusDto,
    MailEnvelopeDto as CachedEnvelopeDto,
    MailFolderDto as CachedFolderDto,
    MailMessageDto as CachedMailDto,
  } from '@flareai/protocol';
  import {flareaiApi} from '../../api/flareai';

  /** Which source the rail has selected: a platform, or a mailbox folder. */
  export type Source =
    | {kind: 'platform'; platform: string; account?: string}
    | {kind: 'mail'; account: string; folder: string};

  /**
   * What the hub already knows, kept outside the component.
   *
   * The hub is a workspace tab, so leaving it and coming back mounts a fresh
   * one — and every mount used to start from nothing: status, then the room
   * list, then the conversation, each a round trip before anything appeared.
   * Holding the last answers here means a return paints immediately and the
   * fetches behind it only correct what changed. Nothing is persisted; this
   * lives as long as the window does.
   */
  const session: {
    status: CachedStatusDto | null;
    chats: CachedChatDto[];
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
    openGroups: Record<string, boolean>;
  } = {
    status: null,
    chats: [],
    messages: new Map(),
    mailboxes: new Map(),
    mail: new Map(),
    source: null,
    activeChatId: null,
    openGroups: {},
  };

  /** Guards against two callers warming the hub at once. */
  let warming: Promise<void> | null = null;

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
      const api = flareaiApi();
      try {
        const status = await api.comms.status();
        session.status = status;
        session.chats = await api.comms.chats().catch(() => session.chats);
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
          } catch {
            // One mailbox that will not answer is not the others' problem.
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
  import type {
    ChatDto,
    ChatMessageDto,
    ChatReactionDto,
    CommsStatusDto,
    MailEnvelopeDto,
    MailFolderDto,
    MailMessageDto,
    FlareAIApi,
  } from '@flareai/protocol';
  import DOMPurify from 'dompurify';
  import {readableError} from '../../shared/errors';
  import Icon from '../../shared/components/Icon.svelte';
  import PlatformLogo from '../../shared/components/PlatformLogo.svelte';
  import {MAIN_UI_ICON_STROKE_WIDTH, RAIL_TILE_SIZE} from '../../shared/layout/iconSizing';
  import {activeLocale, t, translate} from '../../../i18n';

  type IconName = ComponentProps<typeof Icon>['name'];

  const api: FlareAIApi = flareaiApi();

  /**
   * One unified inbox over every linked platform plus every mailbox. The source
   * rail decides what the list shows, and the list decides what the reading
   * pane shows — the same three-column shape a mail client uses, because the
   * two halves of this view are the same task with different transports.
   */
  // Whatever the last mount learned, on screen before the first request.
  let status: CommsStatusDto | null = session.status;
  let chats: ChatDto[] = session.chats;
  let source: Source | null = session.source;
  /**
   * Captured here, at the top of the instance, because the statements that
   * keep the session in step run before `onMount` — and on a fresh mount they
   * would write `null` over the very thing the mount is about to restore.
   */
  const restoringChatId = session.activeChatId;
  /** Only the first visit has nothing to show; later ones refresh in place. */
  let loading = !session.status;
  let error = '';
  let busy = '';

  // Messaging
  let activeChat: ChatDto | null = null;
  let chatMessages: ChatMessageDto[] = [];
  let draft = '';
  /** Token for the page of older messages, null once the room's start is in. */
  let chatBefore: string | null = null;
  /** The thread's scroller, so reaching its top can pull the page before. */
  let threadEl: HTMLDivElement | null = null;
  const CHAT_PAGE = 40;

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
  let composeFiles: string[] = [];
  /** Shown only once there is a reason to: an empty Cc line is noise. */
  let showCopies = false;
  /** What a reply must echo back for the recipient's client to thread it. */
  let composeReply: {inReplyTo: string | null; references: string[]} | null = null;
  /** The draft this compose replaces, when it was opened from one. */
  let composeDraft: {id: string; folder: string} | null = null;
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
  let attachmentPaths: string[] = [];

  /**
   * Which rail groups are expanded. A source with more than one account is a
   * group: clicking the row opens its accounts inline and clicking it again
   * folds them away. A source with a single account has nothing to expand, so
   * its row selects that account outright.
   */
  let openGroups: Record<string, boolean> = {};
  /** Chats whose avatar the homeserver would not serve, so the row falls back
   * to its initial rather than retrying a picture that is not there. */
  let brokenAvatars = new Set<string>();
  /** The rail fades its edges only where the content actually runs on, the
   * same rule the settings rail follows. */
  let railElement: HTMLElement;
  let railAtTop = true;
  let railAtBottom = true;
  /** Whether the mailbox dropdown over the message list is showing. */
  let folderMenu = false;
  /** Remote images stay unloaded until the reader asks for them, per message. */
  let allowRemote = false;

  /** Which slice of the folder the list shows. Applied here rather than in the
   * IMAP query so switching back is instant and costs no round trip. */
  type Filter = 'all' | 'unread' | 'flagged' | 'attachments';
  $: FILTERS = [
    {id: 'all' as Filter, label: $t('hub.filterAll'), icon: 'mail' as IconName},
    {id: 'unread' as Filter, label: $t('hub.filterUnread'), icon: 'bolt' as IconName},
    {id: 'flagged' as Filter, label: $t('hub.filterFlagged'), icon: 'bolt' as IconName},
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

  $: safeHtml = openMail?.html ? sanitiseMail(openMail.html, allowRemote) : '';
  $: blockedRemote = !allowRemote && !!openMail?.html && REMOTE_SOURCE.test(openMail.html);

  /** An `src` pointing off this machine — what "remote images" means. */
  const REMOTE_SOURCE = /<img[^>]+\bsrc\s*=\s*["']?(?:https?:)?\/\//i;

  /**
   * Strips everything a message has no business carrying — scripts, frames,
   * forms, stylesheets that would escape into the app's own styling — and,
   * until asked otherwise, the remote images that make reading a mail visible
   * to whoever sent it.
   */
  function sanitiseMail(html: string, remote: boolean): string {
    const clean = DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'style', 'iframe', 'frame', 'object', 'embed', 'form', 'base', 'link', 'meta'],
      FORBID_ATTR: ['srcset', 'background', 'ping'],
      ALLOW_DATA_ATTR: false,
    });
    if (remote) return clean;
    const holder = document.createElement('div');
    holder.innerHTML = clean;
    for (const image of holder.querySelectorAll('img'))
      if (/^(https?:)?\/\//i.test(image.getAttribute('src') ?? '')) image.removeAttribute('src');
    return holder.innerHTML;
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

  $: accounts = status?.email.accounts ?? [];
  $: linked = (status?.bridges ?? []).filter((bridge) => bridge.state === 'connected');
  // Expanding a group changes how far the rail scrolls, so the edges are
  // re-read whenever its content does.
  $: if (linked.length || accounts.length || openGroups) void tick().then(measureRailEdges);
  /** Chats belonging to whichever platform the rail has selected. */
  $: visibleChats = chatsFor(source, chats, chatSearch);
  /** What the box over the conversation list is filtering on. */
  let chatSearch = '';

  function chatsFor(current: Source | null, list: ChatDto[], query: string): ChatDto[] {
    if (current?.kind !== 'platform') return [];
    const needle = query.trim().toLowerCase();
    return list.filter(
      (chat) =>
        chat.platform === current.platform &&
        // Name and last line, which is what someone scanning for a
        // conversation actually remembers about it.
        (!needle ||
          chat.name.toLowerCase().includes(needle) ||
          (chat.preview ?? '').toLowerCase().includes(needle)),
    );
  }
  $: mailAccount = source?.kind === 'mail' ? source.account : '';
  $: mailFolder = source?.kind === 'mail' ? source.folder : '';
  /** The folders worth surfacing, in the order a mail client shows them. */
  $: railFolders = orderFolders(folders);
  $: currentFolder = folders.find((folder) => folder.name === mailFolder) ?? null;
  $: currentAccount = accounts.find((account) => account.id === mailAccount) ?? null;
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
    flagged: 'bolt',
    other: 'folder',
  };

  function orderFolders(list: MailFolderDto[]): MailFolderDto[] {
    const ranked = list.filter((folder) => FOLDER_ORDER.includes(folder.role));
    return ranked.sort(
      (a, b) => FOLDER_ORDER.indexOf(a.role) - FOLDER_ORDER.indexOf(b.role),
    );
  }

  onMount(() => {
    // What the last visit was looking at, back on screen before a single
    // request goes out. `load` corrects it behind this.
    restoreView();
    void load();
    const unsubscribe = api.comms.subscribe((next) => {
      status = next;
      // Into the session cache as well, or the next mount paints the rail from
      // a snapshot older than the push that has already corrected it.
      session.status = next;
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
    const timer = setInterval(() => void refreshOpen(), REFRESH_MS);
    // Coming back to the window is when stale content is most obvious, so it
    // does not wait out the rest of the interval.
    const onVisible = (): void => {
      if (!document.hidden) void refreshOpen();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      unsubscribe();
      unsubscribeActivity();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  });

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
    }
    const chat = restoringChatId ? chats.find((item) => item.id === restoringChatId) : null;
    if (!chat) return;
    const known = session.messages.get(chat.id);
    activeChat = chat;
    chatMessages = known?.messages ?? [];
    chatBefore = known?.nextBefore ?? null;
  }

  async function load(): Promise<void> {
    loading = !session.status;
    try {
      status = await api.comms.status();
      session.status = status;
      chats = await api.comms.chats().catch(() => session.chats);
      session.chats = chats;
      if (source) {
        // Already looking at something, restored above: bring it up to date
        // rather than choosing somewhere else to be.
        await refreshOpen();
      } else {
        // Open on something useful rather than an empty pane: the first mailbox
        // if there is one, otherwise the first linked platform.
        const account = status.email.accounts.find((item) => item.isDefault) ?? status.email.accounts[0];
        if (account) {
          openGroups = {...openGroups, mail: true};
          await selectMail(account.id);
        } else {
          const first = (status.bridges ?? []).find((bridge) => bridge.state === 'connected');
          if (first) selectPlatform(first.platform);
        }
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
    }
  }

  /**
   * The head of the most recent conversations, fetched one at a time so a busy
   * account does not open twenty requests at once. Only ones never read this
   * session are fetched, and only while nothing else is loading — a prefetch
   * that slows the thing the user actually clicked is worse than no prefetch.
   */
  const PREFETCH_CHATS = 8;

  function mailKey(account: string, folder: string, id: string): string {
    return `${account}|${folder}|${id}`;
  }

  /**
   * The bodies at the top of the open folder. Reading one is the next thing
   * that happens after a folder is listed, so the first few are fetched while
   * the list is being looked at. Stops as soon as a message is opened: the
   * click deserves the connection more than the guess does.
   */
  const PREFETCH_MAIL = 5;

  async function prefetchMailBodies(): Promise<void> {
    if (!source || source.kind !== 'mail') return;
    const mailbox = source;
    for (const envelope of envelopes.slice(0, PREFETCH_MAIL)) {
      if (openMail || openEnvelope) return;
      if (source.kind !== 'mail' || source.folder !== mailbox.folder) return;
      const key = mailKey(mailbox.account, mailbox.folder, envelope.id);
      if (session.mail.has(key)) continue;
      try {
        session.mail.set(
          key,
          await api.comms.mailMessage(envelope.id, mailbox.account, mailbox.folder),
        );
      } catch {
        // Guessed-at work; the click that needs it will report any trouble.
      }
    }
  }

  async function prefetchChats(): Promise<void> {
    for (const chat of chats.slice(0, PREFETCH_CHATS)) {
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
    source = {kind: 'platform', platform, account};
    activeChat = null;
    chatMessages = [];
    openMail = null;
    openEnvelope = null;
    composing = false;
  }

  function toggleGroup(key: string): void {
    openGroups = {...openGroups, [key]: !openGroups[key]};
  }

  // Whatever the pane is showing is what a return should show.
  $: session.source = source;
  $: session.activeChatId = activeChat?.id ?? null;
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
    if (ids.length > 1) toggleGroup(`platform:${platform}`);
    else selectPlatform(platform, ids[0]);
  }

  function pickMail(): void {
    if (accounts.length > 1) toggleGroup('mail');
    else if (accounts[0]) void selectMail(accounts[0].id);
  }

  /**
   * What has already been fetched for a mailbox, so opening one is instant
   * rather than a wait. Filled in the background once the hub knows which
   * accounts exist, and kept up to date by whatever the list loads afterwards.
   */
  const mailCache = session.mailboxes;

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
      } catch {
        // Nothing to report: the mailbox is simply not warmed.
      }
    }
  }

  async function selectMail(account: string, folder?: string): Promise<void> {
    openMail = null;
    openEnvelope = null;
    composing = false;
    activeChat = null;
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
    await refreshSources();
    if (activeChat) await refreshChat();
    else if (source?.kind === 'mail') await refreshEnvelopes();
    else if (source?.kind === 'platform') await refreshChats();
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
      status = await api.comms.status();
      session.status = status;
    } catch {
      // Quiet, for the same reason as the other polls.
    }
  }

  /** The conversation list's own unread counts and previews. */
  async function refreshChats(): Promise<void> {
    try {
      chats = await api.comms.chats();
      session.chats = chats;
    } catch {
      // Quiet, for the same reason as the other polls.
    }
  }

  /**
   * The conversation a message belongs to: everything in this folder carrying
   * the same subject once Re:/Fwd: are stripped. IMAP threading proper needs
   * References on every envelope, which the list does not carry, so the
   * subject is the honest approximation — and the one users recognise.
   */
  async function loadThread(envelope: MailEnvelopeDto): Promise<void> {
    if (!source || source.kind !== 'mail') return;
    const base = baseSubject(envelope.subject);
    thread = [];
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
    // Only worth showing when there is actually a chain.
    const chain = found.filter((item) => baseSubject(item.subject) === base);
    thread = chain.length > 1 ? chain : [];
  }

  function baseSubject(subject: string): string {
    return subject.replace(/^\s*(re|fwd|fw)\s*:\s*/gi, '').trim().toLowerCase();
  }

  async function openChat(chat: ChatDto): Promise<void> {
    activeChat = chat;
    awayFromLatest = false;
    // A conversation read earlier in this session opens on what it said then,
    // including however far back it had been scrolled, and is corrected by the
    // read behind it. Only a conversation never opened waits.
    const known = session.messages.get(chat.id);
    chatMessages = known?.messages ?? [];
    chatBefore = known?.nextBefore ?? null;
    busy = known ? '' : `chat:${chat.id}`;
    try {
      const page = await api.comms.chatMessages(chat.id, CHAT_PAGE);
      if (activeChat?.id !== chat.id) return;
      chatMessages = known ? mergeChatPage(known.messages, page.messages) : page.messages;
      chatBefore = known ? known.nextBefore : page.nextBefore;
      rememberChat(chat.id);
      error = '';
      // Reading it is what makes it read — on the homeserver as well as here,
      // so the count clears on the phone too. The badge is cleared locally
      // rather than re-listing every room for one number.
      // The page arrives newest first, so the read marker is the head of it.
      const newest = chatMessages[0];
      if (newest && (chat.unread ?? 0) > 0) {
        await api.comms.chatMarkRead(chat.id, newest.id).catch(() => {});
        chats = chats.map((item) => (item.id === chat.id ? {...item, unread: 0} : item));
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

  /** Newest first, with the fresh page's copies winning on the overlap. */
  function mergeChatPage(known: ChatMessageDto[], fresh: ChatMessageDto[]): ChatMessageDto[] {
    const byId = new Map(fresh.map((item) => [item.id, item]));
    return [...fresh, ...known.filter((item) => !byId.has(item.id))];
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
   * The name to put over a message. Falls back to the local part of the
   * sender id, so a bridge that never resolved a profile still shows
   * something a person can tell apart rather than a full `@id:server`.
   */
  function senderLabel(message: ChatMessageDto): string {
    const name = message.senderName?.trim();
    if (name && name !== message.sender) return name;
    return message.sender.replace(/^@/, '').split(':')[0];
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

  function scrollToLatest(): void {
    // `column-reverse` puts the newest message at offset zero.
    threadEl?.scrollTo({top: 0, behavior: 'smooth'});
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

  /**
   * Newly arrived messages in the open conversation. Only the head of the room
   * is re-read and merged, so a long scrolled-back history is left alone.
   */
  async function refreshChat(): Promise<void> {
    if (!activeChat || busy) return;
    const chatId = activeChat.id;
    try {
      const page = await api.comms.chatMessages(chatId, 20);
      if (activeChat?.id !== chatId) return;
      const known = new Set(chatMessages.map((item) => item.id));
      const fresh = page.messages.filter((item) => !known.has(item.id));
      if (fresh.length === 0) return;
      chatMessages = [...fresh, ...chatMessages];
      if (activeChat) rememberChat(activeChat.id);
      const newest = fresh[0];
      if (newest) await api.comms.chatMarkRead(chatId, newest.id).catch(() => {});
    } catch {
      // A failed poll is not worth a banner; the next one takes its place.
    }
  }

  async function sendChat(): Promise<void> {
    const text = draft.trim();
    if (!activeChat || !text) return;
    busy = 'send-chat';
    const chatId = activeChat.id;
    const answering = replyTo?.id;
    try {
      const sent = await api.comms.chatSend(chatId, text, answering);
      chatMessages = [sent, ...chatMessages];
      if (activeChat) rememberChat(activeChat.id);
      draft = '';
      replyTo = null;
      error = '';
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
  let copied = '';
  /**
   * The message actions, as a context menu rather than a row of icons under
   * every bubble: they are occasional, and a permanent row of them competes
   * with the conversation it is attached to. `x`/`y` are viewport coordinates
   * of the click, so the menu opens where the pointer already is.
   */
  let messageMenu: {message: ChatMessageDto; x: number; y: number} | null = null;
  let messageMenuEl: HTMLDivElement | undefined;

  function openMessageMenu(event: MouseEvent, message: ChatMessageDto): void {
    event.preventDefault();
    reactingTo = '';
    messageMenu = {message, x: event.clientX, y: event.clientY};
    void tick().then(clampMessageMenu);
  }

  /** Keeps the menu on screen when the click lands near an edge — a menu that
   * opens half outside the window is worse than one a few pixels off. */
  function clampMessageMenu(): void {
    if (!messageMenu || !messageMenuEl) return;
    const {width, height} = messageMenuEl.getBoundingClientRect();
    const margin = 8;
    messageMenu = {
      ...messageMenu,
      x: Math.max(margin, Math.min(messageMenu.x, window.innerWidth - width - margin)),
      y: Math.max(margin, Math.min(messageMenu.y, window.innerHeight - height - margin)),
    };
  }

  function closeMessageMenu(): void {
    messageMenu = null;
    reactingTo = '';
  }

  function startReply(message: ChatMessageDto): void {
    replyTo = message;
    reactingTo = '';
    composerInput?.focus();
  }

  async function copyMessage(message: ChatMessageDto): Promise<void> {
    const text = message.body || message.attachments?.[0]?.name || '';
    if (!text) return;
    await navigator.clipboard.writeText(text).catch(() => {});
    copied = message.id;
    setTimeout(() => {
      if (copied === message.id) copied = '';
    }, 1_200);
  }

  /**
   * Adds the emoji, or takes it back when it is already ours — the same tap
   * doing both, as every messenger behaves. The bubble is updated first so the
   * reaction lands under the pointer rather than a round trip later.
   */
  async function react(message: ChatMessageDto, key: string): Promise<void> {
    if (!activeChat) return;
    const chatId = activeChat.id;
    const existing = (message.reactions ?? []).find((item) => item.key === key);
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
        reactions: applyReaction(item.reactions ?? [], key, mineEventId),
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
    if (!existing) return [...reactions, {key, count: 1, mineEventId}];
    // Adding when it is already ours is the undo, and vice versa.
    const adding = !existing.mineEventId;
    const count = existing.count + (adding ? 1 : -1);
    if (count <= 0) return reactions.filter((item) => item.key !== key);
    return reactions.map((item) =>
      item.key === key ? {...item, count, mineEventId: adding ? mineEventId : null} : item,
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

  let composerInput: HTMLInputElement | null = null;
  /** The recorder, while a voice note is being taken. */
  async function attachToChat(): Promise<void> {
    if (!activeChat) return;
    const chatId = activeChat.id;
    const paths = await api.comms.chatPickFiles();
    if (paths.length === 0) return;
    busy = 'attach';
    try {
      await api.comms.chatSendFiles(chatId, paths);
      // The files come back as messages of their own on the next read.
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
      await api.comms.chatSendAudio(chatId, new Uint8Array(await blob.arrayBuffer()), blob.type);
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
    // Each message earns its own answer on remote content.
    allowRemote = false;
    attachmentPaths = [];
    void loadThread(envelope);
    composing = false;
    busy = cached ? '' : `mail:${envelope.id}`;
    try {
      const message = await api.comms.mailMessage(envelope.id, source.account, source.folder);
      session.mail.set(mailKey(source.account, source.folder, envelope.id), message);
      // A slower earlier click must not overwrite whatever is open now.
      if (openEnvelope?.id !== envelope.id) return;
      openMail = message;
      // Opening a message is what marks it read, the same as any mail client.
      if (!envelope.seen) {
        await api.comms.mailFlag([envelope.id], 'seen', true, source.account, source.folder).catch(() => {});
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

  /** Saves the open message's attachments and offers them to the OS. */
  async function saveAttachments(): Promise<void> {
    if (!source || source.kind !== 'mail' || !openEnvelope) return;
    busy = 'attachments';
    try {
      attachmentPaths = await api.comms.mailDownload(openEnvelope.id, source.account, source.folder);
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
  }

  async function toggleFlag(envelope: MailEnvelopeDto): Promise<void> {
    if (!source || source.kind !== 'mail') return;
    const next = !envelope.flagged;
    envelopes = envelopes.map((item) =>
      item.id === envelope.id ? {...item, flagged: next} : item,
    );
    await api.comms
      .mailFlag([envelope.id], 'flagged', next, source.account, source.folder)
      .catch((cause: unknown) => {
        error = readableError(cause);
      });
  }

  type ComposeMode = 'new' | 'reply' | 'reply-all' | 'forward';

  function startCompose(mode: ComposeMode = 'new'): void {
    const message = mode === 'new' ? null : openMail;
    composing = true;
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
    composeFiles = [];
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
    busy = `mail:${envelope.id}`;
    try {
      const message = await api.comms.mailMessage(envelope.id, source.account, source.folder);
      composing = true;
      openMail = null;
      openEnvelope = envelope;
      composeTo = message.to.map((item) => item.address).join(', ');
      composeCc = message.cc.map((item) => item.address).join(', ');
      composeBcc = '';
      showCopies = composeCc.length > 0;
      composeSubject = message.subject === '(no subject)' ? '' : message.subject;
      composeBody = message.body;
      composeFiles = [];
      composeReply = null;
      composeDraft = {id: envelope.id, folder: source.folder};
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
    if (!composeTo.trim()) return;
    busy = draftOnly ? 'save-draft' : 'send-mail';
    try {
      await api.comms.mailSend({
        account: mailAccount || undefined,
        to: addressList(composeTo),
        cc: addressList(composeCc),
        bcc: addressList(composeBcc),
        subject: composeSubject,
        body: composeBody,
        draft: draftOnly,
        attachments: composeFiles,
        inReplyTo: composeReply?.inReplyTo ?? undefined,
        references: composeReply?.references,
        replacesDraft: composeDraft,
      });
      composing = false;
      composeTo = '';
      composeCc = '';
      composeBcc = '';
      composeSubject = '';
      composeBody = '';
      composeFiles = [];
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
    openMail = null;
    openEnvelope = null;
    activeChat = null;
    composing = false;
  }

  function when(value: string): string {
    const parsed = new Date(value.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return value;
    const today = new Date();
    const sameDay = parsed.toDateString() === today.toDateString();
    return sameDay
      ? parsed.toLocaleTimeString(activeLocale(), {hour: 'numeric', minute: '2-digit'})
      : parsed.toLocaleDateString(activeLocale(), {month: 'short', day: 'numeric'});
  }

  /**
   * The stamp on a chat row. Same shape as a mail row's, but tolerant of the
   * null a room that has never carried a message comes back with.
   */
  function chatTime(value: string | null | undefined): string {
    return value ? when(value) : '';
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
    const parsed = new Date(value.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? value : clockTime(parsed);
  }

  /**
   * The centred stamp over a run of messages, saying when the run began. It
   * says as much as it has to and no more, widening a step at a time as the
   * message recedes: the clock alone today, then Yesterday, then the weekday
   * while it is still this week, then the date, then the year as well.
   */
  function dividerStamp(value: string): string {
    const parsed = new Date(value.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return value;
    const time = clockTime(parsed);
    const today = startOfDay(new Date());
    const days = Math.round((today.getTime() - startOfDay(parsed).getTime()) / DAY_MS);
    if (days <= 0) return time;
    if (days === 1) return `${$t('chats.yesterday')} ${time}`;
    if (days < 7)
      return `${parsed.toLocaleDateString(activeLocale(), {weekday: 'long'})} ${time}`;
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    return parsed.getFullYear() === new Date().getFullYear()
      ? `${day}/${month} ${time}`
      : `${parsed.getFullYear()} ${day}/${month} ${time}`;
  }

  function startOfDay(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const DAY_MS = 86_400_000;
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
</script>

<svelte:window
  onkeydown={(event) => { if (event.key === 'Escape' && messageMenu) { event.stopPropagation(); closeMessageMenu(); } }}
  onclick={(event) => {
    if (messageMenu && !(event.target as HTMLElement).closest('.hub-view-message-menu')) closeMessageMenu();
  }}
/>

<div class="hub-view">
  <div class="hub-view-grid" class:reading={!!openMail || !!openEnvelope || !!activeChat || composing}>
  <nav
    class="hub-view-rail"
    class:at-top={railAtTop}
    class:at-bottom={railAtBottom}
    aria-label={$t('hub.sources')}
    bind:this={railElement}
    onscroll={measureRailEdges}
  >
    {#each linked as bridge (bridge.platform)}
      {@const ids = bridge.accounts.map((item) => item.id)}
      {@const grouped = ids.length > 1}
      {@const expanded = openGroups[`platform:${bridge.platform}`] === true}
      <button
        type="button"
        class="hub-view-source"
        class:active={!grouped && source?.kind === 'platform' && source.platform === bridge.platform}
        aria-expanded={grouped ? expanded : undefined}
        onclick={() => pickPlatform(bridge.platform, ids)}
      >
        <PlatformLogo platform={bridge.platform} size={RAIL_TILE_SIZE} />
        <span>{bridge.name}</span>
      </button>
      {#if grouped && expanded}
        <ul class="hub-view-accounts">
          {#each bridge.accounts as account (account.id)}
            <li>
              <button
                type="button"
                class:active={source?.kind === 'platform' &&
                  source.platform === bridge.platform &&
                  source.account === account.id}
                onclick={() => selectPlatform(bridge.platform, account.id)}
              >
                {account.name}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}

    {#if accounts.length > 0}
      {@const grouped = accounts.length > 1}
      {@const expanded = openGroups.mail === true}
      <button
        type="button"
        class="hub-view-source"
        class:active={!grouped && source?.kind === 'mail'}
        aria-expanded={grouped ? expanded : undefined}
        onclick={pickMail}
      >
        <PlatformLogo platform="mail" size={RAIL_TILE_SIZE} />
        <span>{$t('hub.mail')}</span>
      </button>
      {#if grouped && expanded}
        <ul class="hub-view-accounts">
          {#each accounts as account (account.id)}
            <li>
              <button
                type="button"
                class:active={mailAccount === account.id}
                onclick={() => void selectMail(account.id)}
              >
                {account.email}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

    {#if linked.length === 0 && accounts.length === 0 && !loading}
      <p class="hub-view-rail-empty">
        {$t('hub.railEmpty')}
      </p>
    {/if}
  </nav>

  <section class="hub-view-list" aria-label={$t('hub.messages')}>
    {#if source?.kind === 'mail'}
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
            <span>{currentFolder?.label ?? mailFolder}</span>
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
                    {folder.label}
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
              <span class="hub-view-row-meta">
                {#if envelope.flagged}<Icon name="bolt" size={12} />{/if}
                {#if envelope.hasAttachment}<Icon name="attach" size={12} />{/if}
                {#if envelope.answered}<Icon name="back" size={12} />{/if}
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
    {:else if source?.kind === 'platform'}
      <!-- The same head, and the same bare search field, the mailbox list
           above uses: the two halves of the hub are one list with different
           transports, and a second search treatment would say otherwise. -->
      <div class="hub-view-list-head">
        <input
          bind:value={chatSearch}
          type="search"
          placeholder={$t('hub.searchConversations')}
          aria-label={$t('hub.searchConversations')}
        />
      </div>
      <ul class="hub-view-rows">
        {#each visibleChats as chat (chat.id)}
          <li>
            <button
              type="button"
              class="hub-view-row"
              class:active={activeChat?.id === chat.id}
              class:unread={(chat.unread ?? 0) > 0}
              onclick={() => void openChat(chat)}
            >
              {#if chat.avatarUrl && !brokenAvatars.has(chat.id)}
                <!-- Bridged avatars are fetched from the homeserver's
                     authenticated media endpoint, which answers 404 for a
                     picture the bridge referenced but never uploaded. The
                     initial below is the fallback: a broken-image glyph is
                     worse than no picture at all. -->
                <img
                  class="hub-view-chat-avatar"
                  src={chat.avatarUrl}
                  alt=""
                  loading="lazy"
                  onerror={() => markAvatarBroken(chat.id)}
                />
              {:else}
                <!-- An initial, so a row without a picture still lines up with
                     the rows that have one. -->
                <span class="hub-view-chat-avatar placeholder" aria-hidden="true"
                  >{chat.name.trim().charAt(0).toUpperCase()}</span
                >
              {/if}
              <!-- Two lines, each with its own right-hand element: the time
                   sits against the name, the unread count against the preview,
                   so both columns centre on the line they belong to. -->
              <span class="hub-view-chat-copy">
                <span class="hub-view-row-top">
                  <strong>{chat.name}</strong>
                  {#if chat.lastActivity}
                    <time datetime={chat.lastActivity}>{chatTime(chat.lastActivity)}</time>
                  {/if}
                </span>
                <span class="hub-view-chat-bottom">
                  <span class="hub-view-chat-preview">{chat.preview ?? ''}</span>
                  {#if (chat.unread ?? 0) > 0}
                    <span class="hub-view-chat-unread" aria-label={$t('hub.unreadCount', {count: chat.unread ?? 0})}
                      >{chat.unread! > 99 ? '99+' : chat.unread}</span
                    >
                  {/if}
                </span>
              </span>
            </button>
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
              {chatSearch.trim() ? $t('common.noMatches') : $t('hub.noConversations')}
            </li>
          {/if}
        {/each}
      </ul>
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

  <section class="hub-view-reader" aria-label={$t('hub.readingPane')}>
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
            <input bind:value={composeTo} spellcheck="false" placeholder="name@example.com" />
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
            <input bind:value={composeCc} spellcheck="false" placeholder="name@example.com" />
          </label>
          <label>
            <span>{$t('hub.bcc')}</span>
            <input bind:value={composeBcc} spellcheck="false" placeholder="name@example.com" />
          </label>
        {/if}
        <label>
          <span>{$t('hub.subject')}</span>
          <input bind:value={composeSubject} />
        </label>
        {#if composeFiles.length > 0}
          <div class="hub-view-attachments">
            {#each composeFiles as file (file)}
              <span class="hub-view-file">
                {fileName(file)}
                <button
                  type="button"
                  title={$t('hub.removeAttachment')}
                  onclick={() => (composeFiles = composeFiles.filter((item) => item !== file))}
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            {/each}
          </div>
        {/if}
        <textarea bind:value={composeBody} placeholder={$t('hub.writeMessage')}></textarea>
        <footer>
          <button type="button" onclick={() => void attachFiles()}>
            <Icon name="attach" size={13} /> Attach
          </button>
          <button type="button" onclick={() => (composing = false)}>{$t('common.cancel')}</button>
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
        <button type="button" class="hub-view-back" onclick={closeReader}>
          <Icon name="back" size={13} /> Back
        </button>
        <h2>{openMail?.subject ?? openEnvelope?.subject ?? ''}</h2>
        <p>
          {openMail?.from?.name ??
            openMail?.from?.address ??
            (openEnvelope ? sender(openEnvelope) : $t('hub.unknownSender'))}
          {#if openMail?.date ?? openEnvelope?.date}<em>· {openMail?.date ?? openEnvelope?.date}</em>{/if}
        </p>
        {#if openMail && (openMail.to.length > 0 || openMail.cc.length > 0)}
          <p class="hub-view-recipients">
            To {openMail.to.map((item) => item.name ?? item.address).join(', ') || '—'}
            {#if openMail.cc.length > 0}
              · Cc {openMail.cc.map((item) => item.name ?? item.address).join(', ')}
            {/if}
          </p>
        {/if}
        <div class="hub-view-reader-actions">
          <div class="hub-view-action-group">
            <button type="button" disabled={!openMail} title={$t('hub.reply')} onclick={() => startCompose('reply')}>
              <Icon name="back" size={13} /> Reply
            </button>
            <button type="button" disabled={!openMail} title={$t('hub.replyAll')} onclick={() => startCompose('reply-all')}>
              <Icon name="users" size={13} />
            </button>
            <button type="button" disabled={!openMail} title={$t('hub.forward')} onclick={() => startCompose('forward')}>
              <Icon name="forward" size={13} />
            </button>
          </div>
          {#if openEnvelope}
            {@const envelope = openEnvelope}
            <div class="hub-view-action-group">
              <button type="button" title={$t('hub.archive')} onclick={() => void moveMail(envelope, 'archive')}>
                <Icon name="archive" size={13} />
              </button>
              <button type="button" title={$t('hub.junk')} onclick={() => void moveMail(envelope, 'junk')}>
                <Icon name="close" size={13} />
              </button>
              <button type="button" class="destructive" title={$t('common.delete')} onclick={() => void moveMail(envelope, 'trash')}>
                <Icon name="trash" size={13} />
              </button>
            </div>
            <div
              class="hub-view-action-group hub-view-move"
              onfocusout={(event) => {
                const next = event.relatedTarget;
                if (!(next instanceof Node) || !event.currentTarget.contains(next)) moveMenu = false;
              }}
            >
              <button
                type="button"
                title={$t('hub.moveToFolder')}
                aria-expanded={moveMenu}
                onclick={() => (moveMenu = !moveMenu)}
              >
                <Icon name="folder-move" size={13} />
              </button>
              {#if moveMenu}
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
            <div class="hub-view-action-group">
              <button
                type="button"
                class:on={envelope.flagged}
                title={envelope.flagged ? $t('hub.unflag') : $t('hub.flag')}
                onclick={() => void toggleFlag(envelope)}
              >
                <Icon name="bolt" size={13} filled={envelope.flagged} />
              </button>
              <button type="button" title={$t('hub.markUnread')} onclick={() => void markUnread(envelope)}>
                <Icon name="mail" size={13} />
              </button>
            </div>
            {#if currentFolder?.role === 'trash' || currentFolder?.role === 'junk'}
              <div class="hub-view-action-group">
                <button
                  type="button"
                  class="destructive"
                  title={$t('hub.deletePermanently')}
                  onclick={() => void erase([envelope.id])}
                >
                  <Icon name="trash" size={13} /> Delete permanently
                </button>
              </div>
            {/if}
          {/if}
        </div>
      </header>
      {#if openMail}
        {#if safeHtml}
          <!-- The sender's own markup, sanitised: scripts, frames, forms and
               stylesheets are stripped, links are opened in the real browser
               rather than inside the app, and remote images stay unloaded
               until asked for so a mail cannot phone home just by being read. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="hub-view-body hub-view-html" onclick={openLink}>
            {@html safeHtml}
          </div>
          {#if blockedRemote}
            <button type="button" class="hub-view-remote" onclick={() => (allowRemote = true)}>
              <Icon name="image" size={13} /> Load remote images
            </button>
          {/if}
        {:else}
          <div class="hub-view-body">{openMail.body}</div>
        {/if}
        {#if openMail.attachments.length > 0}
          <div class="hub-view-attachments">
            <span class="hub-view-attachments-head">
              <Icon name="attach" size={12} />
              {openMail.attachments.length} attachment{openMail.attachments.length === 1 ? '' : 's'}
            </span>
            {#each openMail.attachments as file (file.name)}
              <span class="hub-view-file">{file.name}</span>
            {/each}
            {#if attachmentPaths.length === 0}
              <button type="button" disabled={busy === 'attachments'} onclick={() => void saveAttachments()}>
                <Icon name="download" size={12} /> {busy === 'attachments' ? $t('hub.saving') : $t('common.save')}
              </button>
            {:else}
              {#each attachmentPaths as saved (saved)}
                <button type="button" onclick={() => void api.comms.mailOpenFile(saved)}>
                  <Icon name="file" size={12} /> Open {fileName(saved)}
                </button>
              {/each}
            {/if}
          </div>
        {/if}
        {#if thread.length > 1}
          <div class="hub-view-chain">
            <span class="hub-view-chain-head">Conversation · {thread.length} messages</span>
            {#each thread as item (item.id)}
              <button
                type="button"
                class:active={item.id === openEnvelope?.id}
                onclick={() => void readMail(item)}
              >
                <strong>{sender(item)}</strong>
                <em>{when(item.date)}</em>
                <span>{item.subject}</span>
              </button>
            {/each}
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
    {:else if activeChat}
      <header class="hub-view-reader-head hub-view-chat-head">
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
        <h2>{activeChat.name}</h2>
      </header>
      <div class="hub-view-thread" bind:this={threadEl} onscroll={onThreadScroll}>
        {#each chatMessages as message, index (message.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="hub-view-bubble-row"
            class:mine={message.mine}
            oncontextmenu={(event) => openMessageMenu(event, message)}
          >
          <!-- Who sent it, above the bubble and aligned to its leading edge —
               named in a group, where it is the only way to tell people apart,
               and left out of a direct chat, where the header already says it.
               A bridged sender id reads `@whatsapp_614…:server`, which names
               nobody, so the name the bridge resolved is what shows. -->
          {#if !message.mine && activeChat.group && startsSenderRun(index)}
            <span class="hub-view-bubble-who">{senderLabel(message)}</span>
          {/if}
          <div class="hub-view-bubble" class:mine={message.mine}>
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
            {#each message.attachments ?? [] as attachment (attachment.url)}
              {#if attachment.kind === 'image'}
                <img
                  class="hub-view-bubble-image"
                  class:sticker={attachment.sticker}
                  src={attachment.url}
                  alt={attachment.name}
                  width={attachment.width ?? undefined}
                  height={attachment.height ?? undefined}
                  loading="lazy"
                />
              {:else if attachment.kind === 'audio'}
                <!-- Voice notes are most of what arrives on these networks, so
                     they play in place rather than downloading first. -->
                <audio class="hub-view-bubble-audio" controls preload="metadata" src={attachment.url}
                ></audio>
              {:else if attachment.kind === 'video'}
                <!-- svelte-ignore a11y_media_has_caption -->
                <!-- A video someone sent over WhatsApp has no caption track to
                     offer; there is nothing to point this at. -->
                <video class="hub-view-bubble-video" controls preload="metadata" src={attachment.url}
                ></video>
              {:else}
                <a class="hub-view-bubble-file" href={attachment.url} download={attachment.name}>
                  <Icon name="attach" size={13} />
                  {attachment.name}
                </a>
              {/if}
            {/each}
            {#if message.body}<p>{message.body}</p>{/if}
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
              <span class="hub-view-reactions">
                {#each message.reactions ?? [] as reaction (reaction.key)}
                  <button
                    type="button"
                    class="hub-view-reaction"
                    class:mine={Boolean(reaction.mineEventId)}
                    onclick={() => void react(message, reaction.key)}
                  >
                    {reaction.key}
                    {#if reaction.count > 1}<span>{reaction.count}</span>{/if}
                  </button>
                {/each}
              </span>
            {/if}
            <em>{messageTime(message.sentAt)}</em>
          </div>
          </div>
          <!-- After the bubble in the DOM, which `column-reverse` paints above
               it: the stamp introduces the run that starts here. -->
          {#if startsRun(index)}
            <p class="hub-view-stamp">{dividerStamp(message.sentAt)}</p>
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
          class="flareai-dropdown-menu hub-view-message-menu"
          role="menu"
          bind:this={messageMenuEl}
          style:left={`${messageMenu.x}px`}
          style:top={`${messageMenu.y}px`}
        >
          <span class="hub-view-emoji-row">
            {#each QUICK_REACTIONS as emoji (emoji)}
              <button type="button" onclick={() => { void react(target, emoji); closeMessageMenu(); }}>{emoji}</button>
            {/each}
          </span>
          <button
            class="flareai-dropdown-item"
            role="menuitem"
            onclick={() => { startReply(target); closeMessageMenu(); }}
          ><Icon name="back" size={14} /><span>{$t('hub.reply')}</span></button>
          <button
            class="flareai-dropdown-item"
            role="menuitem"
            onclick={() => { void copyMessage(target); closeMessageMenu(); }}
          ><Icon name="copy" size={14} /><span>{$t('common.copy')}</span></button>
        </div>
      {/if}
      {#if awayFromLatest}
        <!-- Sits over the foot of the thread, above the composer: the way back
             to the newest message once the reader has scrolled up from it. -->
        <button type="button" class="hub-view-to-latest" onclick={scrollToLatest}>
          <Icon name="arrow-down" size={13} />
          {$t('chat.scrollToBottom')}
        </button>
      {/if}
      {#if replyTo}
        <!-- What the next message will answer, with a way out of it. -->
        <div class="hub-view-replying">
          <Icon name="back" size={12} />
          <span><strong>{senderLabel(replyTo)}</strong> {replyTo.body || $t('hub.attachment')}</span>
          <button type="button" aria-label={$t('common.cancel')} onclick={() => (replyTo = null)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      {/if}
      <!-- One bar in three states. Nothing recorded: a text field with attach
           beside it, and one primary button that is the microphone until there
           is something to send. Recording: the field becomes the meter, and
           attach and the microphone step aside — there is nothing to attach to
           a take in progress. -->
      <div class="hub-view-composer" class:capturing={voiceState !== 'idle'}>
        {#if voiceState === 'idle'}
          <input
            bind:this={composerInput}
            bind:value={draft}
            placeholder={$t('hub.messagePlaceholder', {name: activeChat.name})}
            onkeydown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendChat();
              }
            }}
          />
          <button
            type="button"
            title={$t('hub.attachFiles')}
            aria-label={$t('hub.attachFiles')}
            disabled={busy === 'attach'}
            onclick={() => void attachToChat()}
          >
            <Icon name="attach" size={15} />
          </button>
          {#if draft.trim()}
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
