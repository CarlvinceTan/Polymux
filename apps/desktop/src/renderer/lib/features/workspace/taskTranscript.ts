import type {RunEventDto} from '@flareai/protocol';
import type {AgentActivityItem} from '../chat/AgentActivity.svelte';
import {activityPresentation, upsertActivity} from '../chat/activities';
import {translate} from '../../../i18n';

/**
 * What a delegated task looked like from the inside: the instruction the
 * orchestrator wrote, and the subagent's own reasoning, tool trail and answer.
 *
 * Built by folding the subagent's run events exactly as the chat pane folds the
 * main run's, so a task tab reads like the chat it is a smaller copy of. The
 * one difference is that nothing here is addressed to the user — there is no
 * one to reply to — so the transcript carries no composer and no message ids to
 * edit against.
 */
export type TaskTranscript = {
  runId: string;
  prompt: string;
  text: string;
  activities: AgentActivityItem[];
  startedAt?: string;
  completedAt?: string;
  running: boolean;
};

export function emptyTranscript(runId: string, prompt = ''): TaskTranscript {
  return {runId, prompt, text: '', activities: [], running: true};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      const item = asRecord(block);
      return item.type === 'text' && typeof item.text === 'string' ? item.text : '';
    })
    .join('');
}

/**
 * Folds one subagent event into the transcript. Pure, and total: an event it
 * has no rule for returns the transcript unchanged, so a new event type shows
 * up as nothing rather than as a broken row.
 */
export function applyTaskEvent(transcript: TaskTranscript, event: RunEventDto): TaskTranscript {
  const payload = asRecord(event.payload);
  const settle = (status: 'completed' | 'failed'): TaskTranscript => ({
    ...transcript,
    running: false,
    completedAt: new Date(event.timestamp).toISOString(),
    activities: transcript.activities.map((item) => item.status === 'active' ? {...item, status} : item),
  });

  switch (event.type) {
    case 'run.started':
      return {...transcript, startedAt: new Date(event.timestamp).toISOString(), running: true};

    case 'message.reasoning.delta': {
      const id = `${event.runId}:thinking`;
      const existing = transcript.activities.find((item) => item.id === id);
      const delta = typeof payload.delta === 'string' ? payload.delta : '';
      return {
        ...transcript,
        activities: upsertActivity(transcript.activities, {
          ...existing,
          id,
          kind: 'thinking',
          status: 'active',
          label: translate('activity.thinking'),
          result: `${existing?.result ?? ''}${delta}`,
        }),
      };
    }

    case 'message.text.delta': {
      const delta = typeof payload.delta === 'string' ? payload.delta : '';
      return {
        ...transcript,
        text: transcript.text + delta,
        activities: transcript.activities.map((item) => item.kind === 'thinking' && item.status === 'active' ? {...item, status: 'completed'} : item),
      };
    }

    case 'message.completed': {
      const text = contentText(asRecord(payload.message).content);
      if (!text) return transcript;
      // Narration mid-run folds into the trail; only the final answer is the
      // task's result.
      if (payload.phase === 'commentary') {
        return {
          ...transcript,
          text: '',
          activities: [...transcript.activities, {id: `${event.runId}:commentary:${event.sequence}`, kind: 'commentary', status: 'completed', label: text}],
        };
      }
      return {...transcript, text};
    }

    case 'tool.started': {
      const call = asRecord(payload.toolCall);
      const name = typeof call.name === 'string' ? call.name : 'tool';
      const id = typeof call.id === 'string' ? call.id : `${event.runId}:${event.sequence}`;
      const presentation = activityPresentation(name, asRecord(call.arguments));
      return {
        ...transcript,
        activities: upsertActivity(
          transcript.activities.filter((item) => item.status !== 'active' || item.kind !== 'thinking'),
          {id, ...presentation, status: 'active'},
        ),
      };
    }

    case 'tool.progress': {
      const id = typeof payload.toolCallId === 'string' ? payload.toolCallId : '';
      const label = typeof payload.message === 'string' ? payload.message.trim() : '';
      if (!id || !label) return transcript;
      return {
        ...transcript,
        activities: transcript.activities.map((item) => item.id === id ? {
          ...item,
          steps: [
            ...(item.steps ?? []).map((step) => step.status === 'active' ? {...step, status: 'completed' as const} : step),
            {id: `${id}:${event.sequence}`, label, status: 'active' as const},
          ],
        } : item),
      };
    }

    case 'tool.completed':
    case 'tool.failed': {
      const call = asRecord(payload.toolCall);
      const id = typeof call.id === 'string' ? call.id : '';
      const status = event.type === 'tool.failed' ? 'failed' as const : 'completed' as const;
      return {
        ...transcript,
        activities: transcript.activities.map((item) => item.id === id ? {
          ...item,
          status,
          steps: item.steps?.map((step) => step.status === 'active' ? {...step, status} : step),
        } : item),
      };
    }

    case 'run.completed': {
      const result = asRecord(payload.result);
      const last = typeof result.lastAgentMessage === 'string' ? result.lastAgentMessage : '';
      const settled = settle('completed');
      return {...settled, text: settled.text || last};
    }
    case 'run.failed':
    case 'run.cancelled':
      return settle('failed');

    default:
      return transcript;
  }
}
