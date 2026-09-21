# Polymux Mobile

Tauri 2 + Svelte 5 companion for the Polymux Personal Host, with account sign-in,
QR/code linking, conversations, and an encrypted on-device Vault. Workspace
drawers and desktop configuration remain in Polymux Desktop.

## What is included

- Assistant history, new chats, and Team conversations from the same Host-owned
  history used by Desktop.
- Streaming answers and activity, mid-run steering, and run cancellation.
- Up to six attachments per message, each at most 12 MB, including microphone
  recordings attached as audio files.
- A small app-sandbox cache for reading recent conversations while disconnected.
  Sending and creating chats still require the Host.
- Light/dark appearance, reduced motion, safe areas, keyboard focus, and system
  font scaling. The configured minimums are iOS 15 and Android API 28.

The Host owns every durable conversation and run. The mobile app is a client;
it does not copy the agent runtime or expose Desktop workspace, browser, Drive,
Hub, Team management, or advanced settings.

## Install and check

Run these from the repository root. Mobile is intentionally not a root npm
workspace, so install its dependencies explicitly.

```sh
npm --prefix apps/mobile install
npm run mobile:check
npm run mobile:test
npm --prefix apps/mobile run build
```

`npm run mobile` opens an interactive target picker. Choose iOS or Android and
Tauri will prompt for the exact connected device or simulator. Direct native
commands remain available:

```sh
npm run mobile:ios
npm run mobile:android
```

Install the [official Tauri mobile prerequisites](https://v2.tauri.app/start/prerequisites/)
first. iOS development requires macOS and Xcode. Android requires Android
Studio plus its SDK, NDK, platform tools, and a Gradle-compatible JDK. Android
Studio's bundled JBR 21 is known to work with this project; if the shell selects
Java 25, point `JAVA_HOME` at that bundled JBR before running the Android
command.

The generated `src-tauri/gen/apple` and `src-tauri/gen/android` projects are
already present. The `ios:init` and `android:init` scripts are only for
regenerating a missing native project, not normal development.

## Pair with a Personal Host

1. Keep the Personal Host online. In Polymux Desktop, open the chat drawer's
   Team view and choose **Polymux Host** (the cloud button).
2. In Polymux Mobile, choose **Scan QR code** and scan the code under **Pair a
   Polymux device**. Camera access is requested only when you start scanning.
3. Polymux connects when it recognizes the code. If scanning is unavailable,
   enter the nine-digit Polymux Connect code manually, then choose
   **Connect**.

The QR code contains only the Host's `connect.polymux.com` endpoint and its short-lived pairing
code. It does not contain the bearer credential created after a successful
connection.

The Host connects outbound to Polymux Connect and the mobile app uses its HTTPS
address. No VPN app, VPN account, router change, or shared Wi-Fi network is
required. Loopback HTTP remains available for local simulators and tests; raw
LAN and public HTTP addresses are rejected by the client.

The Host keeps a separate credential for each paired device. On iOS, account
tokens and the pairing credential are stored in device-only Keychain items.
The encrypted vault and recent conversation cache stay in the app sandbox.

## App suspension and reconnection

Runs execute on the Personal Host, so they continue if the mobile locks, loses
network access, or the app is suspended. While suspended, the app does not run
background polling. An APNs-configured Host can send an opt-in, generic task
completion notification; conversation contents are not sent to Apple. When it
returns to the foreground it checks the Host, reloads messages, and reconnects
to an active run. If the run already finished, its stored result appears after
that refresh.

## Native builds

```sh
npm --prefix apps/mobile run ios:build
npm --prefix apps/mobile run android:build
```

Native build products are generated and git-ignored. Locally verified paths
include:

- iOS simulator: `src-tauri/gen/apple/build/arm64-sim/Polymux.app`
- Android debug: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
- Android release: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`

Device and distribution builds still require the normal Apple signing or
Android signing/release steps; the generated release APK above is unsigned.

## Account sign-in and automatic linking

The welcome screen supports email/password, account creation, password-reset
email requests, native Sign in with Apple, and Google through an iOS web
authentication session. The same-account device directory is scoped to the
signed-in user; only fresh Host entries with canonical Polymux Connect endpoints
are accepted. A single available Host connects automatically. Multiple Hosts
are shown for selection. QR/code linking remains available without an account.

For the hosted Supabase project, allow `polymux-mobile://auth/callback` in Auth
redirect URLs and include `com.flarehq.polymux.mobile` among Apple's accepted
client IDs. Keep existing desktop/web client IDs. `supabase/config.toml` includes
the mobile redirect for local configuration; editing that file does not update
the hosted project. Public settings confirm Apple, Google, and email are enabled,
but native Apple audience and the hosted mobile redirect still need verification.

## iOS Vault AutoFill

Vault already stores encrypted passwords, authenticator secrets and recovery
codes, and can unlock without a Host. Enable password and code AutoFill inside
the unlocked Vault, then enable Polymux in iOS Settings under AutoFill &
Passwords. This copies active password/TOTP entries into a shared device-only
Keychain item protected by the device passcode or biometrics. Password AutoFill
supports iOS 15+; system one-time-code AutoFill requires iOS 18+. This extension
does not provide passkey registration or authentication.

Local edits refresh the AutoFill copy. Foreground Vault sync detects remote
changes and refreshes it, or disables AutoFill if the vault cannot be unlocked.
Open and sync Vault after changes on another device: the extension does not
perform cloud sync. Disabling AutoFill or signing out clears the shared copy.
Locking the main vault leaves opted-in AutoFill available with device authentication.

## Apple identifiers and distribution setup

The Xcode project includes these entitlements; they still need matching Apple
Developer identifiers and provisioning profiles:

| Identifier | Capabilities |
| --- | --- |
| `com.flarehq.polymux.mobile` (Polymux) | Sign in with Apple, Push Notifications, AutoFill Credential Provider, App Groups |
| `com.flarehq.polymux.mobile.autofill` (Polymux AutoFill) | AutoFill Credential Provider, App Groups |
| `group.com.flarehq.polymux.mobile` | Shared group assigned to both identifiers |

Both targets also share Keychain group
`23YB4896XA.com.flarehq.polymux.mobile.vault`. Team is `23YB4896XA`.
The App ID portal's platform list is shared; the Xcode targets are iPhone/iPad.

Push requires a server-side Apple APNs signing key. Set `POLYMUX_APNS_KEY_PATH`,
`POLYMUX_APNS_KEY_ID`, and `POLYMUX_APNS_TEAM_ID` on the Host. Never package the
private key in the mobile app. Debug uses APNs sandbox; release uses production.
The mobile's notification control registers a token only after opt-in and refreshes
an enabled subscription when the conversation list mounts. Revoked peers cannot
register or receive new notifications. Host delivery requires the Host to be online.

Preserve `src-tauri/gen/apple/project.yml`: it owns the embedded extension and
capabilities. Regenerate with `xcodegen generate --spec
apps/mobile/src-tauri/gen/apple/project.yml` from the repo root, not `ios:init`.
An unsigned simulator archive can be verified without provisioning:

```sh
npm --prefix apps/mobile run ios:build -- --debug --target aarch64-sim --no-sign --ci --archive-only
swiftc apps/mobile/src-tauri/plugins/apple/ios/Sources/AutoFillStore.swift apps/mobile/src-tauri/apple/Tests/OneTimeCodeTests.swift -o /tmp/polymux-otp-tests
/tmp/polymux-otp-tests
```

The archive builds with the extension embedded. Device sign-in, cross-app
password/TOTP insertion, permission denial, and APNs delivery still require a
properly signed physical-device test before distribution. An unsigned build
does not establish those runtime guarantees.
