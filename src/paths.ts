import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export function resolveDataHome(): string {
  if (process.env.PASSITON_HOME) return process.env.PASSITON_HOME
  if (process.env.TURING_HOME) return process.env.TURING_HOME

  const passitonHome = join(homedir(), '.passiton')
  if (existsSync(passitonHome)) return passitonHome

  const turingHome = join(homedir(), '.turing')
  if (existsSync(turingHome)) return turingHome

  return passitonHome
}
