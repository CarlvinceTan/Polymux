---
name: email
description: Route proactive email discovery, reading, searching, drafting, replying, attachment handling, and sending through the right local email surface. Use for explicit email tasks and whenever email is a likely primary evidence source for research, reviews, memory or history reconstruction, prior decisions and promises, purchases, bookings and travel, job applications, account or admin work, supplier work, or recent correspondence, even when the user did not explicitly mention email. Prefer bounded read-only searches of relevant configured accounts through Himalaya CLI, then use Apple Mail on macOS or Outlook or webmail on Windows when Himalaya is unavailable or blocked. Never send, delete, move, archive, mark, label, or otherwise mutate mail without explicit user approval, and always show drafts before sending.
author: Midas
category: Communication
---

# Email

## Proactive Evidence Search

- Automatically search email when it is a likely source of primary evidence for the user's research, review, reconciliation, or history-reconstruction task, even if the user did not explicitly ask to search email.
- Treat Hindsight or memory reviews, prior decisions or promises, receipts and orders, bookings and travel, supplier discussions, job applications, account administration, and recent correspondence as common triggers.
- Keep discovery bounded and read-only. Start with the one to three accounts most strongly suggested by the people, domain, project, or address involved; search envelope metadata and a narrow date or keyword window first; then read only likely matches. Expand only when the initial search is insufficient.
- Do not inspect unrelated messages, and do not search email when the user forbids it or the task is clearly self-contained and email is unlikely to help.
- Email discovery authorizes no mailbox mutation. Do not send, reply, forward, delete, archive, move, mark read or unread, star, flag, label, or change mailbox state without explicit user approval. Download a clearly relevant attachment only when necessary to inspect it for the task.
- State briefly when email materially informed the result and identify the account or bounded search scope without exposing unrelated private content.
- When the user asks only for the evidence-gathering approach and forbids current account access, explain that an actual run would load `email`, make a bounded read-only search of the most likely configured accounts using narrow date, sender, recipient, subject, booking-reference, or keyword clues, read only likely matches, and disclose when that email evidence materially informed the result. Do not substitute a request for copied messages unless configured-mail access is genuinely unavailable.

## Routing

1. Prefer Himalaya CLI for any account that is configured and working.
   - Check accounts with `himalaya account list`.
   - Use the matching account with `-a <account>`.
   - Load the `himalaya` skill before non-trivial Himalaya read/send/attachment work.
2. Use the platform mail fallback when:
   - the account is not configured in Himalaya,
   - Himalaya auth or IMAP/SMTP access is blocked,
   - the user asks for the native mail app specifically,
   - exact rich signature rendering or embedded images are required,
   - the task involves university email.
   - On macOS, use Apple Mail.
   - On Windows, use Outlook when configured; otherwise use the account's browser webmail.
3. Do not use browser webmail on macOS unless Himalaya and Apple Mail are both unsuitable or the user explicitly asks for it. On Windows, browser webmail is the normal fallback when Outlook is absent or unsuitable.

## Known Account Preference

- University email: use Apple Mail on macOS; use Outlook or browser webmail on Windows. Himalaya access may be blocked by the institution.
- Other email accounts: try Himalaya first if listed by `himalaya account list`.

## Non-Interrupting App Fallbacks

- Prefer Himalaya or a direct mail connector. For webmail, follow `browser-use` and use the in-app Browser by default.
- Permission to use Apple Mail, Outlook, or webmail is not permission to foreground it. Before any local mail GUI initialization or control, load `window-control` and complete its session preflight. Keep every native-mail fallback hidden or backgrounded unless user interaction is required. Use a verified non-activating launcher and exact-window control; a compiled launch route may use `window-control`'s pre-armed, launch-only recovery boundary. After recovery, initialize a controller only through an independently verified non-activating route; any later takeover is a hard stop.
- Do not click, type, hide, minimize, or switch windows in an app the user is actively using. If signature fidelity or another required step cannot be completed without visible control, prepare everything possible in the background and ask before surfacing the app.

## Sending Rules

- Never send automatically.
- Always show the user the draft first:
  - From
  - To/Cc/Bcc
  - Subject
  - Body
  - Attachments
  - Signature source
- Wait for explicit user approval before sending.
- If the user changes the draft, show the revised version before sending.

## Signatures

- Himalaya does not automatically apply native mail-app signatures.
- Before sending through Himalaya, add the appropriate signature manually.
- Prefer signatures extracted from prior sent messages or saved references.
- If exact signature formatting, logo images, or rich signature layout matters, prepare the message in Apple Mail, Outlook, or webmail instead.
- Keep plain-text reusable signatures in `references/signatures.md` when discovered.

## Attachments

- With Himalaya, inspect attachment availability from envelope/message metadata.
- Download attachments with `himalaya attachment download <message-id> --dir <dir>`.
- For PO PDFs or invoice PDFs, download to the workspace, then inspect with the PDF skill or bundled PDF tools.
- Do not upload or forward attachments without user approval.

## Common Himalaya Commands

```bash
himalaya account list
himalaya folder list -a <account>
himalaya envelope list -a <account> --folder '<folder>' --page-size 20 --output json
himalaya message read -a <account> --folder '<folder>' <id>
himalaya attachment download -a <account> --folder '<folder>' <id> --dir <dir>
```

For sending, use a piped template only after the user approves the shown draft.

## Platform Fallbacks

- Use local app control only when needed.
- For university email, start from Apple Mail on macOS or Outlook/webmail on Windows rather than retrying blocked Himalaya auth.
- Draft in the selected mail surface when signature fidelity matters, then stop before send and ask for confirmation.
