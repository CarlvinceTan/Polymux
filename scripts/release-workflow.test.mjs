import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = await readFile(
  path.join(repository, ".github", "workflows", "release.yml"),
  "utf8",
);

test("release packaging waits for the complete application verification", () => {
  const verify = job("verify");
  assert.match(verify, /- run: npm run check\n/);
  assert.match(verify, /- run: npm test\n/);
  assert.match(verify, /- run: npm run check --prefix apps\/site\n/);

  for (const platform of ["macos", "windows", "linux"])
    assert.match(job(platform), /\n    needs: verify\n/);

  assert.match(
    job("browser-compatibility"),
    /run: node scripts\/verify-published-extension\.mjs/,
  );
  assert.match(
    job("release"),
    /needs: \[browser-compatibility, macos, windows, linux\]/,
  );
});

function job(name) {
  const marker = `  ${name}:\n`;
  const start = workflow.indexOf(marker, workflow.indexOf("jobs:\n"));
  assert.notEqual(start, -1, `release workflow has no ${name} job`);
  const remaining = workflow.slice(start + 1);
  const next = remaining.search(/^  [\w-]+:\n/m);
  return workflow.slice(start, next < 0 ? workflow.length : start + 1 + next);
}
