import type {BotDto, JsonValue, ScheduleDto, ScheduleFrequencyDto} from '@polymux/protocol';
import {confirm, type WorkspaceUi} from './workspace-ui.js';

export function scheduleFrequency(f: ScheduleFrequencyDto): string {
  const zone = f.timeZone ? ` ${f.timeZone}` : '';
  if (f.kind === 'once') return new Date(f.at).toLocaleString();
  if (f.kind === 'cron') return `${f.expression}${zone}`;
  if (f.kind === 'hourly') return `Every ${f.interval ?? 1} hour(s), :${String(f.minute ?? 0).padStart(2, '0')}${zone}`;
  const day = f.kind === 'weekly' ? ` · ${f.days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}` : f.kind === 'monthly' ? ` · day ${f.dayOfMonth}` : f.kind === 'yearly' ? ` · ${f.month + 1}/${f.dayOfMonth}` : '';
  return `${f.kind}${day} · ${f.time}${zone}`;
}

function integer(value: string, label: string, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`${label} must be a whole number from 1 to ${maximum}`);
  return parsed;
}

async function frequency(ui: WorkspaceUi): Promise<ScheduleFrequencyDto | undefined> {
  const kind = await ui.pick('Repeat', ['once', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'cron']
    .map(value => ({value, label: value === 'once' ? 'Once' : value === 'cron' ? 'Custom cron' : value[0].toUpperCase() + value.slice(1)})));
  if (!kind) return;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (kind === 'once') {
    const at = await ui.prompt('Date and time, including time zone (2026-10-01T09:00:00+08:00)');
    if (!at) return;
    if (!Number.isFinite(Date.parse(at))) throw new Error('Enter a valid date and time');
    return {kind, at: Date.parse(at), timeZone};
  }
  if (kind === 'cron') {
    const expression = await ui.prompt(`Five-field cron expression · ${timeZone}`);
    return expression ? {kind, expression, timeZone} : undefined;
  }
  if (kind === 'hourly') {
    const interval = await ui.prompt('Every how many hours?');
    return interval ? {kind, interval: integer(interval, 'Hours', 99), timeZone} : undefined;
  }
  const time = await ui.prompt(`Time (HH:MM) · ${timeZone}`);
  if (!time) return;
  if (!/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Use a time from 00:00 to 23:59');
  if (kind === 'daily') return {kind, time, timeZone};
  if (kind === 'weekly') {
    const days = await ui.prompt('Weekdays, separated by commas (mon,tue,wed,thu,fri,sat,sun)');
    if (!days) return;
    const parsed = days.split(',').map(d => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(d.trim().toLowerCase()));
    if (parsed.some(d => d < 0)) throw new Error('Use weekday names such as mon,tue,fri');
    return {kind, days: [...new Set(parsed)] as Extract<ScheduleFrequencyDto, {kind: 'weekly'}>['days'], time, timeZone};
  }
  const day = await ui.prompt('Day of month');
  if (!day) return;
  const dayOfMonth = integer(day, 'Day', 31);
  if (kind === 'monthly') return {kind, dayOfMonth, time, timeZone};
  const month = await ui.prompt('Month (1–12)');
  return month ? {kind: 'yearly', month: integer(month, 'Month', 12) - 1, dayOfMonth, time, timeZone} : undefined;
}

export async function browseSchedules(ui: WorkspaceUi, botId?: string): Promise<void> {
  for (;;) {
    const [all, bots] = await Promise.all([
      ui.client.call<ScheduleDto[]>('schedules.list'), ui.client.call<BotDto[]>('team.list'),
    ]);
    const items = botId ? all.filter(s => s.botId === botId) : all;
    const selected = await ui.pick('Schedules', [{value: '+', label: 'Create schedule'}, {value: 'refresh', label: 'Refresh'},
      ...items.map(s => ({value: s.id, label: s.title, description: `${s.botId ? bots.find(b => b.id === s.botId)?.name ?? 'Deleted bot' : 'Assistant'} · ${scheduleFrequency(s.frequency)}`, status: s.status}))]);
    if (!selected) return;
    if (selected === 'refresh') continue;
    if (selected === '+') {
      const title = await ui.prompt('Schedule title');
      if (!title?.trim()) continue;
      const prompt = await ui.prompt('Instructions');
      if (!prompt?.trim()) continue;
      const owner = botId ?? await ui.pick('Run as', [{value: 'assistant', label: 'Assistant'}, ...bots.map(b => ({value: b.id, label: b.name}))]);
      if (!owner) continue;
      const cadence = await frequency(ui);
      if (cadence) await ui.client.call('schedules.create', [{title, prompt, frequency: cadence, ...(owner === 'assistant' ? {} : {botId: owner})} as JsonValue]);
      continue;
    }
    const item = items.find(s => s.id === selected);
    if (!item) continue;
    const action = await ui.pick(item.title, [
      {value: 'details', label: 'Details and history'}, {value: 'open', label: 'Open latest run'},
      {value: 'edit', label: 'Edit instructions'}, {value: 'frequency', label: 'Change schedule'},
      {value: 'toggle', label: item.status === 'paused' ? 'Resume schedule' : 'Pause schedule'},
      {value: 'run', label: 'Run now'}, {value: 'remove', label: 'Delete schedule'},
    ]);
    if (action === 'details') {
      await ui.show(item.title, `${item.prompt}\n\n${scheduleFrequency(item.frequency)}\n${item.status}\nNext: ${item.nextRunAt ? new Date(item.nextRunAt).toLocaleString() : 'None'}\n\n` + item.history.map(r => `${new Date(r.startedAt).toLocaleString()} · ${r.outcome}\n${r.error ?? r.summary ?? ''}`).join('\n\n'));
      await ui.client.call('schedules.markRead', [item.id]);
    }
    if (action === 'open') {
      const run = item.history.find(r => r.conversationId);
      if (run?.conversationId) {await ui.openChat({id: run.conversationId, title: item.title}); return;}
      ui.notify('This schedule has no conversation yet');
    }
    if (action === 'edit') {
      const prompt = await ui.prompt('Instructions');
      if (prompt?.trim()) await ui.client.call('schedules.update', [item.id, {prompt}]);
    }
    if (action === 'frequency') {
      const cadence = await frequency(ui);
      if (cadence) await ui.client.call('schedules.update', [item.id, {frequency: cadence} as JsonValue]);
    }
    if (action === 'toggle') await ui.client.call('schedules.update', [item.id, {status: item.status === 'paused' ? 'active' : 'paused'}]);
    if (action === 'run' && await confirm(ui, `Run ${item.title} now?`)) await ui.client.call('schedules.runNow', [item.id]);
    if (action === 'remove' && await confirm(ui, `Delete ${item.title}?`)) await ui.client.call('schedules.remove', [item.id]);
  }
}
