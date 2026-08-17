import type {AgentActivityItem, AgentActivityKind} from '../components/chat/AgentActivity.svelte';
import {translate, type MessageKey} from '../i18n';

export function upsertActivity(activities: AgentActivityItem[] = [], activity: AgentActivityItem): AgentActivityItem[] {
  const index = activities.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...activities, activity];
  return activities.map((item, itemIndex) => itemIndex === index ? activity : item);
}

export function collapseActivities(activities: AgentActivityItem[] = []): AgentActivityItem[] {
  const collapsed: AgentActivityItem[] = [];
  for (const activity of activities) {
    const last = collapsed.at(-1);
    if (last && last.kind === activity.kind && last.label === activity.label) {
      // Merged rows keep every reported step, so repeated calls to the same
      // tool read as one group with its combined sub-step trail.
      const steps = [...(last.steps ?? []), ...(activity.steps ?? [])];
      collapsed[collapsed.length - 1] = {
        ...last,
        ...activity,
        id: last.id,
        steps: steps.length ? steps : undefined,
      };
    } else {
      collapsed.push(activity);
    }
  }
  return collapsed;
}

/**
 * What a tool call is called in the activity trail, in the language the app is
 * in when the call happens. Labels are written into the message's stored
 * metadata as they are produced, so an old conversation keeps the wording it
 * was narrated with — a record of the run rather than a caption re-rendered
 * against whatever language is current.
 */
export function activityPresentation(
  name: string,
  input: Record<string, unknown> = {},
): {kind: AgentActivityKind; label: string; icon?: AgentActivityItem['icon']} {
  const normalized = name.toLowerCase();
  const path = typeof input.path === 'string' ? input.path : '';
  const uri = typeof input.uri === 'string' ? input.uri : '';

  if (normalized.includes('read') && /(?:^|\/)skill\.md$/i.test(path)) {
    return skillActivity(path.split('/').at(-2) ?? '');
  }
  if (normalized === 'skill' || normalized.startsWith('skill_') || normalized.startsWith('skill.')) {
    return skillActivity(typeof input.name === 'string' ? input.name : '');
  }
  // Memory is checked before the generic search and tool rules: recall is a
  // search, but "Recalling memory" is what the user needs to see, and the row
  // is the only place the app tells them their memory was touched at all.
  if (normalized === 'remember' || normalized === 'save_memory') {
    return {kind: 'memory', label: translate('activity.remembering')};
  }
  if (normalized === 'recall' || normalized === 'list_memory' || normalized.includes('search_memory')) {
    return {kind: 'memory', label: translate('activity.recalling')};
  }
  if (normalized === 'forget' || normalized === 'delete_memory') {
    return {kind: 'memory', label: translate('activity.forgetting')};
  }
  if (normalized === 'search_history' || normalized === 'read_conversation') {
    return {kind: 'memory', label: translate('activity.searchingHistory')};
  }
  if (normalized.includes('compact') || normalized.includes('compress') || normalized.includes('optimis') || normalized.includes('optimiz')) {
    return {kind: 'compacting', label: translate('activity.compacting')};
  }
  if (normalized.includes('think') || normalized.includes('reason')) {
    return {kind: 'thinking', label: translate('activity.thinking')};
  }
  if (normalized.includes('resource') || uri.length > 0 || normalized === 'read_resource' || normalized === 'fetch_resource') {
    const named = uri ? uri.split('/').at(-1) : typeof input.name === 'string' ? input.name : '';
    const resource = named ? humanize(named) : translate('activity.resource');
    return {kind: 'resource', label: translate('activity.using', {name: resource})};
  }
  if (normalized === 'read' || normalized.includes('read_file')) {
    return {kind: 'reading', label: translate('activity.readingFiles')};
  }
  if (normalized === 'edit' || normalized === 'write' || normalized.includes('apply_patch') || normalized.includes('edit_file') || normalized.includes('write_file')) {
    return {kind: 'editing', label: translate('activity.editingFiles')};
  }
  if (normalized === 'bash' || normalized.includes('command') || normalized.includes('terminal') || normalized.includes('exec') || normalized === 'sh') {
    return {kind: 'running', label: translate('activity.runningCommand')};
  }
  if (normalized.includes('search') || normalized.includes('web') || normalized === 'glob' || normalized === 'grep') {
    return {kind: 'searching', label: translate('activity.searching')};
  }
  if (normalized === 'task' || normalized.includes('subagent') || normalized.includes('delegate')) {
    return {kind: 'task', label: translate('activity.delegatingTask')};
  }
  if (name.includes('.')) {
    return {kind: 'tool', label: translate('activity.using', {name: humanize(name.split('.')[0]!)})};
  }
  return {kind: 'tool', label: humanize(name)};
}

/**
 * A skill's row. Some folder names read awkwardly in the trail, so those carry
 * a display name of their own — and, where the skill has a glyph that says more
 * than its kind's generic one, the glyph travels with the row rather than being
 * looked up from the finished label, which is translated and so no longer a
 * stable key.
 */
const skillDisplay: Record<string, {name: string; icon: AgentActivityItem['icon']}> = {
  'browser-use': {name: 'Browser', icon: 'globe'},
};

function skillActivity(value: string): {kind: AgentActivityKind; label: string; icon?: AgentActivityItem['icon']} {
  const known = skillDisplay[value.toLowerCase()];
  const name = known ? known.name : value ? humanize(value) : translate('activity.skill');
  return {
    kind: 'skill',
    label: translate('activity.using', {name}),
    ...(known?.icon ? {icon: known.icon} : {}),
  };
}

function humanize(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const condensedLabels: Record<AgentActivityKind, MessageKey> = {
  thinking: 'activity.summary.thinking',
  compacting: 'activity.summary.compacting',
  reading: 'activity.summary.reading',
  searching: 'activity.summary.searching',
  running: 'activity.summary.running',
  task: 'activity.summary.task',
  memory: 'activity.summary.memory',
  skill: 'activity.summary.skill',
  tool: 'activity.summary.tool',
  resource: 'activity.summary.resource',
  editing: 'activity.summary.editing',
  plugin: 'activity.summary.tool',
  commentary: 'activity.summary.commentary',
};

export function shouldShowAgentActivity(activities: AgentActivityItem[] = []): boolean {
  return activities.length > 0;
}

export function activitySummary(activities: AgentActivityItem[]): string {
  const kinds = [...new Set(activities.map((activity) => activity.kind))];
  return kinds.map((kind) => translate(condensedLabels[kind])).join(', ');
}

/** ChatGPT-style elapsed label: "49s" under a minute, then "6m 58s". The unit
 * letters are part of the catalog — they are abbreviations of words, and not
 * every language abbreviates them to `s` and `m`. */
export function formatElapsedSeconds(seconds: number): string {
  if (seconds < 60) return translate('time.seconds', {seconds});
  return translate('time.minutesSeconds', {minutes: Math.floor(seconds / 60), seconds: seconds % 60});
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
