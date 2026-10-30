import { describe, expect, it } from 'vitest'

import { MainConversationTurnService } from '../../src/main/app/MainConversationTurnService'
import type { LlmGateway } from '../../src/main/llm'
import type { CharacterReplyInput, Orchestrator } from '../../src/main/orchestrator'
import type { ScreenContextService } from '../../src/main/screen-context'
import type { TurnAppraisal } from '../../src/shared/character-tools'

const appraisal: TurnAppraisal = {
  valence: 0.7,
  arousal: 0.2,
  socialRelevance: 0.8,
  novelty: 0.1,
  confidence: 0.9,
}

function service(onTurnAppraisal: (turnId: string, value: TurnAppraisal) => void) {
  const orchestrator = {
    createReply: async (_input: CharacterReplyInput) => ({
      replyText: '[warm]Спасибо!',
      emotionKey: 'warm',
      assistantTurnKind: 'character',
      turnAppraisal: appraisal,
    }),
  } as unknown as Orchestrator
  return new MainConversationTurnService(
    () => orchestrator,
    () => ({ getActiveCapabilities: () => ({ supportsVision: true }) }) as LlmGateway,
    {} as ScreenContextService,
    () =>
      ({
        activeProvider: 'groq',
        providers: { groq: { model: 'model', credential: { configured: true } } },
      }) as never,
    onTurnAppraisal,
  )
}

describe('turn appraisal boundary', () => {
  it('hands an explicit user turn appraisal to Main only and never to the renderer reply', async () => {
    const handed: Array<[string, TurnAppraisal]> = []
    const reply = await service((turnId, value) => handed.push([turnId, value])).createReply(1, {
      turnId: 'turn-user',
      userText: 'Ты молодец!',
    })
    expect(handed).toEqual([['turn-user', appraisal]])
    expect(JSON.stringify(reply)).not.toContain('turnAppraisal')
    expect(JSON.stringify(reply)).not.toContain('valence')
  })

  it('ignores the appraisal of autonomous turns', async () => {
    const handed: string[] = []
    await service((turnId) => handed.push(turnId)).createReply(1, {
      turnId: 'turn-auto',
      userText: 'initiative',
      origin: 'autonomous',
    })
    expect(handed).toEqual([])
  })
})
