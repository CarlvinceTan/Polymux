import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {AgentToolContext} from '@polymux/core';
import {Scheduler, type SchedulePreferences} from './index.js';
import {createScheduleTool} from './tools.js';

const context = (runId: string): AgentToolContext => ({runId, turn: 1, callId: 'call', signal: new AbortController().signal, emitProgress: async () => {}});

test('schedule tools scope creation, listing and mutation to their calling bot', async () => {
  const store: SchedulePreferences = {getPreference: () => null, setPreference: () => {}};
  const scheduler = new Scheduler(store, async () => ({}));
  const tool = createScheduleTool(scheduler, runId => runId === 'maya-run' ? 'maya' : undefined);
  const input = {action: 'create', title: 'Research', prompt: 'Review notes', frequency: {kind: 'daily', time: '09:00'}};
  await tool.execute(input, context('maya-run'));
  const bot = scheduler.list()[0];
  assert.equal(bot.botId, 'maya');
  await tool.execute({...input, title: 'Assistant work'}, context('assistant-run'));
  const list = await tool.execute({action: 'list'}, context('maya-run'));
  assert.equal(JSON.parse(String(list.content)).schedules.length, 1);
  for (const action of ['update', 'remove', 'run']) {
    const result = await tool.execute({action, id: bot.id, title: 'Wrong owner'}, context('assistant-run'));
    assert.equal(result.isError, true);
  }
  assert.equal(scheduler.list().find(item => item.id === bot.id)?.title, 'Research');
  scheduler.stop();
});

test('a scheduled run can read schedules but cannot nest new ones', async () => {
  const store: SchedulePreferences = {getPreference: () => null, setPreference: () => {}};
  const scheduler = new Scheduler(store, async () => ({}));
  const tool = createScheduleTool(
    scheduler,
    runId => runId === 'routine-run' ? 'maya' : undefined,
    {isRoutineRun: (runId) => runId === 'routine-run'},
  );
  const input = {action: 'create', title: 'Nested', prompt: 'Should not exist', frequency: {kind: 'daily', time: '09:00'}};
  const refused = await tool.execute(input, context('routine-run'));
  assert.equal(refused.isError, true);
  assert.match(String(refused.content), /cannot create other schedules/);
  assert.equal(scheduler.list().length, 0);
  await tool.execute(input, context('chat-run'));
  assert.equal(scheduler.list().length, 1);
  // Reads stay available unattended, scoped to the calling bot.
  const routineList = await tool.execute({action: 'list'}, context('routine-run'));
  assert.equal(JSON.parse(String(routineList.content)).schedules.length, 0);
  const list = await tool.execute({action: 'list'}, context('chat-run'));
  assert.equal(JSON.parse(String(list.content)).schedules.length, 1);
  scheduler.stop();
});
