import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The interpreter behind `"${POLYMUX_NODE:-node}"` in the skill scripts.
 *
 * Skill scripts are plain `.mjs` files, so they need a Node the agent's shell
 * can name. Three launch modes, three answers:
 *
 *  - Packaged app: `resources/node/node`, the pinned runtime that
 *    `scripts/fetch-node.mjs` puts beside the skills. The packaged binary
 *    cannot stand in for Node itself — forge.config.ts burns the RunAsNode
 *    fuse off precisely so nothing can borrow the signed app as an arbitrary
 *    interpreter with Polymux's TCC grants.
 *  - Development checkout: the dev Electron binary still honours
 *    ELECTRON_RUN_AS_NODE (fuses are flipped at package time, not in the
 *    binary npm installs), so a tiny wrapper script in userData execs the
 *    running executable in Node mode. No download needed to hack on skills.
 *  - Neither (a packaged app whose runtime went missing): POLYMUX_NODE stays
 *    unset and the scripts' `:-node` fallback finds whatever the login shell
 *    has on PATH — the pre-port status quo, but never a silent GUI relaunch,
 *    which is what exec'ing a fuse-stripped binary in "Node mode" would do.
 *
 * Resolution is probing, not `app.isPackaged`: the dev bundle is renamed to
 * "Polymux" for the Dock (scripts/dev-app-name.mjs), which makes a dev run
 * look packaged to that check. Same reasoning as `bundledResource` in main.ts.
 */
export function resolveNodeRuntime(options: {
  bundledNode: string;
  checkoutMarker: string;
  execPath: string;
  wrapperDirectory: string;
}): string | undefined {
  if (existsSync(options.bundledNode)) return options.bundledNode;
  // A repo checkout is the only place the RunAsNode trick is known to work;
  // `checkoutMarker` is a file that exists on disk in a checkout and only
  // inside the asar when packaged, so `existsSync` separates the two.
  if (!existsSync(options.checkoutMarker)) return undefined;
  if (process.platform === "win32") return undefined;
  const wrapper = path.join(options.wrapperDirectory, "polymux-node");
  mkdirSync(options.wrapperDirectory, { recursive: true });
  writeFileSync(
    wrapper,
    `#!/bin/sh\n# Written by Polymux at launch: runs the dev Electron as Node.\nELECTRON_RUN_AS_NODE=1 exec "${options.execPath}" "$@"\n`,
  );
  chmodSync(wrapper, 0o755);
  return wrapper;
}

/**
 * Resolves the runtime and exports it as POLYMUX_NODE, which reaches the
 * agent's shell because the bash tool spawns with `{...process.env}`. Returns
 * the resolved path for logging; undefined means the PATH fallback is in play.
 */
export function exportNodeRuntime(options: {
  bundledNode: string;
  checkoutMarker: string;
  execPath: string;
  wrapperDirectory: string;
}): string | undefined {
  const runtime = resolveNodeRuntime(options);
  if (runtime) process.env.POLYMUX_NODE = runtime;
  return runtime;
}
