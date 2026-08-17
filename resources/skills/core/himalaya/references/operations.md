# Himalaya Operations

Use this reference after `email` has selected a configured Himalaya account.

## Inspect accounts and folders

```bash
himalaya --version
himalaya account list
himalaya folder list
```

Use structured output where supported:

```bash
himalaya envelope list --output json
```

The account flag belongs on the subcommand:

```bash
himalaya envelope list -a work
```

## List, search, and read

```bash
himalaya envelope list
himalaya envelope list --folder "Sent"
himalaya envelope list --page 1 --page-size 20
himalaya envelope list from john@example.com subject meeting
himalaya message read 42
himalaya message export 42 --full
```

Message IDs are folder-relative. Re-list after changing folders or after mailbox mutations.

## Draft, reply, forward, and send

Follow `email` for all drafting and sending decisions. Save a draft by default;
do not execute `template send` until `email` determines that the user's current
instruction explicitly authorizes sending the finished message.

Prefer a generated template or stdin over an interactive editor:

```bash
himalaya template reply 42
himalaya template forward 42
himalaya template save -a work --folder Drafts
```

For rich mail and attachments, read [message-composition.md](message-composition.md) and use MML.

An ambiguous or non-zero send is not permission to retry. SMTP delivery may have succeeded before save-to-Sent failed. Check the correct Sent folder and other delivery evidence first.

## Attachments

```bash
himalaya attachment download 42
himalaya attachment download 42 --dir ~/Downloads
```

Verify downloaded files before opening or forwarding them.

## Copy, move, delete, and flags

First verify the exact account, folder, current message ID, and destination.
Follow `email` for authorization before deletion or consequential mailbox
reorganization.

```bash
himalaya message copy 42 "Important"
himalaya message move 42 "Archive"
himalaya message delete 42
himalaya flag add 42 --flag seen
himalaya flag remove 42 --flag seen
```

Do not infer a successful mutation from process exit alone; re-list the relevant folder.

## Connection checks

After setup, use a small bounded read:

```bash
himalaya envelope list --page 1 --page-size 3
himalaya envelope list -a work --page 1 --page-size 3
```

For diagnosis:

```bash
RUST_LOG=debug himalaya envelope list
RUST_LOG=trace RUST_BACKTRACE=1 himalaya envelope list
```

Avoid exposing logs that may contain message content, account identifiers, or credentials.
