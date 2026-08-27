import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOrder, loadRailOrder, rememberRailOrder, saveAccountOrder} from './hubRailOrder';

class MemoryStorage {
  readonly #values = new Map<string, string>();
  get length(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string): void { this.#values.delete(key); }
  setItem(key: string, value: string): void { this.#values.set(key, value); }
}

test('remembers the first account order and ignores later response order', () => {
  Object.defineProperty(globalThis, 'localStorage', {value: new MemoryStorage(), configurable: true});
  let order = rememberRailOrder(loadRailOrder(), [
    {id: 'platform:whatsapp', accountIds: ['personal', 'work']},
  ]);

  order = rememberRailOrder(order, [
    {id: 'platform:whatsapp', accountIds: ['work', 'personal']},
  ]);

  assert.deepEqual(order.accounts['platform:whatsapp'], ['personal', 'work']);
  assert.deepEqual(loadRailOrder(), order);
});

test('appends new accounts without disturbing remembered positions', () => {
  Object.defineProperty(globalThis, 'localStorage', {value: new MemoryStorage(), configurable: true});
  let order = rememberRailOrder(loadRailOrder(), [
    {id: 'platform:whatsapp', accountIds: ['personal', 'work']},
  ]);
  order = rememberRailOrder(order, [
    {id: 'platform:whatsapp', accountIds: ['third', 'work', 'personal']},
  ]);

  assert.deepEqual(order.accounts['platform:whatsapp'], ['personal', 'work', 'third']);
});

test('an explicit reorder remains authoritative across refreshes and reloads', () => {
  Object.defineProperty(globalThis, 'localStorage', {value: new MemoryStorage(), configurable: true});
  let order = rememberRailOrder(loadRailOrder(), [
    {id: 'platform:whatsapp', accountIds: ['personal', 'work']},
  ]);
  order = saveAccountOrder(order, 'platform:whatsapp', ['work', 'personal']);
  order = rememberRailOrder(order, [
    {id: 'platform:whatsapp', accountIds: ['personal', 'work']},
  ]);

  const accounts = [{id: 'personal'}, {id: 'work'}];
  assert.deepEqual(
    applyOrder(accounts, (account) => account.id, order.accounts['platform:whatsapp']).map((account) => account.id),
    ['work', 'personal'],
  );
  assert.deepEqual(loadRailOrder().accounts['platform:whatsapp'], ['work', 'personal']);
});

test('temporarily missing accounts keep their previous slots', () => {
  Object.defineProperty(globalThis, 'localStorage', {value: new MemoryStorage(), configurable: true});
  let order = rememberRailOrder(loadRailOrder(), [
    {id: 'platform:whatsapp', accountIds: ['personal', 'work']},
  ]);
  order = rememberRailOrder(order, [
    {id: 'platform:whatsapp', accountIds: ['work']},
  ]);
  order = rememberRailOrder(order, [
    {id: 'platform:whatsapp', accountIds: ['work', 'personal']},
  ]);

  assert.deepEqual(order.accounts['platform:whatsapp'], ['personal', 'work']);
});
