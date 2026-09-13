import {existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync} from "node:fs";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const extension = path.join(root, "apps/extension");
const outputIndex = process.argv.indexOf("--output-dir");
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error("--output-dir requires a path.");
const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : extension;
const packaging = outputIndex >= 0;

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv(path.join(root, ".env"));

const url = process.env.POLYMUX_SUPABASE_URL?.trim() || "https://zeparkyoyqvjzavrejsa.supabase.co";
const anonKey = process.env.POLYMUX_SUPABASE_ANON_KEY?.trim() || "";
if (packaging && (!anonKey || !/^https:\/\//.test(url))) {
  throw new Error("Extension packaging requires POLYMUX_SUPABASE_URL (HTTPS) and POLYMUX_SUPABASE_ANON_KEY.");
}
if (packaging && anonKey.startsWith("sb_secret_")) {
  throw new Error(
    "POLYMUX_SUPABASE_ANON_KEY must be the publishable key, not a server-only sb_secret_ key.",
  );
}
mkdirSync(path.join(output, "locker"), {recursive: true});
writeFileSync(
  path.join(output, packaging ? "locker/config.js" : "locker/config.local.js"),
  `export const POLYMUX_SUPABASE_URL = ${JSON.stringify(url)};\nexport const POLYMUX_SUPABASE_ANON_KEY = ${JSON.stringify(anonKey)};\n`,
);

await build({
  absWorkingDir: root,
  entryPoints: ["packages/locker/src/browser.ts"],
  outfile: path.join(output, "locker/offline.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome114", "firefox121", "safari16"],
  legalComments: "none",
  alias: {
    crypto: path.join(here, "crypto-shim.js"),
    "@xmldom/xmldom": path.join(here, "dom-shim.js"),
  },
});

const safariCopies = [
  path.join(extension, "safari/Polymux/Polymux Extension/Resources"),
  path.join(extension, "safari/ios/Polymux/Polymux Extension/Resources"),
];
for (const destination of packaging ? [] : safariCopies) {
  if (!existsSync(destination)) continue;
  for (const name of [
    "locker/offline.js",
    "locker/api.js",
    "locker/popup.js",
    "locker/popup.css",
    "locker/popup.html",
    "locker/config.js",
    "locker/content.js",
    "locker/webauthn.js",
    "locker/webauthn-page.js",
    "agent/cdp.js",
    "agent/content.js",
    "background.js",
    "manifest.json",
    "manifest.firefox.json",
  ]) {
    const source = path.join(extension, name);
    if (existsSync(source)) copyFileSync(source, path.join(destination, name));
  }
}

console.log(`Built Locker in ${output}.`);
