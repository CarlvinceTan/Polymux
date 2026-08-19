import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The prompts FlareAI's own agents run on, as files rather than string
 * literals buried in the code that uses them.
 *
 * `base` opens the system prompt for every run. `main` is loaded into every run
 * that can delegate and `task` into every run that was delegated to — one
 * standing brief each, since the two jobs differ in almost every respect that
 * matters. The rest belong to the internal agents: the goal judge, the
 * compactor, the memory consolidator, the chronicle distiller.
 *
 * None of them is a skill: they are not listed, not switchable, and not
 * something the model chooses to open. They ship as `resources/prompts/<name>.md`,
 * so editing one never means editing code.
 */
export type AgentPromptName =
  | "base"
  | "main"
  | "task"
  | "judge"
  | "compaction"
  | "consolidation"
  | "distillation";

export type AgentPrompts = Partial<Record<AgentPromptName, string>>;

export const AGENT_PROMPT_NAMES: AgentPromptName[] = [
  "base",
  "main",
  "task",
  "judge",
  "compaction",
  "consolidation",
  "distillation",
];

/**
 * Reads whichever prompt files are there. A missing or unreadable file is not
 * an error: the code that asks for it keeps its own default, so a broken
 * install runs on the built-in wording rather than on nothing at all.
 */
export function loadAgentPrompts(directory: string): AgentPrompts {
  const prompts: AgentPrompts = {};
  for (const name of AGENT_PROMPT_NAMES) {
    try {
      const text = readFileSync(path.join(directory, `${name}.md`), "utf8").trim();
      if (text) prompts[name] = text;
    } catch {
      // Left to its default.
    }
  }
  return prompts;
}

/**
 * Fills `{name}` placeholders. Two of these prompts state a budget the caller
 * computes, so the file carries the sentence and the code carries the number.
 */
export function fillPrompt(
  text: string,
  values: Record<string, string | number>,
): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
