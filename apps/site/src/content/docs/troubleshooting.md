---
title: Troubleshooting
slug: troubleshooting
description: Resolve common setup, provider, device, Locker, browser, and permission problems.
section: Help
sectionOrder: 4
order: 2
published: true
---

# Troubleshooting

Start with the narrowest failing surface. A provider problem, disconnected Hub bridge, unavailable storage account, and denied macOS permission have different fixes even when they interrupt the same agent request.

## The agent cannot start

Open **Settings → Providers** and confirm the selected provider is connected. Then check **Settings → Models** for the model assigned to the current role.

Common causes include an expired API key, provider rate limit, account-region restriction, unavailable local runtime, or model that is no longer offered by the provider.

## A paired device is unavailable

Open **Devices** from the chat drawer and check whether the Host is online. Offline devices cannot run new Assistant work. Reconnect the device or choose another Host before starting a conversation.

## The Locker will not unlock

Confirm the Locker master password and try again. If Touch ID is enabled, you can use it instead. For an account-synced Locker, sign in and run **Sync now** before assuming an item is missing.

The master password is required to decrypt the Locker. If it is lost and Touch ID is unavailable, Polymux cannot recover the stored items.

## A Hub account is offline

Open **Settings → Hub**, select the connection, and read its current state. Reconnect the account if its token or linked-device session expired.

For Telegram, confirm the API ID and hash. For iMessage on macOS, confirm Full Disk Access. For email, confirm the provider’s app password and IMAP/SMTP requirements.

## Drive cannot reach a file

Check **Settings → Drive** for the provider state and active storage order. A network folder must be mounted. An S3-compatible provider needs the correct endpoint, region, credentials, and addressing mode.

## Browser control is unavailable

For the in-app browser, check site permissions and browsing settings. For an external browser, confirm the extension is installed, the desktop app is connected, and the intended tab was explicitly assigned to the task.

## A macOS permission was denied

Open **System Settings → Privacy & Security**, enable the relevant permission for Polymux, and restart the app. macOS may not repeat a system permission prompt after it has been denied once.

## Still stuck

Check the [GitHub issues](https://github.com/CarlvinceTan/Polymux/issues) for a matching report. When opening a new issue, include the Polymux version, operating system, the affected view or provider, and the exact error text. Remove keys, tokens, personal messages, and other private data first.
