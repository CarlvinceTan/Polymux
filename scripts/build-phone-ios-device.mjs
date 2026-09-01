#!/usr/bin/env node
/** Build the target-native GPL companion used for no-root iPhone tunnels. */

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

export const IOS_DEVICE_PROTOCOL_VERSION = 1;
export const PYMOBILEDEVICE3_RELEASE = "11.3.0";
export const PYMOBILEDEVICE3_SOURCE =
  "https://files.pythonhosted.org/packages/aa/cf/3d7b4a6a294f84124bfd09ac54d39d31d2827d03ca59f2eda1c37e613948/pymobiledevice3-11.3.0.tar.gz";
export const PYMOBILEDEVICE3_SOURCE_SHA256 =
  "6daf19011465cbdeff5b395d32a84925bcc5c910460816ac792fff79d2b436fc";
export const IOS_DEVICE_SOURCE_ARCHIVES = [
  {
    name: "developer-disk-image",
    version: "0.3.0",
    licenseSignal: "GPL-3.0-or-later classifier",
    fileName: "developer_disk_image-0.3.0.tar.gz",
    sha256: "1fb9841dcc5cf81e697b6e0a9c14909c059c1893d675b38398a91c08cb7ba8bc",
    url: "https://files.pythonhosted.org/packages/52/f5/16c742e98191761d0925ed424468e3bec14503644c84851046602667d3c3/developer_disk_image-0.3.0.tar.gz",
  },
  {
    name: "ipsw-parser",
    version: "1.7.5",
    licenseSignal: "GPL-3.0-or-later classifier",
    fileName: "ipsw_parser-1.7.5.tar.gz",
    sha256: "e49682388731cc9c2a275bf0d2b35746d7619bd352e4a46189efb2f50acc3e1f",
    url: "https://files.pythonhosted.org/packages/ab/ca/40960ace6e13f05101e05ad9695c54969d4943588930c27dca153db56d82/ipsw_parser-1.7.5.tar.gz",
  },
  {
    name: "opack2",
    version: "0.0.1",
    licenseSignal: "GPL-3.0-or-later classifier",
    fileName: "opack2-0.0.1.tar.gz",
    sha256: "0deb0b5d7094253f631db201f3493094a5821404f736ab0234ba805ee93d57b2",
    url: "https://files.pythonhosted.org/packages/b3/ac/8e7d6698282a2130c99fab2fffa3cb1910688ffee16ec36e3d1f71375adf/opack2-0.0.1.tar.gz",
  },
  {
    name: "parameter-decorators",
    version: "0.0.2",
    licenseSignal: "GPL-3.0 license text",
    fileName: "parameter_decorators-0.0.2.tar.gz",
    sha256: "499ec96e71394705be9e3eeb28542aab4875694042516c31051d5dcb0488028e",
    url: "https://files.pythonhosted.org/packages/40/b9/03b5e409930cb4cff0f25f6f3199145f4319a88d5f9be7ee17882359f72d/parameter_decorators-0.0.2.tar.gz",
  },
  {
    name: "pmd-net-addr",
    version: "0.0.3",
    licenseSignal: "GPL-3.0-or-later expression",
    fileName: "pmd_net_addr-0.0.3.tar.gz",
    sha256: "1b0fcb3b77f30076237360eb4cf0243483278a2650fd4a194985cc69b1de07e5",
    url: "https://files.pythonhosted.org/packages/ce/bb/e24ffb9af4243050b54fbaf08393879456f1bd98996b66c6df509106ad2b/pmd_net_addr-0.0.3.tar.gz",
  },
  {
    name: "pmd-net-proto",
    version: "0.0.3",
    licenseSignal: "GPL-3.0-or-later expression",
    fileName: "pmd_net_proto-0.0.3.tar.gz",
    sha256: "e23d7d68cd13399ff2bf0613f9756e221ead6fd54010cf85186c2ab650631cd7",
    url: "https://files.pythonhosted.org/packages/59/ec/eed1b9570cec3e30b993dee84fa5d16be3399189ffce8c0b46373727d20e/pmd_net_proto-0.0.3.tar.gz",
  },
  {
    name: "pmd-pytcp",
    version: "0.3.7",
    licenseSignal: "GPL-3.0-or-later expression",
    fileName: "pmd_pytcp-0.3.7.tar.gz",
    sha256: "8861c091f3fae56f89d10136e2cbcfcb108eaf529d09ab9b9894a2910948b138",
    url: "https://files.pythonhosted.org/packages/84/fb/0acdc66ee6800f83a3972fecbf09520663f8095eb7417ed9949e6949421b/pmd_pytcp-0.3.7.tar.gz",
  },
  {
    name: "pycrashreport",
    version: "2.0.0",
    licenseSignal: "GPL-3.0-or-later classifier",
    fileName: "pycrashreport-2.0.0.tar.gz",
    sha256: "31d5e32faa3a047fe01e923bde3eaf1ec86b23e264babf2fc8f7b61fe4812342",
    url: "https://files.pythonhosted.org/packages/aa/9c/1e1c2d84f746972cbe4d5e65f816008c64e427fc680f55115aa313683c23/pycrashreport-2.0.0.tar.gz",
  },
  {
    name: "pygnuutils",
    version: "0.1.1",
    licenseSignal: "GPL-3.0-or-later classifier",
    fileName: "pygnuutils-0.1.1.tar.gz",
    sha256: "51ab4f27deb59102b7a04192f7585ff2b3a9de03739982f0b19d3cd4d16bea76",
    url: "https://files.pythonhosted.org/packages/03/20/6a828fe03d6586241b824ee06c7da854ea351716006a62fd2548eaa5710b/pygnuutils-0.1.1.tar.gz",
  },
  {
    name: "pyiosbackup",
    version: "0.2.4",
    licenseSignal: "GPL-3.0-or-later classifier",
    fileName: "pyiosbackup-0.2.4.tar.gz",
    sha256: "10b4d2a11c9bedc93a5467cad3addbe18bc2dc434156920e7223226ed4d0beb7",
    url: "https://files.pythonhosted.org/packages/46/ab/c7c3caf6785ced43d02c8c37be3c84720c40d6a9b237eb2ff560af4114e1/pyiosbackup-0.2.4.tar.gz",
  },
  {
    name: "pylzss",
    version: "0.3.4",
    licenseSignal: "LGPL-3.0 classifier",
    fileName: "pylzss-0.3.4.tar.gz",
    sha256: "16818631742488e53a34fda0d402d80edb2b812e11877801e21a9e5ce9b9db1c",
    url: "https://files.pythonhosted.org/packages/7d/dc/9ae75ede398b7adf538f2d1dca0f96c645c4e96789f8039340a0ed6a8a8f/pylzss-0.3.4.tar.gz",
  },
  {
    name: "pymobiledevice3",
    version: PYMOBILEDEVICE3_RELEASE,
    licenseSignal: "GPL-3.0-or-later expression",
    fileName: `pymobiledevice3-${PYMOBILEDEVICE3_RELEASE}.tar.gz`,
    sha256: PYMOBILEDEVICE3_SOURCE_SHA256,
    url: PYMOBILEDEVICE3_SOURCE,
  },
  {
    name: "pytun-pmd3",
    version: "3.0.3",
    licenseSignal: "MIT license text with conflicting GPL classifier; included conservatively",
    fileName: "pytun_pmd3-3.0.3.tar.gz",
    sha256: "7fa822092139b4b77e08fad9233dbd4a6fcca2cf2423b0775db962ca5e87a017",
    url: "https://files.pythonhosted.org/packages/5e/8a/6e73c70ddf5fdf9cf359cdc458f38cf795c4a653c870a4a49c8768e5db86/pytun_pmd3-3.0.3.tar.gz",
  },
  {
    name: "remotezip2",
    version: "0.0.2",
    licenseSignal: "GPL-3.0 license text with conflicting MIT classifier; included conservatively",
    fileName: "remotezip2-0.0.2.tar.gz",
    sha256: "db38fb14d0c297af6da8756808bb25f9d3b2c23c7639a14f7a74794b2fc9a261",
    url: "https://files.pythonhosted.org/packages/3f/47/94335875a4d5339f64943c1a68900f59a91ad987ab8fcd8e5201839e7cc5/remotezip2-0.0.2.tar.gz",
  },
];
export const IOS_DEVICE_PYTHON_RELEASE = "3.13.15+20260825";
const IOS_DEVICE_PYTHON_TAG = "20260825";
const PYTHON_LICENSE =
  `https://raw.githubusercontent.com/astral-sh/python-build-standalone/${IOS_DEVICE_PYTHON_TAG}/LICENSE`;
const PYTHON_LICENSE_SHA256 = "1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5";
const PYTHON_ASSET_PREFIX =
  `https://github.com/astral-sh/python-build-standalone/releases/download/${IOS_DEVICE_PYTHON_TAG}`;
const BUILD_REQUIREMENTS =
  "setuptools==84.0.0 --hash=sha256:51a52592b3b99e102b609654876bd65f19f999935166d1352678931132b0c670\n";

export const IOS_DEVICE_TARGETS = {
  "darwin-arm64": {
    lock: "phone-ios-device-darwin-arm64.lock",
    pythonArchive: `cpython-${IOS_DEVICE_PYTHON_RELEASE}-aarch64-apple-darwin-install_only_stripped.tar.gz`,
    pythonSha256: "149038dd0c194c25d4616d7e42a35f67f2edee96412788f74115819b6a4c8548",
    pythonExecutable: "python/bin/python3",
    pythonSitePackages: "python/lib/python3.13/site-packages",
  },
  "win32-x64": {
    lock: "phone-ios-device-win32-x64.lock",
    pythonArchive: `cpython-${IOS_DEVICE_PYTHON_RELEASE}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`,
    pythonSha256: "c1dc1e267f2a81493ce6e94837263f648f1eb6d0df73a1492469c1fed025ce8f",
    pythonExecutable: "python/python.exe",
    pythonSitePackages: "python/Lib/site-packages",
  },
  "linux-x64": {
    lock: "phone-ios-device-linux-x64.lock",
    pythonArchive: `cpython-${IOS_DEVICE_PYTHON_RELEASE}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz`,
    pythonSha256: "8af9a8214c71b2dd698005e39fab87aad02a994330508857da4e6d1ba7e6ddb6",
    pythonExecutable: "python/bin/python3",
    pythonSitePackages: "python/lib/python3.13/site-packages",
  },
};

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function iosDeviceTarget(platform, arch) {
  const target = IOS_DEVICE_TARGETS[`${platform}-${arch}`];
  if (!target) throw new Error(`No bundled iPhone device runtime for ${platform}-${arch}`);
  return target;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runtimeStamp(platform, arch) {
  return `${PYMOBILEDEVICE3_RELEASE}-python-${IOS_DEVICE_PYTHON_RELEASE}-protocol-${IOS_DEVICE_PROTOCOL_VERSION}-${platform}-${arch}`;
}

function sourceArchivesDigest() {
  return digest(Buffer.from(JSON.stringify(IOS_DEVICE_SOURCE_ARCHIVES)));
}

async function ready(outputDirectory, platform, arch, target, helperBytes, lockBytes) {
  try {
    const [stamp, manifest] = await Promise.all([
      readFile(path.join(outputDirectory, "VERSION"), "utf8"),
      readFile(path.join(outputDirectory, "MANIFEST.json"), "utf8").then(JSON.parse),
    ]);
    if (
      stamp.trim() !== runtimeStamp(platform, arch) ||
      manifest.protocolVersion !== IOS_DEVICE_PROTOCOL_VERSION ||
      manifest.pymobiledevice3Release !== PYMOBILEDEVICE3_RELEASE ||
      manifest.pythonRelease !== IOS_DEVICE_PYTHON_RELEASE ||
      manifest.pythonSha256 !== target.pythonSha256 ||
      manifest.helperSha256 !== digest(helperBytes) ||
      manifest.requirementsSha256 !== digest(lockBytes) ||
      manifest.sourceSha256 !== PYMOBILEDEVICE3_SOURCE_SHA256 ||
      manifest.sourceArchivesSha256 !== sourceArchivesDigest()
    ) return false;
    await Promise.all([
      stat(path.join(outputDirectory, "helper.py")),
      stat(path.join(outputDirectory, target.pythonExecutable)),
      stat(path.join(outputDirectory, "site-packages", "pymobiledevice3")),
      stat(path.join(outputDirectory, "LICENSE.pymobiledevice3.txt")),
      stat(path.join(outputDirectory, "LICENSE.phone-ios-device-helper.txt")),
      stat(path.join(outputDirectory, "LICENSE.python-standalone.txt")),
      stat(path.join(outputDirectory, "SOURCE_ARCHIVES.json")),
      ...IOS_DEVICE_SOURCE_ARCHIVES.map((source) =>
        stat(path.join(outputDirectory, "sources", source.fileName))),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function removePip(runtime, target) {
  const sitePackages = path.join(runtime, target.pythonSitePackages);
  for (const entry of await readdir(sitePackages).catch(() => [])) {
    if (entry === "pip" || /^pip-.*\.dist-info$/u.test(entry) ||
        entry === "setuptools" || /^setuptools-.*\.dist-info$/u.test(entry))
      await rm(path.join(sitePackages, entry), {recursive: true, force: true});
  }
  const bin = path.join(runtime, "python", process.platform === "win32" ? "Scripts" : "bin");
  for (const entry of await readdir(bin).catch(() => [])) {
    if (/^pip(?:3(?:\.12)?)?(?:\.exe)?$/u.test(entry))
      await rm(path.join(bin, entry), {force: true});
  }
}

function smoke(python, outputDirectory) {
  const helper = path.join(outputDirectory, "helper.py");
  const response = execFileSync(python, [helper, "ping"], {encoding: "utf8"}).trim();
  const parsed = JSON.parse(response);
  if (!parsed.ready || parsed.protocolVersion !== IOS_DEVICE_PROTOCOL_VERSION)
    throw new Error("The bundled iPhone device helper failed its protocol smoke test.");
  execFileSync(python, ["-c", [
    "from pymobiledevice3.remote.native_tunnel import NativeRemotedTunnel",
    "from pymobiledevice3.remote.userspace_tunnel import UserspaceRsdTunnel",
    "from pymobiledevice3.services.dvt.testmanaged.xcuitest import XCUITestService",
  ].join("; ")], {
    stdio: "inherit",
    env: {
      ...process.env,
      PYTHONPATH: path.join(outputDirectory, "site-packages"),
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONUTF8: "1",
    },
  });
}

export async function buildPhoneIosDevice(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== process.platform || arch !== process.arch)
    throw new Error(`The ${platform}-${arch} iPhone device runtime must be assembled on that target.`);
  const target = iosDeviceTarget(platform, arch);
  const outputDirectory = options.outputDirectory ?? path.join(root, "resources", "phone", "ios", "device");
  const helperBytes = await readFile(path.join(root, "scripts", "phone-ios-device-helper.py"));
  const lockBytes = await readFile(path.join(root, "scripts", target.lock));
  if (!options.force && await ready(outputDirectory, platform, arch, target, helperBytes, lockBytes)) {
    console.log(`iPhone device helper ${runtimeStamp(platform, arch)} already present, skipping`);
    return outputDirectory;
  }

  const [sourceArchives, pythonBytes, pythonLicense] = await Promise.all([
    Promise.all(IOS_DEVICE_SOURCE_ARCHIVES.map(async (source) => ({
      source,
      bytes: await fetchBytes(source.url),
    }))),
    fetchBytes(`${PYTHON_ASSET_PREFIX}/${encodeURIComponent(target.pythonArchive)}`),
    fetchBytes(PYTHON_LICENSE),
  ]);
  for (const {source, bytes} of sourceArchives) {
    if (digest(bytes) !== source.sha256)
      throw new Error(`${source.name} source sha256 mismatch`);
  }
  if (digest(pythonBytes) !== target.pythonSha256)
    throw new Error("iPhone device Python sha256 mismatch");
  if (digest(pythonLicense) !== PYTHON_LICENSE_SHA256)
    throw new Error("python-build-standalone license sha256 mismatch");

  const staging = await mkdtemp(path.join(tmpdir(), "polymux-phone-ios-device-"));
  const pending = path.join(path.dirname(outputDirectory), `.${path.basename(outputDirectory)}.pending-${process.pid}`);
  try {
    await rm(pending, {recursive: true, force: true});
    await mkdir(path.join(pending, "site-packages"), {recursive: true});
    const requirements = path.join(staging, "requirements.lock");
    const buildRequirements = path.join(staging, "build-requirements.lock");
    const pythonArchive = path.join(staging, target.pythonArchive);
    await Promise.all([
      writeFile(requirements, lockBytes),
      writeFile(buildRequirements, BUILD_REQUIREMENTS),
      writeFile(pythonArchive, pythonBytes),
    ]);
    execFileSync("tar", ["-xzf", pythonArchive, "-C", pending], {stdio: "inherit"});
    const python = path.join(pending, target.pythonExecutable);

    // Restore the standalone distribution's bundled installer only while
    // assembling dependencies, then remove it from the shipped runtime.
    execFileSync(python, ["-m", "ensurepip", "--upgrade", "--default-pip"], {stdio: "inherit"});
    execFileSync(python, [
      "-m", "pip", "install",
      "--disable-pip-version-check",
      "--no-cache-dir",
      "--only-binary=:all:",
      "--no-deps",
      "--require-hashes",
      "-r", buildRequirements,
    ], {stdio: "inherit"});
    execFileSync(python, [
      "-m", "pip", "install",
      "--disable-pip-version-check",
      "--no-cache-dir",
      "--no-compile",
      "--no-warn-script-location",
      "--no-build-isolation",
      "--require-hashes",
      "--ignore-installed",
      "--target", path.join(pending, "site-packages"),
      "-r", requirements,
    ], {stdio: "inherit"});
    await removePip(pending, target);

    await copyFile(path.join(root, "scripts", "phone-ios-device-helper.py"), path.join(pending, "helper.py"));
    await chmod(path.join(pending, "helper.py"), 0o755);
    await mkdir(path.join(pending, "sources"), {recursive: true});
    await Promise.all(sourceArchives.map(({source, bytes}) =>
      writeFile(path.join(pending, "sources", source.fileName), bytes)));
    await writeFile(path.join(pending, "SOURCE_ARCHIVES.json"), `${JSON.stringify({
      purpose: "Exact source distributions for bundled GPL, LGPL, or conservatively included dependencies",
      generatedFrom: "Pinned PyPI release metadata",
      archives: IOS_DEVICE_SOURCE_ARCHIVES.map((source) => ({
        name: source.name,
        version: source.version,
        licenseSignal: source.licenseSignal,
        file: `sources/${source.fileName}`,
        source: source.url,
        sha256: source.sha256,
      })),
    }, null, 2)}\n`);
    const licenseCandidates = [
      path.join(pending, "site-packages", `pymobiledevice3-${PYMOBILEDEVICE3_RELEASE}.dist-info`, "licenses", "LICENSE"),
      path.join(pending, "site-packages", `pymobiledevice3-${PYMOBILEDEVICE3_RELEASE}.dist-info`, "LICENSE"),
    ];
    const license = await Promise.any(licenseCandidates.map(async (candidate) => {
      const bytes = await readFile(candidate);
      return bytes;
    })).catch(() => {
      throw new Error("The pymobiledevice3 wheel did not include its GPL license.");
    });
    await writeFile(path.join(pending, "LICENSE.pymobiledevice3.txt"), license);
    await writeFile(path.join(pending, "LICENSE.phone-ios-device-helper.txt"), license);
    await writeFile(path.join(pending, "LICENSE.python-standalone.txt"), pythonLicense);
    await rm(path.join(pending, "bin"), {recursive: true, force: true});
    for (const entry of await readdir(path.join(pending, "site-packages"))) {
      if (entry === "__pycache__") await rm(path.join(pending, "site-packages", entry), {recursive: true, force: true});
    }

    smoke(python, pending);
    await writeFile(path.join(pending, "MANIFEST.json"), `${JSON.stringify({
      protocolVersion: IOS_DEVICE_PROTOCOL_VERSION,
      platform,
      arch,
      pymobiledevice3Release: PYMOBILEDEVICE3_RELEASE,
      pythonRelease: IOS_DEVICE_PYTHON_RELEASE,
      pythonSha256: target.pythonSha256,
      source: PYMOBILEDEVICE3_SOURCE,
      sourceSha256: PYMOBILEDEVICE3_SOURCE_SHA256,
      sourceIncluded: `sources/pymobiledevice3-${PYMOBILEDEVICE3_RELEASE}.tar.gz`,
      sourceArchives: "SOURCE_ARCHIVES.json",
      sourceArchivesSha256: sourceArchivesDigest(),
      helperSha256: digest(helperBytes),
      requirements: target.lock,
      requirementsSha256: digest(lockBytes),
      license: "GPL-3.0-or-later",
      boundary: "separate-companion-process",
    }, null, 2)}\n`);
    await writeFile(path.join(pending, "VERSION"), `${runtimeStamp(platform, arch)}\n`);
    await rm(outputDirectory, {recursive: true, force: true});
    await rename(pending, outputDirectory);
  } finally {
    await rm(pending, {recursive: true, force: true});
    await rm(staging, {recursive: true, force: true});
  }
  console.log(`iPhone device helper ${runtimeStamp(platform, arch)} → ${path.relative(root, outputDirectory)}`);
  return outputDirectory;
}

async function main() {
  const output = process.argv.find((flag) => flag.startsWith("--output="))?.slice(9);
  await buildPhoneIosDevice({
    outputDirectory: output ? path.resolve(output) : undefined,
    force: process.argv.includes("--force"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
