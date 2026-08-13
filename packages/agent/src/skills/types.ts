export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  iconPath?: string;
  source: "official" | "codex" | "midas" | "agents" | "bundled" | "configured";
  disableModelInvocation: boolean;
  allowedTools?: string[];
}

export interface SkillDiagnostic {
  severity: "warning" | "error";
  message: string;
  path: string;
}
export interface SkillLoadResult {
  skills: Skill[];
  diagnostics: SkillDiagnostic[];
}
