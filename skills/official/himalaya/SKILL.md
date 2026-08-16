---
name: himalaya
description: Himalaya CLI adapter for configured IMAP/SMTP mailboxes. Use whenever a task decides whether a configured mailbox should use Himalaya or a native-mail fallback, or when `email` selects Himalaya, the user asks for Himalaya, or an account needs CLI-level diagnosis. Pair it with `email`; do not replace the general email router. Keep any Apple Mail fallback hidden/background unless user interaction is required, and state this constraint in route explanations.
license: AGPL-3.0
metadata:
  hermes:
    tags: [Email, IMAP, SMTP, CLI, Communication]
    homepage: https://github.com/pimalaya/himalaya
author: FlareAI
category: Communication
---

# Himalaya Email CLI

Himalaya operates configured mailboxes from the terminal. It is an execution
adapter, not the authority for choosing accounts, drafting mail, or approving
sends. Detect its installed version and compiled capabilities with
`himalaya --version`; do not rely on a version copied into this skill.

## Safety And Routing

- `email` is authoritative for account routing, signatures, attachments,
  draft-first behavior, and send approval. Load it before real mailbox work.
- Read, list, and bounded search operations may run directly after resolving the account and folder.
- Save a draft by default. Execute a send command only when `email` determines
  that the user's instruction explicitly authorizes sending the finished mail.
- Never retry a send merely because Himalaya exits non-zero. SMTP delivery may have succeeded before save-to-Sent failed; inspect the correct Sent folder and delivery evidence first.
- Verify account, folder, current message ID, and destination before copying, moving, deleting, or changing flags. Deletion and consequential reorganization require explicit approval.
- Keep Himalaya CLI-only. If setup needs a browser or local GUI, load `browser-use` or `gui-control` as applicable and preserve the user's focus.
- If `email` selects Apple Mail as a fallback, follow its route and
  `gui-control`; do not duplicate GUI policy here.
- Prefer `--output json` for structured reads. Do not expose credentials or unnecessary message content in logs.

## Quick preflight

```bash
himalaya --version
himalaya account list
himalaya folder list
```

For a small connection check:

```bash
himalaya envelope list --page 1 --page-size 3
himalaya envelope list -a work --page 1 --page-size 3
```

The `-a` account flag belongs on the subcommand. Message IDs are relative to the selected folder, so re-list after folder changes.

## Reference routing

Read only the reference needed for the task:

- [operations.md](references/operations.md): listing, reading, sending commands, attachments, mutations, and diagnosis.
- [configuration.md](references/configuration.md): safe configuration,
  credentials, aliases, and provider diagnosis.
- [message-composition.md](references/message-composition.md): MML, rich mail, inline images, and attachments.
- [lark-email.md](references/lark-email.md): Lark/Feishu IMAP and SMTP.

## Lark / Feishu Configuration

Read [lark-email.md](references/lark-email.md). Lark SMTP uses port 465 with TLS, not port 587 with STARTTLS.

## Common operations

Read [operations.md](references/operations.md) before composing, mutating, downloading attachments, or debugging. Key forms include:

```bash
himalaya envelope list -a work
himalaya attachment download 42 --dir ~/Downloads
```

## Troubleshooting

- Authentication, aliases, Gmail, iCloud, and Microsoft routing:
  [configuration.md](references/configuration.md)
- Lark ports and credentials: [lark-email.md](references/lark-email.md)

After any setup change, run a bounded connection check. After any ambiguous send, check Sent and delivery evidence before taking further action.
