import { strict as assert } from "node:assert";
import { test } from "node:test";
import path from "node:path";
import type { ToolHooks } from "@polymux/core";
import {
  ProtectedSkillGuard,
  blocksShellCommand,
  combineHooks,
  isInsideProtectedSkills,
} from "./protected.js";

const ROOT = "/home/u/.polymux/official-skills";
const call = (name: string, args: Record<string, unknown>) =>
  ({ id: "1", name, arguments: args }) as never;

test("recognises paths inside the protected mirror", () => {
  assert.equal(isInsideProtectedSkills(`${ROOT}/computer-use/SKILL.md`, ROOT), true);
  assert.equal(isInsideProtectedSkills(ROOT, ROOT), true);
  assert.equal(isInsideProtectedSkills(`${ROOT}/../skills/mine/SKILL.md`, ROOT), false);
  // A sibling that merely shares the prefix is not inside it.
  assert.equal(isInsideProtectedSkills(`${ROOT}-backup/SKILL.md`, ROOT), false);
  assert.equal(isInsideProtectedSkills("/home/u/.polymux/skills/mine/SKILL.md", ROOT), false);
});

test("blocks writes and edits aimed at a built-in skill", async () => {
  const guard = new ProtectedSkillGuard(ROOT);
  for (const tool of ["write", "edit"]) {
    const decision = await guard.beforeTool(
      call(tool, { path: `${ROOT}/computer-use/SKILL.md` }),
    );
    assert.equal(decision.allow, false);
    assert.match(decision.message ?? "", /read-only/);
  }
});

test("allows writes to the user's own skills", async () => {
  const guard = new ProtectedSkillGuard(ROOT);
  const decision = await guard.beforeTool(
    call("write", { path: "/home/u/.polymux/skills/mine/SKILL.md" }),
  );
  assert.equal(decision.allow, true);
});

test("allows reading a built-in skill", async () => {
  const guard = new ProtectedSkillGuard(ROOT);
  const decision = await guard.beforeTool(
    call("read", { path: `${ROOT}/computer-use/SKILL.md` }),
  );
  assert.equal(decision.allow, true);
});

test("blocks mutating shell commands that touch the mirror", () => {
  assert.equal(blocksShellCommand(`rm -rf ${ROOT}/computer-use`, ROOT), true);
  assert.equal(blocksShellCommand(`echo x > ${ROOT}/a/SKILL.md`, ROOT), true);
  assert.equal(blocksShellCommand("rm -rf ~/.polymux/official-skills/a", ROOT), true);
  // Reads stay allowed: the skills' own scripts and references live there.
  assert.equal(blocksShellCommand(`cat ${ROOT}/computer-use/SKILL.md`, ROOT), false);
  assert.equal(blocksShellCommand("rm -rf /home/u/.polymux/skills/mine", ROOT), false);
});

test("allows trusted bundled scripts without allowing shell composition", () => {
  const script = `${ROOT}/skill-maintenance/scripts/audit_dependencies.py`;
  assert.equal(blocksShellCommand(`python3 ${script}`, ROOT), false);
  assert.equal(blocksShellCommand(`python3 '${script}'`, ROOT), false);
  assert.equal(blocksShellCommand(`/usr/bin/python3 "${script}"`, ROOT), false);
  assert.equal(
    blocksShellCommand(
      `cd ${ROOT}/computer-use && zsh scripts/prepare-background-app.sh --app Helium --check-only`,
      ROOT,
    ),
    false,
  );

  assert.equal(blocksShellCommand(`python3 ${script} > /tmp/audit.json`, ROOT), true);
  assert.equal(blocksShellCommand(`python3 ${script}; rm -rf ${ROOT}`, ROOT), true);
  assert.equal(blocksShellCommand(`python3 ${script} | tee /tmp/audit.json`, ROOT), true);
  assert.equal(blocksShellCommand(`cd ${ROOT}/computer-use && rm -rf scripts`, ROOT), true);
  assert.equal(blocksShellCommand(`cd ${ROOT}/computer-use && python3 -c 'print(1)'`, ROOT), true);
  assert.equal(
    blocksShellCommand(`python3 ${ROOT}/other/scripts/audit_dependencies.py`, ROOT),
    false,
  );
});

test("shell guard reaches the bash tool", async () => {
  const guard = new ProtectedSkillGuard(ROOT);
  const decision = await guard.beforeTool(
    call("bash", { command: `rm -rf ${ROOT}/computer-use` }),
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
  const root = path.join(home, ".polymux", "official-skills");
  assert.equal(isInsideProtectedSkills(path.join(root, "email-use"), root), true);
});
