import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

const tails = new Map<string, Promise<void>>();

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

export async function withFileMutation<T>(
  path: string,
  mutate: () => Promise<T>,
): Promise<T> {
  const key = await canonicalPath(path);
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  const tail = previous.then(() => current);
  tails.set(key, tail);
  await previous;
  try {
    return await mutate();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
