import {createInterface} from "node:readline/promises";
import {stdin, stderr} from "node:process";
import {Writable} from "node:stream";

/** Keep readline's editing and terminal restoration, but discard its echo. */
export async function promptSecret(
  label: string,
  input: NodeJS.ReadStream = stdin,
  output: NodeJS.WritableStream = stderr,
): Promise<string> {
  const muted = new Writable({write(_chunk, _encoding, done) { done(); }});
  const reader = createInterface({input, output: muted, terminal: true});
  const controller = new AbortController();
  const cancel = () => controller.abort();
  reader.once("SIGINT", cancel);
  reader.once("close", cancel);
  reader.once("error", cancel);
  output.write(`${label}: `);
  try {
    return await reader.question("", {signal: controller.signal});
  } catch {
    throw new Error("Password input cancelled.");
  } finally {
    reader.removeListener("SIGINT", cancel);
    reader.removeListener("close", cancel);
    reader.removeListener("error", cancel);
    reader.close();
    muted.end();
    output.write("\n");
  }
}

export async function secretFromStdin(input: NodeJS.ReadStream = stdin): Promise<string> {
  if (input.isTTY) throw new Error("Pipe the password to stdin, or use the hidden password prompt.");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 64 * 1024) throw new Error("Password input is too large.");
    chunks.push(bytes);
  }
  // Accept a normal line-oriented pipe without stripping password whitespace.
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}
