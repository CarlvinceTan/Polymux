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

## Screenshots

Upload only these approved `1280 × 800` captures from
`store-assets/listing-screenshots`, in this order:

1. `polymux-browser-expanded.png`
2. `polymux-chat.png`
3. `polymux-drive-expanded.png`
4. `polymux-hub-expanded.png`
