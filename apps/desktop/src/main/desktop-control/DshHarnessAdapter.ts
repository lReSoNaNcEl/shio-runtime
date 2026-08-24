import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import {
  type ActionPresentationFact,
  DESKTOP_WORKFLOW_REPORTED_OUTCOME_MAX_CHARS,
  type DesktopWorkflowCapability,
} from '../../shared/actions'
import { type DesktopControlRuntimeState, DSH_RUNTIME_VERSION } from '../../shared/desktop-control'
import type { LlmProviderId } from '../../shared/llm'
import { mainLog } from '../logging/safeLogger'
import {
  AGENT_BROWSER_SESSION_IDLE_TIMEOUT_ARGUMENT,
  type AgentBrowserRuntimeResources,
  buildAgentBrowserChildEnvironment,
} from './AgentBrowserResources'
import type {
  DesktopWorkflowAdapterResult,
  DesktopWorkflowExecutionEvidence,
  ShellExecutionEvidence,
} from './executionEvidence'

export interface DshLaunchResources {
  command: string
  runtimeScript: string
  profileDirectory: string
  workspaceDirectory: string
  sessionDirectory: string
  homeDirectory: string
  shell?: {
    command: string
  }
  browser?: AgentBrowserRuntimeResources
}

export type DshWorkflowCapability = Extract<DesktopWorkflowCapability, 'browser' | 'shell'>

export interface DshAdapterSnapshot {
  state: DesktopControlRuntimeState
  version: typeof DSH_RUNTIME_VERSION
  startedAt?: number
  lastError?: string
}

export interface DshModelConfiguration {
  provider: LlmProviderId
  providerDisplayName: string
  model: string
  baseURL: string
  apiKey: string
  credentialConfigured: boolean
  lastError?: string
}

export interface DshModelSnapshot {
  provider: LlmProviderId
  providerDisplayName: string
  model: string
  configured: boolean
  lastError?: string
}

interface HarnessRuntime {
  start(): Promise<void>
  run(
    input: string,
    options?: { onNotification?: (notification: unknown) => void },
  ): Promise<{ finalResponse: string; notifications: unknown[] }>
  executeShell?(command: string, timeoutMs: number): Promise<unknown>
  close(): Promise<void>
}

export interface DshHarnessAdapterOptions {
  resources: () => DshLaunchResources
  model: () => DshModelConfiguration
  environment?: NodeJS.ProcessEnv
  requestTimeoutMs?: number
  createHarness?: (options: {
    resources: DshLaunchResources
    model: DshModelConfiguration
    environment: NodeJS.ProcessEnv
    requestTimeoutMs: number
  }) => Promise<HarnessRuntime>
}

export class DshAdapterError extends Error {
  constructor(
    readonly code:
      | 'DSH_STARTUP_FAILED'
      | 'DSH_REQUEST_TIMEOUT'
      | 'DSH_PROTOCOL_ERROR'
      | 'DSH_TRANSPORT_CLOSED'
      | 'DSH_REMOTE_ERROR'
      | 'DSH_CANCELLED'
      | 'DSH_ACTION_LIMIT'
      | 'DSH_RUNTIME_UNAVAILABLE'
      | 'DSH_MODEL_NOT_CONFIGURED',
    message: string,
    readonly recoverable = true,
    readonly evidence?: DesktopWorkflowExecutionEvidence,
  ) {
    super(message)
    this.name = 'DshAdapterError'
  }
}

const SAFE_OS_VARIABLES = [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'PATH',
  'Path',
  'PATHEXT',
  'ComSpec',
  'ProgramFiles',
  'ProgramW6432',
] as const

const SHELL_REQUEST_TIMEOUT_MS = 60_000
const DSH_BROWSER_TOOL_CALL_MAX = 20
const DSH_BROWSER_OBSERVATION_MAX = 30
const shellOutputSchema = z
  .object({
    text: z.string().max(64_000),
    truncated: z.boolean(),
  })
  .strict()
const shellExecutionResultSchema = z
  .object({
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    timedOut: z.boolean(),
    aborted: z.boolean(),
    timeoutMs: z.number().int().positive().max(120_000),
    stdout: shellOutputSchema,
    stderr: shellOutputSchema,
  })
  .strict()
type ShellExecutionResult = z.infer<typeof shellExecutionResultSchema>

interface BrowserToolTrace {
  calls: Map<string, string>
  successfulResults: Set<string>
}

function observeBrowserToolNotification(notification: unknown, trace: BrowserToolTrace): void {
  if (!notification || typeof notification !== 'object') return
  const envelope = notification as {
    method?: unknown
    params?: {
      event?: {
        type?: unknown
        data?: {
          callId?: unknown
          name?: unknown
          error?: unknown
          message?: { source?: { callId?: unknown }; content?: unknown }
        }
      }
    }
  }
  if (envelope.method !== 'session.event') return
  const event = envelope.params?.event
  const data = event?.data
  if (!event || !data) return
  if (
    event.type === 'tool/call' &&
    typeof data.callId === 'string' &&
    typeof data.name === 'string' &&
    data.name.startsWith('mcp__agent-browser__')
  ) {
    trace.calls.set(data.callId, data.name)
    return
  }
  if (event.type !== 'tool/result') return
  const callId = data.message?.source?.callId
  if (typeof callId !== 'string' || !trace.calls.has(callId) || data.error !== undefined) return
  const content = data.message?.content
  const failedContent =
    Array.isArray(content) &&
    content.some(
      (block) =>
        typeof block === 'object' && block !== null && 'isError' in block && block.isError === true,
    )
  if (!failedContent) trace.successfulResults.add(callId)
}

export function buildDshChildEnvironment(
  hostEnvironment: NodeJS.ProcessEnv,
  resources: Pick<
    DshLaunchResources,
    'workspaceDirectory' | 'sessionDirectory' | 'homeDirectory' | 'browser' | 'shell'
  >,
  model: Pick<DshModelConfiguration, 'apiKey' | 'baseURL' | 'model'>,
  capability: DshWorkflowCapability,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    NO_COLOR: '1',
    DSH_CWD: resources.workspaceDirectory,
    DSH_SESSION_ROOT: resources.sessionDirectory,
    DSH_HOME: resources.homeDirectory,
    SHIO_DSH_ALLOWED_CAPABILITY: capability,
  }
  for (const name of SAFE_OS_VARIABLES) {
    const value = hostEnvironment[name]
    if (value) environment[name] = value
  }
  environment.SHIO_DSH_API_KEY = model.apiKey
  environment.SHIO_DSH_BASE_URL = model.baseURL
  environment.SHIO_DSH_MODEL = model.model
  if (capability === 'shell' && resources.shell) {
    environment.SHIO_PWSH_COMMAND = resources.shell.command
  }
  const browser = capability === 'browser' ? resources.browser : undefined
  if (browser) {
    environment.SHIO_AGENT_BROWSER_COMMAND = browser.command
    environment.SHIO_AGENT_BROWSER_NAMESPACE = browser.namespace
    environment.SHIO_AGENT_BROWSER_SESSION = browser.namespace
    environment.SHIO_AGENT_BROWSER_PROFILE = browser.profileDirectory
    environment.SHIO_AGENT_BROWSER_SOCKET_DIR = browser.socketDirectory
    if (browser.executablePath) {
      environment.SHIO_AGENT_BROWSER_EXECUTABLE_PATH = browser.executablePath
    }
  }
  return environment
}

function runAgentBrowserCommand(
  browser: AgentBrowserRuntimeResources,
  hostEnvironment: NodeJS.ProcessEnv,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(browser.command, args, {
      cwd: browser.socketDirectory,
      env: buildAgentBrowserChildEnvironment(hostEnvironment, browser),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < 32_000) stdout += chunk.slice(0, 32_000 - stdout.length)
    })
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 4_000) stderr += chunk.slice(0, 4_000 - stderr.length)
    })
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolveRun(stdout)
    }
    const abort = (): void => {
      child.kill()
      finish(new DshAdapterError('DSH_CANCELLED', publicMessage('DSH_CANCELLED')))
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('agent-browser command timed out'))
    }, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.once('error', (error) => finish(error))
    child.once('exit', (code) => {
      if (code === 0) finish()
      else
        finish(
          new Error(
            `agent-browser command failed with exit code ${code}: ${stderr.trim().slice(0, 500)}`,
          ),
        )
    })
  })
}

async function defaultCreateHarness({
  resources,
  model,
  environment,
  requestTimeoutMs,
}: {
  resources: DshLaunchResources
  model: DshModelConfiguration
  environment: NodeJS.ProcessEnv
  requestTimeoutMs: number
}): Promise<HarnessRuntime> {
  const sdk = await import('@deepseek-ai/dsh-sdk-client')
  const harness = new sdk.DeepSeekHarness({
    launch: {
      command: resources.command,
      args: [resources.runtimeScript],
      cwd: resources.profileDirectory,
      env: environment,
      requestTimeoutMs,
      shutdownTimeoutMs: 1_500,
      disposeEofGraceMs: 6_000,
      disposeGraceMs: 3_000,
    },
    cwd: resources.workspaceDirectory,
    provider: 'shio-settings',
    model: model.model,
  })
  return {
    start: () => harness.start(),
    run: (input, options) => harness.run(input, options),
    executeShell: (command, timeoutMs) =>
      harness.client.request('shio/shell.execute', { command, timeoutMs }, timeoutMs + 5_000),
    close: () => harness.close(),
  }
}

function publicMessage(code: DshAdapterError['code']): string {
  switch (code) {
    case 'DSH_REQUEST_TIMEOUT':
      return 'Desktop Control runtime timed out'
    case 'DSH_PROTOCOL_ERROR':
      return 'Desktop Control runtime returned an invalid response'
    case 'DSH_TRANSPORT_CLOSED':
      return 'Desktop Control runtime connection closed'
    case 'DSH_REMOTE_ERROR':
      return 'Desktop Control runtime rejected the request'
    case 'DSH_CANCELLED':
      return 'Desktop Control task was stopped'
    case 'DSH_ACTION_LIMIT':
      return 'Desktop Control reached the browser workflow action limit'
    case 'DSH_RUNTIME_UNAVAILABLE':
      return 'Desktop Control runtime is not installed correctly'
    case 'DSH_MODEL_NOT_CONFIGURED':
      return 'Desktop Control requires an active model and API key in Settings'
    case 'DSH_STARTUP_FAILED':
      return 'Desktop Control runtime could not start'
  }
}

function renderShellOutcome(result: ShellExecutionResult): string | undefined {
  const boundedText = (text: string, maxCharacters: number): string => {
    if (text.length <= maxCharacters) return text
    const omission = '\n… output omitted …\n'
    const available = maxCharacters - omission.length
    const headLength = Math.ceil(available * 0.8)
    return `${text.slice(0, headLength)}${omission}${text.slice(-(available - headLength))}`
  }
  const observed = result.stdout.text.trim() || result.stderr.text.trim()
  if (!observed) return undefined
  return boundedText(observed, DESKTOP_WORKFLOW_REPORTED_OUTCOME_MAX_CHARS)
}

function shellExecutionEvidence(
  result: ShellExecutionResult,
  durationMs: number,
): ShellExecutionEvidence {
  return {
    kind: 'shell',
    exitCode: result.exitCode,
    stdout: result.stdout.text,
    stderr: result.stderr.text,
    truncated: result.stdout.truncated || result.stderr.truncated,
    durationMs,
    timedOut: result.timedOut,
    aborted: result.aborted,
  }
}

const RUNTIME_VERSION_COMMANDS: ReadonlyMap<string, string> = new Map([
  ['node -v', 'Node.js'],
  ['node --version', 'Node.js'],
  ['npm -v', 'npm'],
  ['npm --version', 'npm'],
  ['python --version', 'Python'],
  ['python -V', 'Python'],
  ['py --version', 'Python'],
  ['py -V', 'Python'],
  ['git --version', 'Git'],
])

function exactRuntimeVersion(label: string, output: string): string | undefined {
  const escapedLabel =
    label === 'Node.js' || label === 'npm' ? '' : `${label.replace('.', '\\.')}\\s+`
  const match = output.match(
    new RegExp(
      `^${escapedLabel}${label === 'Git' ? 'version\\s+' : ''}v?(\\d+(?:\\.\\d+){1,4}(?:[-+.][0-9A-Za-z.-]+)?)$`,
      'iu',
    ),
  )
  return match?.[1]
}

function runtimeVersionPresentationFacts(
  command: string,
  evidence: ShellExecutionEvidence,
): readonly ActionPresentationFact[] | undefined {
  const normalizedCommand = command.trim().replace(/\s+/gu, ' ')
  const separator = normalizedCommand.indexOf(' ')
  const commandKey =
    separator < 0
      ? normalizedCommand.toLowerCase()
      : `${normalizedCommand.slice(0, separator).toLowerCase()}${normalizedCommand.slice(separator)}`
  const label = RUNTIME_VERSION_COMMANDS.get(commandKey)
  if (!label || evidence.exitCode !== 0 || evidence.truncated) return undefined
  const output = evidence.stdout.trim() || evidence.stderr.trim()
  const version = exactRuntimeVersion(label, output)
  if (!version) return undefined
  return Object.freeze([
    Object.freeze({ kind: 'runtime-version', label, value: version, sensitivity: 'safe' }),
  ])
}

export class DshHarnessAdapter {
  private harness: HarnessRuntime | null = null
  private state: DesktopControlRuntimeState = 'stopped'
  private startedAt: number | undefined
  private lastError: string | undefined
  private activeModelSignature = ''
  private startTask: Promise<void> | null = null
  private closeTask: Promise<void> | null = null
  private running = false
  private readonly listeners = new Set<() => void>()

  constructor(private readonly options: DshHarnessAdapterOptions) {}

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): DshAdapterSnapshot {
    return {
      state: this.state,
      version: DSH_RUNTIME_VERSION,
      startedAt: this.startedAt,
      lastError: this.lastError,
    }
  }

  modelSnapshot(): DshModelSnapshot {
    const model = this.options.model()
    return {
      provider: model.provider,
      providerDisplayName: model.providerDisplayName,
      model: model.model,
      configured:
        model.credentialConfigured && model.apiKey.length > 0 && model.model.trim().length > 0,
      lastError: model.lastError,
    }
  }

  async checkAvailability(): Promise<boolean> {
    const resources = this.options.resources()
    try {
      await Promise.all([
        access(resources.command),
        access(resources.runtimeScript),
        access(join(resources.profileDirectory, 'cordis.yml')),
      ])
      return true
    } catch {
      return false
    }
  }

  async checkBrowserAvailability(): Promise<{
    packagedBinaryAvailable: boolean
    executableAvailable: boolean
  }> {
    const browser = this.options.resources().browser
    if (!browser) {
      return { packagedBinaryAvailable: false, executableAvailable: false }
    }
    const [packagedBinaryAvailable, executableAvailable] = await Promise.all([
      access(browser.command).then(
        () => true,
        () => false,
      ),
      browser.executablePath
        ? access(browser.executablePath).then(
            () => true,
            () => false,
          )
        : Promise.resolve(false),
    ])
    return { packagedBinaryAvailable, executableAvailable }
  }

  async checkShellAvailability(): Promise<{ executableAvailable: boolean }> {
    const shell = this.options.resources().shell
    if (!shell) return { executableAvailable: false }
    return {
      executableAvailable: await access(shell.command).then(
        () => true,
        () => false,
      ),
    }
  }

  start(capability: DshWorkflowCapability = 'browser'): Promise<void> {
    const model = this.options.model()
    const modelSignature = this.modelSignature(model, capability)
    if (this.harness && ['ready', 'running'].includes(this.state)) {
      if (modelSignature === this.activeModelSignature) return Promise.resolve()
      return this.close().then(() => this.start(capability))
    }
    this.startTask ??= this.performStart(model, modelSignature, capability).finally(() => {
      this.startTask = null
    })
    return this.startTask
  }

  private async performStart(
    model: DshModelConfiguration,
    modelSignature: string,
    capability: DshWorkflowCapability,
  ): Promise<void> {
    if (this.closeTask) await this.closeTask
    if (!model.credentialConfigured || !model.apiKey || !model.model.trim()) {
      this.fail('DSH_MODEL_NOT_CONFIGURED')
      throw new DshAdapterError(
        'DSH_MODEL_NOT_CONFIGURED',
        publicMessage('DSH_MODEL_NOT_CONFIGURED'),
      )
    }
    const resources = this.options.resources()
    if (!(await this.checkAvailability())) {
      this.fail('DSH_RUNTIME_UNAVAILABLE')
      throw new DshAdapterError('DSH_RUNTIME_UNAVAILABLE', publicMessage('DSH_RUNTIME_UNAVAILABLE'))
    }
    await Promise.all([
      mkdir(resources.workspaceDirectory, { recursive: true }),
      mkdir(resources.sessionDirectory, { recursive: true }),
      mkdir(resources.homeDirectory, { recursive: true }),
      ...(resources.browser
        ? [
            mkdir(resources.browser.profileDirectory, { recursive: true }),
            mkdir(resources.browser.socketDirectory, { recursive: true }),
          ]
        : []),
    ])
    this.setState('starting')
    const hostEnvironment = this.options.environment ?? process.env
    const environment = buildDshChildEnvironment(hostEnvironment, resources, model, capability)
    const createHarness = this.options.createHarness ?? defaultCreateHarness
    let harness: HarnessRuntime | null = null
    try {
      if (
        capability === 'browser' &&
        resources.browser &&
        (await this.browserResourcesAvailable(resources.browser))
      ) {
        await this.prewarmBrowser(resources.browser, hostEnvironment)
      }
      harness = await createHarness({
        resources,
        model,
        environment,
        requestTimeoutMs: this.options.requestTimeoutMs ?? 15_000,
      })
      this.harness = harness
      await harness.start()
      this.startedAt = Date.now()
      this.activeModelSignature = modelSignature
      this.lastError = undefined
      this.setState('ready')
      mainLog.info('[DesktopControl] DSH runtime started', {
        version: DSH_RUNTIME_VERSION,
        provider: model.provider,
        model: model.model,
        capability,
      })
    } catch (error) {
      if (harness) await Promise.allSettled([harness.close()])
      if (this.harness === harness) this.harness = null
      const normalized = await this.normalizeError(error, 'DSH_STARTUP_FAILED')
      this.fail(normalized.code)
      throw normalized
    }
  }

  async execute(
    goal: string,
    signal: AbortSignal,
    capability: DshWorkflowCapability,
    shellCommand?: string,
  ): Promise<DesktopWorkflowAdapterResult> {
    if (this.running) {
      throw new DshAdapterError('DSH_REMOTE_ERROR', 'Desktop Control is already running a task')
    }
    await this.start(capability)
    const harness = this.harness
    if (!harness)
      throw new DshAdapterError('DSH_TRANSPORT_CLOSED', publicMessage('DSH_TRANSPORT_CLOSED'))
    if (signal.aborted) {
      await this.close()
      throw new DshAdapterError('DSH_CANCELLED', publicMessage('DSH_CANCELLED'))
    }
    this.running = true
    this.setState('running')
    let notificationCount = 0
    const notificationTypes = new Set<string>()
    const browserToolTrace: BrowserToolTrace = {
      calls: new Map(),
      successfulResults: new Set(),
    }
    let browserBudgetExceeded = false
    const abort = (): void => {
      void this.close().catch((error) => {
        mainLog.warn('[DesktopControl] runtime close after cancellation failed', { error })
      })
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      if (capability === 'shell') {
        if (!shellCommand?.trim() || !harness.executeShell) {
          throw new DshAdapterError('DSH_PROTOCOL_ERROR', publicMessage('DSH_PROTOCOL_ERROR'))
        }
        const shellStartedAt = Date.now()
        const parsedResult = shellExecutionResultSchema.safeParse(
          await harness.executeShell(shellCommand.trim(), SHELL_REQUEST_TIMEOUT_MS),
        )
        if (!parsedResult.success) {
          throw new DshAdapterError('DSH_PROTOCOL_ERROR', publicMessage('DSH_PROTOCOL_ERROR'))
        }
        const result = parsedResult.data
        const evidence = shellExecutionEvidence(result, Date.now() - shellStartedAt)
        if (result.timedOut) {
          throw new DshAdapterError(
            'DSH_REQUEST_TIMEOUT',
            publicMessage('DSH_REQUEST_TIMEOUT'),
            true,
            evidence,
          )
        }
        if (result.aborted || signal.aborted) {
          throw new DshAdapterError('DSH_CANCELLED', publicMessage('DSH_CANCELLED'), true, evidence)
        }
        mainLog.info('[DesktopControl] DSH PowerShell command completed', {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdoutCharacters: result.stdout.text.length,
          stdoutTruncated: result.stdout.truncated,
          stderrCharacters: result.stderr.text.length,
          stderrTruncated: result.stderr.truncated,
        })
        if (result.exitCode !== 0) {
          throw new DshAdapterError(
            'DSH_REMOTE_ERROR',
            `PowerShell command failed with exit code ${result.exitCode ?? 'unknown'}`,
            true,
            evidence,
          )
        }
        return {
          runtimeCompleted: true,
          reportedOutcome: renderShellOutcome(result),
          presentationFacts: runtimeVersionPresentationFacts(shellCommand, evidence),
          evidence,
        }
      }
      const result = await harness.run(goal, {
        onNotification: (notification) => {
          observeBrowserToolNotification(notification, browserToolTrace)
          const observationCalls = [...browserToolTrace.calls.values()].filter((name) =>
            /__(?:agent_browser_snapshot|agent_browser_get_(?:text|url|title))$/u.test(name),
          ).length
          if (
            !browserBudgetExceeded &&
            (browserToolTrace.calls.size > DSH_BROWSER_TOOL_CALL_MAX ||
              observationCalls > DSH_BROWSER_OBSERVATION_MAX)
          ) {
            browserBudgetExceeded = true
            void harness.close().catch((error) => {
              mainLog.warn('[DesktopControl] DSH close after browser budget failed', { error })
            })
          }
          notificationCount += 1
          if (!notification || typeof notification !== 'object') return
          const envelope = notification as {
            method?: unknown
            params?: { event?: { type?: unknown } }
          }
          const method = typeof envelope.method === 'string' ? envelope.method : 'unknown'
          const eventType = envelope.params?.event?.type
          notificationTypes.add(typeof eventType === 'string' ? `${method}:${eventType}` : method)
        },
      })
      if (browserBudgetExceeded) {
        throw new DshAdapterError('DSH_ACTION_LIMIT', publicMessage('DSH_ACTION_LIMIT'))
      }
      if (browserToolTrace.successfulResults.size === 0) {
        mainLog.warn('[DesktopControl] DSH browser workflow produced no successful browser tool', {
          notificationCount,
          browserToolCalls: browserToolTrace.calls.size,
        })
      }
      mainLog.info('[DesktopControl] DSH task completed', {
        notificationCount,
        runtimeCompleted: true,
        capability,
        notificationTypes: [...notificationTypes].slice(0, 20),
        browserToolCalls: browserToolTrace.calls.size,
        successfulBrowserToolResults: browserToolTrace.successfulResults.size,
      })
      return {
        runtimeCompleted: true,
        reportedOutcome:
          result.finalResponse.slice(0, DESKTOP_WORKFLOW_REPORTED_OUTCOME_MAX_CHARS) || undefined,
        evidence: {
          kind: 'browser',
          operation: 'workflow',
          browserToolCalls: browserToolTrace.calls.size,
          successfulBrowserToolResults: browserToolTrace.successfulResults.size,
        },
      }
    } catch (error) {
      if (browserBudgetExceeded) {
        throw new DshAdapterError('DSH_ACTION_LIMIT', publicMessage('DSH_ACTION_LIMIT'))
      }
      if (signal.aborted) {
        throw new DshAdapterError('DSH_CANCELLED', publicMessage('DSH_CANCELLED'))
      }
      const normalized = await this.normalizeError(error, 'DSH_REMOTE_ERROR')
      if (normalized.code === 'DSH_TRANSPORT_CLOSED' || normalized.code === 'DSH_PROTOCOL_ERROR') {
        await this.close()
      }
      if (capability !== 'browser' || normalized.evidence) throw normalized
      throw new DshAdapterError(normalized.code, normalized.message, normalized.recoverable, {
        kind: 'browser',
        operation: 'workflow',
        browserToolCalls: browserToolTrace.calls.size,
        successfulBrowserToolResults: browserToolTrace.successfulResults.size,
      })
    } finally {
      signal.removeEventListener('abort', abort)
      this.running = false
      if (this.harness === harness && this.state === 'running') this.setState('ready')
    }
  }

  close(): Promise<void> {
    this.closeTask ??= this.performClose().finally(() => {
      this.closeTask = null
    })
    return this.closeTask
  }

  private async performClose(): Promise<void> {
    if (this.startTask) await this.startTask.catch(() => undefined)
    const harness = this.harness
    this.harness = null
    this.activeModelSignature = ''
    if (!harness) {
      this.startedAt = undefined
      this.setState('stopped')
      return
    }
    this.setState('stopping')
    try {
      await harness.close()
      mainLog.info('[DesktopControl] DSH runtime stopped')
    } catch (error) {
      mainLog.warn('[DesktopControl] DSH runtime shutdown failed', { error })
    } finally {
      this.startedAt = undefined
      this.running = false
      this.setState('stopped')
    }
  }

  private async browserResourcesAvailable(browser: AgentBrowserRuntimeResources): Promise<boolean> {
    if (!browser.executablePath) return false
    const results = await Promise.allSettled([
      access(browser.command),
      access(browser.executablePath),
    ])
    return results.every((result) => result.status === 'fulfilled')
  }

  private async prewarmBrowser(
    browser: AgentBrowserRuntimeResources,
    hostEnvironment: NodeJS.ProcessEnv,
  ): Promise<void> {
    await runAgentBrowserCommand(
      browser,
      hostEnvironment,
      [
        '--json',
        '--session',
        browser.namespace,
        '--idle-timeout',
        AGENT_BROWSER_SESSION_IDLE_TIMEOUT_ARGUMENT,
        'get',
        'url',
      ],
      15_000,
    )
  }

  private async normalizeError(
    error: unknown,
    fallback: DshAdapterError['code'],
  ): Promise<DshAdapterError> {
    if (error instanceof DshAdapterError) return error
    const sdk = await import('@deepseek-ai/dsh-sdk-client')
    const code: DshAdapterError['code'] =
      error instanceof sdk.RequestTimeoutError
        ? 'DSH_REQUEST_TIMEOUT'
        : error instanceof sdk.SdkProtocolError
          ? 'DSH_PROTOCOL_ERROR'
          : error instanceof sdk.TransportClosedError
            ? 'DSH_TRANSPORT_CLOSED'
            : error instanceof sdk.JsonRpcResponseError
              ? 'DSH_REMOTE_ERROR'
              : fallback
    mainLog.warn('[DesktopControl] DSH operation failed', {
      code,
      technicalError: error instanceof Error ? error.message.slice(0, 1_000) : String(error),
    })
    return new DshAdapterError(code, publicMessage(code))
  }

  private fail(code: DshAdapterError['code']): void {
    this.lastError = publicMessage(code)
    this.setState('error')
  }

  private modelSignature(model: DshModelConfiguration, capability: DshWorkflowCapability): string {
    return createHash('sha256')
      .update(`${model.provider}\0${model.model}\0${model.baseURL}\0${model.apiKey}\0${capability}`)
      .digest('hex')
  }

  private setState(state: DesktopControlRuntimeState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}
