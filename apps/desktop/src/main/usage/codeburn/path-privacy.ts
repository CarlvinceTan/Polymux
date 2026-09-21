// @ts-nocheck -- vendored from codeburn (MIT, https://github.com/getagentseal/codeburn).
import { homedir } from './home.js'
import { posix, win32 } from 'node:path'

function normalizedPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Provider-owned container roots are not host workspaces, even when absolute. */
function isProviderContainerWorkingDirectory(value: string): boolean {
  return /^\/sessions\/[^/]+$/i.test(normalizedPath(value))
}

/** True when an absolute path identifies a user home root, not a project. */
export function isUserHomeRoot(value: string | undefined): boolean {
  if (!value) return false
  const normalized = normalizedPath(value)
  if (normalized.toLowerCase() === normalizedPath(homedir()).toLowerCase()) return true
  return /(?:^|\/)(?:users|home|profiles)\/[^/]+$/i.test(normalized)
    || normalized === '/root'
}

/** Absolute, non-home provider cwd eligible for outbound provenance. */
export function isTrustedAbsoluteWorkingDirectory(value: string | undefined): value is string {
  if (!value || isUserHomeRoot(value) || isProviderContainerWorkingDirectory(value)) return false
  return posix.isAbsolute(value) || win32.isAbsolute(value)
}
