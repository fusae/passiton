import type { SessionMode, AgentRef } from './types.js';
interface PromptPair {
    from: string;
    to: string;
}
/**
 * Generate system prompts for both agents based on session mode.
 *
 * @param mode - Session mode
 * @param from - The initiating agent
 * @param to - The receiving agent
 * @param task - The initial prompt / task description
 * @param context - Optional background context from prior conversations
 */
export declare function generateSystemPrompts(mode: SessionMode, from: AgentRef, to: AgentRef, task: string, context?: string): PromptPair;
export {};
//# sourceMappingURL=prompts.d.ts.map