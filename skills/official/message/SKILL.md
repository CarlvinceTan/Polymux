---
name: message
description: Handle personal messages across connected chat accounts. Use when the platform is unspecified, a request spans platforms, unread messages are requested, or WhatsApp, Telegram, Discord, Messenger, Instagram, LinkedIn, iMessage, or WeChat context or sending is needed. Use Mail for email instead.
allowed-tools: read write bash
---

# Message

Route personal messages through an available messaging MCP or configured local
adapter. Keep chat separate from email, reminders, and generic browser work.

## Intent

- **Draft:** write message text only. Never send.
- **Reply:** retrieve only enough conversation context to answer accurately,
  then draft or send according to the user's instruction.
- **Send:** resolve the exact platform, account, recipient, and final payload.
- **Search or summarize:** perform bounded, read-only retrieval.
- **Manage:** archive, delete, mute, label, or otherwise change conversations
  only when explicitly requested.

## Routing and safety

1. Prefer a configured messaging MCP or direct API. Use Matrix when it is the
   configured shared backend for the requested platform.
2. Authentication alone does not prove that the intended account, bridge, or
   conversation is available. Resolve the exact conversation before acting.
3. Never invent a recipient, account, conversation identifier, message, or
   delivery result.
4. A draft request never authorizes sending. Send only when the user clearly
   authorizes the exact account, recipient, and payload.
5. Do not retry an ambiguous or partially failed send until delivery evidence
   has been checked.
6. Do not monitor or auto-reply indefinitely. Each later outbound message needs
   fresh authorization.
7. If the configured adapter lacks the platform, conversation, attachment type,
   or required capability, report the observed limitation instead of silently
   switching to GUI automation.

## Context and drafting

Use the lightest context that preserves facts and tone. For an ordinary reply,
read messages since the user's latest outgoing message and capture unresolved
questions or commitments. Use deeper, bounded history only for sensitive,
contradictory, high-stakes, or long-running threads.

Present every outbound chat draft as numbered send-order chunks, including a
single message:

```text
1. First message bubble
2. Second message bubble
```

For a non-English draft, place a concise English translation immediately below
each numbered chunk. Keep names, links, codes, and quoted wording unchanged.

Before sending, recheck the latest message and verify the ordering of text and
attachments. Report one verified outcome: drafted, sent, blocked, or awaiting
confirmation.

