import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { describe, it, vi } from 'vitest'

import { DesktopControlPlugin } from '../../src/main/desktop-control/DesktopControlPlugin'
import {
  buildDshChildEnvironment,
  DshAdapterError,
  DshHarnessAdapter,
  type DshLaunchResources,
} from '../../src/main/desktop-control/DshHarnessAdapter'

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
    const environment = buildDshChildEnvironment(
      { ...process.env, SHIO_DSH_API_KEY: 'must-not-inherit', CODEX_API_KEY: 'must-not-inherit' },
      resources,
      'shell',
    )
    assert.equal(environment.SHIO_DSH_ALLOWED_CAPABILITY, 'shell')
    assert.equal(environment.SHIO_PWSH_COMMAND, resources.shell?.command)
    assert.equal(environment.SHIO_DSH_EXACT_SHELL, '1')
    assert.equal(environment.SHIO_DSH_API_KEY, undefined)
    assert.equal(environment.CODEX_API_KEY, undefined)
    assert.equal(environment.SHIO_DSH_MODEL, undefined)
    assert.equal(environment.SHIO_DSH_BASE_URL, undefined)
    let starts = 0
    let closes = 0
    const adapter = new DshHarnessAdapter({
      resources: () => resources,
      createHarness: async () => ({
        start: async () => {
          starts += 1
        },
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

    const characterModel = vi.fn(() => ({
      provider: 'codex-cli' as const,
      providerDisplayName: 'Codex CLI',
      model: 'gpt-6-luna',
      configured: false,
    }))
    const plugin = new DesktopControlPlugin({
      adapter,
      authorityMode: () => 'confirm',
      characterModel,
    })
    try {
      await plugin.initialize({ pluginId: plugin.manifest.id })
      await plugin.start()
      assert.equal((await plugin.getHealth()).state, 'healthy')
      assert.equal((await plugin.getCapabilityProjection()).computerControl, 'ready')
      assert.equal(characterModel.mock.calls.length, 0)
      const status = await plugin.startRuntime()
      assert.equal(status.runtime.state, 'ready')
      assert.equal(status.model.configured, false)
    } finally {
      await plugin.dispose()
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

describe('DSH adapter', () => {
  it('runs exact commands with a credential-minimal child environment', async () => {
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
  const adapter = new DshHarnessAdapter({ resources: () => resources })
  try {
    const result = await adapter.execute(
      'Read the local year',
      new AbortController().signal,
      'shell',
      'Get-Date -Format yyyy',
    )
    assert.equal(result.runtimeCompleted, true)
    assert.equal(result.evidence.kind, 'shell')
    assert.equal(result.reportedOutcome, String(new Date().getFullYear()))
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
  // The legacy model-loop fixture explicitly opts in to its own local mock provider.
  const environment = {
    ...buildDshChildEnvironment(process.env, resources, 'shell'),
    SHIO_DSH_EXACT_SHELL: '0',
    SHIO_DSH_API_KEY: 'fixture-only',
    SHIO_DSH_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    SHIO_DSH_MODEL: 'fixture-model',
  }
  const harness = new DeepSeekHarness({
    dshBin: resources.runtimeScript,
    processCwd: profileDirectory,
    env: environment,
    cwd: temporaryRoot,
    provider: 'shio-settings',
    model: environment.SHIO_DSH_MODEL,
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
