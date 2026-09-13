import test from 'node:test';
import assert from 'node:assert/strict';
import {sendMailRequest, terminalInput, terminalSessionId} from './requests';

test('terminal input accepts control bytes and skips empty writes', () => {
  assert.equal(terminalInput('ls'), 'ls');
  assert.equal(terminalInput('\r'), '\r');
  assert.equal(terminalInput('\n'), '\n');
  assert.equal(terminalInput('\x7f'), '\x7f');
  assert.equal(terminalInput('\x1b[A'), '\x1b[A');
  assert.equal(terminalInput(' '), ' ');
  assert.equal(terminalInput(''), undefined);
  assert.throws(() => terminalInput(null), /must be a string/);
  assert.throws(() => terminalInput(1), /must be a string/);
});

test('terminal session ids are kept verbatim and rejected when empty', () => {
  assert.equal(terminalSessionId('abc'), 'abc');
  assert.equal(terminalSessionId('  spaced  '), '  spaced  ');
  assert.throws(() => terminalSessionId(''), /terminal id must be a string/);
  assert.throws(() => terminalSessionId(null), /terminal id must be a string/);
});

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
    inlineAttachments: [],
    importance: 'normal',
    inReplyTo: undefined,
    references: [],
    replacesDraft: null,
  });
});

test('a real email still requires a recipient', () => {
  assert.throws(() => sendMailRequest({subject: 'Not a draft'}), /recipient/i);
});

test('an inline attachment must name an attached path and a safe unique content id', () => {
  assert.deepEqual(sendMailRequest({
    to: ['dana@example.com'],
    attachments: ['/tmp/report.pdf'],
    inlineAttachments: [{path: '/tmp/report.pdf', contentId: 'report@polymux.local'}],
  }).inlineAttachments, [{path: '/tmp/report.pdf', contentId: 'report@polymux.local'}]);
  assert.throws(() => sendMailRequest({
    to: ['dana@example.com'],
    attachments: [],
    inlineAttachments: [{path: '/tmp/report.pdf', contentId: 'report@polymux.local'}],
  }), /also be attached/i);
  assert.throws(() => sendMailRequest({
    to: ['dana@example.com'],
    attachments: ['/tmp/report.pdf'],
    inlineAttachments: [{path: '/tmp/report.pdf', contentId: 'bad\r\nid'}],
  }), /content id is invalid/i);
});
