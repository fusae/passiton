// Session templates — predefined scenario presets

import type { PermissionMode, SessionContextInput, SessionMode, WorkflowNodeType, WorkflowStepContract } from './types.js'

export interface SessionTemplate {
  id: string
  name: string
  nameEn?: string
  description: string
  icon: string
  tags: string[]
  mode: SessionMode
  promptPrefix?: string
  config: {
    systemPrompts?: {
      from: string
      to: string
    }
    mode?: SessionMode
    maxRounds?: number
    tags: string[]
    roles?: {
      from?: string
      to?: string
    }
    preferredAdapters?: {
      from?: string
      to?: string
    }
  }
}

export interface PipelineTemplateStep {
  title: string
  nodeType?: WorkflowNodeType
  agent?: { adapter: string }
  contract?: WorkflowStepContract
  from: { adapter: string }
  to: { adapter: string }
  initialPrompt: string
  mode: SessionMode
  maxRounds: number
  approveMode?: boolean
  permissionMode?: PermissionMode
  cwd?: string
  outputDir?: string
  context?: SessionContextInput
  dependsOn?: number[]
  manualDone?: boolean
  manualOutput?: string
}

export interface PipelineTemplate {
  id: string
  name: string
  nameEn?: string
  description: string
  icon: string
  tags: string[]
  steps: PipelineTemplateStep[]
}

export const templates: SessionTemplate[] = [
  {
    id: 'writing-assistant',
    name: '写文助手',
    nameEn: 'Writing Assistant',
    description: 'Give a topic, Assistant A writes a draft, Assistant B reviews and improves it',
    icon: '📝',
    tags: ['writing', 'content'],
    mode: 'collaborate',
    config: {
      systemPrompts: {
        from: 'You are a skilled writer. Write engaging, well-structured content based on the given topic. Output your draft and end with [DONE].',
        to: 'You are a meticulous editor. Review the draft, fix issues, improve clarity and style. Output the improved version and end with [DONE].',
      },
      mode: 'collaborate',
      maxRounds: 3,
      tags: ['writing', 'content'],
      roles: { from: 'writer', to: 'editor' },
      preferredAdapters: { from: 'anthropic-api', to: 'anthropic-api' },
    },
  },
  {
    id: 'code-review',
    name: '代码审查',
    nameEn: 'Code Review',
    description: 'Submit code, one assistant reviews, another fixes the issues',
    icon: '🔍',
    tags: ['code', 'development'],
    mode: 'collaborate',
    config: {
      systemPrompts: {
        from: 'You are a senior code reviewer. Analyze the code for bugs, security issues, performance problems, and style. Be specific and constructive. End with [DONE].',
        to: 'You are a skilled developer. Read the code review feedback and apply the suggested fixes. Show the corrected code. End with [DONE].',
      },
      mode: 'collaborate',
      maxRounds: 3,
      tags: ['code', 'development'],
      roles: { from: 'reviewer', to: 'fixer' },
    },
  },
  {
    id: 'translation-proofreading',
    name: '翻译校对',
    nameEn: 'Translation & Proofreading',
    description: 'One assistant translates, another proofreads — two rounds for a polished result',
    icon: '🌐',
    tags: ['translation', 'language'],
    mode: 'collaborate',
    config: {
      systemPrompts: {
        from: 'You are a professional translator. Translate the given text naturally and accurately. Preserve tone and nuance. End with [DONE].',
        to: 'You are a bilingual proofreading expert. Review the translation for accuracy, naturalness, and cultural appropriateness. Suggest improvements. End with [DONE].',
      },
      mode: 'collaborate',
      maxRounds: 2,
      tags: ['translation', 'language'],
      roles: { from: 'translator', to: 'proofreader' },
    },
  },
  {
    id: 'brainstorm',
    name: '头脑风暴',
    nameEn: 'Brainstorm',
    description: 'Two assistants riff on a topic, building on each others ideas',
    icon: '💡',
    tags: ['ideation', 'creative'],
    mode: 'collaborate',
    config: {
      systemPrompts: {
        from: 'You are a creative thinker. Build on the previous ideas, add new angles, challenge assumptions. Be bold and inventive. End with [DONE].',
        to: 'You are an analytical thinker. Evaluate the ideas presented, identify the strongest ones, and propose practical next steps or new directions. End with [DONE].',
      },
      mode: 'collaborate',
      maxRounds: 4,
      tags: ['ideation', 'creative'],
      roles: { from: 'thinker-a', to: 'thinker-b' },
    },
  },
  {
    id: 'custom',
    name: '自定义',
    nameEn: 'Custom',
    description: 'Start from scratch with your own configuration',
    icon: '⚙️',
    tags: ['custom'],
    mode: 'freeform',
    config: {
      tags: ['custom'],
    },
  },
]

export const pipelineTemplates: PipelineTemplate[] = []
