import assert from "node:assert/strict";
import test from "node:test";
import type {PhoneDeviceDto} from "@polymux/protocol";
import {
  iosDisconnectedMessage,
  linuxUsbMuxdAvailable,
  parseCoreDevices,
  parseDeviceHelperWireless,
  parseGoIosDevices,
  parseInfoPlistString,
  parseProvisioningProfile,
  parseSigningIdentities,
  pymobileXcuiTestArgs,
  screenshotDataUrl,
  selectPinnedIosDevice,
  selectSigningIdentity,
  usesCoreDeviceTransport,
  wdaSourceMetadataMatches,
  windowsAppleMobileDeviceServiceInstalled,
} from "./ios.js";

const firstPhone: PhoneDeviceDto = {
  platform: "ios" as const,
  id: "ios:first",
  udid: "first",
  name: "First iPhone",
  model: "iPhone",
  osVersion: "26.6",
  transport: "wireless" as const,
  pairingState: "paired" as const,
  developerMode: true,
  tunnelAddress: null,
};

test("pins control to the original iPhone until Stop", () => {
  const secondPhone = {...firstPhone, id: "ios:second", udid: "second", name: "Second iPhone"};
  assert.deepEqual(selectPinnedIosDevice([firstPhone, secondPhone], "first"), {
    device: firstPhone,
    activeMissing: false,
    ambiguous: false,
  });
  assert.deepEqual(selectPinnedIosDevice([secondPhone], "first"), {
    device: null,
    activeMissing: true,
    ambiguous: false,
  });
  assert.deepEqual(selectPinnedIosDevice([firstPhone, secondPhone], null), {
    device: null,
    activeMissing: false,
    ambiguous: true,
  });
});

test("explains the one-time host requirement without hiding the Android route", () => {
  assert.equal(windowsAppleMobileDeviceServiceInstalled(`
    SERVICE_NAME: Apple Mobile Device Service
    DISPLAY_NAME: Apple Mobile Device Service
  `), true);
  assert.equal(windowsAppleMobileDeviceServiceInstalled("The specified service does not exist."), false);
  assert.equal(linuxUsbMuxdAvailable((candidate) => candidate === "/run/usbmuxd"), true);
  assert.equal(linuxUsbMuxdAvailable(() => false), false);
  assert.match(iosDisconnectedMessage("missing-apple-devices"), /install Apple Devices once/i);
  assert.match(iosDisconnectedMessage("missing-usbmuxd"), /install usbmuxd once/i);
  assert.match(iosDisconnectedMessage("ready"), /connect and unlock/i);
});

test("labels WDA JPEG and PNG frames with their real media type", () => {
  assert.match(screenshotDataUrl(Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")), /^data:image\/jpeg;base64,/);
  assert.match(
    screenshotDataUrl(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")),
    /^data:image\/png;base64,/,
  );
  assert.throws(() => screenshotDataUrl(Buffer.from("not-an-image").toString("base64")), /unsupported screenshot format/i);
});

test("re-signs WDA when the bundled control build changes", () => {
  const current = JSON.stringify({
    release: "16.11.4",
    archiveSha256: "source",
    patchLevel: 1,
    bundleId: "com.flarehq.polymux.wda.xctrunner",
  });
  assert.equal(wdaSourceMetadataMatches(current, current), true);
  assert.equal(wdaSourceMetadataMatches(current, JSON.stringify({
    release: "16.11.4",
    archiveSha256: "source",
    patchLevel: 2,
    bundleId: "com.flarehq.polymux.wda.xctrunner",
  })), false);
  assert.equal(wdaSourceMetadataMatches("{}", "{}"), false);
  assert.equal(wdaSourceMetadataMatches("not-json", current), false);
});

test("groups go-ios USB and network routes as one physical iPhone", () => {
  const devices = parseGoIosDevices(JSON.stringify({deviceList: [
    {Udid: "phone-udid", ProductType: "iPhone17,1", ProductVersion: "26.6", ConnectionType: "USB"},
    {Udid: "phone-udid", ProductType: "iPhone17,1", ProductVersion: "26.6", ConnectionType: "Network"},
  ]}));
  assert.deepEqual(devices, [{
    udid: "phone-udid",
    productType: "iPhone17,1",
    productVersion: "26.6",
    transport: "wireless",
  }]);
});

test("keeps a running userspace tunnel discoverable after USB enumeration disappears", () => {
  const devices = parseGoIosDevices(JSON.stringify({deviceList: [
    {Udid: "phone-udid", ProductType: "", ProductVersion: "", ConnectionType: "userspaceTunnel"},
  ]}));
  assert.deepEqual(devices, [{
    udid: "phone-udid",
    productType: "",
    productVersion: "",
    transport: "wireless",
  }]);
});

test("discovers a paired iPhone through the cross-platform wireless helper", () => {
  assert.deepEqual(parseDeviceHelperWireless(JSON.stringify({devices: [{
    udid: "phone-udid",
    transport: "wireless",
  }]})), [{
    platform: "ios",
    id: "ios:phone-udid",
    udid: "phone-udid",
    name: "iPhone",
    model: "iPhone",
    osVersion: "",
    transport: "wireless",
    pairingState: "paired",
    developerMode: true,
    tunnelAddress: null,
  }]);
  assert.deepEqual(parseDeviceHelperWireless("not-json"), []);
});

test("keeps only connected physical iPhones and preserves transport state", () => {
  const devices = parseCoreDevices([
    {
      identifier: "core-1",
      connectionProperties: {pairingState: "paired", transportType: "wired", tunnelIPAddress: "fd00::1", tunnelState: "connected"},
      deviceProperties: {developerModeStatus: "enabled", name: "Owner’s iPhone", osVersionNumber: "26.6"},
      hardwareProperties: {marketingName: "iPhone 16 Pro", platform: "iOS", reality: "physical", udid: "phone-udid"},
    },
    {
      identifier: "simulator",
      connectionProperties: {tunnelState: "connected"},
      deviceProperties: {},
      hardwareProperties: {platform: "iOS", reality: "simulated", udid: "sim-udid"},
    },
    {
      identifier: "offline",
      connectionProperties: {tunnelState: "disconnected"},
      deviceProperties: {},
      hardwareProperties: {platform: "iOS", reality: "physical", udid: "offline-udid"},
    },
  ]);
  assert.deepEqual(devices, [{
    platform: "ios",
    id: "core-1",
    udid: "phone-udid",
    name: "Owner’s iPhone",
    model: "iPhone 16 Pro",
    osVersion: "26.6",
    transport: "wired",
    pairingState: "paired",
    developerMode: true,
    tunnelAddress: "fd00::1",
  }]);
});

test("keeps a reachable paired Wi-Fi iPhone before CoreDevice opens its tunnel", () => {
  const devices = parseCoreDevices([
    {
      capabilities: [{featureIdentifier: "com.apple.coredevice.feature.connectdevice"}],
      identifier: "core-wireless",
      connectionProperties: {
        pairingState: "paired",
        transportType: "localNetwork",
        tunnelState: "disconnected",
      },
      deviceProperties: {
        developerModeStatus: "enabled",
        name: "Owner’s iPhone",
        osVersionNumber: "26.6",
      },
      hardwareProperties: {
        marketingName: "iPhone 16 Pro",
        platform: "iOS",
        reality: "physical",
        udid: "phone-udid",
      },
    },
  ]);
  assert.deepEqual(devices, [{
    platform: "ios",
    id: "core-wireless",
    udid: "phone-udid",
    name: "Owner’s iPhone",
    model: "iPhone 16 Pro",
    osVersion: "26.6",
    transport: "wireless",
    pairingState: "paired",
    developerMode: true,
    tunnelAddress: null,
  }]);
});

test("keeps CoreDevice operations on the backend that discovered the iPhone", () => {
  assert.equal(usesCoreDeviceTransport("darwin", "core-device-identifier"), true);
  assert.equal(usesCoreDeviceTransport("darwin", "ios:phone-udid"), false);
  assert.equal(usesCoreDeviceTransport("win32", "core-device-identifier"), false);
});

test("selects the signing identity belonging to the profile team", () => {
  const identities = parseSigningIdentities(`
    1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Development: One (TEAMONE)"
    2) BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB "Apple Development: Two (TEAMTWO)"
       2 valid identities found
  `);
  assert.equal(selectSigningIdentity(identities, "OTHER", ["BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"])?.hash, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
  assert.equal(selectSigningIdentity(identities, "TEAMTWO", ["CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"]), null);
  assert.equal(selectSigningIdentity(identities, "TEAMTWO")?.hash, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
  assert.equal(selectSigningIdentity(identities, "MISSING"), null);
});

test("reads a provisioning profile without macOS signing tools", () => {
  const profile = parseProvisioningProfile(Buffer.from(`CMS-prefix\0<?xml version="1.0"?><plist><dict>
    <key>ExpirationDate</key><date>2027-01-02T03:04:05Z</date>
    <key>TeamIdentifier</key><array><string>TEAM&amp;ONE</string></array>
    <key>ProvisionedDevices</key><array><string>device-one</string><string>device-two</string></array>
    <key>DeveloperCertificates</key><array><data>AQID</data></array>
  </dict></plist>CMS-suffix`));
  assert.equal(profile.ExpirationDate, "2027-01-02T03:04:05Z");
  assert.deepEqual(profile.TeamIdentifier, ["TEAM&ONE"]);
  assert.deepEqual(profile.ProvisionedDevices, ["device-one", "device-two"]);
  assert.equal(profile.CertificateHashes?.[0]?.length, 40);
});

test("reads WDA bundle metadata without macOS PlistBuddy", () => {
  const info = `<?xml version="1.0"?><plist><dict>
    <key>CFBundleIdentifier</key><string>com.example.phone&amp;control</string>
    <key>CFBundleExecutable</key><string>PhoneRunner</string>
  </dict></plist>`;
  assert.equal(parseInfoPlistString(info, "CFBundleIdentifier"), "com.example.phone&control");
  assert.equal(parseInfoPlistString(info, "CFBundleExecutable"), "PhoneRunner");
  assert.throws(() => parseInfoPlistString(info, "Missing"), /has no Missing/i);
});

test("uses the no-Xcode XCUITest launcher on every desktop platform", () => {
  const wired = {udid: "phone-udid", transport: "wired" as const};
  assert.deepEqual(pymobileXcuiTestArgs("darwin", wired, "test.runner"), [
    "developer", "dvt", "xcuitest", "--native",
    "--udid", "phone-udid", "--env", "USE_PORT=8100", "test.runner",
  ]);
  assert.deepEqual(pymobileXcuiTestArgs("win32", {...wired, transport: "wireless"}, "test.runner"), [
    "developer", "dvt", "xcuitest", "--userspace", "--mobdev2",
    "--udid", "phone-udid", "--env", "USE_PORT=8100", "test.runner",
  ]);
});
