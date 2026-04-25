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
    name: 'Code Review',
    nameEn: 'Code Review',
    mode: 'review',
    promptPrefix: 'Please review the following code changes:\n\n',
    description: 'One agent submits code while the other reviews and gives feedback',
  },
  {
    id: 'solution-discussion',
    name: 'Solution Discussion',
    nameEn: 'Solution Discussion',
    mode: 'discuss',
    promptPrefix: 'Please discuss the tradeoffs of the following technical proposal:\n\n',
    description: 'Two agents discuss a proposal from different perspectives',
  },
  {
    id: 'content-polish',
    name: 'Content Polish',
    nameEn: 'Content Polish',
    mode: 'collaborate',
    promptPrefix: 'Please polish the following copy:\n\n',
    description: 'One agent sets the draft direction while the other polishes it',
  },
  {
    id: 'open-debate',
    name: 'Open Debate',
    nameEn: 'Open Debate',
    mode: 'discuss',
    promptPrefix: '',
    description: 'Two agents hold a multi-round debate on any topic',
  },
]
