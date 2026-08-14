# Lark/Feishu Email via Himalaya

Lark (by ByteDance) supports standard IMAP/SMTP for email clients.  
Feishu (the Chinese version) uses the same server settings.

## Server Settings

| Setting      | Value                          |
|-------------|--------------------------------|
| IMAP host   | `imap.larksuite.com`           |
| IMAP port   | `993`                          |
| IMAP enc.   | `tls` (SSL)                    |
| SMTP host   | `smtp.larksuite.com`           |
| SMTP port   | `465`                          |
| SMTP enc.   | `tls` (SSL, **not** STARTTLS)  |
| Auth        | Full email + password           |

## Himalaya Config

```toml
[accounts.flarehq]
email = "you@flarehq.co"
display-name = "Your Name"
default = false

backend.type = "imap"
backend.host = "imap.larksuite.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "you@flarehq.co"
backend.auth.type = "password"
backend.auth.cmd = "security find-generic-password -a you@flarehq.co -s himalaya-lark -w"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.larksuite.com"
message.send.backend.port = 465
message.send.backend.encryption.type = "tls"
message.send.backend.login = "you@flarehq.co"
message.send.backend.auth.type = "password"
message.send.backend.auth.cmd = "security find-generic-password -a you@flarehq.co -s himalaya-lark -w"

folder.aliases.inbox = "INBOX"
folder.aliases.sent = "Sent"
folder.aliases.drafts = "Drafts"
folder.aliases.trash = "Trash"
```

> **Port 465 TLS, not 587 STARTTLS.** Lark's SMTP uses SSL on port 465, not the more common STARTTLS on port 587. In himalaya config this means `encryption.type = "tls"` on port 465 (not `"start-tls"` on 587).

## Getting Your Password

Obtain the mailbox credential through the current Lark administrator workflow
and store it in the system keyring. Never place the real value in this
reference or directly in the main configuration.

## Testing

```bash
himalaya envelope list -a flarehq --page 1 --page-size 5
```
