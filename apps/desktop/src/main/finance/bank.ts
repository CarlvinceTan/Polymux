import {randomUUID} from 'node:crypto';
import {exposedMcpToolName, type AgentTool, type AgentToolResult} from '@polymux/tools';
import type {FinanceAccountDto, FinanceReadDto, FinanceReadRequest, FinanceTransactionDto} from '@polymux/protocol';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid BankMCP response');
  return value as Record<string, unknown>;
}
function string(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
function amount(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function currency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new Error('Invalid bank currency');
  return value;
}
function payload(result: AgentToolResult): Record<string, unknown> {
  // Provider errors can contain account identifiers or raw response bodies.
  if (result.isError) throw new Error('BankMCP could not read your bank. Check its connection and bank consent.');
  const metadata = result.metadata && typeof result.metadata === 'object' && !Array.isArray(result.metadata) ? result.metadata : null;
  if (metadata?.structuredContent) return record(metadata.structuredContent);
  const text = typeof result.content === 'string' ? result.content : result.content.find(item => item.type === 'text')?.text;
  if (!text) throw new Error('BankMCP returned no data');
  try { return record(JSON.parse(text)); } catch { throw new Error('Invalid BankMCP response'); }
}
export function financeReadRequest(value: unknown): FinanceReadRequest {
  const input = record(value);
  if (typeof input.serverId !== 'string' || !input.serverId.trim() || input.serverId.length > 200) throw new Error('Choose a BankMCP connection');
  for (const key of ['accountId', 'continuation']) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key] || input[key].length > 8192)) throw new Error(`Invalid ${key}`);
  }
  if (input.continuation && !input.accountId) throw new Error('Pagination requires an account');
  return {serverId: input.serverId, accountId: input.accountId as string | undefined, continuation: input.continuation as string | undefined};
}
export function parseAccounts(value: unknown): FinanceAccountDto[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid bank accounts');
  return value.map(item => {
    const a = record(item);
    if (!string(a.uid)) throw new Error('Bank account has no identifier');
    return {id: string(a.uid), name: string(a.label) || string(a.name) || 'Bank account', bank: string(a.bank), currency: currency(a.currency), booked: amount(a.booked), available: amount(a.available), consentUntil: string(a.consent_valid_until) || null, balanceDate: string(a.balance_date) || null, error: a.balance_error ? 'Balance unavailable; check bank consent.' : null};
  });
}
export function parseTransactions(value: unknown): FinanceTransactionDto[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid bank transactions');
  return value.map(item => {
    const t = record(item);
    const signed = amount(t.amount);
    if (signed === null || !string(t.id)) throw new Error('Invalid bank transaction');
    return {id: string(t.id), date: string(t.date), description: string(t.counterparty) || string(t.description) || 'Transaction', amount: signed, currency: currency(t.currency), status: string(t.status)};
  });
}
/** Executes only the two read tools on the explicitly selected MCP server. */
export async function readBank(request: FinanceReadRequest, tools: AgentTool[]): Promise<FinanceReadDto> {
  const call = async (name: 'list_accounts' | 'get_transactions', input: Record<string, string | boolean | number>) => {
    const tool = tools.find(tool => tool.name === exposedMcpToolName(request.serverId, name));
    if (!tool) throw new Error('Choose a connected BankMCP server with account and transaction tools.');
    let result: AgentToolResult;
    try {
      result = await tool.execute(input, {runId: randomUUID(), callId: randomUUID(), turn: 0, signal: AbortSignal.timeout(30_000), emitProgress: async () => {}});
    } catch { throw new Error('BankMCP connection failed. Check the server and bank consent.'); }
    return payload(result);
  };
  const result: FinanceReadDto = {accounts: [], transactions: [], continuation: null, fetchedAt: new Date().toISOString()};
  if (!request.accountId) {
    result.accounts = parseAccounts((await call('list_accounts', {include_balances: true})).accounts);
  } else {
    const data = await call('get_transactions', {account: request.accountId, max_pages: 1, include_raw: false, ...(request.continuation ? {continuation: request.continuation} : {})});
    result.transactions = parseTransactions(data.transactions);
    result.continuation = string(data.continuation) || null;
  }
  return result;
}
