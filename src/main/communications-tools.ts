import type {AgentTool} from "@flareai/core";
import {COMMS_PLATFORMS} from "@flareai/protocol";
import type {Communications} from "./communications/index.js";

/**
 * Agent tools for the accounts linked in Settings → Communications: `message_*`
 * reaches every bridged network through the local Matrix hub, and `email_*`
 * drives the configured mailboxes.
 *
 * These exist so messaging and email are app capabilities rather than an
 * external MCP server the user has to register and keep running.
 */
export function createCommunicationsTools(comms: Communications): AgentTool[] {
  return [
    createChatsTool(comms),
    createReadTool(comms),
    createSearchTool(comms),
    createUnreadTool(comms),
    createSendTool(comms),
    createEmailAccountsTool(comms),
    createEmailListTool(comms),
    createEmailReadTool(comms),
    createEmailSendTool(comms),
  ];
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
      "List the user's conversations across every linked messaging platform (WhatsApp, Telegram, Messenger, Instagram, Discord, LinkedIn, iMessage, WeChat) with their ids, names, and which platform each belongs to. Use the returned chat_id with message_read and message_send.",
    parameters: {
      type: "object",
      properties: {
        query: {type: "string", description: "Case-insensitive filter on the chat name"},
        platform: {type: "string", enum: PLATFORM_IDS},
      },
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const rooms = await comms.chats();
        const needle =
          typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
        const platform = typeof input.platform === "string" ? input.platform : "";
        return ok(
          rooms
            .filter((room) => !needle || room.name.toLowerCase().includes(needle))
            .filter((room) => !platform || room.platform === platform)
            .map((room) => ({chat_id: room.roomId, name: room.name, platform: room.platform})),
        );
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
      "Read recent messages from one conversation, newest first. Pass the exact chat_id from message_chats.",
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
        return ok({next_before: result.nextBefore, messages: result.messages});
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
      "Search message text across every linked messaging platform. Use this to find a conversation or a past message when the chat_id is unknown.",
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
        return ok({next_batch: result.nextBatch, messages: result.messages});
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
      "Fetch unread messages across every linked messaging platform without marking them read. Use this to answer questions like what the user has missed.",
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
        return ok(
          await comms.unreadChats(bounded(input.limit, 100, 500), asString(input.platform)),
        );
      } catch (error) {
        return failed(error);
      }
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
        if (!status.email.tooling.installed) return failed(new Error(status.email.tooling.error ?? "Email is not configured."));
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

function createEmailSendTool(comms: Communications): AgentTool {
  return {
    name: "email_send",
    description:
      "Send an email from one of the user's mailboxes. This delivers immediately, so show the user the exact From, To, Cc, Subject, and body and get their approval before calling it.",
    parameters: {
      type: "object",
      properties: {
        account: {type: "string", description: "Account id to send from; defaults to the default account"},
        to: {type: "array", items: {type: "string"}},
        cc: {type: "array", items: {type: "string"}},
        bcc: {type: "array", items: {type: "string"}},
        subject: {type: "string"},
        body: {type: "string"},
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

function bounded(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}
