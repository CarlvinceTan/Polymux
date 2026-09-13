import assert from 'node:assert/strict';
import test from 'node:test';
import {mailBodyWithSignature, mailHtmlWithSignature} from './mailSignatures';

test('appends a signature without rewriting authored text', () => {
  assert.equal(
    mailBodyWithSignature('Hello Dana,\n\nFriday works.  ', 'Kind regards,\nCarlvince'),
    'Hello Dana,\n\nFriday works.\n\nKind regards,\nCarlvince',
  );
});

test('a signature can be the whole body and no signature leaves the body alone', () => {
  assert.equal(mailBodyWithSignature('', 'Thanks,\nCarlvince'), 'Thanks,\nCarlvince');
  assert.equal(mailBodyWithSignature('Exact body  ', ''), 'Exact body  ');
});

test('formatted signatures become an HTML alternative without treating authored text as markup', () => {
  assert.equal(
    mailHtmlWithSignature('Hello <Dana>\nFriday works.', '<b>Kind regards,</b><br>Carlvince'),
    '<div>Hello &lt;Dana&gt;<br>Friday works.</div><br><br><div data-polymux-signature="true"><b>Kind regards,</b><br>Carlvince</div>',
  );
  assert.equal(mailHtmlWithSignature('Plain only', null), undefined);
});

test('positioned files become CID links at their authored body offsets', () => {
  assert.equal(
    mailHtmlWithSignature('Before\nAfter', null, [{
      name: 'Q3 <report>.pdf',
      contentId: 'q3-report@polymux.local',
      offset: 7,
    }]),
    '<div>Before<br><div><a href="cid:q3-report@polymux.local">Q3 &lt;report&gt;.pdf</a></div>After</div>',
  );
});
