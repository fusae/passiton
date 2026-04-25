// Session templates — predefined scenario presets

import type { SessionMode } from './types.js'

export interface SessionTemplate {
  id: string
  name: string
  nameEn: string
  mode: SessionMode
  promptPrefix: string
  description: string
}

export const templates: SessionTemplate[] = [
  {
    id: 'code-review',
    name: '代码审查',
    nameEn: 'Code Review',
    mode: 'review',
    promptPrefix: '请审查以下代码变更：\n\n',
    description: '一个 agent 提交代码，另一个审查并给出反馈',
  },
  {
    id: 'solution-discussion',
    name: '方案讨论',
    nameEn: 'Solution Discussion',
    mode: 'discuss',
    promptPrefix: '请讨论以下技术方案的优劣：\n\n',
    description: '两个 agent 从不同角度讨论方案',
  },
  {
    id: 'content-polish',
    name: '文案打磨',
    nameEn: 'Content Polish',
    mode: 'collaborate',
    promptPrefix: '请帮忙打磨以下文案：\n\n',
    description: '一个 agent 出初稿方向，另一个执行打磨',
  },
  {
    id: 'open-debate',
    name: '开放辩论',
    nameEn: 'Open Debate',
    mode: 'discuss',
    promptPrefix: '',
    description: '两个 agent 就任意话题展开多轮辩论',
  },
]
