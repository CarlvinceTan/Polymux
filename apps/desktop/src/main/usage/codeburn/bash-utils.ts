// @ts-nocheck -- vendored from codeburn (MIT, https://github.com/getagentseal/codeburn).
import { basename } from 'path'
import stripAnsi from 'strip-ansi'

const WHITESPACE = /\s/

function stripQuotedStrings(command: string): string {
  return command.replace(/"[^"]*"|'[^']*'/g, match => ' '.repeat(match.length))
}

const COMMAND_PREFIXES = new Set([
  'sudo', 'doas',
  'npx', 'bunx',
  'time',
  'nice', 'nohup', 'stdbuf',
  'rtk',
])

export function extractBashCommands(rawCommand: string): string[] {
  if (!rawCommand || !rawCommand.trim()) return []

  const command = stripAnsi(rawCommand)
  const stripped = stripQuotedStrings(command)

  // Match the separator alone, then widen over surrounding whitespace by hand.
  // /\s*(?:&&|;|\|)\s*/ retried its leading \s* from every offset, quadratic on
  // long whitespace-heavy commands. Widening is required (not cosmetic): stripQuotedStrings
  // blanks quoted text, and segments are sliced from the original string.
  const separatorRegex = /(?:&&|;|\|)/g
  const separators: Array<{ start: number; end: number }> = []
  let match: RegExpExecArray | null

  while ((match = separatorRegex.exec(stripped)) !== null) {
    let start = match.index
    while (start > 0 && WHITESPACE.test(stripped[start - 1]!)) start--
    let end = match.index + match[0].length
    while (end < stripped.length && WHITESPACE.test(stripped[end]!)) end++
    const prevEnd = separators[separators.length - 1]?.end ?? 0
    separators.push({ start: Math.max(start, prevEnd), end })
    separatorRegex.lastIndex = end
  }

  const ranges: Array<[number, number]> = []
  let cursor = 0
  for (const sep of separators) {
    ranges.push([cursor, sep.start])
    cursor = sep.end
  }
  ranges.push([cursor, command.length])

  const commands: string[] = []
  for (const [start, end] of ranges) {
    const segment = command.slice(start, end).trim()
    if (!segment) continue

    const tokens = segment.split(/\s+/)
    let i = 0
    while (i < tokens.length) {
      if (/^\w+=/.test(tokens[i]!)) { i++; continue }
      const next = tokens[i + 1]
      if (
        next !== undefined &&
        COMMAND_PREFIXES.has(basename(tokens[i]!)) &&
        !next.startsWith('-') &&
        !/["']/.test(next)
      ) { i++; continue }
      break
    }
    const base = i < tokens.length ? basename(tokens[i]!) : ''

    if (base && base !== 'cd' && base !== 'true' && base !== 'false') {
      commands.push(base)
    }
  }

  return commands
}

// Read-shaped shell commands: they inspect state and cannot modify the
// worktree, so (1) the read-edit-ratio detector counts them as reads and
// (2) retry detection does NOT treat them as a verification step between two
// edits of the same file (#941 — both detectors previously disagreed about
// the same Bash call, scoring rg-first workflows as reckless AND reworked).
const READ_ONLY_BASH = new Set([
  'rg', 'grep', 'egrep', 'fgrep', 'ag',
  'cat', 'head', 'tail', 'less', 'more',
  'ls', 'find', 'fd', 'tree',
  'wc', 'stat', 'file', 'du', 'df',
  'which', 'type', 'pwd', 'printenv', 'env',
  'readlink', 'realpath', 'basename', 'dirname',
  'jq', 'diff',
])

// git subcommands that only inspect history/state. Deliberately excludes
// anything that can create or mutate under any flag (branch, tag, stash,
// remote), so a mutation is never misread as a read.
const GIT_READ_SUBCOMMANDS = new Set([
  'log', 'diff', 'status', 'show', 'blame', 'grep',
  'shortlog', 'describe', 'rev-parse', 'ls-files',
])

/// True when EVERY segment of the raw command line (split on &&, ;, |) is a
/// read-only inspection command. A single mutating segment makes the whole
/// call non-read (`cat x && sed -i ...` edits). Unknown commands are
/// non-read: the conservative default both call sites want.
export function isReadShapedBashCommand(rawCommand: string): boolean {
  if (!rawCommand || !rawCommand.trim()) return false
  const stripped = stripQuotedStrings(stripAnsi(rawCommand))
  const segments = stripped.split(/(?:&&|;|\|)/)
  let sawCommand = false
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    const tokens = trimmed.split(/\s+/)
    let i = 0
    while (i < tokens.length && (/^\w+=/.test(tokens[i]!) || COMMAND_PREFIXES.has(basename(tokens[i]!)))) i++
    const base = i < tokens.length ? basename(tokens[i]!) : ''
    if (!base) continue
    sawCommand = true
    if (base === 'git') {
      const sub = tokens[i + 1]
      if (!sub || !GIT_READ_SUBCOMMANDS.has(sub)) return false
      continue
    }
    if (!READ_ONLY_BASH.has(base)) return false
  }
  return sawCommand
}
