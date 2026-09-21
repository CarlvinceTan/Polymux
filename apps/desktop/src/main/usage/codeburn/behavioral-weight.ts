// @ts-nocheck -- vendored from codeburn (MIT, https://github.com/getagentseal/codeburn).
// Behavioral weight — the single definition of which served calls count as
// requests. A copilot shutdown rollup, synthesized residual, or store row
// paired with its per-turn call (`supplementaryAccounting`, assigned at serve
// time) carries real tokens and cost but is not a distinct behavioral
// request. Hermes observation-time deltas persist the same flag. Every
// user-visible calls/turns counter weighs calls through these helpers so no
// surface can disagree with the session summaries or the sealed daily
// history. Token and cost sums intentionally keep every call —
// supplementary accounting must never be filtered out, only weightless.

type WeightedCall = { supplementaryAccounting?: boolean }
type WeightedTurn = { assistantCalls: readonly WeightedCall[] }

/** True when the call is a real request (weight 1); false for supplementary accounting (weight 0). */
export function isBehavioralCall(call: WeightedCall): boolean {
  return !call.supplementaryAccounting
}

/** Number of real requests among a turn's calls. */
export function behavioralCallCount(calls: readonly WeightedCall[]): number {
  let n = 0
  for (const call of calls) if (!call.supplementaryAccounting) n++
  return n
}

/** True when the turn holds at least one behavioral call — supplementary-only turns add no turn/edit weight. */
export function isBehavioralTurn(turn: WeightedTurn): boolean {
  return turn.assistantCalls.some(call => !call.supplementaryAccounting)
}

/** Number of behavioral turns (weightless accounting containers excluded). */
export function behavioralTurnCount(turns: readonly WeightedTurn[]): number {
  let n = 0
  for (const turn of turns) if (isBehavioralTurn(turn)) n++
  return n
}
