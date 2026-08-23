import type { ModelRef, ReasoningEffort } from "@polymux/inference";
import type { Goal } from "@polymux/storage";
import type { GoalJudge, GoalJudgement } from "./judge.js";
import type { GoalManager } from "./manager.js";

export interface GoalLoopSettings {
  enabled: boolean;
  /**
   * How many continuation turns a single objective may spend before the loop
   * pauses itself. The budget is the load-bearing safety limit: the judge only
   * reads the agent's closing message, so it can be talked into `continue`
   * indefinitely by an agent that keeps reporting near-completion.
   */
  maxTurns: number;
}

export const defaultGoalLoopSettings: GoalLoopSettings = {
  enabled: true,
  maxTurns: 20,
};

export type GoalLoopAction = "continue" | "completed" | "paused" | "inactive";

export interface GoalLoopDecision {
  action: GoalLoopAction;
  /** Present only when `action` is `continue`; the next run's user message. */
  prompt?: string;
  reason?: string;
  turnsUsed: number;
  judgement?: GoalJudgement;
}

export interface GoalLoopTurn {
  conversationId: string;
  model: ModelRef;
  /** Effort the judge reads at, when the judge role carries its own level. */
  reasoning?: ReasoningEffort;
  lastAgentMessage: string;
  signal?: AbortSignal;
}

/**
 * Drives a standing goal across runs. After a run settles, the judge decides
 * whether the objective is met; when it is not, the loop hands back the prompt
 * for another run so the agent keeps working without the user re-prompting.
 *
 * Each continuation is a fresh run that re-reads conversation state from
 * storage, so no state is threaded through this class beyond the turn budget.
 */
export class GoalLoop {
  readonly #goals: GoalManager;
  readonly #judge: GoalJudge;
  readonly #settings: GoalLoopSettings;
  /**
   * Continuations spent per conversation. Deliberately in memory: a restart
   * ends the loop anyway, so the counter should start fresh alongside it.
   */
  readonly #spent = new Map<string, number>();

  constructor(
    goals: GoalManager,
    judge: GoalJudge,
    settings: Partial<GoalLoopSettings> = {},
  ) {
    this.#goals = goals;
    this.#judge = judge;
    this.#settings = { ...defaultGoalLoopSettings, ...settings };
  }

  get settings(): GoalLoopSettings {
    return this.#settings;
  }

  turnsUsed(conversationId: string): number {
    return this.#spent.get(conversationId) ?? 0;
  }

  /** Called when the user drives the conversation themselves. */
  resetBudget(conversationId: string): void {
    this.#spent.delete(conversationId);
  }

  async afterRun(turn: GoalLoopTurn): Promise<GoalLoopDecision> {
    const turnsUsed = this.turnsUsed(turn.conversationId);
    const goal = this.#goals.get(turn.conversationId);
    if (!this.#settings.enabled || !isDriveable(goal))
      return { action: "inactive", turnsUsed };

    if (turnsUsed >= this.#settings.maxTurns) {
      this.#goals.execute(turn.conversationId, { action: "pause" });
      return {
        action: "paused",
        reason: `Goal paused — ${turnsUsed}/${this.#settings.maxTurns} turns used.`,
        turnsUsed,
      };
    }

    const judgement = await this.#judge.judge(
      turn.model,
      goal.objective,
      turn.lastAgentMessage,
      turn.signal,
      turn.reasoning,
    );

    if (judgement.verdict === "done") {
      this.#goals.setStatus(turn.conversationId, "completed");
      this.resetBudget(turn.conversationId);
      return {
        action: "completed",
        reason: judgement.reason,
        turnsUsed,
        judgement,
      };
    }

    if (judgement.verdict === "wait") {
      this.#goals.execute(turn.conversationId, { action: "pause" });
      return {
        action: "paused",
        reason: judgement.reason,
        turnsUsed,
        judgement,
      };
    }

    const next = turnsUsed + 1;
    this.#spent.set(turn.conversationId, next);
    return {
      action: "continue",
      prompt: continuationPrompt(goal.objective, judgement.reason),
      reason: judgement.reason,
      turnsUsed: next,
      judgement,
    };
  }
}

function isDriveable(goal: Goal | null): goal is Goal {
  return goal !== null && goal.status === "active";
}

/**
 * Names the shortfall so the next run has something to act on, and keeps the
 * honest exits open — an agent with no way to report an impasse will invent
 * completion instead.
 */
function continuationPrompt(objective: string, reason: string): string {
  return [
    `Continue working toward the standing goal: ${objective}`,
    `The goal is not yet satisfied: ${reason}`,
    "Take the next concrete step yourself rather than reporting a plan. If the goal is genuinely finished, say so explicitly and state what verifies it. If you are at a real impasse, say what is blocking you.",
  ].join("\n\n");
}
