import type {AgentTool} from "@flareai/core";
import {COMMS_PLATFORMS} from "@flareai/protocol";
import type {Communications} from "./index.js";

/**
 * Agent tools for the accounts linked in Settings → Communications: `message_*`
 * reaches every bridged network through the local Matrix hub, and `email_*`
 * drives the configured mailboxes.
 *
 * These exist so messaging and email are app capabilities rather than an
 * external MCP server the user has to register and keep running.
 */
export function createCommunicationsTools(
  comms: Communications,
  options: {searchAllEmail?: boolean; searchAllEmailTimeoutMs?: number} = {},
): AgentTool[] {
  return [
    createChatsTool(comms),
    createReadTool(comms),
    createSearchTool(comms),
    createUnreadTool(comms),
    createLinkAliasTool(comms),
    createSendTool(comms),
    createEmailAccountsTool(comms),
    createEmailListTool(comms),
    ...(options.searchAllEmail ? [createEmailSearchAllTool(comms, options.searchAllEmailTimeoutMs)] : []),
    createEmailReadTool(comms),
    createEmailSendTool(comms),
    createEmailFoldersTool(comms),
    createEmailAttachmentsTool(comms),
  ];
}

function createEmailSearchAllTool(comms: Communications, timeoutMs?: number): AgentTool {
  const completedRuns = new Map<string, {messages: number; errors: number}>();
  return {
    name: "email_search_all",
    description: "Search every configured email inbox concurrently with exactly one call containing 1-4 precise IMAP queries, deduplicate matches, and return at most 12 compact account-labelled envelopes. Grouped OR syntax is supported, e.g. 'since 5-Aug-2026 subject (assessment OR interview OR offer)'. Use email_read only for likely matches. Later calls in the same worker return no messages. This is read-only and replaces account discovery and per-mailbox loops.",
    executionMode: "parallel",
    parameters: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: {type: "string"},
          minItems: 1,
          maxItems: 4,
          description: "1-4 targeted field queries, e.g. ['since 5-Aug-2026 subject Singapore', 'since 5-Aug-2026 subject NUS', 'since 5-Aug-2026 from goldmansachs.com'].",
        },
        limitPerQuery: {type: "number", description: "1-10 matches per query/account; default 5."},
        maxResults: {type: "number", description: "Global result cap 1-12; default 12."},
      },
      required: ["queries"],
      additionalProperties: false,
    },
    async execute(input, context) {
      try {
        const runId = context?.runId ?? "";
        const completed = runId ? completedRuns.get(runId) : undefined;
        if (completed)
          return ok({
            searchComplete: true,
            reused: true,
            messageCount: completed.messages,
            errorCount: completed.errors,
            note: "The bounded all-inbox search already completed in this worker run. Use its earlier results; do not search the same mailboxes again.",
          });
        const result = await comms.emailSearchAll({
          queries: requireStrings(input.queries, "queries", 4),
          limitPerQuery: bounded(input.limitPerQuery, 5, 10),
          maxResults: bounded(input.maxResults, 12, 12),
          ...(timeoutMs ? {timeoutMs} : {}),
        });
        if (runId) {
          completedRuns.set(runId, {messages: result.messages.length, errors: result.errors.length});
          if (completedRuns.size > 256) completedRuns.delete(completedRuns.keys().next().value!);
        }
        return ok(result);
      } catch (error) {
        return failed(error);
      }
    },
  };
}

const PLATFORM_IDS = COMMS_PLATFORMS.filter((entry) => entry.value !== "matrix").map(
  (entry) => entry.value,
);

function ok(value: unknown): {content: string} {
  return {content: JSON.stringify(value, null, 2)};
}

function failed(error: unknown): {content: string; isError: true} {
  return {
    content: error instanceof Error ? error.message : String(error),
    isError: true,
  };
}

function createChatsTool(comms: Communications): AgentTool {
  return {
    name: "message_chats",
    description:
      "Resolve one named person or alias across all messaging platforms and return complete current coverage. A non-empty query is required so unrelated chat names are never exposed by an accidental inventory call. Use query='*' only when the user explicitly asks to list every chat. Exact chat names stay on the fast path; after a miss, a bounded read-only Contacts lookup may match a nickname, relationship, real name, or phone identity. Do not repeat the same query with platform filters. Never guess when resolution is ambiguous; report only the matching candidates. A room can remain cached after its platform is disconnected: only coverage entries with live=true are current. Use the returned chat_id with message_read and message_send.",
    parameters: {
      type: "object",
      properties: {
        query: {type: "string", description: "Case-insensitive filter on the chat name"},
        platform: {type: "string", enum: PLATFORM_IDS},
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const needle = requireString(input.query, "query").toLowerCase();
        const platform = typeof input.platform === "string" ? input.platform : "";
        const resolved = needle === "*"
          ? {status: "explicit-inventory", identities: [], chats: await comms.chats()}
          : await comms.resolveChatAlias(needle);
        const rooms = resolved.chats.filter((room) => !platform || room.platform === platform);
        return ok({
          coverage: comms.messageCoverage(),
          resolution: {
            status: resolved.status,
            contact_matches: resolved.identities.length,
            chat_matches: rooms.length,
            ambiguous: rooms.length > 1,
          },
          chats: rooms
            .map((room) => ({chat_id: room.roomId, name: room.name, platform: room.platform})),
        });
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createReadTool(comms: Communications): AgentTool {
  return {
    name: "message_read",
    description:
      "Read recent messages from one conversation, newest first, with current bridge coverage. If its platform is not live, the messages are cached history rather than current coverage. Pass the exact chat_id from message_chats.",
    parameters: {
      type: "object",
      properties: {
        chat_id: {type: "string"},
        limit: {type: "number", description: "1-100, default 30"},
        before: {type: "string", description: "Pagination token from a previous call"},
      },
      required: ["chat_id"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const chatId = requireString(input.chat_id, "chat_id");
        const result = await comms.readChat(chatId, bounded(input.limit, 30, 100), asString(input.before));
        return ok({coverage: comms.messageCoverage(), next_before: result.nextBefore, messages: result.messages});
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createSearchTool(comms: Communications): AgentTool {
  return {
    name: "message_search",
    description:
      "Search message text across messaging platforms and return current bridge coverage. For a named person or personal alias, use message_chats first so contact identity can be resolved, then message_read. Use message_search for words expected inside messages. Cached messages may still match after a platform is disconnected: only coverage entries with live=true are current, so non-live results cannot establish the latest message.",
    parameters: {
      type: "object",
      properties: {
        query: {type: "string"},
        limit: {type: "number", description: "1-100, default 30"},
        chat_ids: {
          type: "array",
          items: {type: "string"},
          description: "Optional exact chat scope",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const query = requireString(input.query, "query");
        const chatIds = Array.isArray(input.chat_ids)
          ? input.chat_ids.filter((item): item is string => typeof item === "string")
          : undefined;
        const result = await comms.searchChats(query, bounded(input.limit, 30, 100), chatIds);
        return ok({coverage: comms.messageCoverage(), next_batch: result.nextBatch, messages: result.messages});
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createUnreadTool(comms: Communications): AgentTool {
  return {
    name: "message_unread",
    description:
      "Fetch unread messages without marking them read and return current bridge coverage. Cached unread state from a platform with live=false is historical and not proof of current unread coverage. State relevant coverage gaps.",
    parameters: {
      type: "object",
      properties: {
        limit: {type: "number", description: "1-500, default 100"},
        platform: {type: "string", enum: PLATFORM_IDS},
      },
      additionalProperties: false,
    },
    async execute(input) {
      try {
        return ok({
          coverage: comms.messageCoverage(),
          ...(await comms.unreadChats(bounded(input.limit, 100, 500), asString(input.platform))),
        });
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createLinkAliasTool(comms: Communications): AgentTool {
  return {
    name: "message_link_alias",
    description:
      "Remember that a personal alias refers to one exact conversation. Call this only when the user explicitly states or confirms the mapping in their request; never infer a family relationship or choose an ambiguous candidate. This changes only FlareAI's local identity memory and sends nothing.",
    parameters: {
      type: "object",
      properties: {
        alias: {type: "string", description: "The exact user-provided alias, e.g. Dad"},
        chat_id: {type: "string", description: "The exact chat_id already resolved with message_chats"},
      },
      required: ["alias", "chat_id"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const linked = await comms.linkChatAlias(
          requireString(input.alias, "alias"),
          requireString(input.chat_id, "chat_id"),
        );
        return ok({remembered: true, alias: linked.alias, name: linked.name, platform: linked.platform});
      } catch (error) { return failed(error); }
    },
  };
}

function createSendTool(comms: Communications): AgentTool {
  return {
    name: "message_send",
    description:
      "Send a message to one conversation. This delivers immediately to a real person on a real platform, so confirm the exact recipient and wording with the user before calling it. Pass the exact chat_id from message_chats or message_search.",
    parameters: {
      type: "object",
      properties: {
        chat_id: {type: "string"},
        text: {type: "string"},
      },
      required: ["chat_id", "text"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const chatId = requireString(input.chat_id, "chat_id");
        const text = requireString(input.text, "text");
        return ok({event_id: await comms.sendChat(chatId, text), chat_id: chatId});
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createEmailAccountsTool(comms: Communications): AgentTool {
  return {
    name: "email_accounts",
    description:
      "List the user's configured mailboxes with their account ids, addresses, and which one is the default. Use the returned account id with the other email tools.",
    parameters: {type: "object", properties: {}, additionalProperties: false},
    async execute() {
      try {
        const status = await comms.status();
        if (status.email.accounts.length === 0)
          return failed(new Error("No email account is set up yet."));
        return ok(
          status.email.accounts.map((account) => ({
            account: account.id,
            email: account.email,
            display_name: account.displayName,
            default: account.isDefault,
          })),
        );
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createEmailListTool(comms: Communications): AgentTool {
  return {
    name: "email_list",
    description:
      "List message envelopes in a mailbox folder, newest first. Returns ids that are relative to the folder, so pass the same folder to email_read.",
    parameters: {
      type: "object",
      properties: {
        account: {type: "string", description: "Account id from email_accounts; defaults to the default account"},
        folder: {type: "string", description: "Defaults to INBOX"},
        limit: {type: "number", description: "1-100, default 20"},
        query: {type: "string", description: "IMAP search query, e.g. 'from alice@example.com'"},
      },
      additionalProperties: false,
    },
    async execute(input) {
      try {
        return ok(
          await comms.emailEnvelopes({
            account: asString(input.account),
            folder: asString(input.folder),
            limit: bounded(input.limit, 20, 100),
            query: asString(input.query),
          }),
        );
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createEmailReadTool(comms: Communications): AgentTool {
  return {
    name: "email_read",
    description:
      "Read one email message in full, including headers and body. The id is relative to the folder it was listed from.",
    parameters: {
      type: "object",
      properties: {
        id: {type: "string"},
        account: {type: "string"},
        folder: {type: "string", description: "Defaults to INBOX"},
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        return ok(
          await comms.emailRead({
            id: requireString(input.id, "id"),
            account: asString(input.account),
            folder: asString(input.folder),
          }),
        );
      } catch (error) {
        return failed(error);
      }
    },
  };
}

/**
 * What the mailbox actually contains. Without this a folder can only be
 * guessed at, and the names are not guessable — Gmail's sent mail lives at
 * "[Gmail]/Sent Mail" while another server calls it "Sent".
 */
function createEmailFoldersTool(comms: Communications): AgentTool {
  return {
    name: "email_folders",
    description:
      "List a mailbox's folders with their full IMAP paths and roles (inbox, sent, drafts, junk, trash, archive). Folder names differ by provider, so read them here rather than guessing, and pass the exact name to email_list.",
    parameters: {
      type: "object",
      properties: {
        account: {type: "string", description: "Account id from email_accounts; defaults to the default account"},
      },
      additionalProperties: false,
    },
    async execute(input) {
      try {
        return ok(await comms.mailFolders(asString(input.account)));
      } catch (error) {
        return failed(error);
      }
    },
  };
}

/**
 * Saving a message's files to disk. Reading a message reports what it carries
 * without transferring any of it, so this is the one way the bytes arrive —
 * and the only reason to ask for them is that something is about to be read.
 */
function createEmailAttachmentsTool(comms: Communications): AgentTool {
  return {
    name: "email_attachments",
    description:
      "Save an email's attachments to disk and return the paths they were written to. email_read names a message's attachments without downloading them; call this only when the files themselves are needed, then open them with the tools for their type.",
    parameters: {
      type: "object",
      properties: {
        id: {type: "string", description: "Message id, relative to the folder it was listed from"},
        account: {type: "string"},
        folder: {type: "string", description: "Defaults to INBOX"},
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const paths = await comms.mailDownload(
          requireString(input.id, "id"),
          asString(input.account),
          asString(input.folder),
        );
        // Only ever said when the message really carries none: a failed fetch
        // now throws rather than arriving here as an empty list, so this
        // sentence cannot reassure anyone about a file that would not download.
        if (paths.length === 0) return ok({paths, note: "That message carries no attachments."});
        return ok({paths});
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createEmailSendTool(comms: Communications): AgentTool {
  return {
    name: "email_send",
    description:
      "Send an email from one of the user's mailboxes. This delivers immediately, so show the user the exact From, To, Cc, Subject, and body and get their approval before calling it. Pass draft: true to save it to the Drafts folder instead of sending — nothing leaves the mailbox, so a draft needs no approval; follow it with workspace_show (surface 'hub', the same account, folder 'Drafts') so the user can read and send it themselves — or, if you are a delegated run and have no such tool, say where it is in your answer.",
    parameters: {
      type: "object",
      properties: {
        account: {type: "string", description: "Account id to send from; defaults to the default account"},
        to: {type: "array", items: {type: "string"}},
        cc: {type: "array", items: {type: "string"}},
        bcc: {type: "array", items: {type: "string"}},
        subject: {type: "string"},
        body: {type: "string"},
        draft: {type: "boolean", description: "Save to Drafts instead of sending"},
        attachments: {
          type: "array",
          items: {type: "string"},
          description: "Absolute paths of files to attach",
        },
        importance: {
          type: "string",
          enum: ["high", "normal", "low"],
          description: "Marks the message urgent or low priority for the recipient; omit for normal",
        },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        return ok(
          await comms.emailSend({
            account: asString(input.account),
            to: stringList(input.to, "to"),
            cc: Array.isArray(input.cc) ? stringList(input.cc, "cc") : [],
            bcc: Array.isArray(input.bcc) ? stringList(input.bcc, "bcc") : [],
            subject: requireString(input.subject, "subject"),
            body: requireString(input.body, "body"),
            draft: input.draft === true,
            attachments: Array.isArray(input.attachments)
              ? stringList(input.attachments, "attachments")
              : undefined,
            importance:
              input.importance === "high" || input.importance === "low"
                ? input.importance
                : undefined,
          }),
        );
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} is required`);
  return value;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${label} must be a non-empty array of addresses`);
  return value.map((item, index) => requireString(item, `${label}[${index}]`));
}

function requireStrings(value: unknown, label: string, maximum: number): string[] {
  const strings = stringList(value, label);
  if (strings.length > maximum) throw new Error(`${label} must contain at most ${maximum} items`);
  return strings;
}

function bounded(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}
