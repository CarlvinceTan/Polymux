export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: "official" | "codex" | "midas" | "agents" | "bundled" | "configured";
  disableModelInvocation: boolean;
  allowedTools?: string[];
  displayName?: string;
  author?: string;
  category?: string;
  /** ISO timestamp of the SKILL.md's last modification. */
  updatedAt?: string;
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
