---
name: email-use
description: Route proactive email discovery, reading, searching, drafting, replying, attachment handling, and sending through the right local email surface. Use for explicit email tasks and whenever email is a likely primary evidence source for research, reviews, memory or history reconstruction, prior decisions and promises, purchases, bookings and travel, job applications, account or admin work, supplier work, or recent correspondence, even when the user did not explicitly mention email. Prefer bounded read-only searches of relevant configured accounts through FlareAI's own email tools, then use Apple Mail on macOS or Outlook or webmail on Windows when an account is unconfigured or blocked. Never send, delete, move, archive, mark, label, or otherwise mutate mail without explicit user approval, and always show drafts before sending.
author: FlareAI
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
- When the user asks only for the evidence-gathering approach and forbids current account access, explain that an actual run would load `email-use`, make a bounded read-only search of the most likely configured accounts using narrow date, sender, recipient, subject, booking-reference, or keyword clues, read only likely matches, and disclose when that email evidence materially informed the result. Do not substitute a request for copied messages unless configured-mail access is genuinely unavailable.

## Routing

1. Prefer FlareAI's own email tools for any account that is configured and
   working. They hold an open connection to the mailbox, so a read costs a
   single round trip; there is no CLI to drive and no reason to reach for a
   shell.
   - `email_accounts` lists the configured accounts and their ids.
   - `email_list` lists a folder, newest first, and takes an IMAP search query.
   - `email_read` reads one message in full and names its attachments.
   - `email_attachments` saves those files to disk, and only when they are
     needed — reading a message transfers no attachment.
   - `email_send` sends, or saves to Drafts with `draft: true`.
2. Use the platform mail fallback when:
   - the account is not configured in FlareAI,
   - its IMAP/SMTP access is blocked,
   - the user asks for the native mail app specifically,
   - exact rich signature rendering or embedded images are required,
   - the task involves university email.
   - On macOS, use Apple Mail.
   - On Windows, use Outlook when configured; otherwise use the account's browser webmail.
3. Do not use browser webmail on macOS unless the configured account and Apple Mail are both unsuitable or the user explicitly asks for it. On Windows, browser webmail is the normal fallback when Outlook is absent or unsuitable.

## Known Account Preference

- University email: use Apple Mail on macOS; use Outlook or browser webmail on Windows. Institutions often block direct IMAP/SMTP access.
- Other email accounts: use the email tools first if the account is listed by `email_accounts`.

## Non-Interrupting App Fallbacks

- Prefer the email tools or a direct mail connector. For webmail, follow `browser-use` and use the in-app Browser by default.
- Permission to use Apple Mail, Outlook, or webmail is not permission to foreground it. Before any local mail GUI initialization or control, load `computer-use` and complete its session preflight. Keep every native-mail fallback hidden or backgrounded unless user interaction is required. Use a verified non-activating launcher and exact-window control; a compiled launch route may use `computer-use`'s pre-armed, launch-only recovery boundary. After recovery, initialize a controller only through an independently verified non-activating route; any later takeover is a hard stop.
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
- When a draft is saved to a mailbox rather than shown in chat, put it on screen: call `workspace_show` with surface `hub`, the same account, and folder `Drafts`. The user reads and sends it there; naming the folder in prose leaves them to find it. A delegated run has no `workspace_show` — showing the user something is the main run's to do — so say where the draft is and let it open it.
- **Where a draft belongs.** Write it in your reply by default — "draft an email about Friday", "help me word this" is a request for words, not for a half-filled composer. Open the hub's composer instead (`hub_draft`, with the linked `account`, plus `to`, `subject` and `draft`) only when the user pointed at the account or recipient they are sending from or to: "email Dana from my live.com about Friday". Nothing is saved or sent — it waits in the composer for them.
- A reply or forward is drafted as one: pass `mode` (`reply`, `reply-all`, `forward`) with the `messageId` or `subject` of the message being answered. The composer fills in its recipients, its Re:/Fwd: subject, the quoted text and the threading headers itself, and your `draft` goes above the quote — do not retype the recipient or the subject, and do not paste the quote yourself. Only `mode: new` lets `subject` title the message you are writing.
- The whole composer can arrive filled: `to`, `cc`, `bcc` (comma-separated), `subject`, `attachments` as absolute paths, and `importance` `high` or `low` for the flag the recipient's client shows. Set what the user asked for and nothing else — an unrequested Bcc or urgency flag is a decision they did not make.
- That route needs the account linked in the hub. If it is not, the tool refuses and says so; put the draft in your reply rather than looking for another way in.
- If the user changes the draft, show the revised version before sending.

## Signatures

- The email tools apply no signature of their own.
- Before sending through them, add the appropriate signature to the body yourself.
- Prefer a signature extracted from a prior sent message of that same account.
- If exact signature formatting, logo images, or rich signature layout matters, prepare the message in Apple Mail, Outlook, or webmail instead.
- Read a signature off the account's own sent mail or its mail app when one is
  needed, and reuse it for that account for the rest of the task. This skill
  ships read-only, so never try to store one inside it; a signature worth
  keeping belongs in the user's memory or their own editable skill.

## Attachments

- `email_read` names what a message carries without transferring any of it, so
  a mailbox can be surveyed without pulling megabytes of PDFs across.
- Fetch the bytes with `email_attachments` only once a file actually has to be
  opened. It returns the paths it wrote.
- For PO PDFs or invoice PDFs, save them, then inspect with the PDF skill or bundled PDF tools.
- Do not upload or forward attachments without user approval.

## Reading A Mailbox

A message id is only meaningful together with the folder it was listed from, so
pass the same `account` and `folder` to `email_read` that `email_list` was given.
Re-list after a folder change rather than reusing ids across folders.

Keep a search bounded: `email_list` takes an IMAP query — `from alice@example.com`,
`subject "invoice"`, `since 1-Aug-2026` — which is answered by the server, so
prefer one narrow query over listing a folder and reading through it.

## Platform Fallbacks

- Use local app control only when needed.
- For university email, start from Apple Mail on macOS or Outlook/webmail on Windows rather than retrying an authentication the institution blocks.
- Draft in the selected mail surface when signature fidelity matters, then stop before send and ask for confirmation.
