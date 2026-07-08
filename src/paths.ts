import { homedir } from 'os'
import { join } from 'path'

export function resolveTuringHome(): string {
  return process.env.TURING_HOME ?? join(homedir(), '.turing')
}
