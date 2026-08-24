import {readable} from 'svelte/store';

/**
 * URLs of pages the agent currently holds a control lease on, long-polled
 * from the Polymux agent-surface feed. The workspace tab strip uses this to
 * badge an in-app browser tab's favicon with the cursor glyph — the same
 * treatment the extension gives external tabs.
 *
 * The feed is loopback-only and read-only; when it is unreachable (browser
 * demo, port unavailable) the store settles on an empty set.
 */

// localStorage override keeps the feed reachable in dev/demo runs where the
// desktop app (or a test harness) hosts the surface on another port.
const PORT =
  (typeof localStorage !== 'undefined' && localStorage.getItem('polymuxSurfacePort')) || '47654';
const FEED = `http://127.0.0.1:${PORT}/v1/snapshot`;

interface FeedLease {
  kind: string;
  expiresAtMs: number;
  tab?: {url?: string};
}

function normalized(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

export const leasedUrls = readable<Set<string>>(new Set(), (set) => {
  let stopped = false;
  let revision = -1;

  async function poll(): Promise<void> {
    while (!stopped) {
      try {
        const query = revision >= 0 ? `?after=${revision}&waitMs=25000` : '';
        const response = await fetch(`${FEED}${query}`, {cache: 'no-store'});
        if (!response.ok) throw new Error(String(response.status));
        const snapshot = (await response.json()) as {revision?: number; leases?: FeedLease[]};
        if (stopped) return;
        revision = Number.isInteger(snapshot.revision) ? snapshot.revision! : revision;
        set(new Set(
          (snapshot.leases ?? [])
            .filter((lease) => lease.kind === 'tab' && lease.expiresAtMs > Date.now() && lease.tab?.url)
            .map((lease) => normalized(lease.tab!.url!))
            .filter(Boolean),
        ));
      } catch {
        if (stopped) return;
        set(new Set());
        revision = -1;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  void poll();
  return () => {
    stopped = true;
  };
});

export function isLeased(urls: Set<string>, url: string | undefined): boolean {
  if (!url) return false;
  return urls.has(normalized(url));
}
