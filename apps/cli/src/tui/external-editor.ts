import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** The editor command comes from the user's own VISUAL/EDITOR configuration. */
export async function editPrompt(
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-editor-"));
  const file = path.join(directory, "prompt.md");
  const interrupt = () => {};
  process.on("SIGINT", interrupt);
  try {
    await writeFile(file, text, { mode: 0o600 });
    const editor =
      process.env.VISUAL ||
      process.env.EDITOR ||
      (process.platform === "win32" ? "notepad" : "vi");
    const quoted =
      process.platform === "win32"
        ? `"${file.replace(/"/g, '""')}"`
        : `'${file.replace(/'/g, "'\\''")}'`;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        `${process.platform === "win32" ? "" : "exec "}${editor} ${quoted}`,
        {
          signal,
          shell: true,
          stdio: "inherit",
        },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Editor exited with status ${code}`)),
      );
    });
    return await readFile(file, "utf8");
  } finally {
    process.removeListener("SIGINT", interrupt);
    await rm(directory, { recursive: true, force: true });
  }
}
