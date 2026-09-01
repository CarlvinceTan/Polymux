# Phone

Phone gives the user and the active Polymux agent one shared, controllable
phone screen. The desktop app owns discovery, capture, input, and recovery;
the mobile device remains the authority for unlock, trust, and developer-mode
consent.

## Production routes

| Phone | Desktop | Primary route | One-time user setup | Important limit |
| --- | --- | --- | --- | --- |
| Android | macOS, Windows, Linux | Bundled ADB; scrcpy runtime is available for streaming | Enable USB debugging, approve the computer, then optionally pair Wireless debugging | Android may revoke a wireless pairing or change its port |
| iPhone | macOS | Apple `remoted` tunnel + locally signed WDA; iPhone Mirroring as an external fallback | Enable Developer Mode, trust the Mac, and sign WDA locally | iOS may require the passcode again before allowing XCTest; iPhone Mirroring has no public embedding API |
| iPhone | Windows | Normal-user userspace tunnel + locally signed WDA | Install Apple Devices once, enable Developer Mode, trust the PC, and sign WDA locally | The phone must remain unlocked and reachable |
| iPhone | Linux | Normal-user userspace tunnel + locally signed WDA | Install `usbmuxd` once, enable Developer Mode, trust the computer, and sign WDA locally | Linux device permissions and the phone's lock state remain host constraints |

This order is intentional:

1. Android uses ADB everywhere. It is the most complete, scalable route and
   has an official wireless-pairing workflow.
2. An iPhone on macOS uses WDA when the agent must understand and manipulate
   UI elements. Once iOS has authorised XCTest, WDA may continue operating
   while the physical phone remains passcode-locked. Apple iPhone Mirroring is
   the supported fallback when iOS refuses that state, but Polymux should open
   it as an external Apple surface rather than pretend it can embed it.
3. An iPhone on Windows or Linux uses WDA. There is no general-purpose iOS
   companion app that can escape the iOS sandbox and control other apps.
4. USB remains the recovery route for every platform.

## Guided iPhone setup

The intended non-developer flow is:

1. Connect and unlock the iPhone with USB.
2. Approve **Trust This Computer** and enable Developer Mode. iOS requires the
   restart and confirmation; Polymux cannot approve either step for the user.
3. Sign in to an Apple Account inside Phone and enter the trusted-device
   verification code. The password travels only over stdin to a private local
   helper and is never stored.
4. Polymux creates a device-scoped development certificate and provisioning
   profile, signs its bundled WDA, installs it, prepares a private wireless
   pairing record over the already trusted cable, and starts the XCTest session.
5. The first time that development identity is used, iOS may require the user
   to trust the developer profile in **Settings > General > VPN & Device
   Management**.
6. Keep USB connected while establishing the wireless route. Only unplug once
   Phone reports **Wireless** and a live frame has been captured through that
   route.

A free Apple development profile normally expires after seven days. Polymux
re-signs on the next connection after expiry; a production refresh scheduler
may refresh shortly before expiry, but it must never imply that a disconnected
or locked iPhone can be repaired silently.

## Wireless reliability

Wireless WDA is IP networking, not Bluetooth. The computer and iPhone must be
able to reach one another, and the original pairing record must remain valid.

- Home and private LANs are suitable when client-to-client traffic is allowed.
- Guest, campus, and hotel networks often isolate peers. Discovery may work
  intermittently while the WDA tunnel itself remains unreachable.
- Personal Hotspot is an explicit rescue option, not a Phone dependency or
  normal onboarding step. It is also useful for diagnosing whether the current
  LAN, rather than WDA, is blocking the connection.
- A Windows or Linux laptop hotspot can also provide the local network, but
  driver and Internet-sharing behavior varies by machine. It is a fallback,
  not the default onboarding promise.
- macOS generally cannot receive campus Wi-Fi and re-share that same Wi-Fi
  radio as a conventional hotspot. Use the iPhone hotspot or another private
  access point instead.

Phone prefers a wireless route when the same physical device appears through
both USB and Wi-Fi. It pins control to that physical device until **Stop** so a
second arriving phone cannot receive taps or text accidentally.

## Lock-state boundary

WDA is an XCTest process and cannot bypass the passcode. However, physical lock
and an already-authorised XCTest session are not always the same state. In a
live iPhone 16 Pro / iOS 26.6 test, the packaged userspace route cold-started
over Wi-Fi, captured the screen and accessibility tree, and launched an app
while CoreDevice continued to report `passcodeRequired: true`. The cable was
absent throughout.

That is a useful best-effort capability, not a security guarantee. iOS may show
**Enter Passcode to Use XCTest** after a reboot, trust change, developer-profile
change, or another security transition. Polymux should keep one healthy XCTest
runner alive to avoid unnecessary re-authorisations, recover its transport
without reinstalling WDA, and ask the user only when iOS itself requires the
passcode. It must never claim it can enter or bypass that passcode.

Apple iPhone Mirroring is different: Apple designed it to operate while the
physical phone remains locked. It is therefore the best macOS route for a phone
left in a pocket, but Apple exposes neither a public embedding SDK nor a
cross-platform protocol. Automating its window would also add Screen Recording
and Accessibility permissions and would remain a macOS-only compatibility
layer.

## What ships

Polymux packages the target-native runtimes users should not have to install:

- ADB, scrcpy, and the matching scrcpy server for Android.
- go-ios for iPhone discovery, installation, and recovery operations.
- A separate pinned pymobiledevice3 companion for the primary no-root iPhone
  tunnel, XCTest launch, and loopback-only WDA relay. The corresponding GPL
  and LGPL source archives, licenses, and a hash manifest ship beside it. Its
  dedicated Python 3.13 runtime supplies the supported TCP-PSK API needed by
  unplugged wireless tunnels.
- An unsigned WDA build, standalone Python, the minimal iPASide provisioning
  subset, and a static zsign binary for local Apple signing.

On macOS the signer asks Apple's built-in AOSKit and AuthKit frameworks for the
device headers used by Apple sign-in, so it needs no emulation or extra download.
On Windows and Linux it downloads the exact target-native Unicorn wheel from
PyPI on first Apple-signing use, verifies its pinned SHA-256 digest, and stores
it only in the private signer state. Apple Account traffic goes directly from
the user's computer to Apple. See `THIRD_PARTY_NOTICES.md` before changing this
boundary.

The two unavoidable host prerequisites are detected and named in Phone:

- Windows: Apple's **Apple Devices** app supplies Apple Mobile Device Support.
- Linux: the distribution's `usbmuxd` service and udev rules supply privileged
  USB discovery.

The first iPhone setup is wired because Apple requires trust, pairing, and WDA
installation. After that, Phone restarts the tunnel over the local network when
the cable disappears. The network must permit peer discovery and direct device
traffic. School, hotel, and guest networks commonly isolate clients; disabling
`usbmuxd` is not a sufficient wireless test because Apple's RemotePairing
service can still travel over a USB-created network interface. Release testing
therefore requires removing the cable and checking the actual underlay reported
by the helper. If that test fails, Phone should keep USB control available and
offer another private LAN or hotspot as optional choices; it should not require
the user to connect either device to the other's hotspot.

When the LAN is isolated, the practical fallback is a private local network:
Windows Mobile Hotspot can share Wi-Fi, Ethernet, or cellular over Wi-Fi;
Linux can use a NetworkManager/hostapd hotspot when the adapter supports AP
mode; macOS Internet Sharing normally needs a different upstream interface
(for example Ethernet to Wi-Fi). Connecting the computer to the iPhone's
Personal Hotspot is often the easiest temporary diagnostic, but it consumes
phone data and Apple may disconnect an idle hotspot to save battery.

## Rejected primary routes

- Appium still uses WDA for real iOS UI automation, so it does not remove the
  signing, developer-mode, or lock-state requirements.
- QuickTime-style capture provides pixels but not a supported cross-platform
  input and accessibility-semantic channel.
- Safari Remote Automation covers inspectable web content, not arbitrary native
  apps.
- A Polymux iOS companion app cannot control other apps or bypass the lock
  screen under normal App Store sandboxing.
- Bluetooth is not a general replacement for Apple's paired USB/network device
  services.

## Primary references

- [Android wireless debugging](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi)
- [scrcpy](https://github.com/Genymobile/scrcpy)
- [WebDriverAgent](https://github.com/appium/WebDriverAgent)
- [go-ios](https://github.com/danielpaulus/go-ios)
- [pymobiledevice3](https://github.com/doronz88/pymobiledevice3)
- [iPASide](https://github.com/pwnapplehat/iPASide)
- [Apple: Trust This Computer](https://support.apple.com/109054)
- [Apple Devices for Windows](https://support.apple.com/guide/devices-windows/welcome/windows)
- [libimobiledevice usbmuxd](https://github.com/libimobiledevice/usbmuxd)
- [Apple iPhone Mirroring](https://support.apple.com/120421)
