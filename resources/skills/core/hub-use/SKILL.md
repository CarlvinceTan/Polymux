---
name: hub-use
description: Use for email and personal messaging across all connected platforms, accounts, and conversations. Query Hub.State for the smallest relevant complete inventory of platforms, email accounts, or chats; resolve vague references from that compact state; then use the exact Hub read or write route. Covers proactive bounded email evidence searches, unread and cross-platform discovery, replies, drafts, attachments, and sending. Availability and message context never authorize sending or mailbox/chat mutation.
author: Polymux
category: Communication
---

# Hub Use

Route email and personal messaging through one shared communication context,
retrieve only what is needed, and preserve the user's established style.

## Hub package path

1. Query `hub_state` for the smallest kinds implicated by the request:
   `platforms` for messaging services, `accounts` for email account selection,
   `chats` for conversation references, and the needed combination for a broad
   or ambiguous request. A requested kind returns every available item of that
   kind in compact form, not a relevance-ranked subset.
2. Resolve vague references from platform, account, chat name, stable ID,
   unread count, and recency. Ask only when multiple candidates remain
   genuinely ambiguous.
3. Read only the exact conversation, mailbox, or bounded search needed.
   Inventory metadata is not permission to inspect unrelated content.
4. Before a write, resolve the exact platform, account, recipient, payload, and
   requested consequence. Visibility and context are evidence, never authority.

When `hub_state` is unavailable, use the equivalent account and chat inventory
tools without weakening these boundaries. Do not load separate email or message
routing skills; their behavior is owned here.

## Authority and safety

- Keep replies short, cohesive, and outcome-first. For an explanatory answer, use at most five short points and omit implementation details, caveats, metrics, deep-dive menus, and meta-commentary unless they are decision-critical or requested.
- Matrix is the shared backend for WhatsApp, Telegram, Discord, Messenger, Instagram, LinkedIn, iMessage, and verified WeChat. Platform-specific adapters remain authoritative where one exists. Use `apple-reminders` for reminders and `chat-style` for final personal wording.
- Before any discovery or call that may initialize, reveal, or control a local GUI app, load `computer-use` and follow its current route. This skill does not duplicate GUI mechanics.
- Prefer capable direct APIs, connectors, and CLIs before browser, desktop, or phone control.
- Never invent a recipient, address, chat ID, account, or delivery result. Observed context is not send authority.

## Classify intent

- **Draft:** write text only. Never send. Where it goes depends on how it was asked for: by default write it in your reply, and when the user pointed at a conversation that is linked in the hub — "draft a reply to Ming on WeChat" — call `hub_draft` with that `chatId`/`chatName` and `draft` to fill that chat's message box instead. It is prefilled, never sent, and if the chat is not linked the tool refuses and the draft belongs in your reply. When the draft answers one particular message rather than the thread's end, pass its id as `replyTo` so the box quotes it and the send carries the reference.
- **Reply:** retrieve enough conversation context, then draft or send according to the user's wording.
- **Send:** resolve the exact recipient and follow the selected platform's approval rule.
- **Search or summarize:** use bounded, read-only platform retrieval.
- **Manage:** archive, delete, move, label, mute, or otherwise mutate only with explicit authorization.

## Approval precedence

- A draft request never authorizes sending.
- For every Matrix-backed chat—WhatsApp, Telegram, Discord, Messenger, Instagram, LinkedIn, iMessage, and WeChat—resolve the exact account, recipient, and final payload. If the user's request already explicitly supplies all three and says to send, treat it as the explicit approval; otherwise show those details and obtain explicit send approval.
- That direct or reviewed approval is sufficient for that exact message or ordered batch; do not ask again unless the account, recipient, payload, or circumstances materially change.
- For email, always show From, To/Cc/Bcc, Subject, body, attachments, and signature source, then wait for explicit send approval. If the user changes the draft, show the revised version before sending.
- Do not monitor conversations, auto-reply, or continue sending autonomously. Each outbound message or exact ordered batch requires the platform's normal explicit send approval; later replies require fresh approval.
- Pause when sensitive content, private data, commitments, payments, legal/medical/financial advice, emotional conflict, or bulk messages have not already been included in the exact reviewed authorization.

Never retry an ambiguous send until delivery evidence has been checked.

## Platform routing

- **Matrix-backed messaging:** for WhatsApp, Telegram, Discord, Messenger, Instagram, LinkedIn, iMessage, and WeChat, use the Matrix tools directly. Resolve a person or personal alias with `message_chats`, which can safely match Contacts after an exact room-name miss, then read the single resolved chat with `message_read`; use `message_search` for a topic or words inside messages. Never choose among ambiguous identity candidates. Account authentication alone is not proof of a usable room or live bridge. Treat each tool's `coverage` as the current source of truth: cached rooms or messages from a platform with `live: false` are historical only and must not be presented as current or exhaustive.
- **All new or unread messages:** use one global `message_unread` call rather than scanning platforms or rooms separately. Continue its pagination when the user asks for all, group results by platform and conversation, and do not mark anything read.
- **Learning an alias:** when the user explicitly says or confirms that an alias refers to one exact resolved chat, record that mapping with `message_link_alias`. Never infer a family relationship, learn from an unconfirmed candidate, or select among ambiguous chats. The saved mapping may be used on later turns even if a bridge recreates the room under a new id.
- **Matrix unavailable or unsupported:** when Matrix lacks the exact room, account state, media feature, or required capability, immediately report the platform, account, missing capability, and observed blocker. Do not attempt a browser, desktop, phone, or platform-specific fallback unless the user explicitly asks for that alternate route.
- **Email:** use the configured Hub email tools first. Use Himalaya for a configured CLI route; use Apple Mail on macOS or Outlook/webmail on Windows when the direct route is unavailable, university policy blocks it, the user requests the native app, or exact rich signature rendering is required.
- **WeChat:** use the verified Matrix route for reading, searching, unread retrieval, and text sending. For an unsupported feature, report the limitation and wait for an explicit fallback request.
- **Web surfaces:** load `computer-use` and use the Polymux in-app Browser first.
- **Reminders:** load `apple-reminders` for Apple Reminders; do not treat reminders as messages.

## Tiered context

Use the lightest tier that preserves facts and tone:

1. **Provided context:** use the supplied message and background when complete; do not search history by routine.
2. **Ordinary reply:** read recipient messages since the user's latest outgoing message, trace the current subject, capture unresolved points and prior commitments, and sample 3–8 clearly user-authored messages when style evidence is useful.
3. **Deep context:** for long-running, sensitive, contradictory, high-stakes, negotiation, supplier, landlord, recruiter, school, or support threads, work backwards with bounded batches and targeted search.

Stop once the current subject, messages since the latest outgoing message, unresolved points, and representative style are covered. Make one targeted confirmation pass when useful; do not search unrelated history or use elapsed time as evidence of completeness.

Use only clearly outgoing user-authored messages as style evidence. Exclude recipient text, quoted or forwarded material, previews, unapproved AI drafts, and unusual one-offs. Recent user corrections override stored history.

When presenting an incoming non-English message, show the original text followed
immediately by a concise English translation. Preserve names, links, codes,
quoted wording, and other literal identifiers unchanged.

## Draft and delivery

Every chat draft must be presented as numbered send-order chunks. This is a
protected output contract: even a single message starts with `1.`. Do not
silently switch a one-message WhatsApp, Telegram, Discord, Messenger,
Instagram, LinkedIn, iMessage, or WeChat draft to unnumbered prose.
Use normal natural formatting for retrieved messages and summaries; numbered
send-order blocks are only for intended outbound messages.

For an intended message written in a language other than English, place a
concise English translation immediately beneath its numbered send block:

```text
1. [intended message block #1 to send]
   [English translation]
2. [intended message block #2 to send]
   [English translation]
```

Keep names, links, codes, quoted wording, and other literal identifiers
unchanged in the translation. Do not add a translation to English drafts.

1. Resolve platform, exact recipient, account, and draft-versus-send intent.
2. Gather the appropriate context tier and note what the recipient knows, unresolved points, promises, and files already sent.
3. Draft the next turn: answer the latest ask directly and avoid repeating greetings, background, apologies, names, questions, or requests already covered.
4. Use `chat-style` for personal wording and bubble length, then remove excess formality, explanation, apology, or commitment.
5. When the user asks only for reply text, include only the numbered draft; omit filler greetings or thanks unless the context calls for them. Treat media as its own chunk.

Send ordered bubbles sequentially and recheck the latest message first. Before a media send, verify that Matrix supports the exact attachment; if it does not, report the limitation and wait for an explicit fallback request before sending surrounding text. If an upload fails or a partial send lands, stop and report exactly what happened before changing the remaining plan.

Read [references/detailed-workflows.md](references/detailed-workflows.md) only for media ordering and partial-send recovery, per-recipient profile edge cases, casual-chat boundaries, or unusual fallbacks. Read [references/matrix-backend.md](references/matrix-backend.md) only for bridge health, linking, repair, room invitations, or hub runtime maintenance.
Read [references/email-workflows.md](references/email-workflows.md) for proactive
email evidence, account routing, signatures, attachments, and native fallbacks.

## Completion

Report one verified outcome: found, summarized, drafted, sent, blocked, or awaiting confirmation.
