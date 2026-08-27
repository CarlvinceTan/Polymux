import test from 'node:test';
import assert from 'node:assert/strict';
import {avatarInitial} from './avatarFallback';

test('derives an avatar initial from a contact name', () => {
  assert.equal(avatarInitial(' Jules Tan '), 'J');
  assert.equal(avatarInitial('💬 Élodie'), 'É');
  assert.equal(avatarInitial('陈伟'), '陈');
});

test('uses no initial for bare phone numbers or empty labels', () => {
  assert.equal(avatarInitial('+1 (226) 218-4662'), null);
  assert.equal(avatarInitial('31614121010'), null);
  assert.equal(avatarInitial('  '), null);
});
