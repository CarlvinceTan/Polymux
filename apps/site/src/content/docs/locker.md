---
title: Locker
slug: locker
description: Store passwords, authenticator codes, recovery codes, and passkeys in an encrypted vault.
section: Using Polymux
sectionOrder: 2
order: 3
published: true
---

# Locker

The encrypted Locker is shown as **Vault** in the Polymux workspace. It keeps account credentials together across your own devices without sending readable secrets to a hosted service.

## Create and unlock the Locker

Open **Vault** from the workspace. On first use, choose a master password and create the encrypted vault. Lock it from the Vault menu when you step away; it also locks after five minutes without activity.

On macOS, you can enable Touch ID from Vault settings. The master password is required to decrypt the contents, so keep it somewhere safe.

## Store an account

Use the add menu to create one of these item types:

- **Password** stores a username, password, site address, notes, and an optional group.
- **Authenticator** stores a time-based one-time password secret and shows the current code.
- **Recovery codes** keeps a set of one-time account recovery codes.
- **Passkey** stores the site, user, credential identifier, and private key used by supported sign-in flows.

Items are grouped by site when possible. You can search, copy individual fields, hide or reveal a password, move an item to Deleted, and restore it later.

## Use credentials in the browser

Unlock the Locker to use saved passwords and passkeys in the in-app browser or through the browser extension when a site asks for sign-in. The browser requests the matching item; the agent does not receive every secret in the Locker.

## Sync across devices

Locker sync defaults to **Account**. In that mode, signed-in devices exchange the encrypted vault and metadata, so changes made on one device can appear on another. Polymux does not upload the master password or readable item contents.

Turn off **Sync to account** in Vault settings to keep the encrypted vault only on the current device. When both an account copy and a local copy exist, Polymux asks which copy to keep before changing storage.

## Import existing credentials

Use **More → Import** to bring in a KeePass `.kdbx` file or a supported CSV export. A KeePass file requires its own password. Imported entries are copied into the open Locker and then follow the same encryption and sync settings.
