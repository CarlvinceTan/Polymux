import type {JsonValue, RunEventDto} from '@polymux/protocol';

export interface LiveActivity {
  id: string;
  label: string;
  detail: string;
  status: 'active' | 'completed' | 'failed';
}

export interface LiveRun {
  runId: string;
  conversationId: string;
  sequence: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  text: string;
  notice: string;
  activities: LiveActivity[];
}

export function createLiveRun(runId: string, conversationId: string): LiveRun {
  return {
    runId,
    conversationId,
    sequence: 0,
    status: 'running',
    text: '',
    notice: '',
    activities: [],
  };
}

export function applyRunEvent(run: LiveRun, event: RunEventDto): LiveRun {
  if (event.runId !== run.runId || event.sequence <= run.sequence) return run;
  const payload = record(event.payload);
  let next: LiveRun = {...run, sequence: event.sequence};

  if (event.type === 'message.text.delta') {
    next.text += typeof payload.delta === 'string' ? payload.delta : '';
  } else if (event.type === 'message.final_rejected') {
    next.text = '';
  } else if (event.type === 'message.completed' && payload.phase !== 'commentary') {
    const message = record(payload.message);
    const text = contentText(message.content);
    if (text) next.text = text;
  } else if (event.type === 'agent.notice') {
    next.notice = typeof payload.message === 'string' ? payload.message : '';
  } else if (event.type === 'tool.started') {
    const call = record(payload.toolCall);
    const id = typeof call.id === 'string' ? call.id : `${event.runId}:${event.sequence}`;
    const label = toolLabel(typeof call.name === 'string' ? call.name : 'Tool');
    const detail = toolDetail(record(call.arguments));
    next.activities = upsert(next.activities, {id, label, detail, status: 'active'});
  } else if (event.type === 'tool.progress') {
    const id = typeof payload.toolCallId === 'string' ? payload.toolCallId : '';
    const detail = typeof payload.message === 'string' ? payload.message : '';
    if (id && detail)
      next.activities = next.activities.map((item) => item.id === id ? {...item, detail} : item);
  } else if (event.type === 'tool.completed' || event.type === 'tool.failed') {
    const call = record(payload.toolCall);
    const id = typeof call.id === 'string' ? call.id : '';
    const status = event.type === 'tool.failed' ? 'failed' as const : 'completed' as const;
    next.activities = next.activities.map((item) => item.id === id ? {...item, status} : item);
  } else if (event.type === 'context.compacting') {
    next.activities = upsert(next.activities, {
      id: `${event.runId}:compacting`,
      label: 'Compacting context',
      detail: '',
      status: 'active',
    });
  } else if (event.type === 'context.compacted') {
    next.activities = next.activities.map((item) =>
      item.id === `${event.runId}:compacting` ? {...item, status: 'completed'} : item,
    );
  }

  if (event.type === 'run.completed' || event.type === 'run.cancelled' || event.type === 'run.failed') {
    const result = record(payload.result);
    const finalText = typeof result.lastAgentMessage === 'string' ? result.lastAgentMessage : '';
    next = {
      ...next,
      status: event.type === 'run.completed'
        ? 'completed'
        : event.type === 'run.cancelled'
          ? 'cancelled'
          : 'failed',
      text: next.text || finalText,
      activities: next.activities.map((item) => ({
        ...item,
        status: item.status === 'active'
          ? event.type === 'run.failed' ? 'failed' : 'completed'
          : item.status,
      })),
    };
  }
  return next;
}

export function terminalEvent(event: RunEventDto): boolean {
  return ['run.completed', 'run.cancelled', 'run.failed', 'run.settled'].includes(event.type);
}

export function contentText(value: JsonValue | undefined): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
      const block = item as Record<string, JsonValue>;
      return (block.type === 'text' || block.type === 'output_text') && typeof block.text === 'string'
        ? block.text
        : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function upsert(items: LiveActivity[], item: LiveActivity): LiveActivity[] {
  const existing = items.findIndex((candidate) => candidate.id === item.id);
  if (existing < 0) return [...items, item];
  return items.map((candidate, index) => index === existing ? item : candidate);
}

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : {};
}

function toolLabel(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized === 'bash' || normalized.includes('command')) return 'Running command';
  if (normalized === 'read' || normalized.includes('read_file')) return 'Reading file';
  if (normalized === 'edit' || normalized === 'write' || normalized.includes('patch')) return 'Editing files';
  if (normalized.includes('browser') || normalized.includes('web')) return 'Using Browser';
  if (normalized.includes('search')) return 'Searching';
  if (normalized === 'task' || normalized.includes('subagent')) return 'Delegating task';
  return name.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toolDetail(input: Record<string, JsonValue>): string {
  for (const key of ['path', 'url', 'query', 'command', 'description']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim().split('\n')[0]!.slice(0, 140);
  }
  return '';
}
