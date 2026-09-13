import test from 'node:test';
import assert from 'node:assert/strict';
import {exposedMcpToolName, type AgentTool} from '@polymux/tools';
import {financeReadRequest, parseAccounts, parseTransactions, readBank} from './bank.js';

const account = {uid: 'account-1', label: 'Everyday', bank: 'Example bank', currency: 'EUR', booked: 120, iban: 'secret-account-number'};
function tool(name: string, value: unknown, calls: unknown[], isError = false): AgentTool {
  return {name: exposedMcpToolName('bank', name), description: '', parameters: {}, execute: async input => {calls.push(input);return {content: [{type: 'text', text: JSON.stringify(value)}], isError};}};
}
test('account output removes full account identifiers and preserves unavailable balance', () => {
  const [a] = parseAccounts([account]);
  assert.equal(a.booked, 120); assert.equal(a.available, null);
  assert.equal('iban' in a, false);
  assert.equal(parseAccounts([{...account, booked: undefined}])[0].booked, null);
});
test('rejects malformed currency and transaction amounts', () => {
  assert.throws(() => parseAccounts([{...account, currency: '<script>'}]));
  assert.throws(() => parseTransactions([{id: 't', amount: '1', currency: 'USD'}]));
  assert.throws(() => parseTransactions([{id: 't', amount: Infinity, currency: 'USD'}]));
});
test('unknown IPC inputs and orphan pagination fail closed', () => {
  for (const value of [null, [], {}, {serverId: ' '}, {serverId: 'bank', accountId: 1}, {serverId: 'bank', continuation: 'next'}]) assert.throws(() => financeReadRequest(value));
});
test('only invokes selected server account reader', async () => {
  const calls: unknown[] = [];
  const result = await readBank({serverId: 'bank'}, [tool('list_accounts', {accounts: [account]}, calls)]);
  assert.equal(result.accounts.length, 1); assert.deepEqual(calls, [{include_balances: true}]);
  await assert.rejects(readBank({serverId: 'other'}, [tool('list_accounts', {accounts: [account]}, calls)]));
  assert.equal(calls.length, 1);
});
test('bounded transaction pagination forwards cursor and excludes raw bank data', async () => {
  const calls: unknown[] = [];
  const result = await readBank({serverId: 'bank', accountId: 'account-1', continuation: 'next'}, [tool('get_transactions', {transactions: [{id: 't', amount: -12.5, currency: 'EUR', status: 'BOOK'}], continuation: 'last'}, calls)]);
  assert.equal(result.transactions[0].amount, -12.5); assert.equal(result.continuation, 'last');
  assert.deepEqual(calls, [{account: 'account-1', max_pages: 1, include_raw: false, continuation: 'next'}]);
});
test('provider errors do not leak raw bank bodies', async () => {
  await assert.rejects(readBank({serverId: 'bank'}, [tool('list_accounts', {secret: 'sensitive'}, [], true)]), error => error instanceof Error && !error.message.includes('sensitive') && error.message.includes('consent'));
});
test('malformed provider data is not presented as an empty account', async () => {
  await assert.rejects(readBank({serverId: 'bank'}, [tool('list_accounts', {accounts: 'invalid'}, [])]));
});
test('transport errors do not expose sensitive provider details', async () => {
  const failing = tool('list_accounts', {}, []);
  failing.execute = async () => { throw new Error('secret transport response'); };
  await assert.rejects(readBank({serverId: 'bank'}, [failing]), error => error instanceof Error && !error.message.includes('secret'));
});
test('accepts structured MCP responses', async () => {
  const structured = tool('list_accounts', {}, []);
  structured.execute = async () => ({content: '', metadata: {structuredContent: {accounts: [account]}}});
  assert.equal((await readBank({serverId: 'bank'}, [structured])).accounts[0].id, 'account-1');
});
