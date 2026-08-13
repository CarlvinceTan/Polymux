---
name: mail
description: Work with configured IMAP and SMTP mailboxes through the Himalaya CLI. Use to list, search, read, draft, reply, move, flag, delete, or send email when a configured Himalaya account is the appropriate mailbox route.
allowed-tools: read write bash
---

# Mail

Himalaya is the mailbox execution adapter. The user's request determines the
account, content, and whether a side effect is authorized.

## Safety

- Detect the installed version and capabilities with `himalaya --version`.
- Prefer structured output such as JSON for listing, searching, and inspection.
- Resolve the exact account, folder, and message identifier before acting.
- Reading and bounded search are safe by default. Draft rather than send unless
  the user clearly authorizes sending the finished message.
- Moving, deleting, changing flags, and bulk operations require clear scope.
- Never retry a failed send blindly: delivery may have succeeded even when
  saving to Sent failed. Inspect delivery and Sent-folder evidence first.
- Do not print credentials, tokens, or complete private message bodies unless
  needed for the user's request.

## Workflow

1. Inspect configured accounts and folders without changing them.
2. Use a bounded query and inspect only likely matches.
3. For replies, preserve threading headers and quote only what is useful.
4. Compose mail in a temporary file when content is non-trivial; verify
   recipients, subject, body, attachments, and sending account.
5. Save a draft by default. Send only with explicit authorization.
6. Verify the resulting Drafts or Sent item before reporting success.

If account setup requires authentication outside the CLI, stop and ask for a
user handoff rather than exposing or guessing credentials.

