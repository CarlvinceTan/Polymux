# Polymux

Polymux connects your browser to the Polymux desktop app. It
gives Polymux a lightweight inventory of your open tabs and lets the agent
control only the exact tab assigned to it, without switching your active tab
or bringing a browser window to the foreground.

## What it does

- Shares open-tab metadata such as titles, URLs, and active or pinned state.
- Allows Polymux to read and interact with a specifically leased browser tab.
- Shows a visible badge and animated cursor while a tab is under agent control.
- Releases browser control when the task ends or Polymux disconnects.

## Privacy and control

The extension does not send browsing data to a hosted Polymux service. It
communicates with the Polymux desktop app through a local native-messaging host
and a loopback connection on your computer. Open-tab inventory does not include
page contents. Page content is accessed only when Polymux is asked to work in a
specific tab.

Polymux never raises the browser window or changes the tab you
are currently using. You remain in control and can stop access by ending the
task, closing Polymux, or disabling the extension.

The Polymux desktop app is required.

## Privacy practices

### Single purpose

Polymux connects browser tabs to the locally installed Polymux desktop app so
the app can list open tabs and read or control only a tab assigned to it.

### Permission justifications

#### `tabs`

The tabs permission is required to list open tabs and their titles, URLs,
window, active, pinned, audible, and last-accessed state; identify the exact tab
assigned to Polymux; create a new assigned tab; and close an assigned tab when
requested. It is not used to activate a tab or bring a browser window forward.

#### `nativeMessaging`

Native messaging is required so the Polymux extension can communicate with the
locally installed Polymux desktop app. It uses the `com.polymux.tab_context`
native host to make current tab metadata available to the desktop app. This
communication stays on the user's device. Without this permission, the desktop
app cannot maintain the open-tab inventory used to identify a requested tab.

#### `alarms`

The alarms permission runs a one-minute heartbeat that refreshes open-tab
metadata and reconnects to the local Polymux desktop app after Chrome suspends
the extension's service worker. It is not used for advertising, tracking, or
remote scheduling.

#### `debugger`

The debugger permission is required to read and interact with the exact browser
tab assigned to Polymux, including accessibility snapshots, screenshots,
trusted input, navigation, console and network inspection, dialogs, and file
inputs. It attaches only while a tab is assigned and detaches when access is
released, the tab closes, or the desktop app disconnects.

#### Host permission: `http://127.0.0.1:47654/*`

This host permission is required to exchange leases, commands, cursor status,
and results with the Polymux desktop app over a loopback-only HTTP service on
the user's computer. It does not grant access to a remote website or server.

#### Website access: `http://*/*` and `https://*/*`

Polymux may be assigned a tab on any ordinary website, so its content script
must be available on HTTP and HTTPS pages. The script displays the Polymux badge
and cursor and relays assigned-tab status. Page content is read or controlled
only after the user asks Polymux to work in a specific tab.

### Remote code

No. The extension does not download or execute remote code. All executable code
is included in the extension package.

### Data-use disclosures

- **Web history:** open-tab titles, URLs, and tab state are shared locally with
  the Polymux desktop app so it can identify the tab the user refers to.
- **Website content:** content from a specifically assigned tab may be read by
  the locally installed Polymux desktop app to complete the user's requested
  browser task.
- **User activity:** interactions performed within an assigned tab and their
  results are shared locally with the Polymux desktop app to execute and report
  the requested task.

The extension does not sell this data, use it for advertising or credit-related
purposes, or transfer it to a hosted Polymux service. Its use is limited to the
extension's disclosed single purpose.

## Screenshots

Upload only these approved `1280 × 800` captures from
`store-assets/listing-screenshots`, in this order:

1. `polymux-browser-expanded.png`
2. `polymux-chat.png`
3. `polymux-drive-expanded.png`
4. `polymux-hub-expanded.png`
