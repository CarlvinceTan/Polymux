import type {AgentActivityItem, AgentActivityKind} from '../components/chat/AgentActivity.svelte';

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

export function activityPresentation(name: string, input: Record<string, unknown> = {}): {kind: AgentActivityKind; label: string} {
  const normalized = name.toLowerCase();
  const path = typeof input.path === 'string' ? input.path : '';
  const uri = typeof input.uri === 'string' ? input.uri : '';

  if (normalized.includes('read') && /(?:^|\/)skill\.md$/i.test(path)) {
    const skill = path.split('/').at(-2) ?? 'Skill';
    return {kind: 'skill', label: `Using ${humanizeSkill(skill)}`};
  }
  if (normalized === 'skill' || normalized.startsWith('skill_') || normalized.startsWith('skill.')) {
    const skill = typeof input.name === 'string' ? input.name : 'Skill';
    return {kind: 'skill', label: `Using ${humanizeSkill(skill)}`};
  }
  if (normalized.includes('compact') || normalized.includes('compress') || normalized.includes('optimis') || normalized.includes('optimiz')) {
    return {kind: 'compacting', label: 'Optimising Conversation'};
  }
  if (normalized.includes('think') || normalized.includes('reason')) {
    return {kind: 'thinking', label: 'Thinking'};
  }
  if (normalized.includes('resource') || uri.length > 0 || normalized === 'read_resource' || normalized === 'fetch_resource') {
    const resource = uri ? uri.split('/').at(-1) ?? 'Resource' : typeof input.name === 'string' ? input.name : 'Resource';
    return {kind: 'resource', label: `Using ${humanize(resource)}`};
  }
  if (normalized === 'read' || normalized.includes('read_file')) {
    return {kind: 'reading', label: 'Reading Files'};
  }
  if (normalized === 'edit' || normalized === 'write' || normalized.includes('apply_patch') || normalized.includes('edit_file') || normalized.includes('write_file')) {
    return {kind: 'editing', label: 'Editing Files'};
  }
  if (normalized === 'bash' || normalized.includes('command') || normalized.includes('terminal') || normalized.includes('exec') || normalized === 'sh') {
    return {kind: 'running', label: 'Running Command'};
  }
  if (normalized.includes('search') || normalized.includes('web') || normalized === 'glob' || normalized === 'grep') {
    return {kind: 'searching', label: 'Searching'};
  }
  if (normalized === 'task' || normalized.includes('subagent') || normalized.includes('delegate')) {
    return {kind: 'task', label: 'Delegating Task'};
  }
  if (name.includes('.')) {
    return {kind: 'tool', label: `Using ${humanize(name.split('.')[0]!)}`};
  }
  return {kind: 'tool', label: humanize(name)};
}

// Skills whose folder name reads awkwardly in activity rows. The UI name is the
// one users see in the skills list, so activity labels match it.
const skillDisplayNames: Record<string, string> = {
  'browser-use': 'Browser',
};

function humanizeSkill(value: string): string {
  return skillDisplayNames[value.toLowerCase()] ?? humanize(value);
}

function humanize(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const condensedLabels: Record<AgentActivityKind, string> = {
  thinking: 'Thought',
  compacting: 'Optimised Conversation',
  reading: 'Reading Files',
  searching: 'Searching',
  running: 'Running Commands',
  task: 'Delegating Tasks',
  skill: 'Using Skills',
  tool: 'Using Tools',
  resource: 'Using Resources',
  editing: 'Editing Files',
  plugin: 'Using Tools',
  commentary: 'Shared Updates',
};

export function shouldShowAgentActivity(activities: AgentActivityItem[] = []): boolean {
  return activities.length > 0;
}

export function activitySummary(activities: AgentActivityItem[]): string {
  const kinds = [...new Set(activities.map((activity) => activity.kind))];
  return kinds.map((kind) => condensedLabels[kind]).join(', ');
}

/** ChatGPT-style elapsed label: "49s" under a minute, then "6m 58s". */
export function formatElapsedSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
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
