import { ipcMain } from 'electron'
import { z } from 'zod'

import type { SpeechOperation, SpeechServiceErrorCode } from '../../shared/speech'
import type { ActionRuntime } from '../action/ActionRuntime'
import type { Orchestrator } from '../orchestrator'
import { deriveCapabilities, type SpeechClient } from '../speech/speechClient'
import { logSpeechError, logSpeechRecovery } from '../speech/speechErrors'

interface RegisterSpeechIpcOptions {
  actions: ActionRuntime
  speech: () => SpeechClient
  cancelSynthesis: (turnId: string) => void
}

export function registerSpeechIpc({
  actions,
  speech,
  cancelSynthesis,
}: RegisterSpeechIpcOptions): void {
  const logFailure = (
    operation: SpeechOperation,
    action: { error?: string; errorCode?: string },
  ): void => {
    logSpeechError({
      operation,
      code: (action.errorCode as SpeechServiceErrorCode | undefined) ?? 'UNKNOWN',
      recoverable: false,
      technicalMessage: action.error,
    })
  }

  ipcMain.handle('health:check', async () => {
    const action = await actions.execute<void, Awaited<ReturnType<SpeechClient['health']>>>({
      name: 'speech.health',
      payload: undefined,
    })
    if (action.status === 'success' && action.result) {
      logSpeechRecovery('health')
      return { ok: true, data: action.result, capabilities: deriveCapabilities(action.result) }
    }
    logFailure('health', action)
    return { ok: false, error: action.error, errorCode: action.errorCode }
  })

  ipcMain.handle('asr:recognize', async (_event, wavBuffer: ArrayBuffer) => {
    const action = await actions.execute<ArrayBuffer, { text: string }>({
      name: 'speech.recognize',
      payload: wavBuffer,
    })
    if (action.status === 'success') {
      logSpeechRecovery('recognition')
      return { ok: true, text: action.result?.text }
    }
    logFailure('recognition', action)
    return { ok: false, error: action.error, errorCode: action.errorCode }
  })

  ipcMain.handle(
    'tts:synthesize-reply',
    async (_event, turnId: string, replyText: string, emotionKey: string) => {
      const action = await actions.execute<
        { turnId: string; replyText: string; emotionKey: string },
        Awaited<ReturnType<Orchestrator['synthesizeReply']>>
      >({ name: 'speech.synthesizeReply', payload: { turnId, replyText, emotionKey } })
      if (action.status === 'success') {
        logSpeechRecovery('synthesis')
        return { ok: true, ...action.result }
      }
      logFailure('synthesis', action)
      return { ok: false, error: action.error, errorCode: action.errorCode }
    },
  )

  const warmupSchema = z.object({
    engine: z.literal('f5'),
    voiceId: z.string().trim().min(1).max(200),
    language: z.enum(['ru', 'en']),
  })
  ipcMain.handle('tts:warmup', (_event, input: unknown) =>
    speech().warmupVoice(warmupSchema.parse(input)),
  )
  ipcMain.handle('tts:cancel-synthesis', (_event, turnId: string) => {
    cancelSynthesis(turnId)
    return { ok: true }
  })
}
