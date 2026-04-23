// Policy module — enforce round limits, timeouts, completion detection
export const DEFAULT_POLICY = {
    maxRounds: 20,
    messageTimeout: 5 * 60 * 1000, // 5 minutes
    sessionTimeout: 2 * 60 * 60 * 1000, // 2 hours
    retries: 1,
};
// Check whether we can start another round
export function checkRoundLimit(session, policy) {
    if (session.currentRound >= session.maxRounds) {
        return { allowed: false, reason: 'max_rounds' };
    }
    return { allowed: true };
}
// Check whether the session has exceeded its wall-clock timeout
export function checkSessionTimeout(session, policy) {
    const elapsed = Date.now() - session.createdAt;
    if (elapsed >= policy.sessionTimeout) {
        return { allowed: false, reason: 'session_timeout' };
    }
    return { allowed: true };
}
// Check whether a single message call exceeded its timeout
export function checkMessageTimeout(startedAt, policy) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= policy.messageTimeout) {
        return { allowed: false, reason: 'message_timeout' };
    }
    return { allowed: true };
}
// Detect task completion — agent outputs [DONE]
export function detectCompletion(content) {
    return /\[DONE\]/i.test(content);
}
// Run all pre-round checks (round limit + session timeout)
export function checkPreRound(session, policy) {
    const roundCheck = checkRoundLimit(session, policy);
    if (!roundCheck.allowed)
        return roundCheck;
    const timeoutCheck = checkSessionTimeout(session, policy);
    if (!timeoutCheck.allowed)
        return timeoutCheck;
    return { allowed: true };
}
//# sourceMappingURL=policy.js.map