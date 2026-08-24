import type {AgentTool, AgentToolResult} from "@polymux/core";

/** Bound a research helper inside one delegated run. This is deliberately a
 * wrapper rather than a global runner limit: interactive browser work and
 * unrelated tools must never lose capabilities because one research strategy
 * has a budget. */
export function withPerRunCallLimit(
  tool: AgentTool,
  maximum: number,
  message: string,
): AgentTool {
  return createPerRunCallLimit(maximum, message)(tool);
}

/** One budget shared by every wrapped surface. Research workers often mix a
 * discovery read, direct reads, snapshots and safe page interaction; separate
 * counters would let a model multiply the intended bound by changing tools. */
export function createPerRunCallLimit(
  maximum: number,
  message: string,
): (tool: AgentTool, shouldCount?: (input: unknown) => boolean) => AgentTool {
  const calls = new Map<string, {count: number; touchedAt: number}>();
  return (tool: AgentTool, shouldCount = () => true): AgentTool => ({
      ...tool,
      description: `${tool.description}\n\nDelegated runs share a hard budget of ${maximum} calls across this research tool family. Plan the smallest useful set before the first call and never submit more than ${maximum}, including parallel calls.`,
      async execute(input, context): Promise<AgentToolResult> {
        if (!context.subagent) return tool.execute(input, context);
        // State inspection and form edits on an already identified page are
        // workflow operations, not new public research. A caller can exempt
        // them without splitting the counter shared by genuine research tools.
        if (!shouldCount(input)) return tool.execute(input, context);
        const now = Date.now();
        // Run ids are unique. Opportunistic expiry keeps a long-lived desktop
        // process from retaining one tiny counter for every historical worker.
        for (const [runId, state] of calls) {
          if (now - state.touchedAt > 60 * 60 * 1_000) calls.delete(runId);
        }
        const scope = context.budgetScope ?? context.runId;
        const count = (calls.get(scope)?.count ?? 0) + 1;
        calls.set(scope, {count, touchedAt: now});
        if (count > maximum) {
          return {
            content: message,
            metadata: {budgetReached: true, maximum, attempted: count},
          };
        }
        return tool.execute(input, context);
      },
    });
}
