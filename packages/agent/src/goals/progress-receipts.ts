import type {InferenceMessage, JsonObject} from "@flareai/inference";
import type {JsonValue, Storage} from "@flareai/storage";

const KEY_PREFIX = "goal-progress:";
const MAX_RECEIPTS = 8;
const MAX_RESULT = 900;
const MAX_EVIDENCE = 10;
const SAFE_FIELDS = new Set([
  "account",
  "before",
  "chat",
  "date",
  "domain",
  "folder",
  "from",
  "location",
  "path",
  "platform",
  "query",
  "room",
  "source",
  "to",
  "url",
]);

export interface GoalProgressReceipt {
  id: string;
  goalId: string;
  description: string;
  result: string;
  evidence: string[];
  completedAt: string;
}

/**
 * Persist the useful boundary of a delegated task, not its whole transcript.
 * A goal continuation needs to know what was already checked and what the
 * worker concluded; retaining every model turn would recreate the latency and
 * context pressure this record is meant to remove.
 */
export function recordGoalProgress(
  storage: Storage,
  goalId: string,
  description: string,
  result: string,
  messages: InferenceMessage[],
  now = new Date().toISOString(),
): GoalProgressReceipt {
  const receipt: GoalProgressReceipt = {
    id: crypto.randomUUID(),
    goalId,
    description: compact(description, 160),
    result: compact(result, MAX_RESULT),
    evidence: evidenceCalls(messages).slice(0, MAX_EVIDENCE),
    completedAt: now,
  };
  const previous = readGoalProgress(storage, goalId);
  // Re-running the exact same evidence route should refresh its receipt, not
  // crowd distinct completed work out of the bounded window.
  const identity = receiptIdentity(receipt);
  storage.setPreference(
    `${KEY_PREFIX}${goalId}`,
    [
      ...previous.filter((item) => receiptIdentity(item) !== identity),
      receipt,
    ].slice(-MAX_RECEIPTS) as unknown as JsonValue,
  );
  return receipt;
}

export function readGoalProgress(storage: Storage, goalId: string): GoalProgressReceipt[] {
  const value = storage.getPreference(`${KEY_PREFIX}${goalId}`)?.value;
  if (!Array.isArray(value)) return [];
  return value
    .filter(isReceipt)
    .map((item) => item as unknown as GoalProgressReceipt)
    .slice(-MAX_RECEIPTS);
}

/** Compact run-local context for the next continuation. */
export function goalProgressPrompt(receipts: GoalProgressReceipt[]): string {
  if (!receipts.length) return "";
  const rows = receipts.map((receipt) => {
    const evidence = receipt.evidence.length
      ? `\n  Evidence already read: ${receipt.evidence.join("; ")}`
      : "";
    return `- ${receipt.description} (${receipt.completedAt}): ${receipt.result}${evidence}`;
  });
  return [
    "<goal_progress>",
    "These are receipts from completed delegated work on this durable goal. Use them to identify the unresolved delta. Do not repeat the same source and scope merely to reconfirm it; revisit only when freshness matters, the prior result was incomplete, or a distinct action/source can advance the goal. Receipts are context, not authorization for an external action.",
    ...rows,
    "</goal_progress>",
  ].join("\n");
}

function evidenceCalls(messages: InferenceMessage[]): string[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall" || internalTool(block.name)) continue;
      const scope = safeScope(block.arguments);
      const label = scope ? `${block.name}(${scope})` : block.name;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, count]) => count > 1 ? `${label} x${count}` : label);
}

function safeScope(input: JsonObject): string {
  const fields: string[] = [];
  for (const key of Object.keys(input).sort()) {
    if (!SAFE_FIELDS.has(key.toLowerCase())) continue;
    const value = input[key];
    if (typeof value === "string" && value.trim())
      fields.push(`${key}=${JSON.stringify(compact(value, 120))}`);
    else if (typeof value === "number" || typeof value === "boolean")
      fields.push(`${key}=${String(value)}`);
  }
  return fields.slice(0, 4).join(", ");
}

function internalTool(name: string): boolean {
  return /^(subagent|wait_.*|check_subagents|cancel_subagents|get_goal|update_goal)$/.test(name);
}

function compact(value: string, limit: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function receiptIdentity(receipt: GoalProgressReceipt): string {
  return JSON.stringify([receipt.description.toLowerCase(), [...receipt.evidence].sort()]);
}

function isReceipt(value: JsonValue): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, JsonValue>;
  return [item.id, item.goalId, item.description, item.result, item.completedAt]
    .every((field) => typeof field === "string") &&
    Array.isArray(item.evidence) && item.evidence.every((field) => typeof field === "string");
}
