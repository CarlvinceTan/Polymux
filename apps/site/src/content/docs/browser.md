---
title: Browser
slug: browser
description: Use Polymux’s in-app browser or explicitly assign an external browser tab to a task.
section: Using Polymux
sectionOrder: 2
order: 4
published: true
---

# Browser

Browser keeps web research and actions inside the same workspace as the conversation. Polymux can use its built-in browser or work with an external tab that you explicitly assign.

## In-app browser

Open **Browser** from the workspace to create tabs, navigate, search, inspect downloads, and keep relevant pages beside the chat. The agent can use this browser when a task requires web access.

The in-app browser maintains its own browsing state. Manage passwords, downloads, site permissions, and browsing data under **Settings → Browser**.

## External browser tabs

The optional browser extension connects supported external tabs to the local Polymux app. Its passive inventory is limited to tab metadata such as title, URL, active state, and window relationship.

Page content and interaction become available only for the exact tab assigned to a task. Access ends when the task releases the tab, the tab closes, the app disconnects, or the extension is disabled.

## Downloads

Files downloaded through the in-app browser appear in its Downloads view. From there, you can open the file or reveal it using the operating system.

## When a site needs you

Sign-ins, CAPTCHAs, payment confirmation, and other sensitive checkpoints may require manual attention. Polymux pauses or hands the surface to you instead of assuming permission to complete an irreversible action.
