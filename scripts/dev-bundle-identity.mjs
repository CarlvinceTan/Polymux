import { createHash } from "node:crypto";

export const DEV_BUNDLE_ID = "com.flarehq.polymux.dev";

/**
 * A content-addressed icon filename prevents Launch Services and the Dock from
 * reusing a thumbnail cached for an older development icon.
 */
export function devIconResourceName(bytes) {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  return `polymux-${digest}.icns`;
}
