# Safari wrapper

Safari will not load a Chrome unpacked zip. It needs an Apple-signed Web Extension wrapper around the shared scripts in `apps/extension` (`locker/` for autofill/passkeys/popup, `agent/` for browser control, plus `background.js`).

This folder is that wrapper. Development signing uses team `23YB4896XA`
(FlareHQ) and Automatic style in the Xcode projects. App Store / TestFlight
upload still needs an Apple Distribution identity with a private key, App Store
Connect records for `com.polymux.extension` / `com.polymux.extension.Extension`,
and an ASC API key — none of those are in this repo or local `.env`. Developer
ID Application can notarize a direct macOS build; that is not App Store signing.
Do not treat a development-signed archive as notarized or store-ready.

## macOS

Requires Xcode. From this directory:

```bash
./convert.sh
```

That runs `xcrun safari-web-extension-converter` against the shared extension and writes an Xcode project here. `convert.sh` copies `Polymux.entitlements` (App Sandbox + outgoing network) onto the targets for account sync and the cached-vault path. Then:

1. Open the generated project in Xcode.
2. Team `23YB4896XA` (FlareHQ) is already set for Automatic signing. Bundle IDs are
   `com.polymux.extension` (app) and `com.polymux.extension.Extension`.
3. Enable the Safari Web Extension capability.
4. Run the macOS app once, then enable **Polymux** in Safari → Settings → Extensions.

A development-signed archive/export was produced locally with
`Apple Development: Carlvince Tan` / team `23YB4896XA`. That is not App Store
signing and is not notarized. App Store export fails without Mac App
Distribution, Mac Installer Distribution, and a provisioning profile for
`com.polymux.extension`.

Safari currently uses only the cached/account vault. Sign in from the popup to
pull the account vault, then unlock the cached ciphertext in that trusted popup.
The popup displays this availability limit. Opening desktop Polymux does not
connect its Locker to this wrapper.

Desktop Locker now requires a private native capability. The checked-in
converter generates Apple's standard wrapper; there is no custom native-message
handler or entitlement granting it access to Polymux's private capability file.
The macOS wrapper is sandboxed without a shared application group, while the iOS
application group is not shared with desktop Polymux. HTTP cannot enroll a
client or retrieve that capability. A future desktop connection needs an
explicitly approved native transport; broad filesystem access or an
unauthenticated loopback fallback is not supported.

## iOS / iPadOS

```bash
./convert-ios.sh
```

Safari Web Extensions on iPhone need an iOS app target with the extension embedded — not the Tauri phone app, and not this Chrome zip. The shared JS is the fill protocol. After conversion:

1. Open the project under `ios/`. `convert-ios.sh` copies `iOS.entitlements` (App Group `group.com.polymux.extension`) onto the targets.
2. Set Team `23YB4896XA` if Xcode cleared it. Bundle IDs match macOS:
   `com.polymux.extension` and `com.polymux.extension.Extension`.
3. Archive and upload through Xcode. This machine has no Xcode Apple ID account
   and no iOS development profiles, so iOS archive cannot finish here.

The phone **app** Locker (on-device KeePass vault, Host sync when paired) is the
supported way to manage passwords on iOS until that wrapper is store-signed.
The phone app is not a site browser, so it cannot intercept `navigator.credentials`
on Safari or Chrome. iOS passkey fill uses this Safari Web Extension after it is
installed.

## What this is not

- Not a Chrome unpacked folder loaded in Safari.
- Not OS / iCloud Keychain passkey filling (Apple's browser entitlement).
- Not a finished App Store package. Development team `23YB4896XA` is set so
  Xcode Automatic signing can run; App Store export is blocked until an Apple
  Distribution certificate with a private key exists.
