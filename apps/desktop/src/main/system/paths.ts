import { homedir } from "node:os";
import path from "node:path";

/**
 * Where FlareAI's own configuration lives — skills, plugins, hooks, memories
 * and `mcp.json` — and why it is a function rather than a constant.
 *
 * The ordinary run owns `~/.flareai`. A side instance
 * (`npm run isolate`, or any `FLAREAI_DEV_INSTANCE`) must not: it exists
 * so an agent can start the app beside the session the user is sitting in
 * front of, and installing a plugin, saving a skill or rewriting `mcp.json`
 * from that side run would edit the user's real configuration under them.
 * `main.ts` already keys the userData directory — and with it the
 * single-instance lock — and the homeserver port off the instance name; this
 * is the third thing two runs would otherwise share, and the only one that
 * lives outside Electron's data directory.
 *
 * So a named instance gets `~/.flareai-<name>`, which starts empty in the same
 * way its userData directory does, and comes back on reuse of the same name.
 * Everything reads FlareAI's home through here rather than joining
 * `".flareai"` itself, so there is one place the rule is written.
 */
export function flareaiDirectoryName(): string {
  const instance = process.env.FLAREAI_DEV_INSTANCE?.trim();
  return instance ? `.flareai-${instance}` : ".flareai";
}

/** `~/.flareai`, or `~/.flareai-<instance>` for a side run. */
export function flareaiHome(home = homedir()): string {
  return path.join(home, flareaiDirectoryName());
}

/** A path inside FlareAI's home: `flareaiPath("skills")` -> `~/.flareai/skills`. */
export function flareaiPath(...segments: string[]): string {
  return path.join(flareaiHome(), ...segments);
}
