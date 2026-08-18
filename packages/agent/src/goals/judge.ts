import type {
  InferenceService,
  ModelRef,
  ReasoningEffort,
} from "@flareai/inference";

/**
 * `done` when the objective is satisfied or unreachable, `continue` when more
 * work is needed, `wait` when progress depends on something outside the agent
 * (a reply, an external job) so looping would only burn turns.
 */
export type GoalVerdict = "done" | "continue" | "wait";

export interface GoalJudgement {
  verdict: GoalVerdict;
  reason: string;
}

/**
 * The judge only ever sees the objective and the agent's closing message, so a
 * larger response is truncated rather than allowed to grow the prompt.
 */
const RESPONSE_LIMIT = 4_096;

const systemPrompt = `You judge whether a standing goal has been met.

You receive the goal and the agent's most recent response. Reply with JSON only:
{"verdict": "done" | "continue" | "wait", "reason": "<one sentence>"}

- "done": the response explicitly confirms the goal is complete, the final deliverable is clearly present, or the goal is genuinely unachievable or blocked.
- "wait": further progress depends on something outside the agent's control, such as a human reply or an external job that has not finished.
- "continue": anything else, including partial progress, a plan without execution, or a question the agent could have answered itself.

Be conservative: choose "done" only on explicit confirmation or a clearly finished deliverable. A confident summary is not evidence on its own. Judge the goal only, never the response's style.`;

export class GoalJudge {
  constructor(readonly inference: InferenceService) {}

  /**
   * Judgement failures resolve to `wait` rather than `continue`: an unreadable
   * verdict should pause the loop for the user, never spend the remaining turn
   * budget on a goal nobody has assessed.
   */
  async judge(
    model: ModelRef,
    objective: string,
    lastAgentMessage: string,
    signal?: AbortSignal,
    reasoning?: ReasoningEffort,
  ): Promise<GoalJudgement> {
    const response = lastAgentMessage.trim();
    if (!response)
      return {
        verdict: "wait",
        reason: "The agent ended its turn without a closing message.",
      };
    let answer = "";
    try {
      for await (const event of this.inference.stream({
        model,
        systemPrompt,
        messages: [
          {
            role: "user",
            content: `Goal: ${objective}\n\nAgent's most recent response:\n${response.slice(0, RESPONSE_LIMIT)}`,
          },
        ],
        reasoning,
        signal,
      })) {
        if (event.type === "done")
          answer = event.message.content
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join("\n");
        if (event.type === "error")
          return {
            verdict: "wait",
            reason: `Goal judge failed: ${event.error.message}`,
          };
      }
    } catch (cause) {
      return {
        verdict: "wait",
        reason: `Goal judge failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
    return parseJudgement(answer);
  }
}

export function parseJudgement(answer: string): GoalJudgement {
  const json = extractJson(answer);
  if (!json)
    return {
      verdict: "wait",
      reason: "Goal judge returned no verdict.",
    };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { verdict: "wait", reason: "Goal judge returned malformed JSON." };
  }
  if (!parsed || typeof parsed !== "object")
    return { verdict: "wait", reason: "Goal judge returned malformed JSON." };
  const record = parsed as Record<string, unknown>;
  const verdict = record.verdict;
  if (verdict !== "done" && verdict !== "continue" && verdict !== "wait")
    return {
      verdict: "wait",
      reason: `Goal judge returned an unknown verdict: ${String(verdict)}`,
    };
  const reason =
    typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim()
      : "No reason given.";
  return { verdict, reason };
}

/** Tolerates a fenced or prose-wrapped object, which small models often emit. */
function extractJson(answer: string): string | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return answer.slice(start, end + 1);
}
