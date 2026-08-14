# Installed app compatibility

Use this inventory to distinguish proven coverage from work that still needs a
safe test. It covers 127 top-level `.app` bundles under `/Applications`,
`/System/Applications` (including Utilities), and the user's Applications
folder. Embedded helpers are excluded. Always recheck exact bundle identity and
version at runtime.

## Proven control coverage

- **Full tested action coverage:** Calculator, Chess, Dictionary, Weather, VLC.
- **Exact capture and accessibility inspection only:** the comprehensive
  2026-08-07 audit added or reconfirmed Acrobat Distiller, Activity Monitor,
  Adobe Acrobat, Adobe Lightroom Classic, Alacritty, Android Studio, Anki, App
  Store, Audio MIDI Setup, Automator, Blackmagic RAW Speed Test, Blackmagic
  Remote Monitor, Bluetooth File Exchange, Books, Calendar, Claude, Clock,
  ColorSync Utility, Console, Contacts, CP210xVCPDriver, DaVinci Control Panels
  Setup, Digital Color Meter, FaceTime, Fairlight Studio Utility, FindMy, Font
  Book, Freeform, Games, Grapher, Home, Image Capture, Image Playground, iMovie,
  iPhone Mirroring, Journal, Karabiner-Elements, Karabiner-EventViewer, Keynote,
  LarkSuite, Magnifier, Mail, Maps, Messages, Music, News, Notes, Notion,
  Numbers, Pages, Passwords, Phone, Photos, Podcasts, Reminders, Screen Sharing,
  Script Editor, Shortcuts, Spotify, Stickies, Stocks, System Settings,
  Telegram, Terminal, TextEdit, Tips, TV, VoiceMemos, wBlock, Xcode, and zoom.us.
  Previously verified exact tuples for WeChat, WhatsApp, and Windows App remain
  in the registry and are used only when their current identity still matches.
- **Exact capture only:** Blackmagic Proxy Generator, Blackmagic RAW Player,
  DaVinci Resolve, GarageBand, Tailscale, Visual Studio Code, VoiceOver Utility,
  the current WhatsApp tuple, and the observed current WeChat state were
  visual-read-only in the comprehensive audit. ChatGPT `26.730.61639` build
  `6234` also retains its separately verified exact-capture-only route.
- **Current route problem:** Zed `1.14.2` build `20260805.160132` failed exact
  capture with ScreenCaptureKit `-3811` and accessibility was not trusted on
  2026-08-07. Its observed editor state is unsupported for exact control.
- **No ordinary native window in the observed state:** Agent Surface, AirPort
  Utility, Cursor, Disk Utility, Flow, Ghostty, Photo Booth, Preview,
  QuickTime Player, Telegram Lite, and WireGuard. A running process without an
  ordinary window is not controller coverage.

Read-only coverage does not imply safe mutation. Use a backend or owning skill
first, and test a harmless reversible action before adding an action capability.
The comprehensive audit captured 132 exact windows across 85 apps: 76 apps had
at least one successfully mapped accessibility window and 9 were capture-only.
It performed no mutating action and therefore added no action capability.

## Launch coverage

- **Verified hidden launch:** 78 exact current app tuples. The original ten are
  Calculator, Calendar, Chess, Dictionary, Font Book, Image Capture,
  Reminders, Stickies, VLC, and Weather. The 68 additions are Acrobat
  Distiller, Activity Monitor, Adobe Acrobat, Adobe Lightroom Classic, Adobe
  Photoshop 2026, AirPort Utility, Android Studio, App Store, Audio
  MIDI Setup, Automator, Blackmagic RAW Player, Bluetooth File Exchange,
  Books, CP210xVCPDriver, Clock, ColorSync Utility, Console, Contacts, Digital
  Color Meter, Disk Utility, FaceTime, FindMy, Freeform, Games, GarageBand,
  Ghostty, Grapher, Home, Image Playground, Journal, Karabiner-Elements,
  Karabiner-EventViewer, Keynote, Keynote Creator Studio, Magnifier, Maps, News,
  Notes, Numbers, Pages, Phone, Photo Booth, Photos, Podcasts, Preview,
  QuickTime Player, Safari, Screen Sharing, Script Editor, Shortcuts, Stocks,
  System Settings, TV, Terminal, TextEdit, Tips, VoiceMemos, VoiceOver Utility,
  iMovie, wBlock, zoom.us, Mail, Messages, Music, Passwords, WhatsApp, Xcode,
  and iPhone Mirroring. Every addition passed 3/3 monitored trials.
- **Foregrounding launch; usable with monitored recovery:** Anki, Blackmagic Proxy Generator, Blackmagic RAW
  Speed Test, Blackmagic Remote Monitor, Cursor, DaVinci Control Panels Setup,
  DaVinci Resolve, Dia, Discord, Fairlight Studio Utility, Google Chrome,
  Helium, Opera Air, Spotify, Telegram, Telegram Lite, Visual Studio Code,
  Alacritty, LarkSuite, Notion, WeChat, and Zed.
  The watcher must immediately return the target behind the user's current app
  and verify it is nonfrontmost before any controller starts.
- **Tested launcher did not start the app:** Autodesk Fusion, Autodesk Fusion
  Service Utility, Hermes, Print Center. Treat these as unsupported, not safe.
- **Special UI, agent, or launcher needing route-specific treatment:**
  .Karabiner-VirtualHIDDevice-Manager, Agent Surface, Apps, Claude Code URL
  Handler, CuaDriver, Docker, Flow, Mission Control, Screenshot, Siri, System
  Information, Tailscale, Time Machine, Windows App, WireGuard.
- **Do not launch merely for compatibility testing:** Boot Camp Assistant,
  Migration Assistant, Remove Autodesk Fusion, Uninstall Resolve.

Aorus UDP is intentionally excluded from compiled coverage because it is a
temporary development app. It uses exact-build just-in-time observations
instead.

The 2026-08-07 refresh found the compiled launch identities for Adobe Photoshop
2026 `27.9.1`, Discord `0.0.406`, and Keynote Creator Studio `15.3.1` stale.
Their compiled launch routes remain blocked until each exact current tuple
passes three new cold-launch trials. An ordinary requested task may instead use
one scoped monitored launch and remember that result without attempting
compiled enrollment. Nine other launch attempts were invalidated by independent
foreground changes; their existing compiled route was neither upgraded nor
downgraded.

## Remaining cold-launch gaps

The original audit preserved 14 user-owned running apps. A later monitored
cold-launch audit classified 12 after the user quit them. Claude remains
unverified because it stayed open. Current ChatGPT `26.730.61639` build `6234`
and Zed `1.14.2` build `20260805.160132` also have no verified cold-launch
route: their 2026-08-07 compatibility trials stopped on ambiguous or failed
recovery evidence and did not reach the required three passing trials. Zed's
trial was invalidated by an independent foreground change before launch;
ChatGPT launched frontmost and failed to restore the exact prior app.
Existing-window evidence above remains valid only for the recorded read-only
capability.

Installed-app changes make the affected exact tuple stale, not the whole
inventory. Revalidate only the capability needed by the next task and refresh
broader compiled coverage only when deliberately maintaining it; never infer
compatibility from a similar product.
