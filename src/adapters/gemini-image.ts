import { access, mkdir, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import type { Adapter, AdapterResponse, AdapterSendOpts, Session } from '../types.js'
import { buildPrompt, runCommand } from './shared.js'

const SKILL_SCRIPT = '/Users/jamesyu/.agents/skills/baoyu-danger-gemini-web/scripts/main.ts'
const NPX_COMMAND = process.env.TURING_NPX_COMMAND ?? '/opt/homebrew/bin/npx'
const COOKIE_PATH = process.env.GEMINI_WEB_COOKIE_PATH ??
  path.join(os.homedir(), 'Library', 'Application Support', 'baoyu-skills', 'gemini-web', 'cookies.json')

export class GeminiImageAdapter implements Adapter {
  name = 'gemini-image'
  config: Record<string, unknown> = {
    adapter: 'gemini-image',
    timeout: 1_200_000,
  }
  capabilities = {
    tools: true,
    fileSystem: true,
    shell: true,
    imageGeneration: true,
  }

  async send(session: Session, message: string, opts?: AdapterSendOpts): Promise<AdapterResponse> {
    try {
      await access(COOKIE_PATH)
    } catch {
      throw new Error('Gemini Image 未登录，请先执行 Gemini Web 登录后重跑本步骤')
    }

    const cwd = session.cwd ?? process.cwd()
    const outputDir = path.join(cwd, 'output', 'storyboards', session.id)
    const promptPath = path.join(outputDir, 'storyboard-prompt.txt')
    const imagePath = path.join(outputDir, 'storyboard-gemini.png')
    await mkdir(outputDir, { recursive: true })

    const prompt = [
      buildPrompt(message, opts),
      '',
      '[Image Generation Requirements]',
      'Generate a finished storyboard image whose panel count matches the shots in script.md.',
      'Choose a clear grid layout dynamically; do not add or remove shots to fit a fixed grid.',
      'Black-and-white pencil director storyboard, clear office staging and character actions.',
      'No visible text, dialogue, speech bubbles, subtitles, labels, numbers, logos, or watermarks.',
    ].join('\n')
    await writeFile(promptPath, prompt, 'utf8')

    await runCommand({
      adapterName: this.name,
      command: NPX_COMMAND,
      args: ['-y', 'bun', SKILL_SCRIPT, '--promptfiles', promptPath, '--image', imagePath, '--json'],
      cwd,
      timeout: 1_200_000,
      signal: opts?.signal,
      onOutput: opts?.onOutput,
      getTimeoutExtensionMs: opts?.getTimeoutExtensionMs,
    })

    return {
      content: [
        '[RESULT]',
        '分镜图已由 Gemini Image 专用执行器生成。',
        `提示词：${promptPath}`,
        `分镜图：${imagePath}`,
        '[/RESULT]',
        '[DONE]',
      ].join('\n'),
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await access(COOKIE_PATH)
      return true
    } catch {
      return false
    }
  }
}
