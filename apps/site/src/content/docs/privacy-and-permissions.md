---
title: Privacy and permissions
slug: privacy-and-permissions
description: See how local data, browser access, credentials, and operating-system permissions are handled.
section: Help
sectionOrder: 4
order: 1
published: true
---

# Privacy and permissions

Polymux is a local desktop application, but the services and models you connect may process data under their own terms. Review a provider before giving it access to sensitive work.

## Local data

Chats, run history, workspace state, memory, and connected-service configuration are stored locally by the desktop app. Cloud storage, messaging services, and hosted model providers receive only the information needed for the action you request through that service.

Read the full [privacy policy](/privacy-policy/) for the current product and browser-extension details.

## Credentials

Provider keys and connection credentials are stored through protected operating-system storage where supported. Avoid placing secrets directly in prompts, skill instructions, source files, or public repositories.

## Browser access

The external browser extension can maintain local tab metadata, but it receives page content and interaction access only for an explicitly assigned tab. The in-app browser keeps its own browsing state and permissions.

## Operating-system access

Features such as microphone input, notifications, app automation, local screen context, and iMessage rely on operating-system permissions. Enable only what you plan to use. Polymux remains functional with optional permissions disabled, though the related feature will be unavailable.

## Consequential actions

Giving a tool access does not automatically authorise every outcome. The agent may stop for confirmation before sending, publishing, paying, deleting, or completing another consequential external action.
