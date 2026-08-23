import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChatMessage, LLMProvider } from '../../src/main/llm'
import type { MemoryStore } from '../../src/main/memory'
import { Orchestrator } from '../../src/main/orchestrator'
import {
  type BundledPlugin,
  PluginCapabilityRegistry,
  type PluginInitializationContext,
  PluginRegistryStore,
  PluginRuntime,
} from '../../src/main/plugins'
import { PROJECT_AWARENESS_MANIFEST } from '../../src/main/project-awareness'
import type { SpeechClient } from '../../src/main/speech/speechClient'
import type { AppSettings } from '../../src/shared/config'
import {
  MAX_CHARACTER_CAPABILITY_KINDS_PER_PLUGIN,
  MAX_CHARACTER_PLUGIN_CAPABILITIES,
  type PluginHealth,
  type ProjectContextProvider,
} from '../../src/shared/plugins'

class CapabilityPlugin implements BundledPlugin {
  readonly manifest = PROJECT_AWARENESS_MANIFEST
  health: PluginHealth = { state: 'healthy', checkedAt: 1 }
  private readonly projectContext: ProjectContextProvider = { buildContext: async () => null }

  async initialize(_context: PluginInitializationContext): Promise<void> {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async dispose(): Promise<void> {}
  getHealth(): PluginHealth {
    return this.health
  }
  getProjectContextProvider(): ProjectContextProvider {
    return this.projectContext
  }
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'shio-character-capabilities-'))
  const plugin = new CapabilityPlugin()
  const runtime = new PluginRuntime(
    [plugin],
    new PluginRegistryStore(join(directory, 'registry.json'), [PROJECT_AWARENESS_MANIFEST]),
    new PluginCapabilityRegistry(),
  )
  try {
    const disabled = await runtime.getCharacterCapabilitySnapshot()
    assert.equal(disabled.plugins.length, 1)
    assert.equal(disabled.plugins[0]?.id, 'project-awareness')
    assert.equal(disabled.plugins[0]?.installed, true)
    assert.equal(disabled.plugins[0]?.enabled, false)
    assert.equal(disabled.plugins[0]?.availability, 'disabled')
    assert(Object.isFrozen(disabled))
    assert(Object.isFrozen(disabled.plugins))

    await runtime.enable('project-awareness')
    const availableTurn = await runtime.getCharacterCapabilitySnapshot()
    assert.equal(availableTurn.plugins[0]?.availability, 'available')
    assert.deepEqual(availableTurn.plugins[0]?.capabilities, ['project-context'])

    plugin.health = { state: 'needs-setup', checkedAt: 2 }
    assert.equal(
      (await runtime.getCharacterCapabilitySnapshot()).plugins[0]?.availability,
      'needs-setup',
    )
    plugin.health = { state: 'degraded', checkedAt: 3 }
    assert.equal(
      (await runtime.getCharacterCapabilitySnapshot()).plugins[0]?.availability,
      'degraded',
    )
    plugin.health = {
      state: 'error',
      checkedAt: 4,
      detail: 'super-secret-token C:\\private\\project-index.sqlite',
    }
    const unavailable = await runtime.getCharacterCapabilitySnapshot()
    assert.equal(unavailable.plugins[0]?.availability, 'unavailable')
    assert.equal(JSON.stringify(unavailable).includes('super-secret-token'), false)
    assert.equal(JSON.stringify(unavailable).includes('project-index.sqlite'), false)

    plugin.health = { state: 'healthy', checkedAt: 5 }
    await runtime.disable('project-awareness')
    const disabledNextTurn = await runtime.getCharacterCapabilitySnapshot()
    assert.equal(disabledNextTurn.plugins[0]?.availability, 'disabled')
    assert.equal(availableTurn.plugins[0]?.availability, 'available')
    assert.equal(availableTurn.plugins[0]?.enabled, true)
    assert.equal(
      disabledNextTurn.plugins.some((item) => String(item.id) === 'deepseek-harness-desktop'),
      false,
    )
    assert(disabledNextTurn.plugins.length <= MAX_CHARACTER_PLUGIN_CAPABILITIES)
    assert(
      disabledNextTurn.plugins.every(
        (item) => item.capabilities.length <= MAX_CHARACTER_CAPABILITY_KINDS_PER_PLUGIN,
      ),
    )

    let captured: readonly ChatMessage[] = []
    const llm: LLMProvider = {
      chat: async (messages) => {
        captured = messages
        return '[neutral]Project Awareness установлен, но сейчас выключен.'
      },
    }
    const committed: ChatMessage[] = []
    const memory: MemoryStore = {
      getHistory: async () => [],
      appendTurn: async (_sessionId, turn) => {
        committed.push(turn.user, turn.assistant)
      },
      clear: async () => undefined,
    }
    const orchestrator = new Orchestrator(
      llm,
      memory,
      {} as SpeechClient,
      () => ({ uiLocale: 'ru' }) as AppSettings,
      undefined,
      { getSnapshot: () => runtime.getCharacterCapabilitySnapshot() },
    )
    await orchestrator.createReply({ userText: 'Какие у тебя сейчас есть плагины?' })
    const prompt = captured.find(
      (message) =>
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.includes('## Current Shio Capabilities'),
    )?.content
    assert.equal(typeof prompt, 'string')
    assert.match(String(prompt), /Project Awareness/)
    assert.match(String(prompt), /enabled: no/)
    assert.match(String(prompt), /availability: disabled/)
    assert.match(String(prompt), /state whether it is enabled and its normalized availability/)
    assert.match(String(prompt), /absent from this list is not installed or available now/)
    assert.doesNotMatch(String(prompt), /DeepSeek Harness Desktop/)
    assert.equal(JSON.stringify(committed).includes('availability: disabled'), false)
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
  console.log('Character Capability Awareness focused repro: PASS')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
