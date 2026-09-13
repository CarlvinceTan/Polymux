# macOS permission identity

`Control Skill.app` is an optional native permission owner shared by agents on
the same macOS account. It is separate from the browser and contains no extension.
Its display name is **Control Skill**, bundle ID is `local.control-skill.helper`,
and `LSUIElement` keeps it out of the Dock. It runs on demand; there is no login
item, network listener or always-running service.

The app is launched through Launch Services with background launch options.
Running a loose script or renaming a binary does not establish this identity:
macOS can attribute child processes to the terminal or agent that launched them.
The named app owns its bundled native collectors and its Apple Events requests.
All requests cross a private same-user file channel, with bounded payloads and
unique request IDs. No caller-selected executable or arbitrary script is accepted.

## Setup

```bash
python3 scripts/macos/helper.py install
python3 scripts/macos/helper.py status
```

Installation builds and signs `~/Applications/Control Skill.app` using the
existing Swift toolchain. With exactly one available Developer ID Application
identity, it reuses that identity. `--identity SIGNING_IDENTITY` selects an
existing identity explicitly. If none is unambiguous, local ad-hoc signing is
used and the result warns that updates may require consent again. A stable
publisher signature and bundle ID support permission continuity; this is not a
promise that macOS will never ask again. No signing keys are included in the skill.

Neither installation nor status asks for OS consent. Installation does not
replace an existing agent's permission route. When the task needs these
capabilities, request the relevant permission explicitly:

```bash
python3 scripts/macos/helper.py request-accessibility
python3 scripts/macos/helper.py request-automation --browser RUNNING_BROWSER_BUNDLE_ID
python3 scripts/macos/helper.py request-screen-capture
```

These commands may show macOS consent UI under the Control Skill app identity.
Ask for only the permission needed. Accessibility enables native window/control
inspection; Automation allows the named browser's native scripting interface;
screen capture is separate and is needed only for applicable capture/title access.
Control does not approve dialogs, change the privacy database, reset denied
consent, or request Full Disk Access as part of this setup.

After the human grants Accessibility, the agent can activate the named route:

```bash
python3 scripts/macos/helper.py enable
```

Activation requires a positive permission check and is stored once per OS user.
Native state, browser metadata and native window backends then run through the
named app. Missing permission or a stale helper build is reported; an enabled
helper does not silently switch to another agent's permissions. The outer window
entry point still enforces leases and action fences. Installing or granting a
permission never grants task authorization or a lease.

Without activation, existing script-based collection remains in place and never
requests consent itself. This permits a deliberate migration without interrupting
other agents or revoking their leases. Ambient `state` never installs or enables
the app or opens consent UI. Updates to bundled native code require another
explicit `install`; matching source and signed bundle are checked before dispatch.

## Tab context and coordination

No extension is required. CDP/BiDi are optional context/identity providers. Native
macOS scripting can return tab titles/URLs without either protocol on supported
browsers with consent. Compatible Chromium dictionaries also provide exact IDs
through Apple Events, with no debugging protocol. Safari's native metadata has
no equivalent ID and cannot acquire an individual tab lease. Titles, URLs, indexes, or a hash of
those fields cannot distinguish duplicate tabs or preserve identity across moves.

Individual tab coordination requires a provider's reliable live tab identity.
Current built-in exact tab adapters use Chromium Apple Events or CDP/BiDi; another driver can supply the
same identity contract. An exact native window/app can provide broader ownership
when its attention and action conditions are satisfied. Do not treat that as
independent ownership of individual tabs or activate the window to obtain access.

Apple documents [background app identity](https://developer.apple.com/documentation/bundleresources/information-property-list/lsuielement)
and [Apple Events usage descriptions](https://developer.apple.com/documentation/bundleresources/information-property-list/nsappleeventsusagedescription).
