// @ts-nocheck -- vendored from codeburn (MIT, https://github.com/getagentseal/codeburn).
import stripAnsi from 'strip-ansi'

import type { DateRange, ProjectSummary } from './types.js'

const FIFTEEN_MINUTES = 15
const ONE_HOUR = 60
const ONE_DAY = 24 * 60
const MINUTE_MS = 60 * 1000
const MAX_SERIES_PER_METRIC = 6
// Keep metadata bounded for the legend and tooltip: 80 characters preserves a
// useful title without letting the parser's 200-char transcript cap dominate
// either UI surface.
const MAX_SESSION_TITLE_LENGTH = 80

export type GranularSeries = {
  id: string
  label: string
}

export type GranularValue = {
  seriesId: string
  cost: number
  tokens: number
}

export type GranularPoint = {
  timestamp: string
  cost: number
  tokens: number
  models: GranularValue[]
  sessions: GranularValue[]
}

export type GranularHistory = {
  bucketMinutes: number
  modelSeries: GranularSeries[]
  sessionSeries: GranularSeries[]
  points: GranularPoint[]
}

type Totals = { cost: number; tokens: number }
type RawBucket = {
  timestamp: string
  cost: number
  tokens: number
  models: Map<string, Totals>
  sessions: Map<string, Totals>
}

type SessionTitleCandidate = {
  title: string
  lastTimestamp: string
}

type SessionLabelInfo = {
  provider: string
  projectPath: string
  projectNames: Set<string>
  sessionId: string
  titleCandidates: Map<string, SessionTitleCandidate>
}

type SessionLabelEntry = {
  key: string
  info: SessionLabelInfo
  baseLabel: string
  idFirst: string
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function granularBucketMinutes(range: DateRange): number {
  const durationMs = Math.max(0, range.end.getTime() - range.start.getTime())
  if (durationMs <= 48 * ONE_HOUR * MINUTE_MS) return FIFTEEN_MINUTES
  // Hourly beyond ~8 days means 200+ points of overlapping spikes; daily
  // buckets keep month-scale charts readable.
  if (durationMs <= 8 * ONE_DAY * MINUTE_MS) return ONE_HOUR
  return ONE_DAY
}

function bucketStart(date: Date, bucketMinutes: number): Date {
  if (bucketMinutes === ONE_DAY) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  // Floor against local wall-clock time so :00 means the user's hour even in
  // half-hour timezones. Applying that timestamp's own offset also keeps the
  // two repeated hours distinct across a daylight-saving fallback.
  const intervalMs = bucketMinutes * MINUTE_MS
  const offsetMs = date.getTimezoneOffset() * MINUTE_MS
  const localEpoch = date.getTime() - offsetMs
  return new Date(Math.floor(localEpoch / intervalMs) * intervalMs + offsetMs)
}

function nextBucket(date: Date, bucketMinutes: number): Date {
  if (bucketMinutes === ONE_DAY) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  }
  return new Date(date.getTime() + bucketMinutes * MINUTE_MS)
}

function add(map: Map<string, Totals>, key: string, cost: number, tokens: number): void {
  const total = map.get(key) ?? { cost: 0, tokens: 0 }
  total.cost += cost
  total.tokens += tokens
  map.set(key, total)
}

function topSeriesKeys(totals: Map<string, Totals>): Set<string> {
  const selected = new Set<string>()
  const rows = [...totals.entries()]
  for (const [key] of [...rows].sort((a, b) => b[1].cost - a[1].cost).slice(0, MAX_SERIES_PER_METRIC)) {
    selected.add(key)
  }
  for (const [key] of [...rows].sort((a, b) => b[1].tokens - a[1].tokens).slice(0, MAX_SERIES_PER_METRIC)) {
    selected.add(key)
  }
  return selected
}

function shortSessionId(sessionId: string): string {
  const trimmed = sessionId.trim()
  return trimmed.length > 12 ? `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}` : trimmed || 'unknown'
}

function cleanSessionTitle(title: string | undefined): string | undefined {
  if (title === undefined) return undefined

  // Match the control-character range used by the model-name sanitizer. ANSI
  // sequences are removed first; remaining controls become spaces so transcript
  // line breaks cannot join words before internal whitespace is collapsed.
  const cleaned = stripAnsi(title)
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return undefined

  return Array.from(cleaned).slice(0, MAX_SESSION_TITLE_LENGTH).join('').trimEnd() || undefined
}

// SessionSummary.lastTimestamp is normally an ISO timestamp, but fixtures and
// older cache entries can be incomplete. Valid timestamps win over invalid
// ones; two invalid values are an exact tie and are resolved alphabetically by
// the caller.
function compareTimestamps(a: string, b: string): number {
  const aMs = Date.parse(a)
  const bMs = Date.parse(b)
  const aValid = Number.isFinite(aMs)
  const bValid = Number.isFinite(bMs)
  if (aValid && bValid) return aMs - bMs
  if (aValid) return 1
  if (bValid) return -1
  return 0
}

function preferredProjectName(projectNames: Set<string>): string {
  return [...projectNames].sort()[0] ?? 'Unknown project'
}

function preferredSessionTitle(titleCandidates: Map<string, SessionTitleCandidate>): string | undefined {
  const cleaned = [...titleCandidates.values()]
    .map(candidate => {
      const title = cleanSessionTitle(candidate.title)
      return title === undefined ? undefined : { title, lastTimestamp: candidate.lastTimestamp }
    })
    .filter((candidate): candidate is SessionTitleCandidate => candidate !== undefined)

  cleaned.sort((a, b) => {
    const timestampOrder = compareTimestamps(b.lastTimestamp, a.lastTimestamp)
    if (timestampOrder !== 0) return timestampOrder
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0
  })
  return cleaned[0]?.title
}

// Chart legend is `max-w-40` at 10px ≈ 24–32 glyphs. A title that is unique in
// that window can lead; otherwise the short id must stay in the prefix or
// truncated series look identical (the #997 class). Count code points, matching
// the title cap — a UTF-16 slice can split an emoji and collide two titles.
const VISIBLE_LEGEND_PREFIX = 24

function visibleLegendPrefix(label: string): string {
  return Array.from(label).slice(0, VISIBLE_LEGEND_PREFIX).join('')
}

function buildSessionLabels(inputs: Map<string, SessionLabelInfo>): Map<string, string> {
  // Stable raw-key order makes the residual used-label guard independent of
  // project/session discovery order when a title happens to match another
  // label shape.
  const draft: SessionLabelEntry[] = [...inputs.entries()].map(([key, info]) => {
    const title = preferredSessionTitle(info.titleCandidates)
    const project = shortProjectLabel(info.projectPath, preferredProjectName(info.projectNames))
    const shortId = shortSessionId(info.sessionId)
    const idFirst = title
      ? `${shortId} (${info.provider}) · ${title}`
      : `${shortId} (${info.provider}) · ${project}`
    const titleFirst = title ? `${title} (${info.provider})` : idFirst
    return { key, info, baseLabel: titleFirst, idFirst }
  }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

  const titlePrefixCounts = new Map<string, number>()
  for (const entry of draft) {
    const prefix = visibleLegendPrefix(entry.baseLabel)
    titlePrefixCounts.set(prefix, (titlePrefixCounts.get(prefix) ?? 0) + 1)
  }
  const entries: SessionLabelEntry[] = draft.map(entry => {
    const prefix = visibleLegendPrefix(entry.baseLabel)
    const titleLeads = (titlePrefixCounts.get(prefix) ?? 0) === 1
    return { ...entry, baseLabel: titleLeads ? entry.baseLabel : entry.idFirst }
  })
  const byBaseLabel = new Map<string, SessionLabelEntry[]>()
  for (const entry of entries) {
    const group = byBaseLabel.get(entry.baseLabel) ?? []
    group.push(entry)
    byBaseLabel.set(entry.baseLabel, group)
  }

  const labels = new Map<string, string>()
  const usedLabels = new Set<string>()
  const setUniqueLabel = (entry: SessionLabelEntry, candidate: string): void => {
    let label = candidate
    if (usedLabels.has(label)) {
      const identity = `${candidate} · ${entry.info.projectPath} · ${entry.info.sessionId}`
      label = identity
      let suffix = 2
      while (usedLabels.has(label)) label = `${identity} · ${suffix++}`
    }
    labels.set(entry.key, label)
    usedLabels.add(label)
  }
  for (const group of byBaseLabel.values()) {
    if (group.length === 1) {
      setUniqueLabel(group[0]!, group[0]!.baseLabel)
      continue
    }

    const projectLabels = group.map(entry => shortProjectLabel(entry.info.projectPath, preferredProjectName(entry.info.projectNames)))
    if (new Set(projectLabels).size === group.length) {
      for (let i = 0; i < group.length; i++) {
        const entry = group[i]!
        setUniqueLabel(entry, `${entry.baseLabel} · ${projectLabels[i]}`)
      }
      continue
    }

    // A short project label can still collide (for example two worktrees with
    // the same final path segments). The full path + id is only used for this
    // residual collision, and is unique because provider/path/id form the key.
    for (const entry of group) {
      setUniqueLabel(entry, `${entry.baseLabel} · ${entry.info.projectPath} · ${entry.info.sessionId}`)
    }
  }
  return labels
}

// Legend labels: the sanitized project dir ("-Users-name-Projects-app") is
// unreadable, so prefer the real projectPath's last two segments ("app/web").
// Fall back to the sanitized name when no usable path exists.
function shortProjectLabel(projectPath: string, fallback: string): string {
  const segments = projectPath.trim().replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean)
  if (segments.length === 0) return fallback
  return segments.slice(-2).join('/')
}

function projectSeries(
  rawBuckets: RawBucket[],
  kind: 'models' | 'sessions',
  totals: Map<string, Totals>,
  labels: Map<string, string>,
): { series: GranularSeries[]; values: GranularValue[][] } {
  const selected = topSeriesKeys(totals)
  const prefix = kind === 'models' ? 'model' : 'session'
  const publicIds = new Map<string, string>()
  const series: GranularSeries[] = []

  let index = 0
  for (const rawKey of selected) {
    const id = `${prefix}_${index++}`
    publicIds.set(rawKey, id)
    series.push({ id, label: labels.get(rawKey) ?? rawKey })
  }

  let hasOther = false
  const otherId = `${prefix}_other`
  const values = rawBuckets.map(bucket => {
    const rows: GranularValue[] = []
    let otherCost = 0
    let otherTokens = 0
    for (const [rawKey, value] of bucket[kind]) {
      const id = publicIds.get(rawKey)
      if (id) {
        rows.push({ seriesId: id, cost: value.cost, tokens: value.tokens })
      } else {
        otherCost += value.cost
        otherTokens += value.tokens
      }
    }
    if (otherCost > 0 || otherTokens > 0) {
      hasOther = true
      rows.push({ seriesId: otherId, cost: otherCost, tokens: otherTokens })
    }
    return rows
  })

  if (hasOther) series.push({ id: otherId, label: 'Other' })
  return { series, values }
}

/**
 * Build a selected-period timeline from real call timestamps. The result is
 * bounded to the top six cost series plus the top six token series for each
 * breakdown; everything else is retained in an aggregate Other series.
 */
export function buildGranularHistory(
  projects: ProjectSummary[],
  range: DateRange,
  now = new Date(),
): GranularHistory {
  const bucketMinutes = granularBucketMinutes(range)
  const effectiveEnd = range.end.getTime() < now.getTime() ? range.end : now
  if (range.start.getTime() > effectiveEnd.getTime()) {
    return { bucketMinutes, modelSeries: [], sessionSeries: [], points: [] }
  }

  const rawBuckets: RawBucket[] = []
  const byTimestamp = new Map<string, RawBucket>()
  for (
    let cursor = bucketStart(range.start, bucketMinutes);
    cursor.getTime() <= effectiveEnd.getTime();
    cursor = nextBucket(cursor, bucketMinutes)
  ) {
    const timestamp = cursor.toISOString()
    const bucket: RawBucket = { timestamp, cost: 0, tokens: 0, models: new Map(), sessions: new Map() }
    rawBuckets.push(bucket)
    byTimestamp.set(timestamp, bucket)
  }

  const modelTotals = new Map<string, Totals>()
  const sessionTotals = new Map<string, Totals>()
  const modelLabels = new Map<string, string>()
  const sessionLabelInputs = new Map<string, SessionLabelInfo>()
  let callCount = 0

  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        for (const call of turn.assistantCalls) {
          const timestamp = Date.parse(call.timestamp)
          if (!Number.isFinite(timestamp) || timestamp < range.start.getTime() || timestamp > effectiveEnd.getTime()) continue
          const bucket = byTimestamp.get(bucketStart(new Date(timestamp), bucketMinutes).toISOString())
          if (!bucket) continue

          const cost = nonNegative(call.costUSD)
          // Match the browser's existing Tokens view: fresh input + output.
          // Cache and reasoning remain available in their dedicated metrics.
          const tokens = nonNegative(call.usage.inputTokens) + nonNegative(call.usage.outputTokens)
          const modelKey = call.model || 'unknown'
          // Session ids are usually globally unique, but a few providers scope
          // them to a workspace. Include the project path so two workspaces do
          // not collapse into one line when they reuse the same local id.
          const sessionKey = `${call.provider}\0${project.projectPath}\0${session.sessionId}`
          const projectName = session.project || project.project || 'Unknown project'

          bucket.cost += cost
          bucket.tokens += tokens
          add(bucket.models, modelKey, cost, tokens)
          add(bucket.sessions, sessionKey, cost, tokens)
          add(modelTotals, modelKey, cost, tokens)
          add(sessionTotals, sessionKey, cost, tokens)
          modelLabels.set(modelKey, modelKey === '<synthetic>' ? 'Other model' : modelKey)
          // Collect raw metadata first. Titles are cleaned once per distinct
          // session-key candidate after all calls are aggregated, so a late
          // cache title can win without putting sanitisation on the call path.
          const labelInfo = sessionLabelInputs.get(sessionKey) ?? {
            provider: call.provider,
            projectPath: project.projectPath,
            projectNames: new Set<string>(),
            sessionId: session.sessionId,
            titleCandidates: new Map<string, SessionTitleCandidate>(),
          }
          labelInfo.projectNames.add(projectName)
          if (session.title !== undefined) {
            const existingTitle = labelInfo.titleCandidates.get(session.title)
            if (!existingTitle || compareTimestamps(session.lastTimestamp, existingTitle.lastTimestamp) > 0) {
              labelInfo.titleCandidates.set(session.title, {
                title: session.title,
                lastTimestamp: session.lastTimestamp,
              })
            }
          }
          sessionLabelInputs.set(sessionKey, labelInfo)
          callCount++
        }
      }
    }
  }

  if (callCount === 0) {
    return { bucketMinutes, modelSeries: [], sessionSeries: [], points: [] }
  }

  const sessionLabels = buildSessionLabels(sessionLabelInputs)
  const modelProjection = projectSeries(rawBuckets, 'models', modelTotals, modelLabels)
  const sessionProjection = projectSeries(rawBuckets, 'sessions', sessionTotals, sessionLabels)
  return {
    bucketMinutes,
    modelSeries: modelProjection.series,
    sessionSeries: sessionProjection.series,
    points: rawBuckets.map((bucket, i) => ({
      timestamp: bucket.timestamp,
      cost: bucket.cost,
      tokens: bucket.tokens,
      models: modelProjection.values[i] ?? [],
      sessions: sessionProjection.values[i] ?? [],
    })),
  }
}
