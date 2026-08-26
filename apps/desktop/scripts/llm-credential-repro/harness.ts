import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizeLlmConfig, toPublicLlmConfig } from '../../src/main/llm/config'
import {
  type LlmCredentialProtector,
  LlmCredentialStore,
} from '../../src/main/llm/LlmCredentialStore'
import { resolveLlmPersistence } from '../../src/main/llm/persistence'

const xor = (value: Buffer): Buffer => Buffer.from(value.map((byte) => byte ^ 0x5a))

const protector: LlmCredentialProtector = {
  isAvailable: async () => true,
  encrypt: async (value) => xor(Buffer.from(value, 'utf8')),
  decrypt: async (value) => ({
    result: xor(value).toString('utf8'),
    shouldReEncrypt: false,
  }),
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'shio-llm-credential-'))
  const filePath = join(directory, 'credentials', 'llm-credentials.bin')
  try {
    const store = new LlmCredentialStore(filePath, protector, () => undefined)
    await store.load()
    await store.save('groq', 'secure-groq-key')
    await store.save('mistral', 'secure-mistral-key')

    const encrypted = await readFile(filePath)
    assert.equal(encrypted.includes(Buffer.from('secure-groq-key')), false)

    const restarted = new LlmCredentialStore(filePath, protector, () => undefined)
    await restarted.load()
    assert.equal(restarted.resolve('groq').apiKey, 'secure-groq-key')
    assert.equal(restarted.getStatus('groq').source, 'secure_store')

    await restarted.forget('groq')
    assert.equal(restarted.resolve('groq').apiKey, '')
    assert.equal(restarted.resolve('mistral').apiKey, 'secure-mistral-key')

    const legacyCredentialPath = join(directory, 'legacy-cerebras.bin')
    await writeFile(
      legacyCredentialPath,
      xor(
        Buffer.from(
          JSON.stringify({ cerebras: 'legacy-cerebras-key', groq: 'preserved-groq-key' }),
          'utf8',
        ),
      ),
    )
    const migratedCredentials = new LlmCredentialStore(
      legacyCredentialPath,
      protector,
      () => undefined,
    )
    await migratedCredentials.load()
    assert.equal(migratedCredentials.resolve('groq').apiKey, 'preserved-groq-key')
    const migratedCredentialPayload = xor(await readFile(legacyCredentialPath)).toString('utf8')
    assert.equal(migratedCredentialPayload.includes('cerebras'), false)
    assert.equal(migratedCredentialPayload.includes('legacy-cerebras-key'), false)

    const nested = resolveLlmPersistence({
      llm: {
        activeProvider: 'mistral',
        providers: {
          groq: { model: 'g-model', apiKey: 'legacy-groq-key' },
          mistral: { model: 'm-model', apiKey: 'legacy-mistral-key' },
        },
      },
    })
    assert.deepEqual(nested.plaintextCredentials, {
      groq: 'legacy-groq-key',
      mistral: 'legacy-mistral-key',
    })
    await restarted.importMissing(nested.plaintextCredentials)
    assert.equal(restarted.resolve('mistral').apiKey, 'secure-mistral-key')
    assert.equal(restarted.resolve('groq').apiKey, 'legacy-groq-key')

    const flat = resolveLlmPersistence({
      provider: 'openrouter',
      apiKey: 'flat-key',
      model: 'flat-model',
    })
    assert.equal(flat.plaintextCredentials.openrouter, 'flat-key')
    assert.equal(flat.llm.providers.openrouter.model, 'flat-model')

    const legacyCerebrasFlat = resolveLlmPersistence({
      provider: 'cerebras',
      apiKey: 'must-not-migrate',
      model: 'legacy-model',
    })
    assert.equal(legacyCerebrasFlat.llm.activeProvider, 'cloudflare')
    assert.equal(legacyCerebrasFlat.llm.providers.cloudflare.model, '')
    assert.equal(legacyCerebrasFlat.plaintextCredentials.cloudflare, undefined)

    const groqLegacy = resolveLlmPersistence({
      groqApiKey: 'old-groq-key',
      groqModel: 'old-groq-model',
    })
    assert.equal(groqLegacy.plaintextCredentials.groq, 'old-groq-key')

    const persisted = normalizeLlmConfig({
      activeProvider: 'groq',
      providers: {
        groq: {
          model: 'safe-model',
          apiKey: 'must-not-serialize',
          token: 'must-not-serialize',
          secret: 'must-not-serialize',
          credentialValue: 'must-not-serialize',
          maskedKey: 'must-not-serialize',
        },
      },
      roles: {
        backlogSelector: {},
        computerUseVision: {
          providerId: 'openrouter',
          model: 'google/gemini-2.5-flash',
          timeoutMs: 120_000,
          maxSteps: 999,
        },
      },
    })
    const serialized = JSON.stringify(persisted)
    for (const forbidden of ['apiKey', 'token', 'secret', 'credentialValue', 'maskedKey']) {
      assert.equal(serialized.includes(forbidden), false)
    }
    assert.deepEqual(persisted.roles.computerUseVision, {
      providerId: 'openrouter',
      model: 'google/gemini-2.5-flash',
      timeoutMs: 60_000,
      maxSteps: 300,
    })

    const automaticVisual = normalizeLlmConfig({
      roles: {
        computerUseVision: {
          providerId: '',
          model: 'must-not-select-a-model-in-auto-mode',
          timeoutMs: 100,
          maxSteps: 0,
        },
      },
    })
    assert.deepEqual(automaticVisual.roles.computerUseVision, {
      providerId: '',
      model: '',
      timeoutMs: 5_000,
      maxSteps: 1,
    })

    const publicConfig = toPublicLlmConfig(persisted, (provider) => restarted.getStatus(provider))
    assert.equal(JSON.stringify(publicConfig).includes('legacy-groq-key'), false)
    assert.equal(publicConfig.providers.groq.credential.configured, true)
    assert.equal('apiKey' in publicConfig.providers.groq, false)

    const cloudflareMigrated = normalizeLlmConfig({
      activeProvider: 'cerebras',
      providers: { cerebras: { model: 'legacy-cerebras-model' } },
      roles: {
        backlogSelector: {
          enabled: true,
          providerId: 'cerebras',
          model: 'legacy-cerebras-model',
        },
      },
    })
    assert.equal(cloudflareMigrated.activeProvider, 'cloudflare')
    assert.equal(cloudflareMigrated.providers.cloudflare.model, '')
    assert.equal(cloudflareMigrated.roles.backlogSelector.enabled, false)
    assert.equal(cloudflareMigrated.roles.backlogSelector.providerId, '')
    assert.equal(cloudflareMigrated.roles.backlogSelector.model, '')
    const nestedCerebrasMigration = resolveLlmPersistence({
      llm: {
        activeProvider: 'cerebras',
        providers: { cerebras: { model: 'legacy-cerebras-model' } },
      },
    })
    assert.equal(nestedCerebrasMigration.migrated, true)
    assert.equal(nestedCerebrasMigration.llm.activeProvider, 'cloudflare')

    const environmentPath = join(directory, 'environment-only.bin')
    const environmentOnly = new LlmCredentialStore(environmentPath, protector, (provider) =>
      provider === 'groq' ? 'environment-groq-key' : undefined,
    )
    await environmentOnly.load()
    assert.equal(environmentOnly.getStatus('groq').source, 'environment')
    await assert.rejects(readFile(environmentPath), { code: 'ENOENT' })

    const unavailable = new LlmCredentialStore(
      join(directory, 'unavailable.bin'),
      {
        ...protector,
        isAvailable: async () => false,
      },
      () => undefined,
    )
    await unavailable.load()
    await assert.rejects(unavailable.importMissing({ groq: 'plaintext-key' }))
    assert.equal(unavailable.getStatus('groq').configured, false)
    assert.equal(typeof unavailable.getStatus('groq').lastError, 'string')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

void main()
