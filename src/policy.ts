// Policy module — enforce round limits, timeouts, completion detection

import type { Session, PolicyConfig, PolicyResult } from './types.js'

export const DEFAULT_POLICY: PolicyConfig = {
  maxRounds: 20,
  messageTimeout: 5 * 60 * 1000,   // 5 minutes
  messageRetentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  sessionTimeout: 2 * 60 * 60 * 1000, // 2 hours
  retries: 1,
}

// Check whether we can start another round
export function checkRoundLimit(session: Session, policy: PolicyConfig): PolicyResult {
  if (session.currentRound >= session.maxRounds) {
    return { allowed: false, reason: 'max_rounds' }
  }
  return { allowed: true }
}

// Check whether the session has exceeded its wall-clock timeout
export function checkSessionTimeout(session: Session, policy: PolicyConfig): PolicyResult {
  const elapsed = Date.now() - session.createdAt
  if (elapsed >= policy.sessionTimeout) {
    return { allowed: false, reason: 'session_timeout' }
  }
  return { allowed: true }
}

// Check whether a single message call exceeded its timeout
export function checkMessageTimeout(startedAt: number, policy: PolicyConfig): PolicyResult {
  const elapsed = Date.now() - startedAt
  if (elapsed >= policy.messageTimeout) {
    return { allowed: false, reason: 'message_timeout' }
  }
  return { allowed: true }
}

// Detect task completion — agent outputs [DONE]
export function detectCompletion(content: string): boolean {
  return /\[DONE\]/i.test(content)
}

// Run all pre-round checks (round limit + session timeout)
export function checkPreRound(session: Session, policy: PolicyConfig): PolicyResult {
  const roundCheck = checkRoundLimit(session, policy)
  if (!roundCheck.allowed) return roundCheck

  const timeoutCheck = checkSessionTimeout(session, policy)
  if (!timeoutCheck.allowed) return timeoutCheck

  return { allowed: true }
}
