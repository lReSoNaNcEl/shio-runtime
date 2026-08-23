import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'

import {
  resolveAgentBrowserCommand,
  resolveChromeExecutable,
} from '../../src/main/desktop-control/AgentBrowserResources'
import {
  buildDshChildEnvironment,
  DshAdapterError,
  DshHarnessAdapter,
  type DshLaunchResources,
  type DshModelConfiguration,
} from '../../src/main/desktop-control/DshHarnessAdapter'

async function expectAdapterError(
  operation: () => Promise<unknown>,
  code: DshAdapterError['code'],
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert(error instanceof DshAdapterError)
    assert.equal(error.code, code)
    assert(!error.message.includes('SHIO_REPRO_SECRET'))
    return true
  })
}

async function verifySysteminfoWorkflow(
  resources: DshLaunchResources,
  model: DshModelConfiguration,
): Promise<void> {
  const shellExecution = new DshHarnessAdapter({
    resources: () => resources,
    model: () => model,
    requestTimeoutMs: 20_000,
  })
  try {
    const systeminfoResult = await shellExecution.execute(
      'Run systeminfo once and report whether it completed.',
      new AbortController().signal,
      'shell',
      'systeminfo',
    )
    assert.equal(systeminfoResult.runtimeCompleted, true)
    assert.equal(systeminfoResult.verification, 'verified')
    assert.match(systeminfoResult.reportedOutcome ?? '', /PowerShell exit code: 0/)
    assert.match(systeminfoResult.reportedOutcome ?? '', /stdout:/)
    assert(
      (systeminfoResult.reportedOutcome?.length ?? 0) > 1_000,
      'The shell result lost most of systeminfo stdout',
    )
  } finally {
    await shellExecution.close()
  }
}

async function main(): Promise<void> {
  const desktopRoot = process.cwd()
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'shio-dsh-repro-'))
  const profileDirectory = resolve(desktopRoot, 'resources', 'desktop-control')
  const modulesDirectory = resolve(desktopRoot, 'node_modules')
  const browserExecutable = resolveChromeExecutable()
  assert(browserExecutable, 'Chrome must be discoverable for the browser-runtime repro')
  const realResources: DshLaunchResources = {
    command: process.execPath,
    runtimeScript: resolve(profileDirectory, 'dsh-runtime.mjs'),
    profileDirectory,
    workspaceDirectory: join(temporaryRoot, 'workspace'),
    sessionDirectory: join(temporaryRoot, 'sessions'),
    homeDirectory: join(temporaryRoot, 'runtime'),
    shell: {
      command: resolvePwshPath(undefined, process.env, process.platform),
    },
    browser: {
      command: resolveAgentBrowserCommand(modulesDirectory),
      executablePath: browserExecutable,
      namespace: 'shio-dsh-repro',
      profileDirectory: join(temporaryRoot, 'browser-profile'),
      socketDirectory: join(temporaryRoot, 'browser-runtime'),
    },
  }
  const model: DshModelConfiguration = {
    provider: 'mistral',
    providerDisplayName: 'Mistral',
    model: 'mistral-small-latest',
    baseURL: 'https://api.mistral.ai/v1',
    apiKey: 'dsh-provider-credential',
    credentialConfigured: true,
  }

  try {
    const shellEnvironment = buildDshChildEnvironment(
      {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        SHIO_REPRO_SECRET: 'must-not-cross-boundary',
        GITHUB_TOKEN: 'must-not-cross-boundary',
        MISTRAL_API_KEY: 'must-not-cross-boundary',
        PATH: process.env.PATH,
        PATHEXT: process.env.PATHEXT,
        ComSpec: process.env.ComSpec,
      },
      realResources,
      model,
      'shell',
    )
    assert.equal(shellEnvironment.SHIO_REPRO_SECRET, undefined)
    assert.equal(shellEnvironment.GITHUB_TOKEN, undefined)
    assert.equal(shellEnvironment.MISTRAL_API_KEY, undefined)
    assert.equal(shellEnvironment.SHIO_DSH_API_KEY, 'dsh-provider-credential')
    assert.equal(shellEnvironment.SHIO_DSH_BASE_URL, model.baseURL)
    assert.equal(shellEnvironment.SHIO_DSH_MODEL, model.model)
    assert.equal(shellEnvironment.ELECTRON_RUN_AS_NODE, '1')
    assert.equal(shellEnvironment.PATH, process.env.PATH)
    assert.equal(shellEnvironment.SHIO_DSH_ALLOWED_CAPABILITY, 'shell')
    assert.equal(shellEnvironment.SHIO_PWSH_COMMAND, realResources.shell?.command)
    assert.equal(shellEnvironment.SHIO_AGENT_BROWSER_COMMAND, undefined)

    const browserEnvironment = buildDshChildEnvironment(
      process.env,
      realResources,
      model,
      'browser',
    )
    assert.equal(browserEnvironment.SHIO_DSH_ALLOWED_CAPABILITY, 'browser')
    assert.equal(browserEnvironment.SHIO_PWSH_COMMAND, undefined)
    assert.equal(browserEnvironment.SHIO_AGENT_BROWSER_COMMAND, realResources.browser?.command)
    assert.equal(browserEnvironment.SHIO_AGENT_BROWSER_NAMESPACE, realResources.browser?.namespace)
    assert.equal(browserEnvironment.SHIO_AGENT_BROWSER_SESSION, realResources.browser?.namespace)
    assert.equal(
      browserEnvironment.SHIO_AGENT_BROWSER_PROFILE,
      realResources.browser?.profileDirectory,
    )
    assert.equal(
      browserEnvironment.SHIO_AGENT_BROWSER_SOCKET_DIR,
      realResources.browser?.socketDirectory,
    )
    assert.equal(
      browserEnvironment.SHIO_AGENT_BROWSER_EXECUTABLE_PATH,
      realResources.browser?.executablePath,
    )

    const real = new DshHarnessAdapter({ resources: () => realResources, model: () => model })
    assert.equal(real.snapshot().state, 'stopped')
    assert.equal((await real.checkShellAvailability()).executableAvailable, true)
    await real.start()
    assert.equal(real.snapshot().state, 'ready')
    assert(real.snapshot().startedAt)
    await real.start()
    assert.equal(real.snapshot().state, 'ready')
    await real.start('shell')
    assert.equal(real.snapshot().state, 'ready')
    await real.close()
    assert.equal(real.snapshot().state, 'stopped')

    await verifySysteminfoWorkflow(realResources, model)

    const packagedRoot = process.env.SHIO_DSH_PACKAGED_ROOT
    if (packagedRoot) {
      await verifySysteminfoWorkflow(
        {
          ...realResources,
          command: join(packagedRoot, 'Shio Runtime.exe'),
          runtimeScript: join(
            packagedRoot,
            'resources',
            'app.asar.unpacked',
            'desktop-control',
            'dsh-runtime.mjs',
          ),
          profileDirectory: join(packagedRoot, 'resources', 'app.asar.unpacked', 'desktop-control'),
          workspaceDirectory: join(temporaryRoot, 'packaged-workspace'),
          sessionDirectory: join(temporaryRoot, 'packaged-sessions'),
          homeDirectory: join(temporaryRoot, 'packaged-runtime'),
          browser: undefined,
        },
        model,
      )
    }

    const brokenScript = join(temporaryRoot, 'broken-runtime.mjs')
    await writeFile(brokenScript, 'this is not valid JavaScript', 'utf8')
    const launchFailure = new DshHarnessAdapter({
      resources: () => ({ ...realResources, runtimeScript: brokenScript }),
      model: () => model,
      requestTimeoutMs: 500,
    })
    await expectAdapterError(() => launchFailure.start(), 'DSH_TRANSPORT_CLOSED')
    assert.equal(launchFailure.snapshot().state, 'error')
    await launchFailure.close()

    const hungScript = join(temporaryRoot, 'hung-runtime.mjs')
    await writeFile(hungScript, 'setInterval(() => undefined, 1000)', 'utf8')
    const timeout = new DshHarnessAdapter({
      resources: () => ({ ...realResources, runtimeScript: hungScript }),
      model: () => model,
      requestTimeoutMs: 100,
    })
    await expectAdapterError(() => timeout.start(), 'DSH_REQUEST_TIMEOUT')
    assert.equal(timeout.snapshot().state, 'error')
    await timeout.close()

    let harnessCreations = 0
    let rejectActiveShell: ((error: Error) => void) | null = null
    const cancellable = new DshHarnessAdapter({
      resources: () => realResources,
      model: () => model,
      createHarness: async () => {
        harnessCreations += 1
        const creation = harnessCreations
        return {
          start: async () => undefined,
          run: async () => ({ finalResponse: '', notifications: [] }),
          executeShell: async () => {
            if (creation > 1) {
              return {
                exitCode: 0,
                signal: null,
                timedOut: false,
                aborted: false,
                timeoutMs: 60_000,
                stdout: { text: 'fresh runtime completed', truncated: false },
                stderr: { text: '', truncated: false },
              }
            }
            return new Promise((_, reject) => {
              rejectActiveShell = reject
            })
          },
          close: async () => {
            rejectActiveShell?.(new Error('transport closed after cancellation'))
            rejectActiveShell = null
          },
        }
      },
    })
    const controller = new AbortController()
    const cancelled = cancellable.execute('bounded task', controller.signal, 'shell', 'systeminfo')
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    await expectAdapterError(() => cancelled, 'DSH_CANCELLED')
    assert.equal(cancellable.snapshot().state, 'stopped')
    const fresh = await cancellable.execute(
      'next task',
      new AbortController().signal,
      'shell',
      'systeminfo',
    )
    assert.equal(fresh.runtimeCompleted, true)
    assert.equal(fresh.verification, 'verified')
    assert.equal(harnessCreations, 2)
    await cancellable.close()

    const missingTypedShellEndpoint = new DshHarnessAdapter({
      resources: () => realResources,
      model: () => model,
      createHarness: async () => ({
        start: async () => undefined,
        run: async () => ({ finalResponse: 'claimed completion', notifications: [] }),
        close: async () => undefined,
      }),
    })
    await expectAdapterError(
      () =>
        missingTypedShellEndpoint.execute(
          'must use PowerShell',
          new AbortController().signal,
          'shell',
          'systeminfo',
        ),
      'DSH_PROTOCOL_ERROR',
    )
    await missingTypedShellEndpoint.close()

    const failedShell = new DshHarnessAdapter({
      resources: () => realResources,
      model: () => model,
      createHarness: async () => ({
        start: async () => undefined,
        run: async () => ({ finalResponse: '', notifications: [] }),
        executeShell: async () => ({
          exitCode: 1,
          signal: null,
          timedOut: false,
          aborted: false,
          timeoutMs: 60_000,
          stdout: { text: '', truncated: false },
          stderr: { text: 'command failed', truncated: false },
        }),
        close: async () => undefined,
      }),
    })
    await expectAdapterError(
      () =>
        failedShell.execute(
          'run a failing command',
          new AbortController().signal,
          'shell',
          'exit 1',
        ),
      'DSH_REMOTE_ERROR',
    )
    await failedShell.close()

    const textOnlyBrowser = new DshHarnessAdapter({
      resources: () => ({ ...realResources, browser: undefined }),
      model: () => model,
      createHarness: async () => ({
        start: async () => undefined,
        run: async () => ({ finalResponse: 'I opened it', notifications: [] }),
        close: async () => undefined,
      }),
    })
    await expectAdapterError(
      () => textOnlyBrowser.execute('open the page', new AbortController().signal, 'browser'),
      'DSH_PROTOCOL_ERROR',
    )
    await textOnlyBrowser.close()

    const toolBackedBrowser = new DshHarnessAdapter({
      resources: () => ({ ...realResources, browser: undefined }),
      model: () => model,
      createHarness: async () => ({
        start: async () => undefined,
        run: async (_input, options) => {
          const call = {
            method: 'session.event',
            params: {
              event: {
                type: 'tool/call',
                data: {
                  callId: 'call-1',
                  name: 'mcp__agent-browser__agent_browser_open',
                },
              },
            },
          }
          const result = {
            method: 'session.event',
            params: {
              event: {
                type: 'tool/result',
                data: {
                  message: {
                    source: { callId: 'call-1' },
                    content: [{ type: 'text', text: 'ok' }],
                  },
                },
              },
            },
          }
          options?.onNotification?.(call)
          options?.onNotification?.(result)
          return { finalResponse: 'The page is open.', notifications: [call, result] }
        },
        close: async () => undefined,
      }),
    })
    const browserResult = await toolBackedBrowser.execute(
      'open the page',
      new AbortController().signal,
      'browser',
    )
    assert.equal(browserResult.runtimeCompleted, true)
    assert.equal(browserResult.verification, 'unverified')
    await toolBackedBrowser.close()

    const localPage = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><title>Shio browser repro</title><h1>ready</h1>')
    })
    await new Promise<void>((resolveListen) => localPage.listen(0, '127.0.0.1', resolveListen))
    const address = localPage.address()
    assert(address && typeof address !== 'string')
    const localUrl = `http://127.0.0.1:${address.port}/`
    const browserResources = realResources.browser
    assert(browserResources)
    const directBrowser = new DshHarnessAdapter({
      resources: () => ({
        ...realResources,
        browser: {
          ...browserResources,
          namespace: 'shio-direct-browser-repro',
          profileDirectory: join(temporaryRoot, 'direct-browser-profile'),
          socketDirectory: join(temporaryRoot, 'direct-browser-runtime'),
        },
      }),
      model: () => model,
    })
    try {
      const directResult = await directBrowser.execute(
        'open the exact page',
        new AbortController().signal,
        'browser',
        undefined,
        localUrl,
      )
      assert.equal(directResult.runtimeCompleted, true)
      assert.equal(directResult.verification, 'verified')
      assert.match(directResult.reportedOutcome ?? '', /http:\/\/127\.0\.0\.1:/)
    } finally {
      await directBrowser.close()
      await new Promise<void>((resolveClose, rejectClose) =>
        localPage.close((error) => (error ? rejectClose(error) : resolveClose())),
      )
    }

    let selectedModel = model
    let configurationStarts = 0
    let configurationStops = 0
    const reconfigurable = new DshHarnessAdapter({
      resources: () => ({ ...realResources, browser: undefined }),
      model: () => selectedModel,
      createHarness: async () => {
        configurationStarts += 1
        return {
          start: async () => undefined,
          run: async () => ({ finalResponse: '', notifications: [] }),
          close: async () => {
            configurationStops += 1
          },
        }
      },
    })
    await reconfigurable.start()
    await reconfigurable.start('shell')
    assert.equal(configurationStarts, 2)
    assert.equal(configurationStops, 1)
    selectedModel = { ...model, model: 'mistral-large-latest' }
    await reconfigurable.start('shell')
    assert.equal(configurationStarts, 3)
    assert.equal(configurationStops, 2)
    await reconfigurable.close()

    const missingModel = new DshHarnessAdapter({
      resources: () => realResources,
      model: () => ({ ...model, apiKey: '', credentialConfigured: false }),
    })
    assert.equal(missingModel.modelSnapshot().configured, false)
    await expectAdapterError(() => missingModel.start(), 'DSH_MODEL_NOT_CONFIGURED')

    console.log('DSH adapter repro passed')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
