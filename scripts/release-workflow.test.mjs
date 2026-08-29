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

test("macOS releases are signed and notarized with no unsigned fallback", () => {
  const macos = job("macos");
  const release = job("release");

  assert.doesNotMatch(workflow, /UNSIGNED_PRERELEASE/);
  for (const secret of [
    "MACOS_CERT_P12",
    "MACOS_CERT_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ])
    assert.match(macos, new RegExp(`secrets\\.${secret}`));

  assert.match(macos, /security import "\$CERT_PATH"/);
  assert.match(macos, /codesign --verify --deep --strict/);
  assert.match(macos, /spctl --assess --type execute/);
  assert.match(macos, /xcrun notarytool submit "\$DMG"/);
  assert.match(macos, /xcrun stapler staple "\$DMG"/);
  assert.match(macos, /xcrun stapler validate/);
  assert.match(job("windows"), /Windows package contains macOS-only WeChat runtime/);
  assert.match(job("linux"), /resources\/wxcdn_fileid_capture\.py/);
  assert.match(job("linux"), /resources\/resources\/wechat-writer/);
  assert.match(release, /--generate-notes/);
  assert.doesNotMatch(release, /--prerelease/);
});

function job(name) {
  const marker = `  ${name}:\n`;
  const start = workflow.indexOf(marker, workflow.indexOf("jobs:\n"));
  assert.notEqual(start, -1, `release workflow has no ${name} job`);
  const remaining = workflow.slice(start + 1);
  const next = remaining.search(/^  [\w-]+:\n/m);
  return workflow.slice(start, next < 0 ? workflow.length : start + 1 + next);
}
