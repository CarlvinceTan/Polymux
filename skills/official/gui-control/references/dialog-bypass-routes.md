# Deterministic dialog-bypass routes

Read this reference before operating an Open or Save panel. Query
`runtime-route-observations.py` first. An exact success selects the route below;
a failure or changed identity blocks that route until its requested capability
is revalidated. Never infer support for another app or capability.

## Fixed selection order

1. Use an exact verified route listed here or in the observation cache.
2. Otherwise inspect only bundle files and metadata: `Contents/Resources/*.sdef`,
   `*.scriptSuite`, `*.scriptTerminology`, document/URL declarations in
   `Info.plist`, then documented CLI and the owning skill's API, in that order.
   Reading these files is the static phase.
3. Choose and test only the first route that directly accepts the already
   authorized file or destination. Do not try a sequence of speculative routes.
4. If none exists, use exact background accessibility for the panel. If the
   panel exposes no exact semantic controls, prepare a user handoff.

The `sdef` command is not part of static inspection: it may initialize or launch
the target while asking it for a dictionary. Do not call it merely to see what
happens. Use it only when bundle resources are absent, a runtime dictionary is
the single most likely route to the capability needed by the task, and the
normal launch-risk session gate has already passed with containment pre-armed.
Record whether it launched the app as part of that capability result.

Apple Event permission is part of the exact route and is sender-specific. Do
not run a separate generic permission probe whose process identity differs from
the action. Use the exact recorded route; if macOS reports missing or denied
Automation consent, prepare that one permission handoff, then retry the same
route and update its observation. Do not try alternative controllers merely
because permission was revoked.

## Verified on this Mac

### TextEdit 1.20 build 415, macOS build 25F84

- **Open without panel:** `/usr/bin/open -g -a
  /System/Applications/TextEdit.app FILE`. A monitored real file-open produced
  no activation or focus takeover. Capability:
  `open-file-without-panel`; route: `launchservices-open-g`.
- **Save without panel:** TextEdit's Standard Suite `save DOCUMENT in FILE`
  Apple Event. The first use may require Automation consent; after consent, a
  monitored real save wrote the exact file and produced no activation or focus
  takeover. Capability: `save-file-without-panel`; route:
  `apple-event-save`.

Both routes require the already-authorized exact file or destination and a
material result check. They do not authorize overwriting an unrelated file.

### Chess 3.18 build 3.18, macOS build 25F84

Chess has no bundled scripting-definition resource for a Save command; a prior
one-time `sdef` probe returned `-192` without yielding a dictionary, so do not
rerun it. Its unfinished-game
Save panel also exposed no exact background accessibility controls in the
observed separate Open-and-Save service. Capability
`save-game-without-panel` is unsupported: go directly to a prepared user
handoff rather than retrying CLI, Apple Events, or synthesized input.
