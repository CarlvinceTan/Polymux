# Himalaya Configuration

Use this reference only when a configured account fails or the user asks to
add an account. Prefer repairing an established account over recreating it.
Check current provider requirements against official documentation before
changing authentication because OAuth and app-password policies change.

## Safe workflow

1. Run `himalaya --version` and `himalaya account list --output json`.
2. Inspect only the selected account's non-secret configuration.
3. Preserve working server, folder-alias, signature, and identity settings.
4. Keep passwords, app passwords, refresh tokens, and client secrets in the
   system keyring or a restricted credential command. Never place a real secret
   directly in this skill, command output, or a checked-in configuration.
5. After a change, run a bounded folder list and three-message envelope list.
   Do not test SMTP by sending mail.

The usual configuration file is `~/.config/himalaya/config.toml`. Himalaya
v1.2 can also merge multiple paths supplied through `HIMALAYA_CONFIG`, which is
useful for separating public settings from private credential configuration.

## Minimal account shape

```toml
[accounts.example]
email = "user@example.com"
display-name = "Your Name"
default = false

backend.type = "imap"
backend.host = "imap.example.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "user@example.com"
backend.auth.type = "password"
backend.auth.cmd = "security find-generic-password -a user@example.com -s himalaya-imap -w"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.example.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "user@example.com"
message.send.backend.auth.type = "password"
message.send.backend.auth.cmd = "security find-generic-password -a user@example.com -s himalaya-smtp -w"
```

Use `himalaya account configure <account>` when the installed keyring feature
supports the provider. Do not print a credential command's output while
diagnosing it.

## Folder aliases

Message IDs and canonical folder operations depend on correct aliases. For
v1.2 use the plural `folder.aliases` form:

```toml
folder.aliases.inbox = "INBOX"
folder.aliases.sent = "Sent"
folder.aliases.drafts = "Drafts"
folder.aliases.trash = "Trash"
```

Gmail normally uses:

```toml
folder.aliases.sent = "[Gmail]/Sent Mail"
folder.aliases.drafts = "[Gmail]/Drafts"
folder.aliases.trash = "[Gmail]/Trash"
```

An incorrect Sent alias can make SMTP delivery succeed while saving the Sent
copy fails. Treat that non-zero result as ambiguous and verify Sent/delivery
before considering any retry.

## Provider routing

- **Gmail and Google Workspace:** prefer an existing working App Password or
  OAuth configuration. If authentication policy changed, consult current
  official Google documentation and use a user-authorized OAuth client; do not
  improvise around an administrator restriction.
- **iCloud:** use an Apple app-specific password stored through a credential
  command or keyring.
- **Microsoft personal and work/school:** prefer the already working route.
  Basic-auth, OAuth-client, tenant, and Conditional Access behavior differ and
  change over time. Verify the account type and current Microsoft guidance
  before rebuilding it. Do not reuse third-party public OAuth client IDs.
- **University accounts:** if the established Email route uses Apple Mail,
  retain that fallback instead of forcing Himalaya through an unsupported
  gateway.
- **Lark/Feishu:** read [lark-email.md](lark-email.md).

DavMail, custom token-refresh scripts, and direct Graph/Gmail API clients are
separate integrations, not default Himalaya configuration. Introduce one only
after the user requests setup and current official evidence shows it is the
appropriate route.

## Verification and diagnosis

```bash
himalaya folder list -a ACCOUNT
himalaya envelope list -a ACCOUNT --page 1 --page-size 3 --output json
```

For deeper diagnosis, prefer `--debug` over trace and redact account details,
message content, tokens, and credentials. Never conclude a password is wrong
solely from a provider authentication failure; policy, OAuth scope, tenant
restrictions, or a disabled protocol can produce the same symptom.
