import { homedir } from "node:os";
import path from "node:path";

export function polymuxHome(): string {
  return process.env.POLYMUX_HOME?.trim() || path.join(homedir(), ".polymux");
}

export function hostPaths() {
  const root = polymuxHome();
  return {
    root,
    data: path.join(root, "host"),
    config: path.join(root, "config"),
    state: path.join(root, "host", "state.json"),
    adminSecret: path.join(root, "config", "host-admin-token"),
  };
}
