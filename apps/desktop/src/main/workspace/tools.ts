import type { AgentTool } from "@flareai/core";
import type { WorkspaceRevealDto, WorkspaceSurface } from "@flareai/protocol";

/**
 * The agent's handle on the workspace drawer: what "show me" opens.
 *
 * Everything the agent does off-screen ends somewhere the user can look at —
 * a draft in a mailbox, a file on a drive, a schedule it wrote down — but
 * naming that place in prose leaves the user to find it. This tool navigates
 * there instead: it opens the workspace on the surface, and lands on the exact
 * message, chat, folder or entry the work produced.
 *
 * It only ever *shows* something. Nothing here changes data, so the worst a
 * wrong call can do is put the wrong pane on screen — which is why it is safe
 * to reach for whenever the user asks to see what was done.
 */
/** What the hub has connected, as the draft check reads it. */
export interface LinkedHub {
  mailAccounts: Array<{ id: string; email?: string | null }>;
  chats: Array<{ id: string; name: string }>;
}

export interface WorkspaceRevealer {
  reveal(request: WorkspaceRevealDto): void;
  /**
   * What the hub is actually connected to. A draft is only written into the
   * hub when the account or chat it names is linked there; with nothing
   * linked, the box the agent would fill does not exist, and the draft belongs
   * in the reply instead. Absent, drafts are taken at their word.
   */
  linked?(): Promise<LinkedHub>;
}

const SURFACES: WorkspaceSurface[] = ["hub", "drive", "schedule", "summary"];
/** How a drafted mail relates to an existing one. */
const COMPOSE_MODES = ["new", "reply", "reply-all", "forward"] as const;
const IMPORTANCE = ["high", "normal", "low"] as const;

export function createWorkspaceTool(workspace: WorkspaceRevealer): AgentTool {
  return {
    name: "workspace_show",
    description: [
      "Show a part of the app in the workspace drawer, on screen, where the user is.",
      "Use it when the user asks to see something ('show me', 'open it', 'where is it?'),",
      "and after finishing work whose result lives in the app rather than in the reply —",
      "a saved draft, a file on a drive, a schedule.",
      "Surfaces: 'hub' is mail and messaging; 'drive' is files; 'schedule' is recurring tasks;",
      "'summary' is the conversation summary.",
      "Say where inside the surface to land: for mail give account and folder, and messageId",
      "when you know it — without one the newest message in that folder opens, which is what",
      "'the draft you just wrote' means; subject narrows that to the newest carrying it.",
      "For messaging give chatId or chatName; for the drive give source and path.",
      "To write a message rather than go to one, use `hub_draft`.",
      "This only navigates: it shows the user a surface and changes nothing.",
      "For a web page use the browser tool's 'show' instead.",
    ].join(" "),
    // Putting a pane on screen is instant and has no result to wait on, so it
    // never needs to hold the run's sequential lane.
    executionMode: "parallel",
    // Several delegated runs work at once and none of them can see the screen;
    // whichever finished last would decide what the user is looking at. So the
    // run the user is talking to owns the view, and a subagent reports what it
    // did instead of showing it.
    mainAgentOnly: true,
    parameters: {
      type: "object",
      properties: {
        surface: { type: "string", enum: SURFACES },
        account: { type: "string" },
        folder: { type: "string" },
        messageId: { type: "string" },
        subject: { type: "string" },
        chatId: { type: "string" },
        chatName: { type: "string" },
        source: { type: "string" },
        path: { type: "string" },
      },
      required: ["surface"],
      additionalProperties: false,
    },
    async execute(input) {
      const request = revealRequest(input);
      if (!request)
        return {
          content: `surface must be one of: ${SURFACES.join(", ")}`,
          isError: true,
        };
      const unlinked = workspace.linked
        ? unlinkedDraftTarget(
            request,
            await workspace.linked().catch((): LinkedHub | null => null),
          )
        : null;
      if (unlinked) return { content: unlinked, isError: true };
      workspace.reveal(request);
      return { content: JSON.stringify({ shown: request }) };
    },
  };
}


/**
 * Writing a message the user has not asked to send yet, into the box they
 * would have typed it in.
 *
 * Deliberately not `mainAgentOnly`: a delegated run doing the work is exactly
 * what should be able to produce the draft. What it cannot do is decide what is
 * on screen, so a subagent's draft is placed without stealing the view — the
 * user's own run shows it when it reports back, or the hub simply has it
 * waiting the next time it is opened.
 */
export function createHubDraftTool(workspace: WorkspaceRevealer): AgentTool {
  return {
    name: "hub_draft",
    description: [
      "Write a message into the hub without sending it: the chat's message box, or the mail",
      "composer, filled in and waiting for the user.",
      "For a chat give chatId or chatName and `draft`; `replyTo` is the id of the message being",
      "answered, and the box then quotes it the way pressing Reply does.",
      "For mail give the `account` and any of `to`, `cc`, `bcc` (comma-separated), `subject`,",
      "`draft` as the body, `attachments` as absolute paths, and `importance` 'high' or 'low'.",
      "`mode` 'reply', 'reply-all' or 'forward' answers the message messageId/subject names:",
      "the composer supplies its recipients, its Re:/Fwd: subject, the quoted text and the",
      "headers that thread it, and your `draft` goes above the quote. Only 'new' lets `subject`",
      "title the message you are writing.",
      "Nothing is saved or sent. Set only what the user asked for — an unrequested Bcc or",
      "urgency flag is a decision they did not make.",
      "Use this only when the user pointed at the conversation or recipient ('draft a reply to",
      "Ming on WeChat', 'email Dana about Friday') and it is linked in the hub. When they only",
      "asked for wording, write it in your reply instead: putting words in a chat box implies a",
      "recipient they never chose.",
    ].join(" "),
    executionMode: "parallel",
    parameters: {
      type: "object",
      properties: {
        account: { type: "string" },
        folder: { type: "string" },
        messageId: { type: "string" },
        subject: { type: "string" },
        chatId: { type: "string" },
        chatName: { type: "string" },
        draft: { type: "string" },
        to: { type: "string" },
        cc: { type: "string" },
        bcc: { type: "string" },
        attachments: { type: "array", items: { type: "string" } },
        importance: { type: "string", enum: ["high", "normal", "low"] },
        replyTo: { type: "string" },
        mode: { type: "string", enum: ["new", "reply", "reply-all", "forward"] },
      },
      additionalProperties: false,
    },
    async execute(input, context) {
      const request = revealRequest({ ...input, surface: "hub" });
      if (!request?.mail?.compose && !request?.chat?.draft)
        return {
          content:
            "Nothing to draft: give chatId/chatName with draft, or account with the mail fields.",
          isError: true,
        };
      const unlinked = workspace.linked
        ? unlinkedDraftTarget(
            request,
            await workspace.linked().catch((): LinkedHub | null => null),
          )
        : null;
      if (unlinked) return { content: unlinked, isError: true };
      // A delegated run may write the draft but not decide what is on screen,
      // so its request lands without opening or fronting anything.
      if (context.subagent) request.focus = false;
      workspace.reveal(request);
      return {
        content: JSON.stringify({
          drafted: request,
          ...(context.subagent
            ? {
                shown: false,
                note: "Written into the hub without opening it. Say so when you report back, so the main run can show it.",
              }
            : { shown: true }),
        }),
      };
    },
  };
}

/** The tool's flat arguments as the request the renderer acts on, or null when
 * the surface is not one of ours. */
export function revealRequest(input: Record<string, unknown>): WorkspaceRevealDto | null {
  const surface = SURFACES.find((name) => name === input.surface);
  if (!surface) return null;
  const request: WorkspaceRevealDto = { surface };
  const account = text(input.account);
  const draft = text(input.draft);
  const to = text(input.to);
  const subject = text(input.subject);
  const replyTo = text(input.replyTo);
  const mode = COMPOSE_MODES.find((name) => name === input.mode);
  const cc = text(input.cc);
  const bcc = text(input.bcc);
  const attachments = Array.isArray(input.attachments)
    ? input.attachments.map(text).filter(Boolean)
    : [];
  const importance = IMPORTANCE.find((name) => name === input.importance);
  if (surface === "hub" && account)
    request.mail = {
      account,
      ...(text(input.folder) ? { folder: text(input.folder) } : {}),
      // A reply or forward still has to find what it answers, so messageId and
      // subject keep their navigating meaning there. Only a new message has no
      // message to look for, which frees `subject` to title the one being
      // written.
      ...(draft || to || cc || bcc || mode || attachments.length || importance
        ? {
            ...(mode && mode !== "new"
              ? {
                  ...(text(input.messageId) ? { messageId: text(input.messageId) } : {}),
                  ...(subject ? { subject } : {}),
                }
              : {}),
            compose: {
              ...(to ? { to } : {}),
              ...(cc ? { cc } : {}),
              ...(bcc ? { bcc } : {}),
              ...(subject && (!mode || mode === "new") ? { subject } : {}),
              ...(draft ? { body: draft } : {}),
              ...(attachments.length ? { attachments } : {}),
              ...(importance ? { importance } : {}),
              ...(mode ? { mode } : {}),
            },
          }
        : {
            ...(text(input.messageId) ? { messageId: text(input.messageId) } : {}),
            ...(subject ? { subject } : {}),
          }),
    };
  const chatId = text(input.chatId);
  const chatName = text(input.chatName);
  if (surface === "hub" && (chatId || chatName))
    request.chat = {
      ...(chatId ? { id: chatId } : {}),
      ...(chatName ? { name: chatName } : {}),
      ...(draft ? { draft } : {}),
      ...(replyTo ? { replyTo } : {}),
    };
  const source = text(input.source);
  const path = text(input.path);
  if (surface === "drive" && (source || path))
    request.drive = { ...(source ? { source } : {}), ...(path ? { path } : {}) };
  return request;
}

/**
 * Why a draft cannot land in the hub, or null when it can. Only drafts are
 * checked: navigating to a mailbox that is no longer linked shows an empty
 * pane, which explains itself, while a draft written into nothing is simply
 * lost — and the user asked for the words either way.
 */
export function unlinkedDraftTarget(
  request: WorkspaceRevealDto,
  linked: LinkedHub | null,
): string | null {
  const answerInChat =
    "Write the draft in your reply instead — it is the only place the user can read it.";
  if (request.mail?.compose) {
    if (!linked)
      return `The hub could not say which accounts are linked. ${answerInChat}`;
    const wanted = request.mail.account.trim().toLowerCase();
    const found = linked.mailAccounts.some(
      (account) =>
        account.id.toLowerCase() === wanted ||
        (account.email ?? "").toLowerCase() === wanted,
    );
    if (!found)
      return linked.mailAccounts.length
        ? `No email account "${request.mail.account}" is linked in the hub. Linked: ${linked.mailAccounts
            .map((account) => account.email || account.id)
            .join(", ")}. ${answerInChat}`
        : `No email account is linked in the hub. ${answerInChat}`;
  }
  if (request.chat?.draft) {
    if (!linked) return `The hub could not say which chats are linked. ${answerInChat}`;
    const id = request.chat.id?.toLowerCase();
    const name = request.chat.name?.toLowerCase();
    const found = linked.chats.some(
      (chat) =>
        (id && chat.id.toLowerCase() === id) ||
        (name && chat.name.toLowerCase() === name),
    );
    if (!found)
      return `That chat is not linked in the hub. ${answerInChat}`;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
