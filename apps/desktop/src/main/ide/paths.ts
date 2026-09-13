import path from "node:path";

/** True when `target` is the root or a path inside it. */
export function insideRoot(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Resolves a project-relative path, refusing anything that would leave the root. */
export function resolveInside(root: string, relative = ""): string {
  const resolvedRoot = path.resolve(root);
  const resolved = relative ? path.resolve(resolvedRoot, relative) : resolvedRoot;
  if (!insideRoot(resolvedRoot, resolved)) throw new Error("Path is outside the project");
  return resolved;
}

export function requiredPath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required`);
  return value;
}
