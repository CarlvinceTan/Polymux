// @ts-nocheck -- vendored from codeburn (MIT, https://github.com/getagentseal/codeburn).
// Copilot AI credits. Official rate from GitHub Docs, *Usage-based billing
// for individuals*, fetched 2026-08-23:
// https://docs.github.com/copilot/concepts/billing/usage-based-billing-for-individuals
// 1e9 nano-AIU = 1 credit = $0.01. No per-model rate table in this slice.

export const NANO_AIU_PER_CREDIT = 1e9
export const AI_CREDIT_USD = 0.01

export function isFiniteNanoAiu(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function nanoAiuToCredits(nanoAiu: number): number {
  return nanoAiu / NANO_AIU_PER_CREDIT
}

export function creditsToUsd(credits: number): number {
  return credits * AI_CREDIT_USD
}
