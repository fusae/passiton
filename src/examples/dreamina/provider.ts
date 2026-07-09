import * as path from 'node:path'
import type {
  ExternalTaskProvider,
  ExternalTaskQueryResult,
  RouterExternalTaskHooks,
  Session,
} from '../../types.js'
import { truncate } from '../../router.js'
import {
  queryDreaminaResult,
  submitDreaminaCommand,
  concatVideos,
  parseDreaminaSubmitId,
} from './client.js'
import { readDreaminaVideoPlan, shellQuote } from './video-plan.js'
import { DREAMINA_NODE_TYPES, type DreaminaVideoPlan } from './types.js'

const POLL_INTERVAL_MS = 10_000

export interface DreaminaProviderOptions {
  /** Path to the `dreamina` binary. If unset, the provider is inert. */
  binary?: string
  /** Override query (for tests). */
  queryFn?: (externalId: string, downloadDir: string) => Promise<ExternalTaskQueryResult>
  /** Override submit (for tests). */
  submitFn?: (args: string[], cwd?: string) => Promise<string>
  /** Override poll interval (for tests; default 10s). */
  pollIntervalMs?: number
}

/**
 * Build the Dreamina ExternalTaskProvider. The provider is inert unless the
 * dreamina binary is configured (PASSITON_DREAMINA_COMMAND). When inert, parse
 * still works (so a pending job can be registered) but submit/query error out.
 *
 * Kept as a standalone function (not a class) so the test seam is just a
 * function call with option overrides — no Router needed.
 */
export function createDreaminaProvider(opts: DreaminaProviderOptions = {}): ExternalTaskProvider {
  const binary = opts.binary ?? process.env.PASSITON_DREAMINA_COMMAND ?? process.env.TURING_DREAMINA_COMMAND ?? ''
  const submitFn = opts.submitFn ?? ((args, cwd) => submitDreaminaCommand(binary, args, cwd))
  const queryFn = opts.queryFn ?? ((id, dir) => queryDreaminaResult(binary, id, dir))

  const provider: ExternalTaskProvider = {
    name: 'dreamina',
    handledNodeTypes: [DREAMINA_NODE_TYPES.videoGenerate],
    pollIntervalMs: opts.pollIntervalMs ?? POLL_INTERVAL_MS,

    parseAgentOutput(content, session: Pick<Session, 'cwd'>) {
      if (!/submit[_ -]?id/i.test(content)) return undefined
      if (/(?:本地视频|local video|downloaded)[\s\S]{0,300}\.mp4\b/i.test(content)) return undefined
      const match = content.match(/submit[_ -]?id[^\da-f-]*([0-9a-f]{8}-[0-9a-f-]{27,})/i)
      if (!match?.[1]) return undefined
      return {
        externalId: match[1],
        downloadDir: path.join(session.cwd ?? process.cwd(), 'output'),
      }
    },

    async submit(args, cwd) {
      if (!binary) {
        throw new Error('Dreamina is not configured. Set PASSITON_DREAMINA_COMMAND to enable video generation steps.')
      }
      return submitFn(args, cwd)
    },

    async query(externalId, downloadDir) {
      if (!binary) {
        return { status: 'error', errorMessage: 'Dreamina is not configured.' }
      }
      return queryFn(externalId, downloadDir)
    },

    async handlePipelineStep(hooks, sessionId) {
      await submitDreaminaVideoStep(provider, hooks, sessionId)
    },
  }

  return provider
}

/**
 * Find the next chunk in the plan, submit it, or finalize when all chunks
 * are done. Pure helper — takes the provider so it can call submit() and
 * the hooks so it can drive session/pipeline state.
 */
async function submitDreaminaVideoStep(
  provider: ExternalTaskProvider,
  hooks: RouterExternalTaskHooks,
  sessionId: string,
): Promise<void> {
  const session = hooks.getSession(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)

  const plan = readDreaminaVideoPlan(session)
  const doneJobs = hooks
    .listExternalJobs('done')
    .filter((job) => job.sessionId === sessionId && job.resultPaths?.length)
    .sort((a, b) => a.createdAt - b.createdAt)
  const next = plan.commands[doneJobs.length]
  if (!next) return completeDreaminaVideoPlan(hooks, sessionId, plan)

  const stdout = await provider.submit(next.args, session.cwd)
  const externalId = parseDreaminaSubmitId(stdout)
  if (!externalId) {
    throw new Error(`Dreamina did not return submit_id. Output: ${truncate(stdout, 1000)}`)
  }

  const content = [
    '[RESULT]',
    `已提交即梦视频片段 ${doneJobs.length + 1}/${plan.commands.length}。`,
    '',
    `submit_id：\`${externalId}\``,
    `命令：\`${process.env.PASSITON_DREAMINA_COMMAND ?? process.env.TURING_DREAMINA_COMMAND ?? 'dreamina'} ${next.args.map(shellQuote).join(' ')}\``,
    `下载目录：\`${next.downloadDir}\``,
    '状态：`querying`',
    '[/RESULT]',
  ].join('\n')
  const round = Math.max(1, session.currentRound + 1)
  hooks.recordMessage(sessionId, 'dreamina', content, round)
  hooks.updateSession(sessionId, { currentRound: round, lastAgentOutput: content })

  const job = hooks.upsertExternalJob({
    id: externalId,
    sessionId,
    provider: 'dreamina',
    externalId,
    status: 'querying',
    downloadDir: next.downloadDir,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  hooks.emitLog('info', `Dreamina task waiting [${sessionId.slice(0, 8)}] submit_id=${job.externalId}`, sessionId)
  hooks.scheduleExternalJobPoll(job, provider.pollIntervalMs)
}

/** Concat generated chunks into the final video and complete the step. */
async function completeDreaminaVideoPlan(
  hooks: RouterExternalTaskHooks,
  sessionId: string,
  plan: DreaminaVideoPlan,
): Promise<void> {
  const doneJobs = hooks
    .listExternalJobs('done')
    .filter((job) => job.sessionId === sessionId && job.resultPaths?.length)
    .sort((a, b) => a.createdAt - b.createdAt)
  const inputVideos = doneJobs.flatMap((job) => job.resultPaths ?? [])
  if (!inputVideos.length) throw new Error('No generated video files found for concat')

  let finalPath = plan.finalOutputPath ?? inputVideos[0]
  if (inputVideos.length > 1) {
    finalPath = plan.finalOutputPath ?? path.join(plan.outputDir, 'final-draft.mp4')
    await concatVideos(inputVideos, finalPath)
  }

  const content = [
    '[RESULT]',
    '即梦视频生成完成。',
    '',
    '片段文件：',
    ...inputVideos.map((filePath) => `\`${filePath}\``),
    '',
    `最终视频：\`${finalPath}\``,
    '[/RESULT]',
    '[DONE]',
  ].join('\n')
  const session = hooks.getSession(sessionId)
  hooks.recordMessage(sessionId, 'dreamina', content, Math.max(1, session?.currentRound ?? 1))
  hooks.updateSession(sessionId, { lastAgentOutput: content })
  await hooks.completeSession(sessionId)
  hooks.emitLog('info', `Dreamina video plan completed [${sessionId.slice(0, 8)}]`, sessionId)
}
