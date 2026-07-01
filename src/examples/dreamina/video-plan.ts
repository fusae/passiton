import * as fs from 'node:fs'
import * as path from 'node:path'
import { sessionOutputDirectory, extractExistingOutputFile } from '../../router.js'
import * as state from '../../state.js'
import type { Session } from '../../types.js'
import type { DreaminaVideoCommand, DreaminaVideoPlan } from './types.js'

type ParsedFlag = {
  name: string
  value?: string
}

/** Locate the `video-command.md` produced by an upstream step and read it. */
export function findVideoCommandSource(session: Session): { filePath?: string; content: string } | undefined {
  const contextFile = session.context?.files?.find((file) => /video-command\.md/i.test(file.path))
  const contextPath = contextFile ? extractAbsolutePath(contextFile.path) : undefined
  if (contextPath && fs.existsSync(contextPath) && fs.statSync(contextPath).isFile()) {
    return { filePath: contextPath, content: fs.readFileSync(contextPath, 'utf-8') }
  }
  if (contextFile?.content) return { filePath: contextPath, content: contextFile.content }

  const messages = state.getMessages(session.id).map((message: { content: string }) => message.content).join('\n\n')
  const outputPath = extractExistingOutputFile(messages, 'video-command.md', session.cwd, session.createdAt)
  if (outputPath) return { filePath: outputPath, content: fs.readFileSync(outputPath, 'utf-8') }
  return undefined
}

/** Read, parse, and normalize the Dreamina video plan for a pipeline step. */
export function readDreaminaVideoPlan(session: Session): DreaminaVideoPlan {
  const commandSource = findVideoCommandSource(session)
  if (!commandSource?.content.trim()) {
    throw new Error('video-command.md not found in upstream outputs')
  }
  const outputDir = commandSource.filePath
    ? path.dirname(commandSource.filePath)
    : sessionOutputDirectory(session) ?? session.cwd ?? process.cwd()
  const rawCommands = extractDreaminaCommands(commandSource.content)
  if (!rawCommands.length) {
    throw new Error('video-command.md does not contain a dreamina generation command')
  }
  const commands = rawCommands.map((command) => normalizeDreaminaVideoCommand(command, outputDir))
  return {
    commands,
    outputDir,
    finalOutputPath: extractFinalVideoOutputPath(commandSource.content, outputDir),
  }
}

export function extractDreaminaCommands(content: string): string[] {
  const normalized = content.replace(/\\\r?\n\s*/g, ' ')
  const commands: string[] = []
  const pattern = /(?:^|\n)\s*((?:dreamina|\/[^\s`"'<>]*dreamina)\s+(?:image2video|multiframe2video|multimodal2video|text2video|video)\b[^\n`]*)/gi
  for (const match of normalized.matchAll(pattern)) {
    if (match[1]) commands.push(match[1].trim())
  }
  return commands
}

export function normalizeDreaminaVideoCommand(command: string, outputDir: string): DreaminaVideoCommand {
  const argv = parseShellWords(command)
  if (argv.length < 2 || path.basename(argv[0]) !== 'dreamina') {
    throw new Error(`Unsupported Dreamina command: ${command}`)
  }
  const subcommand = argv[1]
  const flags = parseFlags(argv.slice(2))
  if (subcommand === 'video') return normalizeLegacyDreaminaVideoFlags(flags, outputDir)
  if (!['image2video', 'multiframe2video', 'multimodal2video', 'text2video'].includes(subcommand)) {
    throw new Error(`Unsupported Dreamina video subcommand: ${subcommand}`)
  }

  const args = [subcommand]
  let outputPath: string | undefined
  for (const flag of flags) {
    if (flag.name === 'output') {
      outputPath = resolveMaybePath(flag.value, outputDir)
      continue
    }
    args.push(formatFlag(flag, outputDir))
  }
  ensurePollDisabled(args)
  return { args, downloadDir: outputPath ? path.dirname(outputPath) : outputDir }
}

export function normalizeLegacyDreaminaVideoFlags(flags: ParsedFlag[], outputDir: string): DreaminaVideoCommand {
  const args = ['multimodal2video']
  const images: string[] = []
  let outputPath: string | undefined
  for (const flag of flags) {
    if ((flag.name === 'image' || flag.name === 'reference') && flag.value) {
      images.push(resolveMaybePath(flag.value, outputDir))
      continue
    }
    if (flag.name === 'output') {
      outputPath = resolveMaybePath(flag.value, outputDir)
      continue
    }
    if (['prompt', 'duration', 'ratio', 'session', 'model_version', 'video_resolution'].includes(flag.name)) {
      args.push(`--${flag.name}`, flag.value ?? '')
    }
  }
  for (const image of images) args.push('--image', image)
  ensurePollDisabled(args)
  return { args, downloadDir: outputPath ? path.dirname(outputPath) : outputDir }
}

function parseFlags(tokens: string[]): ParsedFlag[] {
  const flags: ParsedFlag[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    if (eq !== -1) {
      flags.push({ name: token.slice(2, eq), value: token.slice(eq + 1) })
      continue
    }
    const next = tokens[i + 1]
    if (next && !next.startsWith('--')) {
      flags.push({ name: token.slice(2), value: next })
      i += 1
    } else {
      flags.push({ name: token.slice(2) })
    }
  }
  return flags
}

function formatFlag(flag: ParsedFlag, baseDir: string): string {
  const valuePathFlags = new Set(['image', 'images', 'video', 'audio'])
  if (flag.value === undefined) return `--${flag.name}`
  const value = valuePathFlags.has(flag.name) ? resolveMaybePath(flag.value, baseDir) : flag.value
  return `--${flag.name}=${value}`
}

function ensurePollDisabled(args: string[]): void {
  if (!args.some((arg) => arg === '--poll' || arg.startsWith('--poll='))) args.push('--poll=0')
}

export function extractFinalVideoOutputPath(content: string, baseDir: string): string | undefined {
  const refs = Array.from(content.matchAll(/((?:\/|\.{1,2}\/)[^`\s"'<>，。；：、)）]+\.mp4)/gi)).map((match) => match[1])
  const finalRef = [...refs].reverse().find((ref) => /final|draft|成片|最终/i.test(ref)) ?? refs.at(-1)
  return finalRef ? resolveMaybePath(finalRef, baseDir) : undefined
}

export function resolveMaybePath(value: string | undefined, baseDir: string): string {
  if (!value) return ''
  if (value.includes(',') && !value.includes('/,')) {
    return value.split(',').map((part) => resolveMaybePath(part.trim(), baseDir)).join(',')
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(baseDir, value)
}

export function extractAbsolutePath(value: string): string | undefined {
  const match = value.match(/(\/[^\n\r]+)$/)
  return match?.[1]?.trim()
}

export function parseShellWords(input: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  for (const char of input) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) words.push(current)
  return words
}

export function shellQuote(value: string): string {
  if (/^[\w./:=,-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}
