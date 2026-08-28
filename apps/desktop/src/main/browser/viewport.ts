export type BrowserViewportMode = "desktop" | "mobile";

export type BrowserViewportSize = {
  width: number;
  height: number;
};

/** Enter mobile mode once the page is genuinely phone-sized. A little
 * hysteresis keeps a drawer resting on the boundary from reloading the page
 * back and forth while its resize animation settles. */
const MOBILE_ENTER_WIDTH = 640;
const MOBILE_EXIT_WIDTH = 680;

export function browserViewportMode(
  viewport: BrowserViewportSize,
  previous: BrowserViewportMode = "desktop",
): BrowserViewportMode {
  const width = Math.max(0, Math.round(viewport.width));
  const height = Math.max(0, Math.round(viewport.height));
  if (!width || !height) return previous;
  if (height <= width) return "desktop";
  const maximum = previous === "mobile" ? MOBILE_EXIT_WIDTH : MOBILE_ENTER_WIDTH;
  return width <= maximum ? "mobile" : "desktop";
}

export function mobileBrowserUserAgent(chromeVersion: string): string {
  return [
    "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
    "AppleWebKit/537.36 (KHTML, like Gecko)",
    `Chrome/${chromeVersion}`,
    "Mobile Safari/537.36",
  ].join(" ");
}
