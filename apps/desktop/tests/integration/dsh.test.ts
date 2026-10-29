import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
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
  const desktopRoot = join(import.meta.dirname, '../..')
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

// Exercise the shipped composition and SDK, rather than a fake harness seam.
it('runs the installed DSH PowerShell backend and tears down active work', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'shio-dsh-native-'))
  const profileDirectory = join(import.meta.dirname, '../../resources/desktop-control')
  const resources: DshLaunchResources = {
    command: process.execPath,
    runtimeScript: join(profileDirectory, 'dsh-runtime.mjs'),
    profileDirectory,
    workspaceDirectory: join(temporaryRoot, 'workspace'),
    sessionDirectory: join(temporaryRoot, 'sessions'),
    homeDirectory: join(temporaryRoot, 'home'),
    shell: { command: resolvePwshPath(undefined, process.env, process.platform) },
  }
  const adapter = new DshHarnessAdapter({ resources: () => resources, model: () => model })
  try {
    const result = await adapter.execute(
      'Return a deterministic marker',
      new AbortController().signal,
      'shell',
      "[Console]::Write('dsh-runtime-ok')",
    )
    assert.equal(result.runtimeCompleted, true)
    assert.equal(result.evidence.kind, 'shell')
    assert.equal(result.reportedOutcome, 'dsh-runtime-ok')
    await assert.rejects(
      adapter.execute('Fail deterministically', new AbortController().signal, 'shell', 'exit 7'),
      (error) => error instanceof DshAdapterError && error.code === 'DSH_REMOTE_ERROR',
    )
    const pidFile = join(temporaryRoot, 'shell.pid')
    const controller = new AbortController()
    const execution = adapter.execute(
      'Exercise cancellation',
      controller.signal,
      'shell',
      `[System.IO.File]::WriteAllText('${pidFile.replaceAll("'", "''")}',[string]$PID); Start-Sleep -Seconds 30`,
    )
    // Attach a rejection observer before waiting for the shell's ready receipt.
    const cancelled = assert.rejects(
      execution,
      (error) => error instanceof DshAdapterError && error.code === 'DSH_CANCELLED',
    )
    let shellPid = 0
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const text = await readFile(pidFile, 'utf8').catch(() => '')
      if (text) {
        shellPid = Number(text)
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    controller.abort()
    await cancelled
    await adapter.close()
    assert.ok(shellPid > 0, 'PowerShell must actually start before cancellation')
    assert.throws(() => process.kill(shellPid, 0), { code: 'ESRCH' })
    assert.equal(adapter.snapshot().state, 'stopped')
  } finally {
    await adapter.close()
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}, 25_000)

it('keeps the alpha model loop restricted to PowerShell and enforces shell deadlines', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'shio-dsh-loop-'))
  const profileDirectory = join(import.meta.dirname, '../../resources/desktop-control')
  const resources: DshLaunchResources = {
    command: process.execPath,
    runtimeScript: join(profileDirectory, 'dsh-runtime.mjs'),
    profileDirectory,
    workspaceDirectory: temporaryRoot,
    sessionDirectory: join(temporaryRoot, 'sessions'),
    homeDirectory: join(temporaryRoot, 'home'),
    shell: { command: resolvePwshPath(undefined, process.env, process.platform) },
  }
  const requests: {
    tools?: { function: { name: string } }[]
    messages: { role: string; content: unknown }[]
  }[] = []
  const server = createServer((request, response) => {
    void (async () => {
      let body = ''
      for await (const chunk of request) body += String(chunk)
      const input = JSON.parse(body) as (typeof requests)[number]
      requests.push(input)
      const hasToolResult = input.messages.some((message) => message.role === 'tool')
      const delta = hasToolResult
        ? { role: 'assistant', content: 'fixture-complete' }
        : {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'pwsh-fixture',
                type: 'function',
                function: {
                  name: 'pwsh',
                  arguments: JSON.stringify({
                    command: "[Console]::Write('model-tool-ok')",
                    description: 'Return marker',
                  }),
                },
              },
            ],
          }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({
          id: 'fixture',
          object: 'chat.completion.chunk',
          model: 'fixture-model',
          created: 1,
          choices: [{ index: 0, delta, finish_reason: null }],
        })}\n\ndata: ${JSON.stringify({
          id: 'fixture',
          object: 'chat.completion.chunk',
          model: 'fixture-model',
          created: 1,
          choices: [{ index: 0, delta: {}, finish_reason: hasToolResult ? 'stop' : 'tool_calls' }],
        })}\n\ndata: [DONE]\n\n`,
      )
    })().catch(() => {
      response.writeHead(500)
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const environment = buildDshChildEnvironment(
    process.env,
    resources,
    { ...model, baseURL: `http://127.0.0.1:${address.port}/v1` },
    'shell',
  )
  const harness = new DeepSeekHarness({
    dshBin: resources.runtimeScript,
    processCwd: profileDirectory,
    env: environment,
    cwd: temporaryRoot,
    provider: 'shio-settings',
    model: model.model,
    requestTimeoutMs: 10_000,
  })
  try {
    await mkdir(resources.homeDirectory, { recursive: true })
    await mkdir(resources.sessionDirectory, { recursive: true })
    const result = await harness.run('Run the fixture command and report completion')
    assert.equal(result.finalResponse, 'fixture-complete')
    assert.equal(requests.length, 2)
    assert.deepEqual(
      requests[0]?.tools?.map((tool) => tool.function.name),
      ['pwsh'],
    )
    assert.match(JSON.stringify(requests[1]?.messages), /model-tool-ok/u)
    const timedOut = (await harness.client.request('shio/shell.execute', {
      command: 'Start-Sleep -Seconds 30',
      timeoutMs: 100,
    })) as { timedOut: boolean; exitCode: number | null }
    assert.equal(timedOut.timedOut, true)
    await assert.rejects(
      harness.client.request('shio/shell.execute', { command: 'exit 0', extra: true }),
    )
  } finally {
    await harness.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}, 20_000)
