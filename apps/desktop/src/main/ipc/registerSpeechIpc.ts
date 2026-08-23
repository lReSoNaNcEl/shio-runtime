import { ipcMain } from 'electron'
import { z } from 'zod'

import type { SpeechOperation, SpeechServiceErrorCode } from '../../shared/speech'
import type { ActionRuntime } from '../action/ActionRuntime'
import type { Orchestrator } from '../orchestrator'
import {
  DEFAULT_TTS_VOICE_ID,
  deriveCapabilities,
  type SpeechCapabilitiesProbe,
  type SpeechClient,
} from '../speech/speechClient'
import { logSpeechError, logSpeechRecovery } from '../speech/speechErrors'
import type { IpcAuthorization } from './IpcAuthorization'

interface RegisterSpeechIpcOptions {
  actions: ActionRuntime
  speech: () => SpeechClient
  cancelSynthesis: (turnId: string) => void
  onCapabilitiesProbe?: (probe: SpeechCapabilitiesProbe) => void
  authorization: IpcAuthorization
}

export function registerSpeechIpc({
  actions,
  speech,
  cancelSynthesis,
  onCapabilitiesProbe,
  authorization,
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

  ipcMain.handle(
    'health:check',
    authorization.handle('health:check', async () => {
      const action = await actions.execute<void, Awaited<ReturnType<SpeechClient['health']>>>({
        name: 'speech.health',
        payload: undefined,
      })
      if (action.status === 'success' && action.result) {
        logSpeechRecovery('health')
        const capabilities = deriveCapabilities(action.result)
        onCapabilitiesProbe?.(capabilities)
        return { ok: true, data: action.result, capabilities }
      }
      onCapabilitiesProbe?.({
        serviceReachable: false,
        recognition: false,
        synthesis: false,
        streaming: false,
      })
      logFailure('health', action)
      return { ok: false, error: action.error, errorCode: action.errorCode }
    }),
  )

  const wavBufferSchema = z
    .instanceof(ArrayBuffer)
    .refine((buffer) => buffer.byteLength > 0 && buffer.byteLength <= 64 * 1024 * 1024)
  ipcMain.handle(
    'asr:recognize',
    authorization.handlePayload(
      'asr:recognize',
      z.tuple([wavBufferSchema]),
      async (_event, wavBuffer) => {
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
      },
    ),
  )

  const synthesisSchema = z.tuple([
    z.string().trim().min(1).max(100),
    z.string().trim().min(1).max(20_000),
    z.string().trim().min(1).max(100),
  ])
  ipcMain.handle(
    'tts:synthesize-reply',
    authorization.handlePayload(
      'tts:synthesize-reply',
      synthesisSchema,
      async (_event, turnId, replyText, emotionKey) => {
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
    ),
  )

  const warmupSchema = z.object({
    language: z.enum(['ru', 'en']),
  })
  ipcMain.handle(
    'tts:warmup',
    authorization.handlePayload('tts:warmup', z.tuple([warmupSchema.strict()]), (_event, input) =>
      speech().warmupVoice({
        engine: 'f5',
        voiceId: DEFAULT_TTS_VOICE_ID,
        ...input,
      }),
    ),
  )
  ipcMain.handle(
    'tts:cancel-synthesis',
    authorization.handlePayload(
      'tts:cancel-synthesis',
      z.tuple([z.string().trim().min(1).max(100)]),
      (_event, turnId) => {
        cancelSynthesis(turnId)
        return { ok: true }
      },
    ),
  )
}
