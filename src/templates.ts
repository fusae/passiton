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

export const pipelineTemplates: PipelineTemplate[] = [
  {
    id: 'doc-pipeline',
    name: '文档生成流水线',
    nameEn: 'Documentation Pipeline',
    description: '调研 → 起草 → 审校 → 人工确认。适合产出技术文档、产品说明、报告等长文。',
    icon: '📄',
    tags: ['writing', 'documentation', 'pipeline'],
    steps: [
      {
        title: '调研大纲',
        from: { adapter: 'anthropic-api' },
        to: { adapter: 'anthropic-api' },
        initialPrompt: '围绕给定主题，列出文档大纲、需要覆盖的要点和读者关心的核心问题。输出结构化大纲。',
        mode: 'collaborate',
        maxRounds: 3,
      },
      {
        title: '起草正文',
        from: { adapter: 'anthropic-api' },
        to: { adapter: 'anthropic-api' },
        initialPrompt: '基于上游大纲，撰写完整文档正文。结构清晰、用词准确、面向目标读者。输出 Markdown。',
        mode: 'collaborate',
        maxRounds: 3,
        dependsOn: [0],
      },
      {
        title: '审校润色',
        from: { adapter: 'anthropic-api' },
        to: { adapter: 'anthropic-api' },
        initialPrompt: '审校上游正文：修正事实错误、补全遗漏、优化表达与排版。输出最终定稿。',
        mode: 'review',
        maxRounds: 2,
        dependsOn: [1],
      },
      {
        title: '人工确认',
        from: { adapter: 'anthropic-api' },
        to: { adapter: 'anthropic-api' },
        initialPrompt: '等待人工确认文档内容无误。',
        mode: 'freeform',
        maxRounds: 1,
        dependsOn: [2],
        manualDone: true,
      },
    ],
  },
  {
    id: 'code-review-pipeline',
    name: '代码 Review 流水线',
    nameEn: 'Code Review Pipeline',
    description: '扫描问题 → 修复 → 复核。适合改一个 feature、重构、或修一组 bug。需用本地 CLI agent。',
    icon: '🔧',
    tags: ['code', 'development', 'pipeline'],
    steps: [
      {
        title: '扫描问题',
        from: { adapter: 'codex' },
        to: { adapter: 'codex' },
        initialPrompt: '扫描当前项目，找出 bug、安全问题、性能隐患和风格问题。输出按严重程度排序的问题清单，每个问题给出位置和修复建议。',
        mode: 'collaborate',
        maxRounds: 3,
      },
      {
        title: '修复问题',
        from: { adapter: 'codex' },
        to: { adapter: 'codex' },
        initialPrompt: '根据上游问题清单，逐个修复。优先处理严重问题。改完输出每个问题的处理结果。',
        mode: 'collaborate',
        maxRounds: 4,
        dependsOn: [0],
      },
      {
        title: '复核验证',
        from: { adapter: 'codex' },
        to: { adapter: 'codex' },
        initialPrompt: '复核上游修复：问题是否真的解决、有没有引入新问题、改动是否完整。输出复核结论，必要时列出残留问题。',
        mode: 'review',
        maxRounds: 2,
        dependsOn: [1],
      },
    ],
  },
  {
    id: 'batch-translation-pipeline',
    name: '批量翻译流水线',
    nameEn: 'Batch Translation Pipeline',
    description: '翻译 → 校对。两步保证译文质量，适合处理多篇文档或长文翻译。',
    icon: '🌐',
    tags: ['translation', 'language', 'pipeline'],
    steps: [
      {
        title: '翻译',
        from: { adapter: 'anthropic-api' },
        to: { adapter: 'anthropic-api' },
        initialPrompt: '将给定原文翻译成目标语言。译文自然、准确、保留语气与文化细节。输出译文。',
        mode: 'collaborate',
        maxRounds: 2,
      },
      {
        title: '校对润色',
        from: { adapter: 'anthropic-api' },
        to: { adapter: 'anthropic-api' },
        initialPrompt: '校对上游译文：准确性、流畅度、术语一致性、文化适配。输出最终定稿。',
        mode: 'review',
        maxRounds: 2,
        dependsOn: [0],
      },
    ],
  },
  {
    id: 'creative-content-pipeline',
    name: '创意内容流水线',
    nameEn: 'Creative Content Pipeline',
    description: '头脑风暴 → 起草 → 润色。适合写公众号、社媒文案、脚本等需要创意的内容。',
    icon: '✨',
    tags: ['creative', 'content', 'pipeline'],
    steps: [
      {
        title: '头脑风暴',
        from: { adapter: 'anthropic-api' },
        to: { adapter: 'anthropic-api' },
        initialPrompt: '围绕给定主题，多角度发散创意，列出可写的角度和切入点。不评判，尽量多。',
        mode: 'collaborate',
        maxRounds: 3,
      },
      {
        title: '起草正文',
        from: { adapter: 'anthropic-api' },
        to: { adapter: 'anthropic-api' },
        initialPrompt: '从上游创意中挑选最强的角度，起草完整内容。有吸引力、结构清晰、符合目标平台风格。',
        mode: 'collaborate',
        maxRounds: 3,
        dependsOn: [0],
      },
      {
        title: '润色定稿',
        from: { adapter: 'anthropic-api' },
        to: { adapter: 'anthropic-api' },
        initialPrompt: '润色上游草稿：标题、开头、节奏、金句、结尾。输出可直接发布的定稿。',
        mode: 'review',
        maxRounds: 2,
        dependsOn: [1],
      },
    ],
  },
]
