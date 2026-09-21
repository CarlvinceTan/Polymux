// @ts-nocheck -- vendored from codeburn (MIT, https://github.com/getagentseal/codeburn).
import { formatTokens } from '../format.js'

export type ActionKind =
  | 'mcp-remove' | 'mcp-project-scope'
  | 'defer-enable' | 'defer-alwaysload' | 'defer-threshold'
  | 'archive-skill' | 'archive-agent' | 'archive-command'
  | 'claude-md-rule' | 'shell-config'
  | 'guard-install' | 'guard-uninstall'
  | 'model-default'

export type FileChange = {
  path: string            // absolute path modified
  backup: string | null   // backups/<id>/<n>.bak relative to the actions dir, null if the file did not exist before
  op: 'edit' | 'create' | 'move'
  movedTo?: string        // for op: 'move' (archives)
  destBackup?: string | null  // move ops: snapshot of a file that already existed at movedTo
  afterHash: string       // sha256 of the post-apply bytes, checked for drift on undo
}

// Before/after measurement captured when an action is applied, diffed against
// the post-apply window by `act report`. `metrics` holds the kind-specific
// numbers:
//   mcp-remove / mcp-project-scope: server name -> schema tokens per session
//   archive-skill|agent|command:    item name   -> definition tokens per session
//   claude-md-rule (read/edit rule): { reads, edits }
//   shell-config (bash cap):         { calls }
//   guard-install:                   { abandonedPct, avgSessionCostUSD }
// estimatedTokens is the finding's estimate at apply time (0 for guard, which
// is a correlation signal, not a token estimate). sessions is the affected-scope
// session count over the window, kept out of `metrics` so it can never collide
// with a server literally named "sessions"; it feeds only the volume-shift
// confidence check.
export type ActionBaseline = {
  windowDays: number
  capturedAt: string
  estimatedTokens: number
  sessions: number
  metrics: Record<string, number>
  // model-default only: identifies the candidate independently of metrics key order.
  candidateModel?: string
}

export type ActionRecord = {
  id: string              // crypto.randomUUID()
  at: string              // ISO timestamp
  kind: ActionKind
  findingId: string | null
  description: string     // one human sentence, shown in `act list`
  changes: FileChange[]
  status: 'applied' | 'undone'
  undoneAt?: string
  baseline?: ActionBaseline
}

// expectedHash: sha256 of the raw on-disk bytes the plan's content was
// computed from (null when the plan expects the file to be absent). runAction
// refuses to apply when the target no longer matches, so a file edited
// between preview and confirm is never silently clobbered with stale
// content. undefined skips the check.
export type PlannedChange =
  | { op: 'edit'; path: string; content: string | Buffer; expectedHash?: string | null }
  | { op: 'create'; path: string; content: string | Buffer; expectedHash?: string | null }
  | { op: 'move'; path: string; movedTo: string }

export type ActionPlan = {
  kind: ActionKind
  description: string
  findingId?: string | null
  changes: PlannedChange[]
  baseline?: ActionBaseline
  // MCP plans only: exact server identities the generated file mutations own.
  // Preview and baseline capture must not claim skipped/managed targets.
  affectedMcpServers?: string[]
  // Relevant config scopes could not all be read, so removal may proceed
  // with warnings but savings/baseline claims must be suppressed.
  mcpSavingsUncertain?: boolean
}

// Applied actions are re-measured on every `codeburn optimize` run: only fixes
// at least this old have a post-apply window to measure against.
export const REPORT_MIN_AGE_DAYS = 3
// A fix counts as having worked once it realizes this share of its
// window-scaled estimate; anything above zero but below it is partial.
export const VERDICT_WORKED_RATIO = 0.7

// Per-applied-entry judgement shown by `codeburn optimize` after an --apply.
// Computed in act/report.ts from the same rows `act report` prints - there is
// one reconciliation, not two. Lives here so the optimize renderer can format
// it without importing report.ts back into optimize.ts.
export type AppliedVerdict = 'worked' | 'partial' | 'no-effect' | 'pending'

export type AppliedFix = {
  id: string
  kind: ActionKind
  findingId: string | null
  appliedAt: string
  ageDays: number
  verdict: AppliedVerdict
  // Window-scaled estimate, the same column `act report` compares against.
  estimatedTokens: number
  realizedTokens: number
  note: string
  undoCommand: string
}

const VERDICT_GLYPH: Record<AppliedVerdict, string> = {
  worked: '\u2713',
  partial: '~',
  'no-effect': '\u2717',
  pending: '\u2026',
}

export function appliedFixGlyph(fix: AppliedFix): string {
  return VERDICT_GLYPH[fix.verdict]
}

// One plain line per applied fix: what it estimated, what it measured, and for
// a fix that did nothing, how to put it back.
export function formatAppliedFix(fix: AppliedFix): string {
  const age = Math.max(0, Math.floor(fix.ageDays))
  const head = `${fix.findingId ?? fix.kind} (${age}d ago)`
  if (fix.verdict === 'pending') {
    const why = fix.note || (age <= REPORT_MIN_AGE_DAYS
      ? `measuring, check back after ${REPORT_MIN_AGE_DAYS} days`
      : 'measuring')
    return `${head}: ${why}`
  }
  const pair = `est. ${formatTokens(fix.estimatedTokens)} -> measured ${formatTokens(fix.realizedTokens)}`
  if (fix.verdict === 'worked') return `${head}: ${pair}`
  if (fix.verdict === 'partial') {
    const under = Math.round((1 - fix.realizedTokens / fix.estimatedTokens) * 100)
    return `${head}: ${pair} (-${under}% vs estimate)`
  }
  return `${head}: ${pair} - did not help. Revert: ${fix.undoCommand}`
}
