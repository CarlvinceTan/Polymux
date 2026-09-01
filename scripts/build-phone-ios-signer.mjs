#!/usr/bin/env node
/** Build the private, relocatable Apple-account provisioning helper.
 *
 * The shipped runtime is a pinned standalone CPython plus the small MIT iPASide
 * authentication/provisioning subset and zsign. It is assembled on the target
 * OS during packaging, so end users install none of those dependencies.
 */

import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const IOS_SIGNER_PROTOCOL_VERSION = 1;
export const IPASIDE_RELEASE = "1.2.5";
export const IPASIDE_COMMIT = "7ca1fb7f52a000fdf363c6463bdaaad121081cd4";
export const PYTHON_RELEASE = "3.12.14+20260825";
export const ZSIGN_RELEASE = "1.1.1";

const IPASIDE_SOURCE = `https://github.com/pwnapplehat/iPASide/archive/${IPASIDE_COMMIT}.tar.gz`;
const IPASIDE_SOURCE_SHA256 = "2add876c134e0902298940ad4ad152a8f65c5457839a0b40716e6e1faf9fc51a";
const IPASIDE_LICENSE_SHA256 = "0de4ee5e6e62289f00e7a28107d660e6e8e883e33fc02f15df5c8a74b6c89ee2";
const PYTHON_TAG = "20260825";
const PYTHON_LICENSE =
  `https://raw.githubusercontent.com/astral-sh/python-build-standalone/${PYTHON_TAG}/LICENSE`;
const PYTHON_LICENSE_SHA256 = "1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5";
const ZSIGN_LICENSE = `https://raw.githubusercontent.com/zhlynn/zsign/v${ZSIGN_RELEASE}/LICENSE`;
const ZSIGN_LICENSE_SHA256 = "57a50ade7eafe84091e7f97169e2c555980513e5d425ba8b21c76ce7458f602c";

export const IOS_SIGNER_TARGETS = {
  "darwin-arm64": {
    pythonArchive: `cpython-${PYTHON_RELEASE}-aarch64-apple-darwin-install_only_stripped.tar.gz`,
    pythonSha256: "8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6",
    pythonExecutable: "python/bin/python3",
    sitePackages: "python/lib/python3.12/site-packages",
    zsignArchive: null,
    zsignSha256: null,
    zsignSource: "zsign",
    zsignExecutable: "zsign",
    anisetteProvider: "system-aoskit",
  },
  "win32-x64": {
    pythonArchive: `cpython-${PYTHON_RELEASE}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`,
    pythonSha256: "8e6aad12ef6fc9685e67ce66253f8f72d6e8fa02cb7187e5850bd4db5ecd9e2a",
    pythonExecutable: "python/python.exe",
    sitePackages: "python/Lib/site-packages",
    zsignArchive: "zsign-windows-x64.zip",
    zsignSha256: "1b0eed7a64a3ee28bedd941072b546520c20c5e4a6983b0743e8a7c1b42b1bff",
    zsignSource: "zsign.exe",
    zsignExecutable: "zsign.exe",
    anisetteProvider: "portable-apple-libraries",
  },
  "linux-x64": {
    pythonArchive: `cpython-${PYTHON_RELEASE}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz`,
    pythonSha256: "7ce4a71285d913955a76053cc7605ea96da8ecada54dba9cf395245961816421",
    pythonExecutable: "python/bin/python3",
    sitePackages: "python/lib/python3.12/site-packages",
    zsignArchive: "zsign-linux-musl-static.tar.gz",
    zsignSha256: "9880b0e1290dea211481fd031bcca8d0d7f3f09ba1c6a89743b3422df1ac14b9",
    zsignSource: "zsign-musl",
    zsignExecutable: "zsign",
    anisetteProvider: "portable-apple-libraries",
  },
};

const PYTHON_ASSET_PREFIX =
  `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_TAG}`;
const ZSIGN_ASSET_PREFIX = `https://github.com/zhlynn/zsign/releases/download/v${ZSIGN_RELEASE}`;
const IPASIDE_MODULES = [
  "__init__.py",
  "anisette.py",
  "developer.py",
  "errors.py",
  "gsa.py",
  "paths.py",
  "provision.py",
  "signing.py",
  "tls.py",
];

/** All transitive wheels are exact and hash-locked. Native packages carry one
 * hash per supported release target; pip selects only the compatible wheel. */
export const IOS_SIGNER_REQUIREMENTS = `
Anisette==1.2.4 --hash=sha256:f61e620aa736f0cac0ca102dd44a02cc2caea1a072eab0f1ef7f2d8b534e03dc
appdirs==1.4.4 --hash=sha256:a841dacd6b99318a741b166adb07e19ee71a274450e68237b4650ca1055ab128
certifi==2026.7.22 --hash=sha256:62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775
cffi==2.1.1 --hash=sha256:f81b3b8f3d4e343550fa4baa0e479bba9f2d29ce9c2e9b51d1ce1718d7442fcf --hash=sha256:f53e442b08449d42821fa4a4fba000095af9f62742a500f978a9f557ec44339a --hash=sha256:c1453022f490d2459a11819d83ad1d586e9ff65a12ac3e705ffebd46d3685dcf
charset-normalizer==3.5.1 --hash=sha256:5b6d1386bf0096d26d3a863dc0a487a5b4eb9aa93cf5ba69683d29dde6b9d60f --hash=sha256:3617ac3cfd8b9888f145ad89dd6e692285834b0201c6074a5eeaad3fd4d668c2 --hash=sha256:b9af956078716df40d985fb0dfeb2c2120c5ca92ba4ff4b388acfd01cdc14d08
cryptography==50.0.1 --hash=sha256:b8f852c65863251b9e3a1b8c150ce21e59b522dbb6a7d4bc80e680d38388e986 --hash=sha256:aed8db4f6d71c51efb89530e12d9464e7bf2923d46c3205dc794a2a93f8c0648 --hash=sha256:ff838d62ec1bfce4f9ba7fa16f4a7b554cd8d0c299e6be37502161a660c84eef
fs==2.4.16 --hash=sha256:660064febbccda264ae0b6bace80a8d1be9e089e0a5eb2427b7d517f9a91545c
idna==3.19 --hash=sha256:815e7be7a7806d54abb586dc943addc79e8b2ee16915059658cbeff4b1b43bf4
pycparser==3.0 --hash=sha256:b727414169a36b7d524c1c3e31839a521725078d7b2ff038656844266160a992
pyelftools==0.33 --hash=sha256:f215ad5f47d3f1373a21496a6c9e0707c622840d0622f23ff7ce08678b020036
requests==2.34.2 --hash=sha256:2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0
setuptools==84.0.0 --hash=sha256:51a52592b3b99e102b609654876bd65f19f999935166d1352678931132b0c670
six==1.17.0 --hash=sha256:4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274
srp==1.0.22 --hash=sha256:35aa8af053285a35683eb37182dcb2e46dbd85c7075d28e139f200d6bf16ea43
typing-extensions==4.16.0 --hash=sha256:481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8
urllib3==2.7.0 --hash=sha256:9fb4c81ebbb1ce9531cce37674bbc6f1360472bc18ca9a553ede278ef7276897
`.trim() + "\n";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function iosSignerTarget(platform, arch) {
  const target = IOS_SIGNER_TARGETS[`${platform}-${arch}`];
  if (!target) throw new Error(`No bundled iPhone signer runtime for ${platform}-${arch}`);
  return target;
}

export function cliOption(args, name) {
  const prefix = `--${name}=`;
  return args.find((flag) => flag.startsWith(prefix))?.slice(prefix.length);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function runtimeStamp(platform, arch) {
  return `${IPASIDE_RELEASE}-python-${PYTHON_RELEASE}-zsign-${ZSIGN_RELEASE}-${platform}-${arch}`;
}

async function ready(outputDirectory, platform, arch, target) {
  try {
    const [stamp, manifest, helper] = await Promise.all([
      readFile(path.join(outputDirectory, "VERSION"), "utf8"),
      readFile(path.join(outputDirectory, "MANIFEST.json"), "utf8").then(JSON.parse),
      readFile(path.join(root, "scripts", "phone-ios-signer-helper.py")),
    ]);
    if (
      stamp.trim() !== runtimeStamp(platform, arch) ||
      manifest.protocolVersion !== IOS_SIGNER_PROTOCOL_VERSION ||
      manifest.iPASideCommit !== IPASIDE_COMMIT ||
      manifest.pythonSha256 !== target.pythonSha256 ||
      manifest.unicorn?.bundled !== false ||
      manifest.unicorn?.release !== "2.1.4" ||
      manifest.anisetteProvider !== target.anisetteProvider ||
      manifest.helperSha256 !== digest(helper) ||
      manifest.requirementsSha256 !== digest(Buffer.from(IOS_SIGNER_REQUIREMENTS))
    ) return false;
    await Promise.all([
      stat(path.join(outputDirectory, target.pythonExecutable)),
      stat(path.join(outputDirectory, target.zsignExecutable)),
      stat(path.join(outputDirectory, "helper.py")),
      stat(path.join(outputDirectory, "LICENSE.iPASide.txt")),
      stat(path.join(outputDirectory, "LICENSE.python-standalone.txt")),
      stat(path.join(outputDirectory, "LICENSE.zsign.txt")),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function copyIpasideSubset(sourceRoot, sitePackages) {
  const source = path.join(sourceRoot, "src", "iPASide.Engine", "ipaside_engine");
  const target = path.join(sitePackages, "ipaside_engine");
  await mkdir(path.join(target, "certs"), {recursive: true});
  await Promise.all(IPASIDE_MODULES.map((name) => copyFile(path.join(source, name), path.join(target, name))));
  await copyFile(
    path.join(source, "certs", "apple_gsa_ca.pem"),
    path.join(target, "certs", "apple_gsa_ca.pem"),
  );
}

async function pruneInstaller(runtime, sitePackages, platform) {
  for (const entry of await readdir(sitePackages)) {
    if (entry === "pip" || /^pip-.*\.dist-info$/u.test(entry))
      await rm(path.join(sitePackages, entry), {recursive: true, force: true});
  }
  const bin = platform === "win32" ? path.join(runtime, "python", "Scripts") : path.join(runtime, "python", "bin");
  for (const entry of await readdir(bin).catch(() => [])) {
    if (/^pip(?:3(?:\.12)?)?(?:\.exe)?$/u.test(entry))
      await rm(path.join(bin, entry), {force: true});
  }
}

function smoke(outputDirectory, target) {
  const python = path.join(outputDirectory, target.pythonExecutable);
  const helper = path.join(outputDirectory, "helper.py");
  const state = path.join(outputDirectory, ".smoke-state");
  const result = execFileSync(python, [helper], {
    input: '{"id":"smoke","method":"ping"}\n',
    encoding: "utf8",
    env: {
      ...process.env,
      LOCALAPPDATA: state,
      PYTHONUTF8: "1",
      PYTHONDONTWRITEBYTECODE: "1",
    },
  }).trim();
  const response = JSON.parse(result);
  if (!response.ok || response.result?.protocolVersion !== IOS_SIGNER_PROTOCOL_VERSION)
    throw new Error("The bundled iPhone signer helper failed its protocol smoke test.");
  execFileSync(path.join(outputDirectory, target.zsignExecutable), ["-v"], {stdio: "ignore"});
}

export async function buildPhoneIosSigner(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== process.platform || arch !== process.arch)
    throw new Error(`The ${platform}-${arch} signer runtime must be assembled on that target.`);
  const target = iosSignerTarget(platform, arch);
  const outputDirectory = options.outputDirectory ??
    path.join(root, "resources", "phone", "ios", "signer");
  if (!options.force && await ready(outputDirectory, platform, arch, target)) {
    console.log(`iPhone signer ${runtimeStamp(platform, arch)} already present, skipping`);
    return outputDirectory;
  }

  console.log(`building iPhone signer ${runtimeStamp(platform, arch)}`);
  const helperBytes = await readFile(path.join(root, "scripts", "phone-ios-signer-helper.py"));
  const downloads = [
    fetchBytes(`${PYTHON_ASSET_PREFIX}/${encodeURIComponent(target.pythonArchive)}`),
    fetchBytes(IPASIDE_SOURCE),
    fetchBytes(PYTHON_LICENSE),
    fetchBytes(ZSIGN_LICENSE),
  ];
  if (target.zsignArchive)
    downloads.push(fetchBytes(`${ZSIGN_ASSET_PREFIX}/${target.zsignArchive}`));
  const [pythonBytes, ipasideBytes, pythonLicense, zsignLicense, zsignBytes] =
    await Promise.all(downloads);
  if (digest(pythonBytes) !== target.pythonSha256) throw new Error("standalone Python sha256 mismatch");
  if (digest(ipasideBytes) !== IPASIDE_SOURCE_SHA256) throw new Error("iPASide source sha256 mismatch");
  if (digest(pythonLicense) !== PYTHON_LICENSE_SHA256) throw new Error("standalone Python license sha256 mismatch");
  if (digest(zsignLicense) !== ZSIGN_LICENSE_SHA256) throw new Error("zsign license sha256 mismatch");
  if (target.zsignArchive && digest(zsignBytes) !== target.zsignSha256)
    throw new Error("zsign archive sha256 mismatch");

  const staging = await mkdtemp(path.join(tmpdir(), "polymux-phone-ios-signer-"));
  const pending = path.join(
    path.dirname(outputDirectory),
    `.${path.basename(outputDirectory)}.pending-${process.pid}`,
  );
  try {
    await rm(pending, {recursive: true, force: true});
    await mkdir(pending, {recursive: true});
    const pythonArchive = path.join(staging, target.pythonArchive);
    const ipasideArchive = path.join(staging, `ipaside-${IPASIDE_COMMIT}.tar.gz`);
    await Promise.all([
      writeFile(pythonArchive, pythonBytes),
      writeFile(ipasideArchive, ipasideBytes),
    ]);
    execFileSync("tar", ["-xzf", pythonArchive, "-C", pending], {stdio: "inherit"});
    execFileSync("tar", ["-xzf", ipasideArchive, "-C", staging], {stdio: "inherit"});

    const requirements = path.join(staging, "requirements.lock");
    await writeFile(requirements, IOS_SIGNER_REQUIREMENTS);
    const python = path.join(pending, target.pythonExecutable);
    execFileSync(python, [
      "-m", "pip", "install",
      "--disable-pip-version-check",
      "--no-cache-dir",
      "--no-compile",
      "--no-warn-script-location",
      "--only-binary=:all:",
      "--no-deps",
      "--require-hashes",
      "--upgrade",
      "--force-reinstall",
      "-r", requirements,
    ], {stdio: "inherit"});

    const sitePackages = path.join(pending, target.sitePackages);
    const sourceRoot = path.join(staging, `iPASide-${IPASIDE_COMMIT}`);
    await copyIpasideSubset(sourceRoot, sitePackages);
    await writeFile(path.join(pending, "helper.py"), helperBytes);

    if (target.zsignArchive) {
      const archive = path.join(staging, target.zsignArchive);
      await writeFile(archive, zsignBytes);
      execFileSync("tar", ["-xf", archive, "-C", staging], {stdio: "inherit"});
      await copyFile(path.join(staging, target.zsignSource), path.join(pending, target.zsignExecutable));
    } else {
      const sourceDirectory = options.zsignDirectory ??
        path.join(root, "resources", "phone", "ios", "signer-tools");
      await copyFile(path.join(sourceDirectory, target.zsignSource), path.join(pending, target.zsignExecutable));
    }
    await chmod(path.join(pending, target.zsignExecutable), 0o755);

    const ipasideLicense = await readFile(path.join(sourceRoot, "LICENSE"));
    if (digest(ipasideLicense) !== IPASIDE_LICENSE_SHA256)
      throw new Error("iPASide license sha256 mismatch");
    await Promise.all([
      writeFile(path.join(pending, "LICENSE.iPASide.txt"), ipasideLicense),
      writeFile(path.join(pending, "LICENSE.python-standalone.txt"), pythonLicense),
      writeFile(path.join(pending, "LICENSE.zsign.txt"), zsignLicense),
    ]);
    await pruneInstaller(pending, sitePackages, platform);
    smoke(pending, target);
    await rm(path.join(pending, ".smoke-state"), {recursive: true, force: true});

    await writeFile(
      path.join(pending, "MANIFEST.json"),
      `${JSON.stringify({
        protocolVersion: IOS_SIGNER_PROTOCOL_VERSION,
        platform,
        arch,
        iPASideRelease: IPASIDE_RELEASE,
        iPASideCommit: IPASIDE_COMMIT,
        iPASideSourceSha256: IPASIDE_SOURCE_SHA256,
        pythonRelease: PYTHON_RELEASE,
        pythonSha256: target.pythonSha256,
        helperSha256: digest(helperBytes),
        requirementsSha256: digest(Buffer.from(IOS_SIGNER_REQUIREMENTS)),
        zsignRelease: ZSIGN_RELEASE,
        zsignSha256: target.zsignSha256 ??
          digest(await readFile(path.join(pending, target.zsignExecutable))),
        anisetteLibrariesSha256:
          "59f6a104ef3df1e6630c85de725072f5a80f26df43c83df8552e0d55dd1ee966",
        anisetteProvider: target.anisetteProvider,
        unicorn: {
          release: "2.1.4",
          bundled: false,
          distribution: "direct-pypi-first-use",
          wheelSha256: {
            "win32-x64": "d7107500c64ce5c168fbff6bef9485b5db1350050036f4cea568650cf8bdbdf5",
            "linux-x64": "9d6e6dea140560de4ebd8446661f7ef84a357d428c14a3ef09dacd306ec8c239",
          },
        },
      }, null, 2)}\n`,
    );
    await writeFile(path.join(pending, "VERSION"), `${runtimeStamp(platform, arch)}\n`);
    await rm(outputDirectory, {recursive: true, force: true});
    await rename(pending, outputDirectory);
  } finally {
    await rm(pending, {recursive: true, force: true});
    await rm(staging, {recursive: true, force: true});
  }
  console.log(`iPhone signer ${runtimeStamp(platform, arch)} → ${path.relative(root, outputDirectory)}`);
  return outputDirectory;
}

async function main() {
  const output = cliOption(process.argv, "output");
  const zsignDirectory = cliOption(process.argv, "zsign-directory");
  await buildPhoneIosSigner({
    outputDirectory: output ? path.resolve(output) : undefined,
    zsignDirectory: zsignDirectory ? path.resolve(zsignDirectory) : undefined,
    force: process.argv.includes("--force"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
