import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

export function releaseNotes(source, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("A stable release version is required.");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error("Release notes are missing front matter.");
  const metadata = match[1];
  if (!metadata.split(/\r?\n/).includes(`version: ${version}`)) throw new Error("Release notes version does not match the tag.");
  if (!/^published: true\s*$/m.test(metadata)) throw new Error("Release notes are still a draft.");
  const body = match[2].trim();
  let category = false, area = false, count = 0;
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      category = ["Features", "Bug Fixes", "Improvements"].includes(line.slice(3));
      area = false;
      if (!category) throw new Error("Unsupported release category.");
    } else if (line.startsWith("### ")) {
      area = category && Boolean(line.slice(4).trim());
    } else if (line.startsWith("- ")) {
      if (!category || !area) throw new Error("Release notes must be grouped by category and area.");
      count++;
    }
  }
  if (!count) throw new Error("Release notes must include a user-facing change.");
  return `${body}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]?.replace(/^v/, "");
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Pass the stable release tag.");
  const source = readFileSync(new URL(`../../apps/site/src/content/releases/${version}.md`, import.meta.url), "utf8");
  process.stdout.write(releaseNotes(source, version));
}
