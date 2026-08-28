// Compatibility contract between the desktop agent-surface server and the
// independently shipped Chrome extension. Product versions deliberately do
// not appear here: only a change to this contract can couple their releases.

const extensionCapabilities = Object.freeze([
  "surface-commands-v1",
  "tab-snapshots-v1",
]);
const desktopCapabilities = Object.freeze(["surface-feed-v1"]);

export const SURFACE_PROTOCOL = Object.freeze({
  desktop: Object.freeze({
    minVersion: 1,
    maxVersion: 1,
    capabilities: desktopCapabilities,
    requiredExtensionCapabilities: Object.freeze(["surface-commands-v1"]),
  }),
  extension: Object.freeze({
    minVersion: 1,
    maxVersion: 1,
    capabilities: extensionCapabilities,
    requiredDesktopCapabilities: Object.freeze(["surface-feed-v1"]),
  }),
  // Extension 0.2.1 predates negotiation but already speaks protocol 1. This
  // fallback keeps it compatible while newer packages begin reporting their
  // contract explicitly.
  legacyExtension: Object.freeze({
    minVersion: 1,
    maxVersion: 1,
    capabilities: extensionCapabilities,
  }),
  // Raise this attested floor only when the desktop starts requiring a
  // protocol/capability absent from the previously published extension. CI
  // proves the floor satisfies the desktop, then the release gate proves its
  // package version is live in the Chrome Web Store.
  minimumPublishedExtension: Object.freeze({
    version: "0.2.1",
    minVersion: 1,
    maxVersion: 1,
    capabilities: extensionCapabilities,
  }),
});

export const SURFACE_PROTOCOL_HEADERS = Object.freeze({
  extensionVersion: "X-Polymux-Extension-Version",
  minVersion: "X-Polymux-Surface-Protocol-Min",
  maxVersion: "X-Polymux-Surface-Protocol-Max",
  capabilities: "X-Polymux-Surface-Capabilities",
});

/** Headers attached to every extension request to the desktop surface. */
export function extensionProtocolHeaders(extensionVersion) {
  return {
    [SURFACE_PROTOCOL_HEADERS.extensionVersion]: extensionVersion,
    [SURFACE_PROTOCOL_HEADERS.minVersion]: String(
      SURFACE_PROTOCOL.extension.minVersion,
    ),
    [SURFACE_PROTOCOL_HEADERS.maxVersion]: String(
      SURFACE_PROTOCOL.extension.maxVersion,
    ),
    [SURFACE_PROTOCOL_HEADERS.capabilities]:
      SURFACE_PROTOCOL.extension.capabilities.join(","),
  };
}

/**
 * Highest mutually supported protocol plus any missing desktop requirement.
 * @param {{minVersion: number, maxVersion: number, capabilities: readonly string[]}} extension
 * @param {{minVersion: number, maxVersion: number, capabilities: readonly string[], requiredExtensionCapabilities: readonly string[]}} desktop
 */
export function negotiateSurfaceProtocol(
  extension,
  desktop = SURFACE_PROTOCOL.desktop,
) {
  const minimum = Math.max(desktop.minVersion, extension.minVersion);
  const maximum = Math.min(desktop.maxVersion, extension.maxVersion);
  const negotiatedVersion = minimum <= maximum ? maximum : null;
  const capabilities = new Set(extension.capabilities ?? []);
  const missingCapabilities = desktop.requiredExtensionCapabilities.filter(
    (capability) => !capabilities.has(capability),
  );
  const compatible = negotiatedVersion !== null && missingCapabilities.length === 0;
  let reason = null;
  if (negotiatedVersion === null) {
    reason = `Extension protocols ${extension.minVersion}-${extension.maxVersion} do not overlap desktop protocols ${desktop.minVersion}-${desktop.maxVersion}.`;
  } else if (missingCapabilities.length > 0) {
    reason = `Extension is missing required capabilities: ${missingCapabilities.join(", ")}.`;
  }
  return {compatible, negotiatedVersion, missingCapabilities, reason};
}

/** Whether a negotiated desktop response satisfies the extension itself. */
export function desktopSupportsExtension(surface) {
  if (!surface) return true; // A pre-negotiation desktop speaks protocol 1.
  if (surface.compatible !== true || !Number.isInteger(surface.negotiatedVersion))
    return false;
  const capabilities = new Set(surface.capabilities ?? []);
  return SURFACE_PROTOCOL.extension.requiredDesktopCapabilities.every(
    (capability) => capabilities.has(capability),
  );
}
