import assert from 'node:assert/strict'

import { developerModeDefaults, resolveDeveloperModeSettings } from '../../src/main/configDefaults'
import {
  connectionStatusKey,
  credentialStatusKey,
} from '../../src/renderer/components/settings/projectStatusPresentation'
import { ControllerStore } from '../../src/renderer/controller/ControllerStore'
import type { ControllerState } from '../../src/renderer/controller/contracts'
import {
  isVrmConfigured,
  shouldBlockChatSubmission,
} from '../../src/renderer/controller/firstRunState'

assert.deepEqual(developerModeDefaults(true), {
  developerModeEnabled: 'false',
  developerOverlayAnimationHudEnabled: 'false',
})
assert.deepEqual(developerModeDefaults(false), {
  developerModeEnabled: 'true',
  developerOverlayAnimationHudEnabled: 'true',
})
assert.deepEqual(
  resolveDeveloperModeSettings(
    {
      developerModeEnabled: 'true',
      developerOverlayAnimationHudEnabled: 'false',
    },
    true,
  ),
  {
    developerModeEnabled: 'true',
    developerOverlayAnimationHudEnabled: 'false',
  },
)

const readiness = {
  reason: 'missing-credential',
  providerId: 'groq',
  providerDisplayName: 'Groq',
} as const
assert.equal(shouldBlockChatSubmission(readiness), true)
assert.equal(shouldBlockChatSubmission({ ...readiness, reason: 'missing-account-id' }), true)
assert.equal(shouldBlockChatSubmission({ ...readiness, reason: 'model-missing' }), true)
assert.equal(shouldBlockChatSubmission({ ...readiness, reason: 'ready' }), false)
assert.equal(isVrmConfigured(''), false)
assert.equal(isVrmConfigured(' C:\\avatar.vrm '), true)
assert.equal(
  credentialStatusKey({
    configured: true,
    source: 'secure_store',
    secureStorageAvailable: true,
  }),
  'settings.project.credential.savedSecurely',
)
assert.equal(connectionStatusKey.error, 'settings.project.connection.error')

const store = new ControllerStore({
  chatDraft: 'preserved draft',
  messages: [
    { id: '1', role: 'assistant', text: 'hello' },
    { id: '2', role: 'user', text: 'preserved draft' },
  ],
} as ControllerState)
store.removeLatestUserMessage('preserved draft')
assert.deepEqual(store.getState().messages, [{ id: '1', role: 'assistant', text: 'hello' }])
assert.equal(store.getState().chatDraft, 'preserved draft')

console.log('first-run repro: passed')
