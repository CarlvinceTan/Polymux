---
title: Hub
slug: hub
description: Bring supported messaging services and email accounts into one Polymux inbox.
section: Using Polymux
sectionOrder: 2
order: 2
published: true
---

# Hub

Hub brings supported messaging platforms and email accounts into the Polymux workspace. You can read a conversation, write a reply, and let the agent work with the selected thread without constantly changing apps.

## Connect an account

Open **Settings → Hub** and choose a messaging platform or email provider. The exact sign-in flow depends on the service: it may use OAuth, a QR code, a pairing code, an app password, or provider-specific credentials.

Some notable requirements:

- Telegram personal accounts require an API ID and API hash from Telegram.
- iMessage requires Full Disk Access on macOS so Polymux can read the local Messages database.
- iCloud Mail and Fastmail use app-specific passwords.
- Custom email uses the IMAP and SMTP server details supplied by your provider.

## Messages and email

The left rail lists connected services and conversations. Selecting one opens its history in the main Hub view. The composer follows the capabilities of that service, including attachments or reactions where supported.

Email accounts use the same Hub surface, with mail-specific fields and actions where needed.

## Incognito mode

Hub Incognito Mode is available under **Settings → General**. When supported by a connection, it lets Polymux read messages without marking them as seen or read.

## Local bridge model

Messaging connections run through bridges supervised by Polymux on your computer. Support varies by platform and service, and a provider can change its login requirements independently of Polymux.
