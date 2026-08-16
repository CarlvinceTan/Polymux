import { strict as assert } from "node:assert";
import { test } from "node:test";
import path from "node:path";
import type { ToolHooks } from "@flareai/core";
import {
  ProtectedSkillGuard,
  blocksShellCommand,
  combineHooks,
  isInsideProtectedSkills,
} from "../protected-skills.js";

const ROOT = "/home/u/.flareai/official-skills";
const call = (name: string, args: Record<string, unknown>) =>
  ({ id: "1", name, arguments: args }) as never;

test("recognises paths inside the protected mirror", () => {
  assert.equal(isInsideProtectedSkills(`${ROOT}/gui-control/SKILL.md`, ROOT), true);
  assert.equal(isInsideProtectedSkills(ROOT, ROOT), true);
  assert.equal(isInsideProtectedSkills(`${ROOT}/../skills/mine/SKILL.md`, ROOT), false);
  // A sibling that merely shares the prefix is not inside it.
  assert.equal(isInsideProtectedSkills(`${ROOT}-backup/SKILL.md`, ROOT), false);
  assert.equal(isInsideProtectedSkills("/home/u/.flareai/skills/mine/SKILL.md", ROOT), false);
});

test("blocks writes and edits aimed at a built-in skill", async () => {
  const guard = new ProtectedSkillGuard(ROOT);
  for (const tool of ["write", "edit"]) {
    const decision = await guard.beforeTool(
      call(tool, { path: `${ROOT}/gui-control/SKILL.md` }),
    );
    assert.equal(decision.allow, false);
    assert.match(decision.message ?? "", /read-only/);
  }
});

test("allows writes to the user's own skills", async () => {
  const guard = new ProtectedSkillGuard(ROOT);
  const decision = await guard.beforeTool(
    call("write", { path: "/home/u/.flareai/skills/mine/SKILL.md" }),
  );
  assert.equal(decision.allow, true);
});

test("allows reading a built-in skill", async () => {
  const guard = new ProtectedSkillGuard(ROOT);
  const decision = await guard.beforeTool(
    call("read", { path: `${ROOT}/gui-control/SKILL.md` }),
  );
  assert.equal(decision.allow, true);
});

test("blocks mutating shell commands that touch the mirror", () => {
  assert.equal(blocksShellCommand(`rm -rf ${ROOT}/gui-control`, ROOT), true);
  assert.equal(blocksShellCommand(`echo x > ${ROOT}/a/SKILL.md`, ROOT), true);
  assert.equal(blocksShellCommand("rm -rf ~/.flareai/official-skills/a", ROOT), true);
  // Reads stay allowed: the skills' own scripts and references live there.
  assert.equal(blocksShellCommand(`cat ${ROOT}/gui-control/SKILL.md`, ROOT), false);
  assert.equal(blocksShellCommand("rm -rf /home/u/.flareai/skills/mine", ROOT), false);
});

test("shell guard reaches the bash tool", async () => {
  const guard = new ProtectedSkillGuard(ROOT);
  const decision = await guard.beforeTool(
    call("bash", { command: `rm -rf ${ROOT}/gui-control` }),
  );
  assert.equal(decision.allow, false);
});

test("combineHooks stops at the first veto and runs afterTool on all", async () => {
  const seen: string[] = [];
  const allowing: ToolHooks = {
    beforeTool: async () => {
      seen.push("before:allow");
      return { allow: true };
    },
    afterTool: async (): Promise<void> => {
      seen.push("after:allow");
    },
  };
  const denying: ToolHooks = {
    beforeTool: async () => {
      seen.push("before:deny");
      return { allow: false, message: "no" };
    },
  };
  const combined = combineHooks(denying, allowing);
  const decision = await combined.beforeTool?.(call("write", { path: "/x" }));
  assert.equal(decision?.allow, false);
  // The allowing hook never ran: the veto short-circuits.
  assert.deepEqual(seen, ["before:deny"]);
  await combined.afterTool?.(call("write", { path: "/x" }), { content: "" });
  assert.deepEqual(seen, ["before:deny", "after:allow"]);
});

test("guard uses the real mirror location shape", () => {
  const home = path.join("/home", "u");
  const root = path.join(home, ".flareai", "official-skills");
  assert.equal(isInsideProtectedSkills(path.join(root, "email"), root), true);
});
