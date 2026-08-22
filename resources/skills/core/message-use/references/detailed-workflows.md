# Detailed message workflows

Read this reference only for the edge cases named in `SKILL.md`. The core skill
and the owning platform skills remain authoritative.

## Media ordering and recovery

- Represent each photo, file, link, or voice note as its own numbered chunk at
  the exact planned point in the sequence.
- Verify that the selected route can read and upload the final file before
  sending surrounding text that depends on it.
- If a direct bridge restricts outbound paths, use a currently configured
  bridge outbox. Do not assume or invent a path; inspect the route's reported
  configuration. After copying, verify the exact copied file before sending.
- Recheck the latest recipient message before the first send. Send approved
  chunks sequentially and preserve their order.
- If an upload fails before anything is sent, report the failure and ask before
  substituting a link or different file unless that fallback was already
  approved.
- If any text or media has already landed, stop after a later failure and state
  exactly what was delivered. Do not silently retry, reorder, rewrite, or
  replace the remaining chunks.

## Per-recipient context

- Use recent clearly user-authored messages to the same recipient as the
  strongest style evidence. Borrow style, never facts, from another chat.
- Treat quoted, forwarded, recipient-authored, preview, and unapproved generated
  text as context rather than evidence of the user's style.
- An existing profile is only a starting point. Refresh it against the current
  conversation and let recent user corrections win.
- Keep newly inferred profile state task-local unless an existing approved
  profile store supports the update. Do not create durable memory or a new
  personal database merely to prepare one reply.
- For professional review requests, frame the intent as due diligence or final
  confirmation unless the user asks for a blunter tone, then pass that intent
  to `chat-style` for final wording.

## Casual-chat boundaries

- Match established casualness, language mix, nicknames, emojis, and bubble
  length through `chat-style`.
- Do not introduce flirting, insults, conflict, private disclosures, or
  commitments merely to make a conversation more lively. They require the
  user's request or clear approved context.

## Unusual fallbacks

- Discover the currently capable route instead of assuming a bridge, browser,
  desktop app, phone, operating system, or signed-in account is available.
- Load `browser-use` or `computer-use` for the selected
  fallback and let that skill own its mechanics. Message still owns the
  exact recipient, account, payload, and send authorization.
- Keep one route for an ordered send. If a route fails, determine what already
  landed before proposing another route.
- When no capable route exists, provide the approved draft or precise blocker;
  never claim that an unverified send succeeded.
