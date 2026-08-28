---
title: Installation
slug: installation
description: Install Polymux on macOS, Windows, or Linux and understand the current platform support.
section: Getting started
sectionOrder: 1
order: 3
published: true
---

# Installation

Polymux is a desktop application for macOS, Windows, and Linux. Download releases from the website or GitHub.

## Download a release

Use the [download button](/#download) on the Polymux website. It selects the appropriate release for the current operating system when one is available. You can also browse every build on [GitHub Releases](https://github.com/CarlvinceTan/Polymux/releases/latest).

| Platform | Package | Current support |
| --- | --- | --- |
| macOS | Apple silicon application | Best-tested platform |
| Windows | x64 installer | Available; some integrations may differ |
| Linux | x64 AppImage | Available; some integrations may differ |

## macOS permissions

macOS may request access when you first use features such as notifications, dictation, app control, local screen context, or iMessage. Polymux explains why each permission is needed before the system prompt appears.

A denied permission can be changed in **System Settings → Privacy & Security**. Restart Polymux after enabling access if macOS does not apply it immediately.

## Updates

Open **Settings → General** to see the installed version and check for updates. Releases are also available directly from GitHub.

## Build from source

Developers can build Polymux from its [public repository](https://github.com/CarlvinceTan/Polymux). The repository README and `docs/DEVELOPMENT.md` contain the current setup, test, and packaging commands.
