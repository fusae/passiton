import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import type { DreaminaQueryResult } from './types.js'

const CURL_COMMAND = process.env.TURING_CURL_COMMAND ?? 'curl'
const FFMPEG_COMMAND = process.env.TURING_FFMPEG_COMMAND ?? 'ffmpeg'

export function execFileText(command: string, args: string[], timeout = 60_000, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 10 * 1024 * 1024, cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || err.message).trim()))
        return
      }
      resolve(stdout.trim())
    })
  })
}

/** Poll a submitted Dreamina task for its current status. */
export async function queryDreaminaResult(
  binary: string,
  externalId: string,
  downloadDir: string,
): Promise<DreaminaQueryResult> {
  fs.mkdirSync(downloadDir, { recursive: true })
  const stdout = await execFileText(binary, ['query_result', `--submit_id=${externalId}`])
  const payload = JSON.parse(stdout) as {
    gen_status?: string
    message?: string
    result_json?: {
      videos?: Array<{ video_url?: string; format?: string }>
    }
  }
  const status = payload.gen_status?.toLowerCase()
  if (status === 'success') {
    const videos = payload.result_json?.videos ?? []
    const paths: string[] = []
    for (const [index, video] of videos.entries()) {
      if (!video.video_url) continue
      const ext = video.format?.toLowerCase() === 'webm' ? 'webm' : 'mp4'
      const destination = path.join(downloadDir, `${externalId}_video_${index + 1}.${ext}`)
      await downloadAndValidateVideo(video.video_url, destination)
      paths.push(destination)
    }
    if (paths.length > 0) return { status: 'success', paths }
    return { status: 'querying' }
  }
  if (status === 'failed' || status === 'error') {
    return { status: 'error', errorMessage: payload.message ?? `Dreamina task ${status}` }
  }
  return { status: 'querying' }
}

/** Submit a fresh Dreamina task and return the raw stdout (submit_id is parsed out by the caller). */
export async function submitDreaminaCommand(binary: string, args: string[], cwd?: string): Promise<string> {
  return execFileText(binary, args, 5 * 60_000, cwd)
}

export async function concatVideos(inputVideos: string[], destination: string): Promise<void> {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const listPath = path.join(path.dirname(destination), `.concat-${Date.now()}.txt`)
  const listContent = inputVideos
    .map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`)
    .join('\n')
  fs.writeFileSync(listPath, listContent)
  try {
    await execFileText(FFMPEG_COMMAND, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      destination,
    ], 20 * 60_000)
    await execFileText(FFMPEG_COMMAND, ['-v', 'error', '-i', destination, '-f', 'null', '-'], 5 * 60_000)
  } finally {
    fs.rmSync(listPath, { force: true })
  }
}

async function downloadAndValidateVideo(url: string, destination: string): Promise<void> {
  const partial = `${destination}.part`
  await execFileText(CURL_COMMAND, [
    '--location',
    '--fail',
    '--retry', '3',
    '--retry-delay', '2',
    '--continue-at', '-',
    '--output', partial,
    url,
  ], 20 * 60_000)
  try {
    await execFileText(FFMPEG_COMMAND, ['-v', 'error', '-i', partial, '-f', 'null', '-'], 5 * 60_000)
  } catch (err) {
    fs.rmSync(partial, { force: true })
    throw new Error(`Downloaded video failed integrity check: ${(err as Error).message}`)
  }
  fs.renameSync(partial, destination)
}

export function parseDreaminaSubmitId(stdout: string): string | undefined {
  return stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
}
