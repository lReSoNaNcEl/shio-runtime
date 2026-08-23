// Provider-neutral variant of the DeepSeek Harness SDK JSON-RPC server.
// The upstream MIT implementation mounts a vendor-specific model fallback.
// Shio always composes its model Adapter explicitly, so this local entry point
// keeps the wire contract without importing that fallback.

import { resolve } from 'node:path'

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'

function successStatus(reason, maxTokensAsSuccess) {
  if (reason === 'completed') return 'ok'
  return reason === 'max-tokens' && maxTokensAsSuccess ? 'ok' : 'error'
}

const SHELL_OUTPUT_MAX_BYTES = 64_000
const SHELL_TIMEOUT_DEFAULT_MS = 60_000
const SHELL_TIMEOUT_MAX_MS = 120_000

function validateShellExecuteParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new TypeError('shell.execute params must be an object')
  }
  const keys = Object.keys(params)
  if (keys.some((key) => key !== 'command' && key !== 'timeoutMs')) {
    throw new TypeError('shell.execute params contain an unknown property')
  }
  if (typeof params.command !== 'string') {
    throw new TypeError('shell.execute command must be a string')
  }
  const command = params.command.trim()
  if (command.length === 0 || command.length > 2_000) {
    throw new TypeError('shell.execute command must contain between 1 and 2000 characters')
  }
  const timeoutMs = params.timeoutMs ?? SHELL_TIMEOUT_DEFAULT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > SHELL_TIMEOUT_MAX_MS) {
    throw new TypeError('shell.execute timeoutMs must be a positive safe integer up to 120000')
  }
  return { command, timeoutMs }
}

class ShioSdkJsonRpcServer {
  constructor(ctx, transport, options) {
    this.ctx = ctx
    this.transport = transport
    this.options = options
    this.cwd = process.cwd()
    this.provider = ''
    this.model = ''
    this.maxTokens = undefined
    this.sessions = new Map()
    this.sessionCreations = new Map()
    this.disposers = []
    this.shutdownTask = undefined
    this.shuttingDown = false

    this.disposers.push(
      ctx.on('session/event', (session, event) => {
        transport.notify('session.event', { sessionId: String(session.id), event })
      }),
      ctx.on('agent/status', ({ agent, status }) => {
        transport.notify('session.status', { sessionId: String(agent.session.id), status })
      }),
      ctx.on('session/created', (session) => {
        const parentSession = session.header.parentSession
        if (parentSession === undefined) return
        transport.notify('subagent.started', {
          parentSessionId: String(parentSession),
          childSessionId: String(session.id),
        })
      }),
      ctx.on('subagent/end', function onSubagentEnd(info) {
        if (!info.local) return
        const parent = carrierKeyOf(this)
        transport.notify('subagent.finished', {
          provider: info.provider,
          agentId: String(info.id),
          parentSessionId: String(parent.session.id),
          childSessionId: String(info.id),
          status: successStatus(info.stopReason, options.maxTokensAsSuccess),
          stopReason: info.stopReason,
          ...(info.lastAssistantMessage === undefined
            ? {}
            : { lastAssistantMessage: info.lastAssistantMessage }),
        })
      }),
    )
  }

  async initialize(params) {
    if (
      params.maxTokens !== undefined &&
      (!Number.isSafeInteger(params.maxTokens) || params.maxTokens <= 0)
    ) {
      throw new TypeError('initialize maxTokens must be a positive safe integer')
    }
    this.cwd = resolve(params.cwd)
    this.provider = params.provider
    this.model = params.model
    this.maxTokens = params.maxTokens
    if (
      !this.ctx
        .get('llm')
        ?.listProviders()
        .some((entry) => entry.id === this.provider)
    ) {
      throw new Error(`no adapter registered for provider "${this.provider}"`)
    }
    return {
      serverInfo: {
        name: 'deepseek-harness-sdk-runtime',
        version: '0.0.1',
      },
    }
  }

  async prompt(params) {
    const record = await this.getOrCreateSession(params.sessionId)
    if (this.ctx.agents.get(record.handle.agent.id) !== record.handle.agent) {
      throw new Error(`session agent was disposed outside the server: ${params.sessionId}`)
    }
    const message = createUserMessage({
      content: params.contentBlocks,
      source: { kind: 'user' },
    })
    record.handle.agent.followup(message)
    return { messageId: message.id }
  }

  async shellExecute(params) {
    if (process.env.SHIO_DSH_ALLOWED_CAPABILITY !== 'shell') {
      throw new Error('PowerShell execution is not enabled for this runtime')
    }
    const request = validateShellExecuteParams(params)
    const spec = this.ctx.shell.resolve({
      command: request.command,
      workdir: this.cwd,
      timeoutMs: request.timeoutMs,
      stdoutMaxBytes: SHELL_OUTPUT_MAX_BYTES,
    })
    const result = await this.ctx.shell.run(spec)
    return {
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      aborted: result.aborted,
      timeoutMs: result.timeoutMs,
      stdout: {
        text: result.stdout.text.slice(-SHELL_OUTPUT_MAX_BYTES),
        truncated: result.stdout.truncated,
      },
      stderr: {
        text: result.stderr.text.slice(-SHELL_OUTPUT_MAX_BYTES),
        truncated: result.stderr.truncated,
      },
    }
  }

  shutdown() {
    this.shutdownTask ??= this.performShutdown()
    return this.shutdownTask
  }

  async performShutdown() {
    this.shuttingDown = true
    await Promise.allSettled([...this.sessionCreations.values()])
    this.sessionCreations.clear()
    const records = [...this.sessions.values()]
    this.sessions.clear()
    const failures = []
    while (this.disposers.length > 0) {
      try {
        this.disposers.pop()?.()
      } catch (error) {
        failures.push(error)
      }
    }
    const teardown = await Promise.allSettled(
      records.map((record) => Promise.resolve().then(() => record.handle.dispose())),
    )
    failures.push(
      ...teardown.filter((result) => result.status === 'rejected').map((result) => result.reason),
    )
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'SDK server teardown failed')
    return {}
  }

  async handleRequest(method, params) {
    switch (method) {
      case 'initialize':
        return this.initialize(params)
      case 'session/prompt':
        return this.prompt(params)
      case 'shio/shell.execute':
        return this.shellExecute(params)
      case 'shutdown':
        return this.shutdown()
      default:
        throw new Error(`unknown DeepSeek Harness SDK runtime method: ${method}`)
    }
  }

  async getOrCreateSession(sessionId) {
    if (this.shuttingDown) throw new Error('SDK server is shutting down')
    const existing = this.sessions.get(sessionId)
    if (existing) return existing
    const pending = this.sessionCreations.get(sessionId)
    if (pending) return pending
    const creation = this.createSession(sessionId)
    this.sessionCreations.set(sessionId, creation)
    creation.finally(() => this.sessionCreations.delete(sessionId)).catch(() => undefined)
    return creation
  }

  async createSession(sessionId) {
    const record = {
      handle: await this.ctx.agents.create({
        sessionId: SessionId(sessionId),
        meta: { cwd: this.cwd },
        agentOptions: {
          provider: this.provider,
          model: this.model,
          ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
        },
      }),
    }
    this.sessions.set(sessionId, record)
    return record
  }
}

function ShioSdkJsonRpcPlugin(ctx, config = {}) {
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout)
  const server = new ShioSdkJsonRpcServer(ctx, transport, {
    maxTokensAsSuccess: config.maxTokensAsSuccess === true,
  })
  const rootFiber = ctx.root.fiber
  let exitTask
  const disposeAndExit = () => {
    exitTask ??= (async () => {
      await Promise.allSettled([transport.flush()])
      await Promise.allSettled([rootFiber.dispose()])
      process.exit(0)
    })()
    return exitTask
  }

  transport.onRequest(async (method, params) => {
    if (method === 'initialize') await ctx.get('loader')?.await()
    const result = await server.handleRequest(method, params)
    if (method === 'shutdown') setImmediate(() => void disposeAndExit())
    return result
  })
  ctx.effect(() => {
    transport.start()
    return async () => {
      await server.shutdown()
      transport.close()
    }
  }, 'jsonrpc.serve')
}

ShioSdkJsonRpcPlugin.inject =
  process.env.SHIO_DSH_ALLOWED_CAPABILITY === 'shell' ? ['agents', 'shell'] : ['agents']

export default ShioSdkJsonRpcPlugin
