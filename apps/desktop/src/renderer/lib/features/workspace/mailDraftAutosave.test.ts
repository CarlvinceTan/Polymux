import test from 'node:test';
import assert from 'node:assert/strict';
import type {SendMailRequest, SendMailResult} from '@polymux/protocol';
import {loadMailDraft, type MailComposerDraft} from '../../shared/state/composerDrafts';
import {MailDraftAutosave} from './mailDraftAutosave';

class MemoryStorage {
  readonly #values = new Map<string, string>();
  get length(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string): void { this.#values.delete(key); }
  setItem(key: string, value: string): void { this.#values.set(key, value); }
}

function draft(revision: number, body: string): MailComposerDraft {
  return {
    localId: 'compose-1',
    revision,
    pending: true,
    account: 'work',
    folder: 'INBOX',
    to: 'dana@example.com',
    cc: '',
    bcc: '',
    subject: 'Friday',
    body,
    signatureId: '',
    signatureBody: '',
    signatureHtml: null,
    files: [],
    importance: 'normal',
    reply: null,
    remoteDraft: null,
  };
}

function deferred<T>(): {promise: Promise<T>; resolve(value: T): void} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return {promise, resolve};
}

test('overlapping edits are serialised and replace one mailbox draft', async () => {
  Object.defineProperty(globalThis, 'localStorage', {value: new MemoryStorage(), configurable: true});
  const requests: SendMailRequest[] = [];
  const replies = [deferred<SendMailResult>(), deferred<SendMailResult>()];
  const autosave = new MailDraftAutosave(async (request) => {
    requests.push(request);
    return replies[requests.length - 1].promise;
  }, 60_000);

  autosave.update(draft(1, 'first'));
  const flushed = autosave.flush('compose-1');
  assert.equal(requests.length, 1);

  autosave.update(draft(2, 'second'));
  replies[0].resolve({draft: {id: '10', folder: '[Gmail]/Drafts'}});
  while (requests.length < 2) await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].replacesDraft, {id: '10', folder: '[Gmail]/Drafts'});

  replies[1].resolve({draft: {id: '11', folder: '[Gmail]/Drafts'}});
  assert.deepEqual(await flushed, {id: '11', folder: '[Gmail]/Drafts'});
  assert.equal(requests[1].body, 'second');
  assert.deepEqual(loadMailDraft('work'), {
    ...draft(2, 'second'),
    pending: false,
    remoteDraft: {id: '11', folder: '[Gmail]/Drafts'},
  });
  autosave.complete('compose-1', 'work');
});

test('autosaved drafts carry the selected signature without folding it into local text', async () => {
  Object.defineProperty(globalThis, 'localStorage', {value: new MemoryStorage(), configurable: true});
  const requests: SendMailRequest[] = [];
  const autosave = new MailDraftAutosave(async (request) => {
    requests.push(request);
    return {};
  }, 60_000);
  const signed = {
    ...draft(1, 'See you Friday.'),
    signatureId: 'usual',
    signatureBody: 'Best,\nCarlvince',
    signatureHtml: '<b>Best,</b><br>Carlvince',
  };
  autosave.update(signed);
  await autosave.flush(signed.localId);

  assert.equal(requests[0].body, 'See you Friday.\n\nBest,\nCarlvince');
  assert.equal(requests[0].html, '<div>See you Friday.</div><br><br><div data-polymux-signature="true"><b>Best,</b><br>Carlvince</div>');
  assert.equal(loadMailDraft('work')?.body, 'See you Friday.');
  assert.equal(loadMailDraft('work')?.signatureId, 'usual');
  autosave.complete(signed.localId, signed.account);
});

test('sending cancels a pending autosave and reuses the saved draft UID', async () => {
  Object.defineProperty(globalThis, 'localStorage', {value: new MemoryStorage(), configurable: true});
  let calls = 0;
  const autosave = new MailDraftAutosave(async () => {
    calls += 1;
    return {};
  }, 60_000);
  const restored = {...draft(1, 'ready'), pending: false, remoteDraft: {id: '7', folder: 'Drafts'}};
  autosave.seed(restored);
  autosave.update({...restored, revision: 2, pending: true, body: 'ready now'});

  assert.deepEqual(await autosave.referenceForSend('compose-1'), {id: '7', folder: 'Drafts'});
  assert.equal(calls, 0);
  autosave.complete('compose-1', 'work');
});
