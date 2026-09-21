---
title: Privacy and permissions
slug: privacy-and-permissions
description: See how local data, connected devices, browser access, credentials, and operating-system permissions are handled.
section: Help
sectionOrder: 4
order: 1
published: true
---

# Privacy and permissions

Polymux is a local desktop application, but the services and models you connect may process data under their own terms. Review a provider before giving it access to sensitive work.

## Local data

Chats, run history, workspace state, memory, connected-service configuration, and the encrypted Locker are stored locally by the desktop app. If Locker sync is enabled, the account receives only the encrypted vault and its sync metadata. Cloud storage, messaging services, and hosted model providers receive only the information needed for the action you request through that service.

Read the full [privacy policy](/privacy-policy/) for the current product and browser-extension details.

## Credentials

Provider keys and connection credentials are stored through protected operating-system storage where supported. The Locker keeps passwords, authenticator codes, recovery codes, and passkeys inside an encrypted vault. Its master password is not stored as plaintext, and account sync uploads only the encrypted vault. Keep the master password safe because Polymux cannot recover the vault contents without it.

Avoid placing secrets directly in prompts, skill instructions, source files, or public repositories.

## Connected devices

Pairing lets one Polymux Desktop send Assistant work to a Host on another computer. Each device has its own paired identity and connection. You can review online or offline Hosts and remove a remote device from the **Devices** panel.

## Browser access

The external browser extension can maintain local tab metadata, but it receives page content and interaction access only for an explicitly assigned tab. The in-app browser keeps its own browsing state and permissions. When the Locker is unlocked, it can supply saved passwords and passkeys for explicit fill or sign-in actions.

## Operating-system access

Features such as microphone input, notifications, app automation, local screen context, and iMessage rely on operating-system permissions. Enable only what you plan to use. Polymux remains functional with optional permissions disabled, though the related feature will be unavailable.

## Consequential actions

Giving a tool access does not automatically authorise every outcome. The agent may stop for confirmation before sending, publishing, paying, deleting, or completing another consequential external action.
