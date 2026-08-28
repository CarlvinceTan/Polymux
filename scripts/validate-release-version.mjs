#!/usr/bin/env node

import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";

const root = JSON.parse(readFileSync("package.json", "utf8"));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  console.error(`Release version check failed: ${message}`);
  process.exit(1);
}

function parts(version) {
  const match = versionPattern.exec(version);
  if (!match) fail(`${version} is not a stable semantic version (x.y.z).`);
  return match.slice(1).map(Number);
}

function compare(left, right) {
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

parts(root.version);

const tag = `v${root.version}`;
const tags = execFileSync("git", ["tag", "--list", "v*"], {encoding: "utf8"})
  .trim()
  .split("\n")
  .filter((entry) => /^v\d+\.\d+\.\d+$/.test(entry));
if (tags.includes(tag)) fail(`${tag} already exists.`);

const baseArgument = process.argv.find((entry) => entry.startsWith("--base="));
if (baseArgument) {
  const base = baseArgument.slice("--base=".length);
  const previous = JSON.parse(
    execFileSync("git", ["show", `${base}:package.json`], {encoding: "utf8"}),
  ).version;
  if (compare(root.version, previous) < 0)
    fail(`version ${root.version} cannot be older than main's ${previous}.`);
}

const latest = tags
  .map((entry) => entry.slice(1))
  .sort((left, right) => compare(right, left))[0];
if (latest && compare(root.version, latest) <= 0)
  fail(`version ${root.version} must be newer than the latest tag v${latest}.`);

console.log(JSON.stringify({version: root.version, tag, latest: latest ? `v${latest}` : null}));
