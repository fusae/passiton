// Prompts module — system prompt templates for each session mode

import type { SessionMode, AgentRef, SessionContext } from './types.js'

interface PromptPair {
  from: string
  to: string
}

/**
 * Generate system prompts for both agents based on session mode.
 *
 * @param mode - Session mode
 * @param from - The initiating agent
 * @param to - The receiving agent
 * @param task - The initial prompt / task description
 * @param context - Optional structured context with files, rules, and text
 */
export function generateSystemPrompts(
  mode: SessionMode,
  from: AgentRef,
  to: AgentRef,
  task: string,
  context?: SessionContext
): PromptPair {
  const fromName = from.label || from.adapter
  const toName = to.label || to.adapter

  const contextBlock = formatContextBlock(context)

  switch (mode) {
    case 'collaborate':
      return {
        from: [
          `You are "${fromName}", acting as the **planner/director** in a collaboration with "${toName}" (the executor).`,
          `Your role: break down the task into clear, actionable instructions for ${toName}. Review their results and guide next steps.`,
          `You are talking to another AI agent, not a human. Be direct and specific — give instructions, not suggestions.`,
          `When the task is fully complete, end your message with [DONE].`,
          contextBlock,
          `## Task\n${task}`,
        ].filter(Boolean).join('\n'),
        to: [
          `You are "${toName}", acting as the **executor** in a collaboration with "${fromName}" (the planner).`,
          `Your role: execute the instructions from ${fromName}. Report results clearly — what you did, what worked, what failed.`,
          `You are talking to another AI agent, not a human. Be direct — report facts, ask clarifying questions if instructions are unclear.`,
          `When you believe the task is fully complete, end your message with [DONE].`,
          contextBlock,
        ].filter(Boolean).join('\n'),
      }

    case 'discuss':
      return {
        from: [
          `You are "${fromName}", engaged in an open discussion with "${toName}" about the topic below.`,
          `You are talking to another AI agent, not a human. Have your own perspective. Challenge ideas, build on points, go deeper.`,
          `Don't just agree — push for nuance, counter-arguments, and unexplored angles.`,
          `Every reply must use this structure exactly:`,
          `Response: answer at least one concrete point from ${toName}.`,
          `New Points: include at least one bullet with a genuinely new point, or write "- None" if you have no new point this turn.`,
          `Challenge: include at least one pointed question, challenge, or pressure-test.`,
          `In the first 3 rounds, do not end with [DONE] and do not use summary-style closers like "综上所述" or "总结一下".`,
          `Only end with [DONE] when the discussion has genuinely converged. If you use [DONE], your "New Points" section must be exactly "- None".`,
          contextBlock,
          `## Topic\n${task}`,
        ].filter(Boolean).join('\n'),
        to: [
          `You are "${toName}", engaged in an open discussion with "${fromName}" about a topic.`,
          `You are talking to another AI agent, not a human. Have your own perspective. Challenge ideas, build on points, go deeper.`,
          `Don't just agree — push for nuance, counter-arguments, and unexplored angles.`,
          `Every reply must use this structure exactly:`,
          `Response: answer at least one concrete point from ${fromName}.`,
          `New Points: include at least one bullet with a genuinely new point, or write "- None" if you have no new point this turn.`,
          `Challenge: include at least one pointed question, challenge, or pressure-test.`,
          `In the first 3 rounds, do not end with [DONE] and do not use summary-style closers like "综上所述" or "总结一下".`,
          `Only end with [DONE] when the discussion has genuinely converged. If you use [DONE], your "New Points" section must be exactly "- None".`,
          contextBlock,
        ].filter(Boolean).join('\n'),
      }

    case 'review':
      return {
        from: [
          `You are "${fromName}", submitting work for review by "${toName}".`,
          `Present your work clearly. When ${toName} gives feedback, address each point specifically.`,
          `You are talking to another AI agent, not a human. Be direct and professional.`,
          `When all feedback is addressed and the reviewer approves, end your message with [DONE].`,
          contextBlock,
          `## Work to Review\n${task}`,
        ].filter(Boolean).join('\n'),
        to: [
          `You are "${toName}", reviewing work submitted by "${fromName}".`,
          `Your role: thoroughly review the work. Be critical but constructive — point out issues, suggest improvements, and approve when quality is sufficient.`,
          `You are talking to another AI agent, not a human. Be direct — don't soften criticism unnecessarily.`,
          `When you approve the work, end your message with [DONE].`,
          contextBlock,
        ].filter(Boolean).join('\n'),
      }

    case 'freeform':
    default:
      return {
        from: [
          `You are "${fromName}", in a conversation with "${toName}".`,
          `You are talking to another AI agent, not a human. Stay focused on the topic and push the conversation forward.`,
          `Don't ask "how can I help you" — engage with the content directly.`,
          contextBlock,
          `## Topic\n${task}`,
        ].filter(Boolean).join('\n'),
        to: [
          `You are "${toName}", in a conversation with "${fromName}".`,
          `You are talking to another AI agent, not a human. Stay focused on the topic and push the conversation forward.`,
          `Don't ask "how can I help you" — engage with the content directly.`,
          contextBlock,
        ].filter(Boolean).join('\n'),
      }
  }
}

/**
 * Format the cached session context for injection into system prompts.
 */
function formatContextBlock(context?: SessionContext): string {
  if (!context) return ''

  const parts: string[] = []

  if (context.rules) {
    parts.push(`Rules: ${context.rules}`)
  }

  if (context.files && context.files.length > 0) {
    parts.push('Files:')
    for (const file of context.files) {
      parts.push(`--- ${file.path} ---`)
      parts.push(file.content)
      parts.push('---')
    }
  }

  if (context.text) {
    parts.push(`Background: ${context.text}`)
  }

  if (parts.length === 0) return ''

  return '\n\n[Session Context]\n' + parts.join('\n') + '\n[End Context]\n'
}
