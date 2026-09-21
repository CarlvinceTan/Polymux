import type {TaskOverviewDto as TaskOverview} from '@polymux/protocol';
import {confirm, type WorkspaceUi} from './workspace-ui.js';

export async function browseTasks(ui: WorkspaceUi): Promise<void> {
  let scope = 'all';
  for (;;) {
    const all = await ui.client.call<TaskOverview[]>('tasks.snapshot');
    const items = scope === 'all' ? all : all.filter(t => t.chatId === scope);
    const selected = await ui.pick('Tasks', [
      {value: 'scope', label: 'Conversation', description: scope === 'all' ? 'All Assistant chats and Team' : items[0]?.chatTitle}, {value: 'refresh', label: 'Refresh'},
      ...items.map(t => ({value: t.id, label: `${t.parentRunId ? '↳ ' : ''}${t.title}`, description: t.chatTitle, status: t.status})),
    ]);
    if (!selected) return;
    if (selected === 'refresh') continue;
    if (selected === 'scope') {
      scope = await ui.pick('Conversation', [{value: 'all', label: 'All conversations'},
        ...[...new Map(all.map(t => [t.chatId, t.chatTitle])).entries()].map(([value, label]) => ({value, label}))]) ?? scope;
      continue;
    }
    const task = items.find(t => t.id === selected);
    if (!task) continue;
    const action = await ui.pick(task.title, [
      {value: 'details', label: 'Details and result'}, {value: 'open', label: 'Open conversation'},
      ...(['running', 'queued', 'pending'].includes(task.status) ? [{value: 'cancel', label: 'Cancel task'}] : []),
    ]);
    if (action === 'open') {await ui.openChat({id: task.chatId, title: task.chatTitle}); return;}
    if (action === 'details') await ui.show(task.title, [task.chatTitle, task.status,
      `Started: ${task.startedAt ?? 'Not started'}`, `Finished: ${task.finishedAt ?? 'Not finished'}`,
      task.error, '', 'Result preview', task.result || 'No result yet'].filter(v => v !== null).join('\n'));
    if (action === 'cancel' && await confirm(ui, `Cancel ${task.title}?`))
      await ui.client.call('tasks.cancel', [task.jobId ? `job:${task.jobId}` : task.id]);
  }
}
