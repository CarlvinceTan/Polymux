/**
 * Uploads the artifacts produced by `npm run make` to the R2 bucket behind
 * updates.polymux.com, and writes the feed document macOS reads.
 *
 * Electron Forge has no publisher for "static files on an S3-compatible
 * bucket", and electron-updater's generic provider expects the latest-*.yml
 * pair that only electron-builder emits. Both platforms are served here
 * instead, in the shape Squirrel itself asks for:
 *
 *   stable/darwin/<arch>/RELEASES.json   - {url, name, notes, pub_date}
 *   stable/darwin/<arch>/<app>.zip
 *   stable/win32/<arch>/RELEASES         - written by MakerSquirrel, copied as-is
 *   stable/win32/<arch>/<app>.nupkg
 *
 * Required environment: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const CHANNEL = "stable";
const MAKE_DIR = "out/make";

const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Cannot publish: missing ${missing.join(", ")}`);
  process.exit(1);
}

const bucket = process.env.R2_BUCKET;
const publicHost = process.env.MIDAS_UPDATE_HOST ?? "https://updates.polymux.com";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const { version } = JSON.parse(await readFile("package.json", "utf8"));

/** Every file under `dir`, as paths relative to it. */
async function walk(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(full);
  }
  return found;
}

async function upload(localPath, key, contentType) {
  const body = await readFile(localPath);
  const { size } = await stat(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    // Squirrel re-checks the feed every few minutes. A long cache on RELEASES
    // would hide a release for as long as the TTL, so only the immutable
    // artifacts are allowed to sit in a CDN.
    CacheControl: key.endsWith(".json") || key.endsWith("/RELEASES")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  }));
  console.log(`  uploaded ${key} (${(size / 1e6).toFixed(1)} MB)`);
}

let published = 0;

// macOS: the ZIP that MakerZIP produced, plus a feed pointing at it.
for (const arch of ["arm64", "x64"]) {
  const dir = path.join(MAKE_DIR, "zip/darwin", arch);
  const zips = await walk(dir).catch(() => []);
  const zip = zips.find((file) => file.endsWith(".zip"));
  if (!zip) continue;

  const prefix = `${CHANNEL}/darwin/${arch}`;
  const zipKey = `${prefix}/${path.basename(zip)}`;
  console.log(`darwin/${arch}:`);
  await upload(zip, zipKey, "application/zip");

  const feed = {
    url: `${publicHost}/${zipKey}`,
    name: version,
    notes: process.env.MIDAS_RELEASE_NOTES ?? "",
    pub_date: new Date().toISOString(),
  };
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `${prefix}/RELEASES.json`,
    Body: JSON.stringify(feed, null, 2),
    ContentType: "application/json",
    CacheControl: "no-cache",
  }));
  console.log(`  wrote ${prefix}/RELEASES.json -> ${version}`);
  published += 1;
}

// Windows: Squirrel reads RELEASES and fetches the .nupkg named in it, so the
// whole maker output directory goes up unchanged. The Setup.exe rides along as
// the download for people installing for the first time.
for (const arch of ["x64", "arm64"]) {
  const dir = path.join(MAKE_DIR, "squirrel.windows", arch);
  const files = await walk(dir).catch(() => []);
  if (files.length === 0) continue;

  console.log(`win32/${arch}:`);
  for (const file of files) {
    const name = path.basename(file);
    const type = name.endsWith(".exe")
      ? "application/octet-stream"
      : name.endsWith(".nupkg")
        ? "application/zip"
        : "text/plain";
    await upload(file, `${CHANNEL}/win32/${arch}/${name}`, type);
  }
  published += 1;
}

if (published === 0) {
  console.error(`No artifacts found under ${MAKE_DIR}. Run \`npm run make\` first.`);
  process.exit(1);
}

console.log(`\nPublished ${version} for ${published} platform target(s).`);
