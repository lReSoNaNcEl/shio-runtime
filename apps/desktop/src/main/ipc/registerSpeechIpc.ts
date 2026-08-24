import { ipcMain } from 'electron'
import { z } from 'zod'

import type { SpeechOperation } from '../../shared/speech'
import type { SpeechApplicationService } from '../app/SpeechApplicationService'
import { deriveCapabilities, type SpeechCapabilitiesProbe } from '../speech/speechClient'
import { logSpeechError, logSpeechRecovery, normalizeSpeechError } from '../speech/speechErrors'
import type { IpcAuthorization } from './IpcAuthorization'

interface RegisterSpeechIpcOptions {
  service: SpeechApplicationService
  onCapabilitiesProbe?: (probe: SpeechCapabilitiesProbe) => void
  authorization: IpcAuthorization
}

export function registerSpeechIpc({
  service,
  onCapabilitiesProbe,
  authorization,
}: RegisterSpeechIpcOptions): void {
  const logFailure = (operation: SpeechOperation, error: unknown): void => {
    logSpeechError(normalizeSpeechError(error, operation).toSerialized())
  }

  ipcMain.handle(
    'asr:get-streaming-connection',
    authorization.handle('asr:get-streaming-connection', () => ({
      baseUrl: service.getEndpoint(),
    })),
  )

  ipcMain.handle(
    'health:check',
    authorization.handle('health:check', async () => {
      try {
        const result = await service.health()
        logSpeechRecovery('health')
        const capabilities = deriveCapabilities(result)
        onCapabilitiesProbe?.(capabilities)
        return { ok: true, data: result, capabilities }
      } catch (error) {
        onCapabilitiesProbe?.({
          serviceReachable: false,
          recognition: false,
          synthesis: false,
          streaming: false,
        })
        const normalized = normalizeSpeechError(error, 'health')
        logFailure('health', normalized)
        return { ok: false, error: normalized.message, errorCode: normalized.code }
      }
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
        try {
          const result = await service.recognize(wavBuffer)
          logSpeechRecovery('recognition')
          return { ok: true, text: result.text }
        } catch (error) {
          const normalized = normalizeSpeechError(error, 'recognition')
          logFailure('recognition', normalized)
          return { ok: false, error: normalized.message, errorCode: normalized.code }
        }
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
        try {
          const result = await service.synthesize(turnId, replyText, emotionKey)
          logSpeechRecovery('synthesis')
          return { ok: true, ...result }
        } catch (error) {
          const normalized = normalizeSpeechError(error, 'synthesis')
          if (normalized.code !== 'CANCELLED') logFailure('synthesis', normalized)
          return { ok: false, error: normalized.message, errorCode: normalized.code }
        }
      },
    ),
  )

  const warmupSchema = z.object({
    language: z.enum(['ru', 'en']),
  })
  ipcMain.handle(
    'tts:warmup',
    authorization.handlePayload('tts:warmup', z.tuple([warmupSchema.strict()]), (_event, input) =>
      service.warmup(input.language),
    ),
  )
  ipcMain.handle(
    'tts:cancel-synthesis',
    authorization.handlePayload(
      'tts:cancel-synthesis',
      z.tuple([z.string().trim().min(1).max(100)]),
      async (_event, turnId) => {
        await service.cancelSynthesis(turnId)
        return { ok: true }
      },
    ),
  )
}
