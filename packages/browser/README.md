# @polymux/browser

Everything the agent can do to a page, written once against the Chrome
DevTools Protocol and nothing else.

Two surfaces drive it: the Polymux in-app Browser, where the main process
speaks CDP through Electron's `webContents.debugger`, and the user's own
browser, where the extension's service worker speaks it through
`chrome.debugger`. Both hand this package a transport and get the same command
set, so a capability added here appears on both at once and a page behaves the
same wherever the agent meets it.

This package is **plain JavaScript, not TypeScript** — deliberately. A browser
extension loads the files it is given, with no build step in front of them, and
adding one would mean the extension is no longer the directory you point Chrome
at. JSDoc annotations carry the types instead, and `tsc` checks them.

Nothing here touches Electron, `chrome.*`, or the network. The transport is
injected:

```js
const session = createSession({
  send: (method, params) => /* your CDP channel */,
  enableDomain,
  onEvent,
  moveCursor,   // optional: animate a cursor to a point before pointer input
});
await handlers.snapshot(session, { interactive: true });
```

## The cursor

`cursor-motion.js` and `cursor-overlay.js` are classic scripts, not modules:
the extension loads them as content scripts and the in-app Browser injects
their source into every document. They give the agent a visible pointer that
travels to a control and lands on it before it is used.

`moveTo(point)` resolves on arrival, or earlier if a newer move supersedes it.
Handlers wait for it only when the surface reports someone is watching, and
then only up to `CURSOR_WAIT_CAP_MS` — the cursor follows the work, it does not
pace it. Long moves land slightly short, settle, then make the small corrective
hop a hand makes.

While a field is being typed into the cursor retires to its bottom-right corner
(`restingPoint`), so it does not sit on top of the text as it appears. The
click itself still lands in the text: aiming a click at that corner is how you
hit a clear button or a password reveal.

A surface that supplies no `moveCursor` simply does not wait, and the command
runs exactly the same.

How long a glide takes is `DEFAULT_TRAVEL_SCALE` in `cursor-motion.js`, or a
`travelScale` passed to `createRenderer`. When timing it, remember that the
first move after a renderer is created teleports — warm it with one move and
time the second, or you will be measuring a teleport and concluding the knob
does nothing.
