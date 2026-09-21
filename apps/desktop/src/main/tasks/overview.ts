import type {SqliteStorage} from '@polymux/storage/sqlite';
import type {ManagerJob} from '../agent/chat-pool.js';
import {isTeamBotSetupCue, type TaskOverviewDto as TaskOverview} from '@polymux/protocol';

const text = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content)
  ? content.flatMap(block => block && typeof block === 'object' && 'text' in block && typeof block.text === 'string' ? [block.text] : []).join('\n') : '';

/** A cross-chat read projection, preserving runtime outcomes and queued work. */
export function taskOverview(storage: SqliteStorage, jobs: ManagerJob[] = []): TaskOverview[] {
  // Query each run's boundary messages directly: the normal chat page is capped.
  const title = (id: string) => storage.getConversation(id)?.title ?? 'Conversation';
  const boundary = (id: string, role: string, latest = false) => {
    const row = storage.database.prepare(`SELECT id FROM messages WHERE run_id=? AND role=? ORDER BY sequence ${latest ? 'DESC' : 'ASC'} LIMIT 1`).get(id, role) as {id: string} | undefined;
    return row ? storage.getMessage(row.id) : null;
  };
  // Active work must remain visible even when newer history fills the page.
  const ids = storage.database.prepare("SELECT id FROM runs WHERE status IN ('queued', 'running') UNION SELECT id FROM (SELECT id FROM runs ORDER BY created_at DESC LIMIT 200)").all() as Array<{id: string}>;
  const result: TaskOverview[] = ids.flatMap(({id}) => {
    const run = storage.getRun(id);
    if (!run) return [];
    const job = jobs.find(j => j.runId === id);
    const prompt = boundary(id, 'user');
    const input = job?.text ?? (isTeamBotSetupCue(prompt?.metadata) ? '' : text(prompt?.content));
    return [{id, ...(job ? {jobId: job.id} : {}), chatId: run.conversationId, chatTitle: title(run.conversationId),
      title: input.split('\n')[0]?.trim() || title(run.conversationId), status: run.status,
      runId: id, parentRunId: run.parentRunId ?? null, startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null, error: typeof run.error === 'string' ? run.error
        : run.error && typeof run.error === 'object' && !Array.isArray(run.error) && typeof run.error.message === 'string' ? run.error.message : null,
      result: text(boundary(id, 'assistant', true)?.content).slice(0, 16_000)}];
  });
  const represented = new Set(result.flatMap(row => row.jobId ? [row.jobId] : []));
  return [...jobs.filter(j => !represented.has(j.id)).map((j): TaskOverview => ({
    id: `job:${j.id}`, jobId: j.id, chatId: j.chatId, chatTitle: title(j.chatId), title: j.text.split('\n')[0],
    status: j.status, runId: j.runId, parentRunId: null, startedAt: j.startedAt,
    finishedAt: j.finishedAt, error: j.error, result: '',
  })), ...result.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))];
}
