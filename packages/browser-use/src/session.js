// A control session: one page, one set of refs, one observation buffer.
//
// The session is the only thing a surface has to build. Give it a transport
// and it carries everything the handler table needs, so the in-app Browser and
// the extension differ by their transport and nothing else.

import { pacer } from "./input.js";
import { PageObservers } from "./observers.js";

/**
 * @typedef {object} Transport
 * @property {(method: string, params?: object) => Promise<any>} send
 * @property {(domain: string) => Promise<void>} enableDomain
 * @property {(method: string, listener: (params: any) => void) => (() => void)} onEvent
 */

/**
 * @param {Transport & {
 *   moveCursor?: (point: {x: number, y: number}) => Promise<void>,
 *   observed?: () => boolean,
 * }} transport
 */
export function createSession(transport) {
  const session = {
    send: (method, params) => transport.send(method, params),
    /** ref -> backendNodeId, replaced wholesale by every snapshot. */
    refs: new Map(),
    observers: new PageObservers(transport),
    /** Last point the cursor was sent to, for the raw mouse commands. */
    cursor: null,
    paced: pacer("calm"),
    /**
     * Send the cursor to a point. Returns a promise that settles when it has
     * arrived — or sooner, if a later move supersedes it.
     *
     * This never rejects and is never required: presentation must not be the
     * reason an action fails or does not happen.
     */
    moveCursor(point) {
      session.cursor = point;
      if (!transport.moveCursor) return Promise.resolve();
      return Promise.resolve(transport.moveCursor(point)).catch(() => {});
    },

    /**
     * Whether a person is plausibly looking at this surface right now.
     *
     * This is what decides whether the cursor is allowed to hold an action up.
     * A surface that cannot tell says so by omitting it, and is treated as
     * watched — the safe default, because the cost of being wrong is a little
     * latency rather than a confusing screen.
     */
    observed: () => transport.observed?.() ?? true,
  };
  return session;
}

/** Start observing. Safe to call once per session, before the first command. */
export async function startSession(session) {
  await session.observers.start();
  return session;
}

export function stopSession(session) {
  session.observers.stop();
  session.refs.clear();
}
