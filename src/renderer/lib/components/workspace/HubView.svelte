<script lang="ts">
  import {onMount, type ComponentProps} from 'svelte';
  import type {
    ChatDto,
    ChatMessageDto,
    CommsStatusDto,
    MailEnvelopeDto,
    MailFolderDto,
    MailMessageDto,
    FlareAIApi,
  } from '@flareai/protocol';
  import DOMPurify from 'dompurify';
  import {flareaiApi} from '../../api/flareai';
  import {readableError} from '../../errors';
  import Icon from '../shared/Icon.svelte';
  import PlatformLogo from '../shared/PlatformLogo.svelte';
  import {MAIN_UI_ICON_STROKE_WIDTH, RAIL_TILE_SIZE} from '../../layout/iconSizing';
  import {activeLocale, t, translate} from '../../i18n';

  type IconName = ComponentProps<typeof Icon>['name'];

  const api: FlareAIApi = flareaiApi();

  /**
   * One unified inbox over every linked platform plus every mailbox. The source
   * rail decides what the list shows, and the list decides what the reading
   * pane shows — the same three-column shape a mail client uses, because the
   * two halves of this view are the same task with different transports.
   */
  type Source =
    | {kind: 'platform'; platform: string; account?: string}
    | {kind: 'mail'; account: string; folder: string};

  let status: CommsStatusDto | null = null;
  let chats: ChatDto[] = [];
  let source: Source | null = null;
  let loading = true;
  let error = '';
  let busy = '';

  // Messaging
  let activeChat: ChatDto | null = null;
  let chatMessages: ChatMessageDto[] = [];
  let draft = '';

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
  /** Chats belonging to whichever platform the rail has selected. */
  $: visibleChats = chatsFor(source, chats);

  function chatsFor(current: Source | null, list: ChatDto[]): ChatDto[] {
    if (current?.kind !== 'platform') return [];
    return list.filter((chat) => chat.platform === current.platform);
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

  const FOLDER_ORDER: MailFolderDto['role'][] = [
    'inbox',
    'drafts',
    'sent',
    'archive',
    'junk',
    'trash',
  ];
  const FOLDER_ICONS: Record<MailFolderDto['role'], IconName> = {
    inbox: 'mail',
    drafts: 'edit',
    sent: 'send',
    archive: 'folder',
    junk: 'trash',
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
    void load();
    return api.comms.subscribe((next) => {
      status = next;
    });
  });

  async function load(): Promise<void> {
    loading = true;
    try {
      status = await api.comms.status();
      chats = await api.comms.chats().catch(() => []);
      // Open on something useful rather than an empty pane: the first mailbox
      // if there is one, otherwise the first linked platform.
      const account = status.email.accounts.find((item) => item.isDefault) ?? status.email.accounts[0];
      if (account) {
        openGroups = {...openGroups, mail: true};
        await selectMail(account.id);
      }
      else {
        const first = (status.bridges ?? []).find((bridge) => bridge.state === 'connected');
        if (first) selectPlatform(first.platform);
      }
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      loading = false;
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

  /**
   * One click on a rail row: expand the accounts when there is a choice to
   * make, otherwise go straight to the only account there is.
   */
  function pickPlatform(platform: string, ids: string[]): void {
    if (ids.length > 1) toggleGroup(`platform:${platform}`);
    else selectPlatform(platform, ids[0]);
  }

  function pickMail(): void {
    if (accounts.length > 1) toggleGroup('mail');
    else if (accounts[0]) void selectMail(accounts[0].id);
  }

  async function selectMail(account: string, folder?: string): Promise<void> {
    openMail = null;
    openEnvelope = null;
    composing = false;
    activeChat = null;
    busy = 'folders';
    const switching = !source || source.kind !== 'mail' || source.account !== account;
    // Commit to the mailbox before fetching it, so the list keeps its header —
    // picker, search, compose — while the folders load rather than dropping
    // back to the placeholder pane and rebuilding it a moment later.
    if (switching) folders = [];
    // The rows on screen belong to the folder being left; keeping them under
    // the new folder's name would misreport what is in it.
    envelopes = [];
    source = {kind: 'mail', account, folder: folder ?? 'INBOX'};
    try {
      if (switching) folders = await api.comms.mailFolders(account);
      const target =
        folder ?? folders.find((item) => item.role === 'inbox')?.name ?? folders[0]?.name ?? 'INBOX';
      source = {kind: 'mail', account, folder: target};
      await loadEnvelopes();
      error = '';
    } catch (cause) {
      error = readableError(cause);
    } finally {
      busy = '';
    }
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
      error = '';
    } catch (cause) {
      if (fetchId !== envelopeFetch) return;
      error = readableError(cause);
      if (!more) envelopes = [];
    } finally {
      busy = '';
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
    busy = `chat:${chat.id}`;
    try {
      chatMessages = await api.comms.chatMessages(chat.id, 60);
      error = '';
      // Reading it is what makes it read — on the homeserver as well as here,
      // so the count clears on the phone too. The badge is cleared locally
      // rather than re-listing every room for one number.
      const newest = chatMessages.at(-1) ?? chatMessages[0];
      if (newest && (chat.unread ?? 0) > 0) {
        await api.comms.chatMarkRead(chat.id, newest.id).catch(() => {});
        chats = chats.map((item) => (item.id === chat.id ? {...item, unread: 0} : item));
      }
    } catch (cause) {
      error = readableError(cause);
      chatMessages = [];
    } finally {
      busy = '';
    }
  }

  async function sendChat(): Promise<void> {
    const text = draft.trim();
    if (!activeChat || !text) return;
    busy = 'send-chat';
    const chatId = activeChat.id;
    try {
      const sent = await api.comms.chatSend(chatId, text);
      chatMessages = [sent, ...chatMessages];
      draft = '';
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
    openMail = null;
    // Each message earns its own answer on remote content.
    allowRemote = false;
    attachmentPaths = [];
    void loadThread(envelope);
    composing = false;
    busy = `mail:${envelope.id}`;
    try {
      const message = await api.comms.mailMessage(envelope.id, source.account, source.folder);
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
      if (openEnvelope?.id === envelope.id) {
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

  function sender(envelope: MailEnvelopeDto): string {
    return envelope.from.name ?? envelope.from.address ?? $t('hub.unknown');
  }
</script>

<div class="hub-view">
  <div class="hub-view-grid" class:reading={!!openMail || !!openEnvelope || !!activeChat || composing}>
  <nav class="hub-view-rail" aria-label={$t('hub.sources')}>
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
      <ul class="hub-view-rows">
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
              {busy === 'more' ? $t('common.loading') : $t('hub.loadMore')}
            </button>
          </li>
        {/if}
        {#if visibleEnvelopes.length === 0}
          <li class="hub-view-empty">
            {busy === 'envelopes' || busy === 'folders'
              ? $t('common.loading')
              : envelopes.length > 0
                ? $t('hub.noneMatchFilter')
                : $t('hub.nothingHere')}
          </li>
        {/if}
      </ul>
    {:else if source?.kind === 'platform'}
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
              {#if chat.avatarUrl}
                <img class="hub-view-chat-avatar" src={chat.avatarUrl} alt="" loading="lazy" />
              {:else}
                <!-- An initial, so a row without a picture still lines up with
                     the rows that have one. -->
                <span class="hub-view-chat-avatar placeholder" aria-hidden="true"
                  >{chat.name.trim().charAt(0).toUpperCase()}</span
                >
              {/if}
              <span class="hub-view-chat-copy">
                <span class="hub-view-row-top">
                  <strong>{chat.name}</strong>
                  {#if chat.lastActivity}
                    <time datetime={chat.lastActivity}>{chatTime(chat.lastActivity)}</time>
                  {/if}
                </span>
                {#if chat.preview}
                  <span class="hub-view-chat-preview">{chat.preview}</span>
                {/if}
              </span>
              {#if (chat.unread ?? 0) > 0}
                <span class="hub-view-chat-unread" aria-label={$t('hub.unreadCount', {count: chat.unread ?? 0})}
                  >{chat.unread! > 99 ? '99+' : chat.unread}</span
                >
              {/if}
            </button>
          </li>
        {:else}
          <li class="hub-view-empty">{$t('hub.noConversations')}</li>
        {/each}
      </ul>
    {:else}
      <p class="hub-view-empty">{loading ? $t('common.loading') : $t('hub.pickSource')}</p>
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
      <header class="hub-view-reader-head">
        <button type="button" class="hub-view-back" onclick={closeReader}>
          <Icon name="back" size={13} /> Back
        </button>
        <h2>{activeChat.name}</h2>
      </header>
      <div class="hub-view-thread">
        {#each chatMessages as message (message.id)}
          <div class="hub-view-bubble" class:mine={message.mine}>
            <!-- The contact's own name. A bridged sender id reads
                 `@whatsapp_614…:server`, which names nobody. -->
            {#if !message.mine}
              <span class="hub-view-bubble-who">{message.senderName ?? message.sender}</span>
            {/if}
            {#each message.attachments ?? [] as attachment (attachment.url)}
              {#if attachment.kind === 'image'}
                <img
                  class="hub-view-bubble-image"
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
            <em>{when(message.sentAt)}</em>
          </div>
        {:else}
          <p class="hub-view-empty">{$t('hub.noMessages')}</p>
        {/each}
      </div>
      <div class="hub-view-composer">
        <input
          bind:value={draft}
          placeholder={$t('hub.messagePlaceholder', {name: activeChat.name})}
          onkeydown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendChat();
            }
          }}
        />
        <button type="button" disabled={busy === 'send-chat' || !draft.trim()} onclick={() => void sendChat()}>
          <Icon name="send" size={15} />
        </button>
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
