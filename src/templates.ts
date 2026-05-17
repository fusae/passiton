// Session templates — predefined scenario presets

import type { SessionMode } from './types.js'

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
  from: { adapter: string }
  to: { adapter: string }
  initialPrompt: string
  mode: SessionMode
  maxRounds: number
  dependsOn?: number[]
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
    id: 'douyin-video-production',
    name: '抖音视频生成',
    nameEn: 'Douyin Video Production',
    description: '改编文案、生成分镜与 prompt、再生成视频素材',
    icon: '🎬',
    tags: ['video', 'douyin', 'content'],
    steps: [
      {
        title: '改编文案',
        from: { adapter: 'opencode' },
        to: { adapter: 'claude-code' },
        initialPrompt: '基于给定的对标视频或原文案，按现有视频工作流完成改编文案，保留结构、节奏和笑点，输出可继续制作的版本。',
        mode: 'collaborate',
        maxRounds: 3,
      },
      {
        title: '生成分镜与 Prompt',
        from: { adapter: 'opencode' },
        to: { adapter: 'claude-code' },
        initialPrompt: '基于上一步结果，按现有视频工作流生成 reference.md、script.md 和 prompt.txt；prompt 中不要生成字幕，目录和命名遵循仓库约定。',
        mode: 'collaborate',
        maxRounds: 3,
        dependsOn: [0],
      },
      {
        title: '生成视频素材',
        from: { adapter: 'opencode' },
        to: { adapter: 'claude-code' },
        initialPrompt: '基于上一步产物，按现有视频工作流调用生成命令产出视频素材，保存到约定目录，并汇总生成结果、文件路径和后续剪映处理事项。',
        mode: 'collaborate',
        maxRounds: 3,
        dependsOn: [1],
      },
    ],
  },
]
