import { ipcMain, type MessagePortMain } from 'electron'
import { z } from 'zod'

import {
  SPEECH_EMOTIONS,
  type SpeechOperation,
  type SpeechStreamInput,
  type SpeechStreamOutput,
} from '../../shared/speech'
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

  const deliveryIntentSchema = z
    .object({
      emotion: z.enum(SPEECH_EMOTIONS),
      pace: z.enum(['slow', 'normal', 'fast']),
      energy: z.enum(['low', 'normal', 'high']),
      volume: z.enum(['soft', 'normal', 'loud']),
    })
    .strict()
  const streamStartSchema = z
    .object({
      protocolVersion: z.literal(1),
      sessionId: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9:._-]+$/u),
      turnId: z.string().trim().min(1).max(100),
      voiceId: z.string().trim().min(1).max(128),
      language: z.enum(['ru', 'en']),
      delivery: deliveryIntentSchema,
    })
    .strict()
  const streamInputSchema = z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('text'),
        sequence: z.number().int().nonnegative().max(100_000),
        text: z.string().trim().min(1).max(220),
      })
      .strict(),
    z
      .object({
        type: z.literal('delivery'),
        sequence: z.number().int().nonnegative().max(100_000),
        delivery: deliveryIntentSchema,
      })
      .strict(),
    z.object({ type: z.literal('finish-input') }).strict(),
    z.object({ type: z.literal('cancel'), reason: z.string().max(160) }).strict(),
    z
      .object({
        type: z.literal('audio-ack'),
        sequence: z.number().int().nonnegative().max(100_000),
      })
      .strict(),
  ])
  ipcMain.on('tts:open-stream', (event, input) => {
    let port: MessagePortMain | undefined
    try {
      authorization.assert(event, 'tts:open-stream')
      const start = streamStartSchema.parse(input)
      ;[port] = event.ports
      if (!port || event.ports.length !== 1)
        throw new Error('Exactly one speech MessagePort is required')
      bridgeSpeechStream(port, service, start, streamInputSchema)
    } catch (error) {
      const normalized = normalizeSpeechError(error, 'synthesis')
      logFailure('synthesis', normalized)
      port?.postMessage({ type: 'error', code: normalized.code, message: normalized.message })
      port?.close()
    }
  })

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

function bridgeSpeechStream(
  port: MessagePortMain,
  service: SpeechApplicationService,
  start: Parameters<SpeechApplicationService['openStream']>[0],
  inputSchema: z.ZodType<SpeechStreamInput>,
): void {
  const pendingAudio: Extract<SpeechStreamOutput, { type: 'audio' }>[] = []
  let inFlightSequence: number | null = null
  let pendingComplete: Extract<SpeechStreamOutput, { type: 'complete' }> | null = null
  let expectedInputSequence = 0
  let closed = false
  const MAX_PENDING_AUDIO = 8

  const close = (reason: string): void => {
    if (closed) return
    closed = true
    stream.cancel(reason)
    port.close()
  }
  const pump = (): void => {
    if (closed || inFlightSequence !== null) return
    const audio = pendingAudio.shift()
    if (audio) {
      inFlightSequence = audio.sequence
      port.postMessage(audio)
      return
    }
    if (pendingComplete) {
      port.postMessage(pendingComplete)
      pendingComplete = null
      closed = true
      port.close()
    }
  }
  const stream = service.openStream(start, (output) => {
    if (closed) return
    if (output.type === 'audio') {
      if (pendingAudio.length >= MAX_PENDING_AUDIO) {
        port.postMessage({
          type: 'error',
          code: 'renderer_backpressure',
          message: 'Renderer audio queue exceeded its bounded capacity',
        })
        close('Renderer audio queue overflow')
        return
      }
      pendingAudio.push(output)
      pump()
      return
    }
    if (output.type === 'complete') {
      pendingComplete = output
      pump()
      return
    }
    port.postMessage(output)
    if (output.type === 'cancelled') {
      closed = true
      port.close()
      return
    }
    if (output.type === 'error') close(output.message)
  })

  port.on('message', (event) => {
    try {
      const input = inputSchema.parse(event.data)
      if (input.type === 'audio-ack') {
        if (input.sequence !== inFlightSequence)
          throw new Error(`Unexpected audio ack sequence=${input.sequence}`)
        inFlightSequence = null
        stream.send(input)
        pump()
        return
      }
      if (input.type === 'text' || input.type === 'delivery') {
        if (input.sequence !== expectedInputSequence)
          throw new Error(
            `Unexpected speech input sequence=${input.sequence}; expected=${expectedInputSequence}`,
          )
        expectedInputSequence += 1
      }
      stream.send(input)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      port.postMessage({ type: 'error', code: 'invalid_renderer_stream_input', message })
      close(message)
    }
  })
  port.on('close', () => close('Renderer stream port closed'))
  port.start()
}
