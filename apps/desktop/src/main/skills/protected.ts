import path from "node:path";
import type {
  AgentToolResult,
  ToolCallBlock,
  ToolHookDecision,
  ToolHooks,
} from "@flareai/core";

/**
 * Bundled skills — `resources/skills/core` and `resources/skills/official`
 * alike — ship with the app and are mirrored, app-owned, into
 * `~/.flareai/official-skills`. The Skills tab already refuses to edit them
 * (`editable` is true only for `~/.flareai/skills`), but the mirror is an
 * ordinary writable directory, so the agent's own file tools could still
 * rewrite a built-in skill's instructions. An update would silently revert the
 * edit at the next digest check, which makes the damage confusing rather than
 * harmless.
 *
 * This guard closes that path: it vetoes any mutating tool call aimed at the
 * mirror, before the call runs. Reads stay allowed — skills are meant to be
 * read, and their own scripts run from there.
 */

/** Tools that change files, mapped to the argument naming the target path. */
const PATH_ARGUMENTS: Record<string, string> = { write: "path", edit: "path" };

/**
 * The tilde spelling of a path under FlareAI's home, derived from the mirror
 * root rather than written out. A side instance keeps its configuration in
 * `~/.flareai-<name>` (see system/paths.ts), and both the message the agent is
 * shown and the shell command it might type have to name the directory that
 * run actually uses.
 */
function tilde(root: string, leaf = path.basename(root)): string {
  return `~/${path.basename(path.dirname(path.resolve(root)))}/${leaf}`;
}

function message(root: string): string {
  return (
    "Bundled skills are read-only. They are mirrored from the app bundle and " +
    "any edit here is reverted on update. To customise one, copy it into " +
    `${tilde(root, "skills")} and edit that copy.`
  );
}

export function isInsideProtectedSkills(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return (
    resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

/**
 * A shell command is opaque, so the guard cannot resolve its targets. It
 * blocks when the command mentions the mirror at all and is not plainly a
 * read: cheap to satisfy (read via the `read` tool, or work on a copy) and it
 * fails closed on the cases that matter.
 */
const READ_ONLY_COMMAND =
  /^\s*(?:cat|less|head|tail|ls|find|grep|rg|wc|file|stat|diff|md5|shasum|sha256sum)\b/;

export function blocksShellCommand(command: string, root: string): boolean {
  const mentions =
    command.includes(path.resolve(root)) ||
    command.includes(tilde(root)) ||
    command.includes(tilde(root).replace("~", "$HOME"));
  return mentions && !READ_ONLY_COMMAND.test(command);
}

export class ProtectedSkillGuard implements ToolHooks {
  readonly #root: string;
  constructor(root: string) {
    this.#root = root;
  }

  async beforeTool(call: ToolCallBlock): Promise<ToolHookDecision> {
    const argument = PATH_ARGUMENTS[call.name];
    if (argument) {
      const target = (call.arguments as Record<string, unknown>)[argument];
      if (
        typeof target === "string" &&
        isInsideProtectedSkills(target, this.#root)
      )
        return { allow: false, message: message(this.#root) };
    }
    if (call.name === "bash") {
      const command = (call.arguments as Record<string, unknown>).command;
      if (typeof command === "string" && blocksShellCommand(command, this.#root))
        return { allow: false, message: message(this.#root) };
    }
    return { allow: true };
  }
}

/**
 * Runs each set of hooks in order and stops at the first veto, so a built-in
 * guard and the user's own `hooks.json` rules both apply to every call.
 */
export function combineHooks(...hooks: ToolHooks[]): ToolHooks {
  return {
    async beforeTool(call: ToolCallBlock): Promise<ToolHookDecision> {
      for (const hook of hooks) {
        const decision = await hook.beforeTool?.(call);
        if (decision && !decision.allow) return decision;
      }
      return { allow: true };
    },
    async afterTool(call: ToolCallBlock, result: AgentToolResult): Promise<void> {
      for (const hook of hooks) await hook.afterTool?.(call, result);
    },
  };
}
