---
name: message
description: Handle personal messages across connected accounts. Use when the platform is unspecified; a task compares or spans platforms or accounts; all new or unread messages are requested; or WhatsApp, Telegram, Discord, Messenger, Instagram, LinkedIn, iMessage, or WeChat context or sending is needed. Matrix is the default shared backend for verified connected accounts. For clearly scoped email, reminder, or wording-only work, use `email`, `apple-reminders`, or `chat-style` directly.
author: FlareAI
category: Communication
---

# Message

Route personal message through the safest capable platform, retrieve only the context needed, and preserve the user's established style.

## Authority and safety

- Keep replies short, cohesive, and outcome-first. For an explanatory answer, use at most five short points and omit implementation details, caveats, metrics, deep-dive menus, and meta-commentary unless they are decision-critical or requested.
- Matrix is the shared backend for WhatsApp, Telegram, Discord, Messenger, Instagram, LinkedIn, iMessage, and verified WeChat. Platform-specific skills remain authoritative where one exists. Load `email` for email, `apple-reminders` for reminders, and `chat-style` for final personal wording.
- Before any discovery or call that may initialize, reveal, or control a local GUI app, load `gui-control` and follow its current route. This skill does not duplicate GUI mechanics.
- Prefer capable direct APIs, connectors, and CLIs before browser, desktop, or phone control.
- Never invent a recipient, address, chat ID, account, or delivery result. Observed context is not send authority.

## Classify intent

- **Draft:** write text only. Never send.
- **Reply:** retrieve enough conversation context, then draft or send according to the user's wording.
- **Send:** resolve the exact recipient and follow the selected platform's approval rule.
- **Search or summarize:** use bounded, read-only platform retrieval.
- **Manage:** archive, delete, move, label, mute, or otherwise mutate only with explicit authorization.

## Approval precedence

- A draft request never authorizes sending.
- For every Matrix-backed chat—WhatsApp, Telegram, Discord, Messenger, Instagram, LinkedIn, iMessage, and WeChat—resolve the exact account, recipient, and final payload. If the user's request already explicitly supplies all three and says to send, treat it as the explicit approval; otherwise show those details and obtain explicit send approval.
- That direct or reviewed approval is sufficient for that exact message or ordered batch; do not ask again unless the account, recipient, payload, or circumstances materially change. For email, load and follow `email`, including its account-selection and background-mail route, rather than restating its approval rules here.
- Do not monitor conversations, auto-reply, or continue sending autonomously. Each outbound message or exact ordered batch requires the platform's normal explicit send approval; later replies require fresh approval.
- Pause when sensitive content, private data, commitments, payments, legal/medical/financial advice, emotional conflict, or bulk messages have not already been included in the exact reviewed authorization.

Never retry an ambiguous send until delivery evidence has been checked.

## Platform routing

- **Matrix-backed messaging:** for WhatsApp, Telegram, Discord, Messenger, Instagram, LinkedIn, iMessage, and WeChat, use the Matrix tools directly. For one known conversation, resolve it with `matrix_list_rooms`, then read it with `matrix_get_messages`; for a topic or person, use `matrix_search_messages`. Account authentication alone is not proof of a usable room or live bridge.
- **All new or unread messages:** use one global `matrix_get_unread_messages` call rather than scanning platforms or rooms separately. Continue its pagination when the user asks for all, group results by platform and conversation, and do not mark anything read.
- **Matrix unavailable or unsupported:** when Matrix lacks the exact room, account state, media feature, or required capability, immediately report the platform, account, missing capability, and observed blocker. Do not attempt a browser, desktop, phone, or platform-specific fallback unless the user explicitly asks for that alternate route.
- **Email:** load `email` and let it choose the account and route.
- **WeChat:** use the verified Matrix route for reading, searching, unread retrieval, and text sending. For an unsupported feature, report the limitation and wait for an explicit fallback request.
- **Web surfaces:** load `browser-use` and use the FlareAI in-app Browser first.
- **Reminders:** load `apple-reminders` for Apple Reminders; do not treat reminders as messages.
- **Phone tasks:** load `remote-control` before declaring a phone route unavailable.

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

Read [references/detailed-workflows.md](references/detailed-workflows.md) only for media ordering and partial-send recovery, per-recipient profile edge cases, casual-chat boundaries, or unusual fallbacks. Read [references/matrix-backend.md](references/matrix-backend.md) only for bridge health, linking, repair, room invitations, MCP loading, or Matrix runtime maintenance.

## Completion

Report one verified outcome: drafted, sent, blocked, or awaiting confirmation.
