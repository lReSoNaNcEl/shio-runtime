import { describe, expect, it } from 'vitest'

import {
  developerModeDefaults,
  resolveDeveloperModeSettings,
} from '../../../src/main/configDefaults'
import {
  connectionStatusKey,
  credentialStatusKey,
} from '../../../src/renderer/components/settings/projectStatusPresentation'
import { ControllerStore } from '../../../src/renderer/controller/ControllerStore'
import type { ControllerState } from '../../../src/renderer/controller/contracts'
import {
  isAvatarConfigured,
  shouldBlockChatSubmission,
} from '../../../src/renderer/controller/firstRunState'

describe('First-run state', () => {
  it('uses safe developer-mode defaults and preserves explicit settings', () => {
    expect(developerModeDefaults(true)).toEqual({
      developerModeEnabled: 'false',
      developerOverlayAnimationHudEnabled: 'false',
    })
    expect(developerModeDefaults(false)).toEqual({
      developerModeEnabled: 'true',
      developerOverlayAnimationHudEnabled: 'true',
    })
    expect(
      resolveDeveloperModeSettings(
        {
          developerModeEnabled: 'true',
          developerOverlayAnimationHudEnabled: 'false',
        },
        true,
      ),
    ).toEqual({
      developerModeEnabled: 'true',
      developerOverlayAnimationHudEnabled: 'false',
    })
  })

  it('blocks chat until provider setup is ready', () => {
    const readiness = {
      reason: 'missing-credential',
      providerId: 'groq',
      providerDisplayName: 'Groq',
    } as const
    expect(shouldBlockChatSubmission(readiness)).toBe(true)
    expect(shouldBlockChatSubmission({ ...readiness, reason: 'missing-account-id' })).toBe(true)
    expect(shouldBlockChatSubmission({ ...readiness, reason: 'model-missing' })).toBe(true)
    expect(shouldBlockChatSubmission({ ...readiness, reason: 'ready' })).toBe(false)
  })

  it('recognizes configured VRM and Project credential presentation', () => {
    expect(isAvatarConfigured('')).toBe(false)
    expect(isAvatarConfigured(' C:\\avatar.vrm ')).toBe(true)
    expect(
      credentialStatusKey({
        configured: true,
        source: 'secure_store',
        secureStorageAvailable: true,
      }),
    ).toBe('settings.project.credential.savedSecurely')
    expect(connectionStatusKey.error).toBe('settings.project.connection.error')
  })

  it('restores a failed submitted draft without duplicating its message', () => {
    const store = new ControllerStore({
      chatDraft: 'preserved draft',
      messages: [
        { id: '1', role: 'assistant', text: 'hello' },
        { id: '2', role: 'user', text: 'preserved draft' },
      ],
    } as ControllerState)
    store.removeLatestUserMessage('preserved draft')
    expect(store.getState().messages).toEqual([{ id: '1', role: 'assistant', text: 'hello' }])
    expect(store.getState().chatDraft).toBe('preserved draft')
  })
})
