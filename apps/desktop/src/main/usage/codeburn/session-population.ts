// @ts-nocheck -- vendored from codeburn (MIT, https://github.com/getagentseal/codeburn).
import type { ProjectSummary, SessionSummary } from './types.js'

/**
 * Sidechains are real usage, but they are not user-started work sessions.
 * Behavioral consumers should use this predicate or the projected project
 * view below; accounting and configuration consumers should use the originals.
 */
export function isUserStartedSession(session: SessionSummary): boolean {
  return session.isSidechain !== true
}

export function withUserStartedSessions(project: ProjectSummary): ProjectSummary {
  const sessions = project.sessions.filter(isUserStartedSession)
  if (sessions.length === project.sessions.length) return project

  const totalCostUSD = sessions.reduce((sum, session) => sum + session.totalCostUSD, 0)
  return {
    ...project,
    sessions,
    totalCostUSD,
    totalSavingsUSD: sessions.reduce((sum, session) => sum + session.totalSavingsUSD, 0),
    totalEstimatedCostUSD: project.totalEstimatedCostUSD === undefined
      ? undefined
      : sessions.reduce((sum, session) => sum + (session.totalEstimatedCostUSD ?? 0), 0),
    totalApiCalls: sessions.reduce((sum, session) => sum + session.apiCalls, 0),
    // Proxy coverage is project-scoped and applies to every retained session
    // whenever it applies to the source project.
    totalProxiedCostUSD: project.totalProxiedCostUSD > 0 ? totalCostUSD : 0,
  }
}

export function userStartedProjects(projects: ProjectSummary[]): ProjectSummary[] {
  return projects.map(withUserStartedSessions)
}
