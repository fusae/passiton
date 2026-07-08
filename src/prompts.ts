// Prompts module — system prompt templates for each session mode

import type { SessionMode, AgentRef, SessionContext, SessionContextFile } from './types.js'

// ── Context clamping ──────────────────────────────────────────────────────────

/** Maximum size of a single context file content (256 KB). */
export const CONTEXT_FILE_MAX_BYTES = 256 * 1024
/** Maximum total size of all context files + text (2 MB). */
export const CONTEXT_TOTAL_MAX_BYTES = 2 * 1024 * 1024

/**
 * Clamp a SessionContext so that no single file exceeds {@link CONTEXT_FILE_MAX_BYTES}
 * and the combined size of all files + text stays within {@link CONTEXT_TOTAL_MAX_BYTES}.
 *
 * When truncation occurs, a marker line is appended to the affected content
 * so consumers can tell their data was modified.
 *
 * Returns a *new* object — the input is never mutated.
 */
export function clampSessionContext(context?: SessionContext): SessionContext | undefined {
  if (!context) return context

  // Helper: truncate a string to *byteLength* and append a marker.
  function truncateWithMarker(content: string, maxBytes: number, originalBytes: number): string {
    // Encode, slice at byte boundary, decode back (handles multi-byte chars).
    const buf = Buffer.from(content, 'utf8')
    if (buf.length <= maxBytes) return content
    const sliced = buf.subarray(0, Math.max(0, maxBytes - 200)) // leave room for marker
    let result = sliced.toString('utf8')
    // Fix any trailing partial multi-byte sequence.
    for (let i = 0; i < 4; i++) {
      try {
        result = Buffer.from(result, 'utf8').toString('utf8')
        break
      } catch {
        result = result.slice(0, -1)
      }
    }
    const originalKB = Math.round(originalBytes / 1024)
    const keptKB = Math.round(maxBytes / 1024)
    result += `\n[Turing: file truncated from ${originalKB}KB to ${keptKB}KB]`
    return result
  }

  // Byte-length helper (UTF-8).
  function byteLength(s: string): number {
    return Buffer.byteLength(s, 'utf8')
  }

  // --- Phase 1: clamp individual files to CONTEXT_FILE_MAX_BYTES ---
  let files: SessionContextFile[] | undefined
  let fileChanged = false
  if (context.files && context.files.length > 0) {
    files = context.files.map((file) => {
      const originalBytes = byteLength(file.content)
      if (originalBytes > CONTEXT_FILE_MAX_BYTES) {
        fileChanged = true
        return {
          ...file,
          content: truncateWithMarker(file.content, CONTEXT_FILE_MAX_BYTES, originalBytes),
        }
      }
      return file
    })
  }

  // --- Phase 2: if total files + text still exceeds limit, shrink largest files ---
  let text = context.text
  const computeTotal = (): number => {
    let total = 0
    for (const f of files ?? []) total += byteLength(f.content)
    if (text) total += byteLength(text)
    return total
  }

  let totalChanged = false
  while (computeTotal() > CONTEXT_TOTAL_MAX_BYTES && files && files.length > 0) {
    // Find the largest file by current byte size.
    let maxIndex = 0
    let maxSize = 0
    for (let i = 0; i < files.length; i++) {
      const size = byteLength(files[i].content)
      if (size > maxSize) {
        maxSize = size
        maxIndex = i
      }
    }
    if (maxSize === 0) break

    const total = computeTotal()
    const overage = total - CONTEXT_TOTAL_MAX_BYTES
    const currentSize = byteLength(files[maxIndex].content)
    const targetSize = Math.max(0, currentSize - overage)
    if (targetSize === 0) {
      // Remove the file entirely if target is 0.
      files.splice(maxIndex, 1)
      totalChanged = true
      continue
    }
    const originalContent = files[maxIndex].content
    const originalBytes = byteLength(originalContent)
    files[maxIndex] = {
      ...files[maxIndex],
      content: truncateWithMarker(originalContent, targetSize, originalBytes),
    }
    totalChanged = true
  }

  // If text alone is still over the limit (rare, but possible if no files),
  // truncate it too.
  if (text) {
    const textBytes = byteLength(text)
    if (textBytes > CONTEXT_TOTAL_MAX_BYTES) {
      text = truncateWithMarker(text, CONTEXT_TOTAL_MAX_BYTES, textBytes)
      totalChanged = true
    }
  }

  // Build result only if something changed (avoid unnecessary copy).
  if (!fileChanged && !totalChanged) return context

  console.warn(`[turing] session context clamped (file-level=${fileChanged}, total-level=${totalChanged})`)

  const result: SessionContext = {}
  if (context.rules) result.rules = context.rules
  if (files && files.length > 0) result.files = files
  if (text) result.text = text
  return Object.keys(result).length > 0 ? result : undefined
}

interface PromptPair {
  from: string
  to: string
}

export interface PromptCapabilities {
  fromCanUseTools?: boolean
  toCanUseTools?: boolean
}

const TURING_AWARENESS = 'You are operating inside Turing, an agent-to-agent orchestration system. If the task should be split into parallel or dependent sub-tasks, explicitly propose a Turing pipeline/session plan instead of losing scope in one thread. When your task is complete, wrap your final result or summary in [RESULT]...[/RESULT] tags.'

const PROGRESS_OUTPUT_GUIDANCE = 'For long-running tasks, output brief progress as you work — one short line per completed step or file. Extended silence risks triggering an idle timeout that terminates your process.'

const HUMAN_SUMMON_PROTOCOL = [
  '## Summoning the human',
  'The human overseeing this session is NOT watching continuously — they rely on you to call them. Emit a [HUMAN_NEEDED] block and stop when ANY of these are true:',
  '- You must choose between materially different directions and the right one depends on human intent.',
  '- You are about to take an irreversible action (delete, overwrite, publish, send).',
  '- You have tried twice and are still blocked.',
  '- Requirements are ambiguous and guessing wrong would waste significant work.',
  'Block format:',
  '[HUMAN_NEEDED]',
  '<one-sentence question>',
  'Options:',
  '- A: <option A>',
  '- B: <option B>',
  '[/HUMAN_NEEDED]',
  'After the block, stop and wait. The human will respond and the session resumes. Do NOT use [HUMAN_NEEDED] for routine progress or anything you can resolve yourself by reading files or running commands.',
].join('\n')

export function generateTaskSystemPrompt(context?: SessionContext): string {
  return [
    `You are the lead agent for a task inside Turing.`,
    `Follow the existing workflow and repository instructions for this task.`,
    `If the workflow requires delegation, create the necessary Turing sessions or pipelines and use their outputs instead of collapsing the work into one-agent execution.`,
    `Do not assume you must do every step yourself just because this task was assigned to you.`,
    `When the task is complete, wrap your final result or summary in [RESULT]...[/RESULT] tags.`,
    PROGRESS_OUTPUT_GUIDANCE,
    formatContextBlock(context),
  ].filter(Boolean).join('\n')
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
  context?: SessionContext,
  capabilities?: PromptCapabilities
): PromptPair {
  const fromName = from.label || from.adapter
  const toName = to.label || to.adapter

  const contextBlock = formatContextBlock(context)

  switch (mode) {
    case 'collaborate': {
      const fromCanUseTools = capabilities?.fromCanUseTools ?? true
      const toCanUseTools = capabilities?.toCanUseTools ?? true

      const plannerNoToolWarning = !fromCanUseTools
        ? [
            `CRITICAL: You are an API-based agent — you CANNOT execute tools, write files, or run commands.`,
            `Do NOT output XML tool tags like <write_file>, <bash>, <read_file>, <file_editor>, etc. They will NOT be executed.`,
            `Your messages are plain-text instructions sent to ${toName}. Describe WHAT needs to be done clearly and completely.`,
            `${toName} has its own tools and will decide how to implement your instructions.`,
            `Do NOT say [DONE] until ${toName} confirms it has actually completed the work and verified the results.`,
          ].join('\n')
        : ''

      const executorVerifyWarning = !fromCanUseTools
        ? `IMPORTANT: ${fromName} cannot execute tools — it can only give you instructions via text. If ${fromName}'s message contains tool-like XML tags (<write_file>, <bash>, etc.), those were NOT executed. You must implement everything yourself. Always verify by reading files or running commands after making changes.`
        : ''
      const executorNoToolWarning = !toCanUseTools
        ? [
            `CRITICAL: You are an API-based agent — you CANNOT execute tools, write files, create directories, or run commands.`,
            `Do NOT output XML tool tags like <write_file>, <create_directory>, <read_file>, or <bash>; they will NOT be executed.`,
            `Produce the complete requested content in plain text for ${fromName} to materialize and verify.`,
            `If you need an inaccessible file, webpage, command result, or verification, emit an [ASSIST_REQUEST] block with action, target, and purpose, then wait for ${fromName}.`,
            `Do NOT claim a file exists and do NOT say [DONE].`,
          ].join('\n')
        : ''
      const plannerMustExecuteWarning = fromCanUseTools && !toCanUseTools
        ? [
            `IMPORTANT: ${toName} cannot read, browse, execute, write, or verify external resources.`,
            `When it returns an [ASSIST_REQUEST] block or says it cannot access a required resource, you MUST use your tools to complete that work immediately and send the concrete result back.`,
            `Do not redirect the request to the human or merely explain how to do it.`,
            `You must also create and verify every required file from ${toName}'s content. Do not accept simulated tool tags as execution.`,
          ].join('\n')
        : ''

      return {
        from: [
          `You are "${fromName}", acting as the **planner/director** in a collaboration with "${toName}" (the executor).`,
          `Your role: break down the task into clear, actionable instructions for ${toName}. Review their results and guide next steps.`,
          `You are talking to another AI agent, not a human. Be direct and specific — give instructions, not suggestions.`,
          plannerNoToolWarning,
          plannerMustExecuteWarning,
          TURING_AWARENESS,
          HUMAN_SUMMON_PROTOCOL,
          `When the task is fully complete, end your message with [DONE].`,
          contextBlock,
          `## Task\n${task}`,
        ].filter(Boolean).join('\n'),
        to: [
          `You are "${toName}", acting as the **executor** in a collaboration with "${fromName}" (the planner).`,
          `Your role: execute the instructions from ${fromName}. Report results clearly — what you did, what worked, what failed.`,
          `You are talking to another AI agent, not a human. Be direct — report facts, ask clarifying questions if instructions are unclear.`,
          executorVerifyWarning,
          executorNoToolWarning,
          TURING_AWARENESS,
          HUMAN_SUMMON_PROTOCOL,
          PROGRESS_OUTPUT_GUIDANCE,
          `When you believe the task is fully complete, end your message with [DONE].`,
          contextBlock,
        ].filter(Boolean).join('\n'),
      }
    }

    case 'discuss':
      return {
        from: [
          `You are "${fromName}", engaged in an open discussion with "${toName}" about the topic below.`,
          `You are talking to another AI agent, not a human. Have your own perspective. Challenge ideas, build on points, go deeper.`,
          TURING_AWARENESS,
          HUMAN_SUMMON_PROTOCOL,
          `Don't just agree — push for nuance, counter-arguments, and unexplored angles.`,
          `Every reply must use this structure exactly:`,
          `Response: answer at least one concrete point from ${toName}.`,
          `New Points: include at least one bullet with a genuinely new point, or write "- None" if you have no new point this turn.`,
          `Challenge: include at least one pointed question, challenge, or pressure-test.`,
          `In the first 3 rounds, do not end with [DONE] and do not use summary-style closers such as "in summary" or equivalent closing phrases.`,
          `Only end with [DONE] when the discussion has genuinely converged. If you use [DONE], your "New Points" section must be exactly "- None".`,
          contextBlock,
          `## Topic\n${task}`,
        ].filter(Boolean).join('\n'),
        to: [
          `You are "${toName}", engaged in an open discussion with "${fromName}" about a topic.`,
          `You are talking to another AI agent, not a human. Have your own perspective. Challenge ideas, build on points, go deeper.`,
          TURING_AWARENESS,
          HUMAN_SUMMON_PROTOCOL,
          `Don't just agree — push for nuance, counter-arguments, and unexplored angles.`,
          `Every reply must use this structure exactly:`,
          `Response: answer at least one concrete point from ${fromName}.`,
          `New Points: include at least one bullet with a genuinely new point, or write "- None" if you have no new point this turn.`,
          `Challenge: include at least one pointed question, challenge, or pressure-test.`,
          `In the first 3 rounds, do not end with [DONE] and do not use summary-style closers such as "in summary" or equivalent closing phrases.`,
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
          TURING_AWARENESS,
          HUMAN_SUMMON_PROTOCOL,
          `When all feedback is addressed and the reviewer approves, end your message with [DONE].`,
          contextBlock,
          `## Work to Review\n${task}`,
        ].filter(Boolean).join('\n'),
        to: [
          `You are "${toName}", reviewing work submitted by "${fromName}".`,
          `Your role: thoroughly review the work. Be critical but constructive — point out issues, suggest improvements, and approve when quality is sufficient.`,
          `You are talking to another AI agent, not a human. Be direct — don't soften criticism unnecessarily.`,
          TURING_AWARENESS,
          HUMAN_SUMMON_PROTOCOL,
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
          TURING_AWARENESS,
          HUMAN_SUMMON_PROTOCOL,
          `Don't ask "how can I help you" — engage with the content directly.`,
          contextBlock,
          `## Topic\n${task}`,
        ].filter(Boolean).join('\n'),
        to: [
          `You are "${toName}", in a conversation with "${fromName}".`,
          `You are talking to another AI agent, not a human. Stay focused on the topic and push the conversation forward.`,
          TURING_AWARENESS,
          HUMAN_SUMMON_PROTOCOL,
          `Don't ask "how can I help you" — engage with the content directly.`,
          contextBlock,
        ].filter(Boolean).join('\n'),
      }
  }
}

/**
 * Format the cached session context for injection into system prompts.
 */
export function formatContextBlock(context?: SessionContext): string {
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
