import { isDeepStrictEqual } from 'node:util'

import type { AppSettings } from '../../shared/config'
import {
  SPECULATIVE_REPLY_MAX_AGE_MS,
  SpeculativeDirectReply,
} from '../character-tools/CharacterSpeculativeReply'
import { generatePreparedWatchReply } from '../character-tools/CharacterToolLoop'
import type { ChatMessage, LLMProvider, LlmRequestOptions } from '../llm'
import { mainLog } from '../logging/safeLogger'
import type { CharacterLivingContext } from '../orchestrator'

interface WatchVoiceSnapshot {
  frame?: Uint8Array
  frameTiles?: { columns: number; images: readonly Uint8Array[] }
  transcript?: string
  recentScenes?: readonly string[]
}

export interface WatchVoiceReplyInput extends WatchVoiceSnapshot {
  sessionId: string
  utteranceId: string
  userText: string
}

export function watchReplyModelKey(settings: AppSettings): string {
  const config = settings.llm
  if (!config) return ''
  const models = [
    { providerId: config.activeProvider, model: config.providers[config.activeProvider].model },
    ...(config.roles?.characterFallbacks ?? []),
  ]
  return JSON.stringify(
    models.map(({ providerId, model }) => {
      const provider = config.providers[providerId]
      return [providerId, model, provider.accountId, provider.codexReasoningByModel?.[model]]
    }),
  )
}

/** A Main-only candidate for the exact direct microphone request. Only the admitted turn can claim it. */
export class PreparedWatchVoiceReply {
  private readonly controller = new AbortController()
  private readonly reply: SpeculativeDirectReply
  private readonly timer: ReturnType<typeof setTimeout>
  private readonly signal: AbortSignal
  private readonly admission = Promise.withResolvers<boolean>()
  private readonly model: string
  private preparedMessages?: readonly ChatMessage[]
  private claimed = false

  constructor(
    private readonly input: WatchVoiceReplyInput,
    parent: AbortSignal,
    readonly livingSnapshot: CharacterLivingContext,
    private readonly currentModel: () => string,
    compose: () => Promise<readonly ChatMessage[]>,
    llm: LLMProvider,
    providerId: NonNullable<AppSettings['llm']>['activeProvider'],
    shortCodexOpening = false,
  ) {
    this.model = currentModel()
    this.signal = AbortSignal.any([parent, this.controller.signal])
    this.timer = setTimeout(() => this.discard(), SPECULATIVE_REPLY_MAX_AGE_MS)
    this.timer.unref()
    this.reply = new SpeculativeDirectReply(
      this.signal,
      async (onEvent, signal) => {
        signal.throwIfAborted()
        const messages = await compose()
        signal.throwIfAborted()
        if (currentModel() !== this.model) throw new Error('Watch voice model changed')
        this.preparedMessages = messages
        return generatePreparedWatchReply(
          llm,
          providerId,
          messages,
          signal,
          input.utteranceId,
          (event) => {
            if (event.type === 'text-delta' || event.type === 'embodiment-intent') onEvent(event)
          },
          shortCodexOpening,
          this.admission.promise,
        )
      },
      Date.now,
      {
        onReleased: ({ bufferedCharacters, waitedMs }) =>
          mainLog.info('[WatchTogether] direct voice preparation released', {
            bufferedCharacters,
            waitedMs,
          }),
      },
    )
    if (this.signal.aborted) this.discard()
    else this.signal.addEventListener('abort', this.aborted, { once: true })
  }

  private readonly aborted = (): void => {
    this.admission.resolve(false)
    clearTimeout(this.timer)
    this.preparedMessages = undefined
    this.reply.discard('cancelled')
  }

  discard(): void {
    clearTimeout(this.timer)
    this.preparedMessages = undefined
    this.controller.abort()
    this.reply.discard('cancelled')
  }

  matches(
    sessionId: string | undefined,
    utteranceId: string | undefined,
    userText: string,
    snapshot: WatchVoiceSnapshot,
    model: string,
  ): boolean {
    return (
      !this.claimed &&
      !this.signal.aborted &&
      this.model === model &&
      this.input.sessionId === sessionId &&
      this.input.utteranceId === utteranceId &&
      this.input.userText === userText &&
      this.input.frame === snapshot.frame &&
      isDeepStrictEqual(this.input.frameTiles, snapshot.frameTiles) &&
      (this.input.transcript || undefined) === (snapshot.transcript || undefined) &&
      isDeepStrictEqual(this.input.recentScenes ?? [], snapshot.recentScenes ?? [])
    )
  }

  claim(
    messages: readonly ChatMessage[],
    options: LlmRequestOptions,
  ): SpeculativeDirectReply | undefined {
    if (
      this.claimed ||
      this.signal.aborted ||
      this.currentModel() !== this.model ||
      options.signal?.aborted ||
      options.maxTokens !== undefined ||
      options.timeoutMs !== undefined ||
      !isDeepStrictEqual(this.preparedMessages, messages)
    ) {
      this.discard()
      return
    }
    this.claimed = true
    this.admission.resolve(true)
    clearTimeout(this.timer)
    this.preparedMessages = undefined
    const detach = () => this.signal.removeEventListener('abort', this.aborted)
    void this.reply.completion.then(detach, detach)
    return this.reply
  }
}
