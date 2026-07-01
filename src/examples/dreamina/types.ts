/**
 * Dreamina video-pipeline business types.
 *
 * These nodeType strings are owned by the Dreamina provider (see provider.ts).
 * The engine itself does not recognize them — WorkflowNodeType is an open
 * string — so any other provider is free to invent its own node types.
 */
export const DREAMINA_NODE_TYPES = {
  /** Upstream step that produces a `video-command.md`. */
  videoCommand: 'video_command',
  /** Step fully owned by the Dreamina provider: read the plan, submit, chain. */
  videoGenerate: 'video_generate',
} as const

export type DreaminaVideoCommand = {
  args: string[]
  downloadDir: string
}

export type DreaminaVideoPlan = {
  commands: DreaminaVideoCommand[]
  outputDir: string
  finalOutputPath?: string
}

export type DreaminaQueryResult = {
  status: 'querying' | 'success' | 'error'
  paths?: string[]
  errorMessage?: string
}
