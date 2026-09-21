# App Bundling Plan

Status: proposal. Goal: let workspace apps (Locker, Drive, Hub, …) ship as self-contained bundles that third parties can also author, instead of touching three layers per app.

## Current state

- `packages/*` (`locker`, `drive`, `hub`, …) are headless domain libraries: vault crypto, drive client, DTOs. No Electron, no IPC, no UI.
- Real backend lives in `apps/desktop/src/main/`: per-app service (e.g. `locker/service.ts`), plus IPC + lifecycle wiring in `backend.ts`.
- Frontend lives in `apps/desktop/src/renderer/lib/features/workspace/*View.svelte`, switched by `workspaceKind`.
- `OFFICIAL_WORKSPACE_APPS` in `backend.ts` is a hardcoded registry.
- `main/plugins/` already supports Claude-style plugins (skills, `.mcp.json`, static HTML `views/` via the file-preview boundary), but contributes no backend IPC, no first-class workspace entry, and no Svelte UI.

Adding an app today means editing the package, the main service + IPC, the renderer view, and the registry. That is what this plan removes.

## Proposed bundle shape

New top-level `workspace-apps/<id>/` (not `apps/`, which means deployables, nor `packages/`, which means shared libs). Each bundle owns its contract end to end:

```
workspace-apps/locker/
  polymux.app.json   # id, name, version, permissions, entries
  src/protocol.ts    # zod DTOs shared by main <-> renderer
  src/main.ts        # register(ctx) -> channels, lifecycle, lock/dispose
  src/view.svelte    # renderer entry, lazy-loaded
```

`polymux.app.json` declares at minimum: `id`, `name`, `description`, `workspaceKind`, `settingsKind`, `pinnable`, `permissions` (ipc namespace, storage scope, network, system surfaces), and entry points for main + view. Protocol stays zod-validated as today (`main/locker/requests.ts` is the model).

## Host changes (small, in `apps/desktop`)

1. Add an `AppHost` beside `backend.ts`: discover builtin + user-installed bundles, validate manifests + permissions, call `register(ctx)` per app.
2. Replace `OFFICIAL_WORKSPACE_APPS` with a merged registry: builtins (bundled at build time) + discovered third-party apps, exposed over the existing `workspaceApps` IPC (`list/install/setEnabled/setPinned/remove` in `@polymux/protocol`).
3. Give each app a namespaced context: `ipc.<id>.*` channels only, isolated storage scope, declared events only (e.g. `lockerChanged`), explicit dispose on disable/uninstall. Tier 3 backends run in a per-app child process speaking the same context over IPC — never in the main process. Power events (suspend -> `locker.lock()`) route through lifecycle hooks, not bespoke code per app.
4. Renderer loads builtin views as lazy Svelte imports; third-party views load through the existing file-preview/iframe boundary (including Tier 3 — full backend power does not imply renderer trust).

## Trust tiers

- Tier 1, builtin (Locker, Drive, …): full trust, Svelte view + Node service, bundled with the release.
- Tier 2, third-party default: untrusted — HTML view + capability-limited bridge (storage scope, fetch allowlist, agent tools, declared IPC events). No raw Node.
- Tier 3, third-party promoted: full Node backend power, granted explicitly per app. Runs in an isolated per-app backend process (not in the main process), with deny-by-default permissions, its own storage scope, and user-visible install/upgrade consent. No shared address space with Locker secrets or other apps' backends; all host access goes through the same namespaced `AppHost` context as Tier 2, just with a wider grant table (Node builtins, network, system surfaces as declared in `polymux.app.json`).

Promotion path: Tier 2 works by default; Tier 3 requires a permission review surface (declared permissions shown at install, re-consent on manifest widening) plus provenance (versioned bundle + signature/hash check) before the host spawns its backend process.

## Migration sequence

1. Pilot with Locker, no behavior change: move `main/locker/*` logic behind `workspace-apps/locker/src/main.ts`, move `LockerView.svelte` to the bundle's `src/view.svelte`, keep thin re-export shims at the old paths. Registry still lists locker, now sourced from the bundle manifest.
2. Prove install/disable/uninstall + lock-on-suspend through `AppHost`, including a sample Tier 2 app and a sample Tier 3 (isolated Node backend) app.
3. Migrate Drive, then Hub; leave Terminal/IDE/Mobile (deep system integration) for last.
4. Document the authoring contract (`polymux.app.json` reference + minimal sample app) once the pilot is stable.

## Decision: full Node for third parties

Yes — third-party apps can graduate to Tier 3 full Node backend power, via explicit per-app consent + isolated backend process as above. Tier 2 stays the default; Tier 3 is opt-in per install, never implicit.
