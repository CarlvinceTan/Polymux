/** Provider OAuth pages must open as real web pages. Anything else — a file,
 * a javascript: URL, a custom scheme — is not a sign-in the system browser
 * should be asked to load. */
export function requireWebConsentUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The sign-in address is not a web page.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error("The sign-in address is not a web page.");
  return parsed.href;
}

/** The small Polymux sheet that stays behind the system browser so closing it
 * still cancels. The provider page itself is no longer loaded here. */
export function consentWaitingHtml(dark: boolean): string {
  const background = dark ? "#171717" : "#ffffff";
  const color = dark ? "#f5f5f5" : "#171717";
  return `<!doctype html><meta charset="utf-8"><title>Polymux</title><body style="font:15px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:${background};color:${color}"><p>Finish in your browser.</p></body>`;
}
