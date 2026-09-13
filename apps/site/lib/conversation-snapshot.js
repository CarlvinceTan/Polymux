export const SHARE_TTL_SECONDS = 86400;
export const MAX_SNAPSHOT_BYTES = 1_000_000;

/** A deliberately small public contract: no file paths, run IDs, or live previews.
 * @param {any} source
 * @param {string | undefined} throughId
 */
export function conversationSnapshot(source, throughId = undefined) {
  if (!source || typeof source.title !== 'string' || !Array.isArray(source.messages)) throw new Error('Invalid conversation');
  const end = throughId === undefined ? source.messages.length - 1 : source.messages.findIndex((/** @type {any} */ m) => m.id === throughId && m.role === 'assistant');
  if (throughId !== undefined && end < 0) throw new Error('Response no longer exists');
  const string = (/** @type {any} */ value, max = 200_000) => {
    if (typeof value !== 'string' || value.length > max) throw new Error('Invalid snapshot text');
    return value;
  };
  const date = (/** @type {any} */ value) => value === undefined ? undefined : new Date(string(value, 40)).toISOString();
  const statuses = ['pending', 'active', 'completed', 'failed'];
  const kinds = ['thinking', 'compacting', 'reading', 'searching', 'running', 'task', 'memory', 'skill', 'tool', 'resource', 'editing', 'messaging', 'mail', 'plugin', 'commentary'];
  const messages = source.messages.slice(0, end + 1).map((/** @type {any} */ m, /** @type {number} */ index) => {
    if (!['user', 'assistant'].includes(m.role)) throw new Error('Invalid message role');
    return {
      id: String(index), role: m.role, text: string(m.text), sentAt: date(m.sentAt),
      asGoal: m.asGoal === true,
      startedAt: date(m.startedAt), completedAt: date(m.completedAt ?? (m.startedAt ? new Date().toISOString() : undefined)),
      files: m.files === undefined ? undefined : m.files.map((/** @type {any} */ f) => string(f, 512).split(/[\\/]/).pop()),
      activities: m.activities === undefined ? undefined : m.activities.map((/** @type {any} */ a, /** @type {number} */ i) => {
        if (!kinds.includes(a.kind) || !statuses.includes(a.status)) throw new Error('Invalid activity');
        return {id: String(i), kind: a.kind, status: a.status, label: string(a.label),
          icon: ['globe', 'computer'].includes(a.icon) ? a.icon : undefined,
          target: a.target === undefined ? undefined : string(a.target),
          result: a.result === undefined ? undefined : string(a.result),
          count: Number.isSafeInteger(a.count) && a.count > 0 ? a.count : undefined,
          steps: a.steps?.map((/** @type {any} */ step, /** @type {number} */ j) => {
            if (!statuses.includes(step.status)) throw new Error('Invalid activity step');
            return {id: String(j), label: string(step.label), status: step.status, result: step.result === undefined ? undefined : string(step.result)};
          })};
      }),
    };
  });
  if (!messages.length || messages.length > 2000) throw new Error('Share requires 1–2000 messages');
  const snapshot = {version: 1, title: string(source.title, 500), messages};
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > MAX_SNAPSHOT_BYTES) throw new Error('Conversation is too large to share');
  return snapshot;
}
