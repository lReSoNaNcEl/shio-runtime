import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { describe, it } from 'vitest'

import {
  buildDshChildEnvironment,
  DshAdapterError,
  DshHarnessAdapter,
  type DshLaunchResources,
  type DshModelConfiguration,
} from '../../src/main/desktop-control/DshHarnessAdapter'

const model: DshModelConfiguration = {
  provider: 'groq',
  providerDisplayName: 'Groq',
  model: 'fixture-model',
  baseURL: 'https://api.example.test/openai/v1',
  apiKey: 'fixture-secret',
  credentialConfigured: true,
}

async function main(): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'shio-dsh-repro-'))
  const desktopRoot = process.cwd().endsWith('apps\\desktop')
    ? process.cwd()
    : join(process.cwd(), 'apps', 'desktop')
  const profileDirectory = join(desktopRoot, 'resources', 'desktop-control')
  const resources: DshLaunchResources = {
    command: process.execPath,
    runtimeScript: join(profileDirectory, 'dsh-runtime.mjs'),
    profileDirectory,
    workspaceDirectory: join(temporaryRoot, 'workspace'),
    sessionDirectory: join(temporaryRoot, 'sessions'),
    homeDirectory: join(temporaryRoot, 'home'),
    shell: { command: resolvePwshPath(undefined, process.env, process.platform) },
  }
  try {
    const environment = buildDshChildEnvironment(process.env, resources, model, 'shell')
    assert.equal(environment.SHIO_DSH_ALLOWED_CAPABILITY, 'shell')
    assert.equal(environment.SHIO_PWSH_COMMAND, resources.shell?.command)
    assert.equal(environment.SHIO_DSH_API_KEY, model.apiKey)
    assert.equal(environment.SHIO_DSH_MODEL, model.model)
    assert.equal(environment.SHIO_DSH_BASE_URL, model.baseURL)
    let starts = 0
    let closes = 0
    const adapter = new DshHarnessAdapter({
      resources: () => resources,
      model: () => model,
      createHarness: async () => ({
        start: async () => {
          starts += 1
        },
        run: async () => ({ finalResponse: '', notifications: [] }),
        executeShell: async (command, timeoutMs) => ({
          exitCode: command === 'exit 7' ? 7 : 0,
          signal: null,
          timedOut: false,
          aborted: false,
          timeoutMs,
          stdout: {
            text:
              command === 'node -v'
                ? 'v22.12.0'
                : command === 'npx.cmd --version'
                  ? '11.17.0'
                  : 'fixture output',
            truncated: false,
          },
          stderr: { text: '', truncated: false },
        }),
        close: async () => {
          closes += 1
        },
      }),
    })
    assert.equal(await adapter.checkAvailability(), true)
    assert.equal((await adapter.checkShellAvailability()).executableAvailable, true)
    const result = await adapter.execute(
      'Read the installed Node.js version',
      new AbortController().signal,
      'shell',
      'node -v',
    )
    assert.equal(result.runtimeCompleted, true)
    assert.equal(result.evidence.kind, 'shell')
    assert.equal(result.presentationFacts?.[0]?.value, '22.12.0')
    assert.equal(starts, 1)

    const npxResult = await adapter.execute(
      'Read the installed npx version',
      new AbortController().signal,
      'shell',
      'npx.cmd --version',
    )
    assert.deepEqual(npxResult.presentationFacts?.[0], {
      kind: 'runtime-version',
      label: 'npx',
      value: '11.17.0',
      sensitivity: 'safe',
    })

    await assert.rejects(
      () =>
        adapter.execute('Run the failing fixture', new AbortController().signal, 'shell', 'exit 7'),
      (error) => error instanceof DshAdapterError && error.code === 'DSH_REMOTE_ERROR',
    )
    await adapter.close()
    assert.equal(closes, 1)

    const unconfigured = new DshHarnessAdapter({
      resources: () => resources,
      model: () => ({ ...model, apiKey: '', credentialConfigured: false }),
    })
    await assert.rejects(
      () => unconfigured.start('shell'),
      (error) => error instanceof DshAdapterError && error.code === 'DSH_MODEL_NOT_CONFIGURED',
    )
    console.log('DSH shell planner seam repro: PASS')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

describe('DSH adapter', () => {
  it('preserves the shell planner seam', async () => {
    await main()
  })
})
