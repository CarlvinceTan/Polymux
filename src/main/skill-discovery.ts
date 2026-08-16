import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { SkillLoader } from "@flareai/agent";
import type { DiscoveredSkillGroupDto } from "@flareai/protocol";

/**
 * The agents whose names we know how to write, in the order their groups are
 * listed. Anything else with a skills directory is still found — the scan
 * walks the home directory rather than working from a list, so an agent
 * installed tomorrow needs no change here — and only its heading is guessed
 * from the directory name.
 *
 * `sourced` marks a directory FlareAI already loads from, so its skills are
 * reported as present rather than offered for copying: the point is to show
 * where every skill on the machine lives, not only the missing ones.
 */
const KNOWN_AGENTS: {ids: string[]; label: string; sourced?: boolean}[] = [
  // The ones a FlareAI user is most likely to also be running, first.
  {ids: ["claude"], label: "Claude"},
  {ids: ["codex"], label: "Codex"},
  {ids: ["hermes"], label: "Hermes"},
  {ids: ["pi"], label: "Pi"},
  {ids: ["cursor"], label: "Cursor"},
  {ids: ["gemini"], label: "Gemini CLI"},
  {ids: ["opencode"], label: "OpenCode"},
  {ids: ["copilot", "github-copilot"], label: "GitHub Copilot"},
  {ids: ["amp"], label: "Amp"},
  {ids: ["goose"], label: "goose"},
  // The rest of the Agent Client Protocol registry, alphabetically.
  {ids: ["agoragentic"], label: "Agoragentic"},
  {ids: ["aider"], label: "Aider"},
  {ids: ["auggie", "augment", "augmentcode"], label: "Auggie CLI"},
  {ids: ["autohand"], label: "Autohand Code"},
  {ids: ["cline"], label: "Cline"},
  {ids: ["codebuddy"], label: "Codebuddy Code"},
  {ids: ["continue"], label: "Continue"},
  {ids: ["cortex"], label: "Cortex Code"},
  {ids: ["corust"], label: "Corust Agent"},
  {ids: ["crow", "crow-cli"], label: "crow-cli"},
  {ids: ["deepagents"], label: "DeepAgents"},
  {ids: ["devin"], label: "Devin"},
  {ids: ["dimcode"], label: "DimCode"},
  {ids: ["dirac"], label: "Dirac"},
  {ids: ["droid", "factory"], label: "Factory Droid"},
  {ids: ["fast-agent", "fastagent"], label: "fast-agent"},
  {ids: ["glm"], label: "GLM Agent"},
  {ids: ["grok"], label: "Grok Build"},
  {ids: ["harn"], label: "Harn"},
  {ids: ["junie"], label: "Junie"},
  {ids: ["kilo"], label: "Kilo"},
  {ids: ["kimi"], label: "Kimi CLI"},
  {ids: ["kiro"], label: "Kiro"},
  {ids: ["minion"], label: "Minion Code"},
  {ids: ["vibe", "mistral"], label: "Mistral Vibe"},
  {ids: ["nova"], label: "Nova"},
  {ids: ["openhands"], label: "OpenHands"},
  {ids: ["poolside"], label: "Poolside"},
  {ids: ["qoder"], label: "Qoder CLI"},
  {ids: ["qwen"], label: "Qwen Code"},
  {ids: ["sigit", "getsigit"], label: "siGit Code"},
  {ids: ["stakpak"], label: "Stakpak"},
  {ids: ["vtcode", "vt-code"], label: "VT Code"},
  {ids: ["windsurf"], label: "Windsurf"},
  {ids: ["zed"], label: "Zed"},
  // The cross-agent standard directory `npx skills` installs into, which
  // FlareAI already sources. Last: it is not one agent's library.
  {ids: ["agents"], label: "Shared skills", sourced: true},
];

/** Both spellings are in the wild, so both are checked under every agent. */
const SKILL_FOLDERS = ["skills", "skill"];

/**
 * FlareAI's own directories. Its personal skills are already the Skills list,
 * and its mirror of the bundled set is not something to adopt from.
 */
const SELF = new Set([".flareai"]);

/**
 * Reads every agent skill directory on this machine: `~/.<agent>/skills` and
 * `~/.config/<agent>/skills`, which is where the agents that follow the XDG
 * layout keep theirs. Directories with nothing in them are dropped rather
 * than listed empty — a run of empty headings buries the real finds.
 *
 * `installed` is the set of skill names FlareAI already loads, which decides
 * whether a find is offered or reported as one it already has.
 */
export function discoverAgentSkills(
  installed: ReadonlySet<string>,
  home = homedir(),
): DiscoveredSkillGroupDto[] {
  const groups: DiscoveredSkillGroupDto[] = [];
  for (const candidate of agentDirectories(home)) {
    const known = KNOWN_AGENTS.find((agent) => agent.ids.includes(candidate.id));
    // Parsed by the loader itself, so a folder counts as a skill here exactly
    // when FlareAI would treat it as one — no second frontmatter reader that
    // can drift from the first.
    const skills = new SkillLoader({configured: [candidate.directory]}).load().skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: displayPath(path.dirname(skill.filePath), home),
      state:
        known?.sourced || installed.has(skill.name)
          ? ("loaded" as const)
          : ("available" as const),
    }));
    if (!skills.length) continue;
    groups.push({
      id: candidate.id,
      label: known?.label ?? agentLabel(candidate.id),
      directory: displayPath(candidate.directory, home),
      skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  // Known agents first, in the order above, so the common ones stay at the top
  // however many one-off directories a machine has collected.
  return groups.sort((a, b) => {
    const left = KNOWN_AGENTS.findIndex((agent) => agent.ids.includes(a.id));
    const right = KNOWN_AGENTS.findIndex((agent) => agent.ids.includes(b.id));
    if (left === right) return a.label.localeCompare(b.label);
    if (left < 0) return 1;
    if (right < 0) return -1;
    return left - right;
  });
}

/**
 * Resolves what the renderer displays back to a real directory, and refuses
 * anything that is not inside an agent skills directory: the path makes a
 * round trip through the window before it is copied from.
 */
export function resolveDiscoveredSkill(displayed: string, home = homedir()): string {
  const absolute = path.resolve(
    displayed.startsWith("~/") || displayed === "~"
      ? path.join(home, displayed.slice(1))
      : displayed,
  );
  const roots = agentDirectories(home).map((candidate) => path.resolve(candidate.directory));
  if (!roots.some((root) => absolute.startsWith(`${root}${path.sep}`)))
    throw new Error("That skill is not in a directory FlareAI scans");
  return absolute;
}

/** Every `<agent>/skills` directory that exists, keyed by the agent's name. */
function agentDirectories(home: string): {id: string; directory: string}[] {
  const found: {id: string; directory: string}[] = [];
  const roots: {parent: string; hidden: boolean}[] = [
    {parent: home, hidden: true},
    {parent: path.join(home, ".config"), hidden: false},
  ];
  for (const root of roots) {
    for (const name of entries(root.parent)) {
      if (root.hidden && !name.startsWith(".")) continue;
      if (SELF.has(name) || name === "." || name === "..") continue;
      const id = name.replace(/^\./, "");
      if (!id) continue;
      for (const folder of SKILL_FOLDERS) {
        const directory = path.join(root.parent, name, folder);
        if (isDirectory(directory) && !found.some((item) => item.directory === directory))
          found.push({id, directory});
      }
    }
  }
  return found;
}

function entries(directory: string): string[] {
  try {
    return readdirSync(directory, {withFileTypes: true})
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function isDirectory(target: string): boolean {
  try {
    return existsSync(target) && statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** "open-interpreter" reads as "Open Interpreter" until we know better. */
function agentLabel(id: string): string {
  return id
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

function displayPath(absolute: string, home: string): string {
  return absolute === home
    ? "~"
    : absolute.startsWith(`${home}${path.sep}`)
      ? `~${path.sep}${absolute.slice(home.length + 1)}`
      : absolute;
}
