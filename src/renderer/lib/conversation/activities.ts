import type {AgentActivityItem, AgentActivityKind} from '../components/chat/AgentActivity.svelte';

export function upsertActivity(activities: AgentActivityItem[] = [], activity: AgentActivityItem): AgentActivityItem[] {
  const index = activities.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...activities, activity];
  return activities.map((item, itemIndex) => itemIndex === index ? activity : item);
}

const condensedLabels: Record<AgentActivityKind, string> = {
  thinking: 'Thought',
  reading: 'Read files',
  searching: 'Searched',
  running: 'Ran commands',
  editing: 'Edited files',
  plugin: 'Used tools',
};

export function shouldShowAgentActivity(activities: AgentActivityItem[] = []): boolean {
  return activities.length > 0;
}

export function activitySummary(activities: AgentActivityItem[]): string {
  const kinds = [...new Set(activities.map((activity) => activity.kind))];
  return kinds.map((kind) => condensedLabels[kind]).join(', ');
}

export function activityDuration(startedAt?: string, completedAt?: string, now = Date.now()): number {
  if (!startedAt) return 0;
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
}

/**
 * Milliseconds until the displayed duration next changes. A plain one-second
 * interval drifts and gets coalesced when the main thread is busy, which makes
 * the counter stall and then jump; scheduling each tick to the moment the value
 * actually changes keeps it advancing once per second. `activityDuration`
 * rounds, so that moment is each half-second past the start.
 */
export function nextDurationTickDelay(startedAt?: string, now = Date.now()): number {
  const start = Date.parse(startedAt ?? '');
  if (!Number.isFinite(start)) return 1000;
  const sinceLastChange = (((now - start - 500) % 1000) + 1000) % 1000;
  return 1000 - sinceLastChange;
}
