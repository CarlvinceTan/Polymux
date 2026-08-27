import test from 'node:test';
import assert from 'node:assert/strict';
import {sendMailRequest} from './requests';

test('a mailbox draft may be saved before a recipient is entered', () => {
  assert.deepEqual(sendMailRequest({draft: true, subject: 'Unfinished', body: 'Still writing'}), {
    account: undefined,
    to: [],
    cc: [],
    bcc: [],
    subject: 'Unfinished',
    body: 'Still writing',
    html: undefined,
    draft: true,
    attachments: [],
    importance: 'normal',
    inReplyTo: undefined,
    references: [],
    replacesDraft: null,
  });
});

test('a real email still requires a recipient', () => {
  assert.throws(() => sendMailRequest({subject: 'Not a draft'}), /recipient/i);
});
