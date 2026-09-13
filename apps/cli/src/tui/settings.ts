import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { polymuxHome } from "../paths.js";
import {
  KeybindingsManager,
  TUI_KEYBINDINGS,
  type KeybindingsConfig,
} from "@earendil-works/pi-tui";

export interface TuiSettings {
  outputPad: 0 | 1;
  editorPaddingX: number;
  autocompleteMaxVisible: number;
  hideThinkingBlock: boolean;
  expandTools: boolean;
  quietStartup: boolean;
  scopedModels: string[];
}
export const defaults: TuiSettings = {
  outputPad: 1,
  editorPaddingX: 1,
  autocompleteMaxVisible: 5,
  hideThinkingBlock: true,
  expandTools: false,
  quietStartup: false,
  scopedModels: [],
};
export const appKeys = {
  "app.editor.external": {
    defaultKeys: "ctrl+g",
    description: "Edit prompt in VISUAL or EDITOR",
  },
  "app.interrupt": {
    defaultKeys: "escape",
    description: "Cancel run or dialog",
  },
  "app.clear": {
    defaultKeys: "ctrl+c",
    description: "Clear input; press twice to exit",
  },
  "app.exit": { defaultKeys: "ctrl+d", description: "Exit with empty input" },
  "app.thinking.cycle": {
    defaultKeys: "shift+tab",
    description: "Cycle thinking level",
  },
  "app.model.cycleForward": {
    defaultKeys: "ctrl+p",
    description: "Next scoped model",
  },
  "app.model.cycleBackward": {
    defaultKeys: "ctrl+shift+p",
    description: "Previous scoped model",
  },
  "app.model.select": { defaultKeys: "ctrl+l", description: "Select model" },
  "app.tools.expand": {
    defaultKeys: "ctrl+o",
    description: "Expand tool output",
  },
  "app.thinking.toggle": {
    defaultKeys: "ctrl+t",
    description: "Expand thinking",
  },
  "app.message.followUp": {
    defaultKeys: "enter",
    description: "Send or queue a follow-up",
  },
  "app.message.dequeue": {
    defaultKeys: "alt+up",
    description: "Edit the last queued follow-up",
  },
  "app.message.copy": {
    defaultKeys: "ctrl+x",
    description: "Copy last answer",
  },
} as const;

async function json(file: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `Cannot read ${file}: ${error instanceof Error ? error.message : error}`,
    );
  }
}
function settings(raw: Record<string, unknown>): Partial<TuiSettings> {
  const result: Partial<TuiSettings> = {};
  if (raw.outputPad === 0 || raw.outputPad === 1)
    result.outputPad = raw.outputPad;
  for (const key of [
    "hideThinkingBlock",
    "expandTools",
    "quietStartup",
  ] as const)
    if (typeof raw[key] === "boolean") result[key] = raw[key];
  for (const key of ["editorPaddingX", "autocompleteMaxVisible"] as const)
    if (
      Number.isInteger(raw[key]) &&
      Number(raw[key]) >= (key === "editorPaddingX" ? 0 : 1) &&
      Number(raw[key]) <= 12
    )
      result[key] = Number(raw[key]);
  if (Array.isArray(raw.scopedModels))
    result.scopedModels = raw.scopedModels.filter(
      (item): item is string => typeof item === "string",
    );
  return result;
}
export async function loadTuiSettings(
  cwd = process.cwd(),
  home = polymuxHome(),
) {
  const globalFile = path.join(home, "settings.json");
  const localFile = path.join(cwd, ".polymux", "settings.json");
  const [global, project, rawKeys] = await Promise.all([
    json(globalFile),
    json(localFile),
    json(path.join(home, "keybindings.json")),
  ]);
  const keys = Object.fromEntries(
    Object.entries(rawKeys).filter(
      ([, value]) =>
        typeof value === "string" ||
        (Array.isArray(value) && value.every((key) => typeof key === "string")),
    ),
  ) as KeybindingsConfig;
  const keybindings = new KeybindingsManager(
    { ...TUI_KEYBINDINGS, ...appKeys },
    { "tui.input.submit": ["enter", "super+enter"], ...keys },
  );
  return {
    settings: { ...defaults, ...settings(global), ...settings(project) },
    keybindings,
    globalFile,
    projectFile: localFile,
  };
}
export async function saveTuiSettings(
  value: Partial<TuiSettings>,
  file = path.join(polymuxHome(), "settings.json"),
) {
  const current = await json(file);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify({ ...current, ...value }, null, 2) + "\n",
    { mode: 0o600 },
  );
  await rename(temporary, file);
}
