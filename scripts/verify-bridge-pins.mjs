#!/usr/bin/env node
/**
 * Verifies that every GitHub release pin names the exact commit behind its
 * upstream tag. Artifact bytes and upstream sha256sums are checked separately
 * by fetch-bridges.mjs; this closes the gap where a valid release tag could be
 * paired with the wrong source commit for Windows builds.
 */

import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {FLEET} from "./fetch-bridges.mjs";

export function tagCommit(output, tag) {
  const refs = new Map(
    output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [commit, ref] = line.trim().split(/\s+/, 2);
        return [ref, commit];
      }),
  );
  return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`) ?? null;
}

export function verifyResolvedTag(entry, output) {
  const actual = tagCommit(output, entry.tag);
  if (!actual)
    throw new Error(`${entry.repo} ${entry.tag} does not exist upstream`);
  if (actual !== entry.commit)
    throw new Error(
      `${entry.binary} pins ${entry.commit}, but mautrix/${entry.repo} ${entry.tag} resolves to ${actual}`,
    );
  return actual;
}

function resolveTag(repo, tag) {
  return execFileSync(
    "git",
    [
      "ls-remote",
      `https://github.com/mautrix/${repo}.git`,
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ],
    {encoding: "utf8"},
  );
}

export function main() {
  const resolved = new Map();
  for (const entry of FLEET) {
    const key = `${entry.repo}@${entry.tag}`;
    let output = resolved.get(key);
    if (output === undefined) {
      output = resolveTag(entry.repo, entry.tag);
      resolved.set(key, output);
    }
    const commit = verifyResolvedTag(entry, output);
    console.log(`${entry.binary.padEnd(20)} ${entry.tag.padEnd(12)} ${commit}`);
  }
  console.log(`\n${FLEET.length}/${FLEET.length} release pins match their upstream tags.`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
