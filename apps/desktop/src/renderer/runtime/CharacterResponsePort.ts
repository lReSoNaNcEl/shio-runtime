import type { CharacterEmbodimentIntent } from '../../shared/character-response'
import type { CharacterReplyStreamEvent } from '../../shared/character-stream'
import type {
  CharacterReplyOrigin,
  ConversationTurnFailure,
  ReplyGrounding,
} from '../../shared/conversation'
import {
  type EmotionTextSegment,
  parseEmotionalReply,
  stripAssistantMarkup,
} from '../../shared/emotion'

export class LlmCredentialMissingError extends Error {
  constructor() {
    super('LLM_CREDENTIAL_MISSING')
    this.name = 'LlmCredentialMissingError'
  }
}

export class LlmModelMissingError extends Error {
  constructor() {
    super('LLM_MODEL_MISSING')
    this.name = 'LlmModelMissingError'
  }
}

export class ConversationTurnFailureError extends Error {
  constructor(readonly failure: ConversationTurnFailure) {
    super(failure.code)
    this.name = 'ConversationTurnFailureError'
  }
}

export interface AssistantReplyDraft {
  replyText: string
  displayText: string
  speechText: string
  emotionKey: string
  embodimentIntent?: CharacterEmbodimentIntent
  grounding?: ReplyGrounding
  segments: EmotionTextSegment[]
}

export interface CharacterResponsePort {
  createReply(
    turnId: string,
    userText: string,
    screenContextId?: string,
    onStreamEvent?: (event: CharacterReplyStreamEvent) => void,
    origin?: CharacterReplyOrigin,
  ): Promise<AssistantReplyDraft>
}

/** Renderer-side transport adapter for Main-owned Character Response Generation. */
export class MainCharacterResponsePort implements CharacterResponsePort {
  async createReply(
    turnId: string,
    userText: string,
    screenContextId?: string,
    onStreamEvent?: (event: CharacterReplyStreamEvent) => void,
    origin?: CharacterReplyOrigin,
  ): Promise<AssistantReplyDraft> {
    let resolveStreamCompletion: (() => void) | undefined
    // The invoke result and pushed stream events use separate IPC channels. Keep
    // the listener alive until the terminal event so queued tail deltas cannot be lost.
    const streamCompletion = onStreamEvent
      ? new Promise<void>((resolve) => {
          resolveStreamCompletion = resolve
        })
      : undefined
    const unsubscribe = onStreamEvent
      ? window.api.llm.onReplyStreamEvent((event) => {
          if (event.turnId !== turnId) return
          if (event.type === 'completed') resolveStreamCompletion?.()
          onStreamEvent(event)
        })
      : undefined
    let reply: Awaited<ReturnType<Window['api']['llm']['reply']>>
    try {
      reply = await window.api.llm.reply(turnId, userText, screenContextId, origin)
      if (reply.ok) await streamCompletion
    } finally {
      unsubscribe?.()
    }
    if (!reply.ok || !reply.replyText) {
      if (reply.errorCode === 'LLM_CREDENTIAL_MISSING') throw new LlmCredentialMissingError()
      if (reply.errorCode === 'LLM_MODEL_MISSING') throw new LlmModelMissingError()
      if (reply.failure) throw new ConversationTurnFailureError(reply.failure)
      throw new Error('UNKNOWN')
    }

    const parsed = parseEmotionalReply(reply.replyText)
    const segments = parsed.segments.map((segment) => ({
      ...segment,
      text: stripAssistantMarkup(segment.text),
    }))
    return {
      replyText: reply.replyText,
      displayText: parsed.visibleText,
      speechText: segments.map((segment) => segment.text).join(' '),
      emotionKey: parsed.primaryEmotion,
      segments,
      embodimentIntent: reply.embodimentIntent,
      grounding: reply.grounding,
    }
  }
}
