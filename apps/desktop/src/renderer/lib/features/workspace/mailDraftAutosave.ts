import type {SendMailRequest, SendMailResult} from '@polymux/protocol';
import {
  clearMailDraft,
  loadMailDraft,
  saveMailDraft,
  type MailComposerDraft,
} from '../../shared/state/composerDrafts';
import {mailBodyWithSignature, mailHtmlWithSignature} from './mailSignatures';

type SaveDraft = (request: SendMailRequest) => Promise<SendMailResult>;

type AutosaveState = {
  account: string;
  latest: MailComposerDraft | null;
  remoteDraft: {id: string; folder: string} | null;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<{id: string; folder: string} | null> | null;
};

/**
 * Serialises mailbox draft saves per composer.
 *
 * A save appends a new IMAP message and then removes the version it replaces.
 * Serialising matters: two overlapping saves would both replace the same old
 * UID and leave one duplicate behind. While a request is in flight, newer
 * typing is collapsed into one latest snapshot and saved immediately after it.
 */
export class MailDraftAutosave {
  readonly #states = new Map<string, AutosaveState>();

  constructor(
    private readonly save: SaveDraft,
    private readonly delay = 800,
  ) {}

  update(draft: MailComposerDraft): void {
    saveMailDraft(draft);
    const state = this.#state(draft);
    state.latest = draft;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      // Local persistence already succeeded. A transient mailbox failure is
      // retried by the next edit or explicit save without becoming an
      // unhandled renderer rejection.
      void this.flush(draft.localId).catch(() => {});
    }, this.delay);
  }

  /** Rehydrates a composer whose latest text is already in the mailbox. */
  seed(draft: MailComposerDraft): void {
    this.#state(draft);
  }

  /** Saves everything typed so far and returns the mailbox draft now owning it. */
  async flush(localId: string): Promise<{id: string; folder: string} | null> {
    const state = this.#states.get(localId);
    if (!state) return null;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.running) return state.running;

    let failed = false;
    state.running = (async () => {
      while (state.latest) {
        const draft = state.latest;
        state.latest = null;
        let result: SendMailResult;
        try {
          result = await this.save({
            account: draft.account,
            to: addresses(draft.to),
            cc: addresses(draft.cc),
            bcc: addresses(draft.bcc),
            subject: draft.subject,
            body: mailBodyWithSignature(draft.body, draft.signatureBody),
            html: mailHtmlWithSignature(draft.body, draft.signatureHtml),
            draft: true,
            attachments: draft.files,
            importance: draft.importance,
            inReplyTo: draft.reply?.inReplyTo ?? undefined,
            references: draft.reply?.references,
            replacesDraft: state.remoteDraft,
          });
        } catch (cause) {
          failed = true;
          state.latest ??= draft;
          throw cause;
        }
        state.remoteDraft = result.draft ?? state.remoteDraft;

        // A newer keystroke may already have replaced this snapshot locally.
        // Give that newer copy the new UID without putting old text over it.
        const current = loadMailDraft(state.account);
        if (current?.localId === localId) {
          saveMailDraft({
            ...current,
            remoteDraft: state.remoteDraft,
            pending: current.revision === draft.revision ? false : current.pending,
          });
        }
      }
      return state.remoteDraft;
    })();

    try {
      return await state.running;
    } finally {
      state.running = null;
      // An update can arrive after the loop observes an empty queue but before
      // the promise settles. It still deserves a save rather than another
      // debounce interval.
      if (!failed && state.latest) void this.flush(localId).catch(() => {});
    }
  }

  /**
   * Stops a pending autosave before a real Send. An in-flight save is allowed
   * to finish so Send can delete the exact mailbox UID it produced.
   */
  async referenceForSend(localId: string): Promise<{id: string; folder: string} | null> {
    const state = this.#states.get(localId);
    if (!state) return null;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.latest = null;
    // A mailbox refusing its Drafts append must not prevent the user from
    // trying the real delivery. Send can still succeed through SMTP, and will
    // replace whichever earlier remote draft we do know about.
    if (state.running) await state.running.catch(() => null);
    return state.remoteDraft;
  }

  complete(localId: string, account: string): void {
    const state = this.#states.get(localId);
    if (state?.timer) clearTimeout(state.timer);
    this.#states.delete(localId);
    clearMailDraft(account, localId);
  }

  reference(localId: string): {id: string; folder: string} | null {
    return this.#states.get(localId)?.remoteDraft ?? null;
  }

  #state(draft: MailComposerDraft): AutosaveState {
    const existing = this.#states.get(draft.localId);
    if (existing) return existing;
    const created: AutosaveState = {
      account: draft.account,
      latest: null,
      remoteDraft: draft.remoteDraft,
      timer: null,
      running: null,
    };
    this.#states.set(draft.localId, created);
    return created;
  }
}

function addresses(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
