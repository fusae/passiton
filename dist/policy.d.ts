import type { Session, PolicyConfig, PolicyResult } from './types.js';
export declare const DEFAULT_POLICY: PolicyConfig;
export declare function checkRoundLimit(session: Session, policy: PolicyConfig): PolicyResult;
export declare function checkSessionTimeout(session: Session, policy: PolicyConfig): PolicyResult;
export declare function checkMessageTimeout(startedAt: number, policy: PolicyConfig): PolicyResult;
export declare function detectCompletion(content: string): boolean;
export declare function checkPreRound(session: Session, policy: PolicyConfig): PolicyResult;
//# sourceMappingURL=policy.d.ts.map