/**
 * The workspace browser is a native WebContentsView. The compositor draws it
 * above every renderer element, so CSS stacking cannot put a dialog over the
 * page. Window-modal surfaces declare `aria-modal`; that is the signal to hide
 * the view until they close.
 *
 * Hide is not enough on its own: `backdrop-filter` can only blur renderer
 * pixels, so the page's last frame has to be copied into the DOM first.
 */
export const EMBEDDED_BROWSER_OVERLAY_SELECTOR = '[aria-modal="true"]';

type YieldHandler = () => Promise<void>;

const yieldHandlers = new Set<YieldHandler>();

export function overlayObscuresEmbeddedBrowser(root: ParentNode = document): boolean {
  return Boolean(root.querySelector(EMBEDDED_BROWSER_OVERLAY_SELECTOR));
}

export function watchEmbeddedBrowserOverlays(onChange: (obscured: boolean) => void): () => void {
  const sync = (): void => {
    onChange(overlayObscuresEmbeddedBrowser());
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-modal'],
  });
  sync();
  return () => observer.disconnect();
}

/** Lets an open browser tab freeze its last frame and step aside before a
 * window-modal paints, so the dialog's backdrop still shows the page. */
export function onEmbeddedBrowserYield(handler: YieldHandler): () => void {
  yieldHandlers.add(handler);
  return () => {
    yieldHandlers.delete(handler);
  };
}

export async function yieldEmbeddedBrowsers(): Promise<void> {
  if (!yieldHandlers.size) return;
  await Promise.all([...yieldHandlers].map((handler) => handler()));
}
