import { access, mkdir, writeFile } from 'fs/promises'
import path from 'path'
import type { Adapter, AdapterResponse, AdapterSendOpts, Session } from '../types.js'
import { buildPrompt, runCommand } from './shared.js'

const SKILL_SCRIPT = process.env.TURING_GEMINI_SKILL_SCRIPT ?? ''
const NPX_COMMAND = process.env.TURING_NPX_COMMAND ?? 'npx'
const COOKIE_PATH = process.env.GEMINI_WEB_COOKIE_PATH ?? ''

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
    if (!SKILL_SCRIPT || !COOKIE_PATH) {
      throw new Error('Gemini Image requires TURING_GEMINI_SKILL_SCRIPT and GEMINI_WEB_COOKIE_PATH')
    }
    try {
      await access(COOKIE_PATH)
    } catch {
      throw new Error('Gemini Image cookie file not found; set GEMINI_WEB_COOKIE_PATH to an existing cookies.json')
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
    if (!SKILL_SCRIPT || !COOKIE_PATH) return false
    try {
      await access(COOKIE_PATH)
      return true
    } catch {
      return false
    }
  }
}
