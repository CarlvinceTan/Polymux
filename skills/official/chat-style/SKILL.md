---
name: chat-style
description: Draft, rewrite, and review short chat or message replies in the user's personal text style. Use when composing replies for WeChat, WhatsApp, email-like chats, marketplace/support chats, friend messages, or any communication where the agent should match the user's own phrasing, bubble length, casualness, language mix, and prior corrections. Also use when recording user edits to improve future chat drafts.
author: Midas
category: Communication
---

# Chat Style

Use this skill to make chat replies sound like the user, not like an assistant. Keep it separate from platform skills: communication skills decide where to read/send; this skill decides how the text should sound.

## Core Workflow

1. Understand the actual reply meaning first.
2. Use the latest context and person identity supplied by the owning platform skill. If it is incomplete, request only the needed context through that skill; do not independently choose a platform route.
3. Pull style evidence in this order:
   - the user's recent outgoing messages to that person
   - approved/rejected edit examples logged for that person or platform
   - general user style rules in this skill
4. Draft as short chat bubbles, not a polished paragraph, unless the platform or situation calls for long-form text.
5. Self-check before showing or sending:
   - answers the latest message directly
   - does not repeat old context unnecessarily
   - not more formal, verbose, apologetic, or explanatory than the user would be
   - uses only style examples clearly authored by the user
   - avoids commitments, emotional escalation, flirting, private data, or sensitive claims unless the user clearly asked for them

## Style Evidence Rules

- Prefer examples from the same person and platform over global rules.
- Treat outgoing messages from the user as style examples. Do not learn style from the recipient, quoted text, previews, AI drafts, UI labels, or summaries.
- Use 3-8 relevant examples when available. More examples can make the draft overfit or drift.
- Preserve the user's normal level of casualness, casing, punctuation, emoji use, and message chunking for that relationship.
- Use the user's corrections as stronger evidence than older examples.

## Default Text Style

- Keep replies concise, natural, and chat-native.
- Use short bubbles for casual chats and active messaging.
- Avoid assistant-like phrasing: "I hope you're well", "just wanted to check in", "happy to help", "please let me know", "that sounds great" unless the user actually writes that way in the relationship.
- Avoid over-explaining obvious context or domain terms.
- For friends, quick reactions can be enough when they fit: "hmm", "rip", "oh well", "yeah hahaha", "anyway anyway", "This one right?", "Yep", or a short emoji reaction.
- For commercial, school, landlord, recruiter, or support chats, keep practical clarity but do not over-polish.

## Edit Learning

Record draft/final pairs whenever the user edits a proposed chat reply. Use the helper script:

```bash
python3 scripts/record_chat_edit.py record-original --text "draft" --person "name-or-id" --platform "wechat" --message-type "reply"
python3 scripts/record_chat_edit.py record-final --match "<hash>" --text "user final version"
python3 scripts/record_chat_edit.py pending
python3 scripts/record_chat_edit.py stats
```

Store examples in `~/.midas/state/chat-style/edits/` by default. These logs are evidence for the main agent to read and summarize into skill rules later; they do not require another AI process.

When reviewing edits:

- Look for concrete differences: shorter, less formal, different emoji, different bubble split, removed explanation, changed commitment, changed wording.
- Promote repeated corrections into the skill only when they are stable across examples.
- Keep person-specific quirks in a future relationship memory layer instead of hard-coding them globally.

## Coordination

- Let `message` and `email` handle platform routing and safety.
- Use this skill after the platform skill has identified the person, latest context, and whether the user wants draft-only or send.
- If a relationship-memory tool exists, use it before drafting to retrieve person aliases, cross-platform context, open loops, and relevant outgoing examples.
