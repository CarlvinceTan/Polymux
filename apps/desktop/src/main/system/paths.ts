import { homedir } from "node:os";
import path from "node:path";

/**
 * Where Polymux's own configuration lives — skills, plugins, hooks, memories
 * and `mcp.json` — and why it is a function rather than a constant.
 *
 * The ordinary run owns `~/.polymux`. A side instance
 * (`npm run isolate`, or any `POLYMUX_DEV_INSTANCE`) must not: it exists
 * so an agent can start the app beside the session the user is sitting in
 * front of, and installing a plugin, saving a skill or rewriting `mcp.json`
 * from that side run would edit the user's real configuration under them.
 * `main.ts` already keys the userData directory — and with it the
 * single-instance lock — and the homeserver port off the instance name; this
 * is the third thing two runs would otherwise share, and the only one that
 * lives outside Electron's data directory.
 *
 * So a named instance gets `~/.polymux-<name>`, which starts empty in the same
 * way its userData directory does, and comes back on reuse of the same name.
 * Everything reads Polymux's home through here rather than joining
 * `".polymux"` itself, so there is one place the rule is written.
 */
export function polymuxDirectoryName(): string {
  const instance = process.env.POLYMUX_DEV_INSTANCE?.trim();
  return instance ? `.polymux-${instance}` : ".polymux";
}

/** `~/.polymux`, or `~/.polymux-<instance>` for a side run. */
export function polymuxHome(home = homedir()): string {
  return path.join(home, polymuxDirectoryName());
}

/** A path inside Polymux's home: `polymuxPath("skills")` -> `~/.polymux/skills`. */
export function polymuxPath(...segments: string[]): string {
  return path.join(polymuxHome(), ...segments);
}
