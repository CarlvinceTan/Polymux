export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: "official" | "codex" | "flareai" | "agents" | "bundled" | "configured";
  disableModelInvocation: boolean;
  allowedTools?: string[];
  /**
   * App grants the skill declares in its frontmatter, e.g.
   * `permissions: reminders calendars`. Kept as written rather than checked
   * against a list of known grants: this package has no opinion on what the
   * host can ask macOS for, and the host drops what it does not recognise.
   */
  permissions?: string[];
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
