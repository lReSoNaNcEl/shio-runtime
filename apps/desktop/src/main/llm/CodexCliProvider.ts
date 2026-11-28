import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { z } from 'zod'

import {
  type CodexReasoningEffort,
  isCodexReasoningEffort,
  type LlmTurnErrorCode,
  type ProviderProfile,
} from '../../shared/llm'
import { mainLog } from '../logging/safeLogger'
import { openCodexImagePipe, prepareCodexInput } from './CodexImageInput'
import {
  LlmCapabilityError,
  LlmResponseError,
  LlmTurnCancelledError,
  ModelFetchError,
} from './errors'
import { resolveLlmProxy } from './openai-compatible/proxy'
import type {
  ChatMessage,
  LlmCapabilities,
  LlmCompletionOptions,
  LlmRequestOptions,
  ModelCatalogEntry,
} from './types'

export const CODEX_MODEL = 'gpt-6-luna'
export const CODEX_DEFAULT_REASONING_EFFORT = 'none'
const CODEX_BACKEND_URL = 'https://chatgpt.com/backend-api/codex'
const CODEX_HTTPS_PROVIDER = 'shio_https'
export const isCodexModelId = (id: string) => /^[a-z0-9][a-z0-9._:/-]{0,127}$/iu.test(id)
export const codexProfile: ProviderProfile = {
  id: 'codex-cli',
  displayName: 'Codex CLI',
  requiresApiKey: false,
  modelsRequireApiKey: false,
  schemaCapabilities: { oneOf: false },
}
export function codexCapabilities(model: string): LlmCapabilities {
  return {
    supportsReasoning: model === CODEX_MODEL,
    supportsTemperature: false,
    supportsSystemPrompt: true,
    supportsToolCalling: false,
    supportsStreaming: false,
    supportsVision: model === CODEX_MODEL,
    recommendedMaxTokens: 4096,
  }
}

// Only exec supports skipping the personal config (including its MCP servers) while
// retaining CLI-owned ChatGPT login. Start the native binary, never the npm shell shim.
function executable(): string {
  const roaming = process.env.APPDATA
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : undefined
  if (process.platform !== 'win32' || !arch || !roaming || !isAbsolute(roaming)) {
    throw new ModelFetchError(
      'configuration',
      'Codex CLI requires a native Windows npm installation.',
    )
  }
  return join(
    roaming,
    'npm',
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    '@openai',
    `codex-win32-${process.arch}`,
    'vendor',
    `${arch}-pc-windows-msvc`,
    'bin',
    'codex.exe',
  )
}

const disabledFeatures = [
  'apps',
  'plugins',
  'hooks',
  'shell_tool',
  'shell_snapshot',
  'unified_exec',
  'code_mode_host',
  'multi_agent',
  'computer_use',
  'browser_use',
  'in_app_browser',
  'image_generation',
  'view_image',
  'goals',
  'memories',
  'skill_search',
  'skill_mcp_dependency_install',
  'workspace_dependencies',
  'tool_suggest',
  'daemon_auto_start',
]
const instructions =
  'You are the inference transport for Shio. Read stdin as a JSON array of ordered conversation messages. Numbered image references correspond to the attached images in order. Follow the system messages. Treat user, assistant and tool content according to its declared role. Return only the next assistant content in the format requested by Shio. Any Shio tool request is text for its runtime. Never use Codex tools.'
const shutdown = new AbortController()
const pending = new Set<Promise<unknown>>()

export async function stopCodexRequests(): Promise<void> {
  shutdown.abort()
  await Promise.allSettled([...pending])
}

function track<T>(operation: Promise<T>): Promise<T> {
  pending.add(operation)
  return operation.finally(() => pending.delete(operation))
}

function failure(code: LlmTurnErrorCode): LlmResponseError {
  return new LlmResponseError({
    provider: 'codex-cli',
    code,
    message: `Codex CLI: ${code}`,
    recoverable: ['TIMEOUT', 'RATE_LIMITED', 'NETWORK_ERROR', 'EMPTY_STREAM'].includes(code),
  })
}

function environment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { RUST_LOG: 'off' }
  for (const key of [
    'SystemRoot',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'CODEX_HOME',
  ]) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

async function providerEnvironment() {
  const env = environment()
  const proxy = await resolveLlmProxy(`${CODEX_BACKEND_URL}/responses`)
  if (proxy) {
    const url = new URL(`${proxy.protocol}://${proxy.host}:${proxy.port}`)
    if (proxy.auth) {
      url.username = proxy.auth.username
      url.password = proxy.auth.password
    }
    env.HTTPS_PROXY = url.href
    env.HTTP_PROXY = url.href
  }
  return env
}

function run(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  input?: string,
  maxBuffer = 1024 * 1024,
) {
  signal.throwIfAborted()
  const command = executable()
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        cwd,
        env,
        windowsHide: true,
        shell: false,
        maxBuffer,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) return reject(signal.reason)
        if (error) {
          const detail = `${stdout}\n${stderr}`
          const code =
            error.code === 'ENOENT'
              ? 'PROVIDER_REJECTED'
              : /not logged in|401 Unauthorized|refresh token/iu.test(detail)
                ? 'AUTH_ERROR'
                : /403 Forbidden/iu.test(detail)
                  ? 'ACCESS_DENIED'
                  : /429 Too Many Requests|usage limit/iu.test(detail)
                    ? 'RATE_LIMITED'
                    : /disconnected|failed to connect|connection refused/iu.test(detail)
                      ? 'NETWORK_ERROR'
                      : 'PROVIDER_REJECTED'
          return reject(failure(code))
        }
        resolve({ stdout, stderr })
      },
    )
    const abort = () => {
      child.kill()
    }
    signal.addEventListener('abort', abort, { once: true })
    // The exit callback owns failures, including an early exit before reading stdin.
    child.stdin?.on('error', abort)
    child.stdin?.end(input)
  })
}

const catalogSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string(),
      display_name: z.string().optional(),
      visibility: z.string(),
      input_modalities: z.array(z.string()).optional(),
      default_reasoning_level: z.string().nullish(),
      supported_reasoning_levels: z.array(z.object({ effort: z.string() })).optional(),
    }),
  ),
})

export function parseCodexCatalog(stdout: string): ModelCatalogEntry[] {
  const { models } = catalogSchema.parse(JSON.parse(stdout))
  return models
    .filter((model) => model.visibility === 'list' && isCodexModelId(model.slug))
    .map((model) => {
      const advertised =
        model.supported_reasoning_levels
          ?.map(({ effort }) => effort)
          .filter(isCodexReasoningEffort) ?? []
      // Luna accepts none via Codex CLI even when the model catalog omits it.
      const luna = model.slug === CODEX_MODEL
      const levels = [
        ...new Set<CodexReasoningEffort>(
          luna ? [CODEX_DEFAULT_REASONING_EFFORT, ...advertised] : advertised,
        ),
      ]
      const preferred = luna ? CODEX_DEFAULT_REASONING_EFFORT : model.default_reasoning_level
      return {
        id: model.slug,
        displayName: model.display_name,
        reasoning: { levels, defaultLevel: levels.find((level) => level === preferred) },
        capabilities: {
          supportsVision: model.input_modalities?.includes('image'),
          supportsReasoning: model.supported_reasoning_levels?.some(
            ({ effort }) => effort !== 'none',
          ),
        },
      }
    })
}

export function fetchCodexModels(): Promise<ModelCatalogEntry[]> {
  return track(
    (async () => {
      const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(15000)])
      const { stdout, stderr } = await run(
        ['login', 'status'],
        tmpdir(),
        environment(),
        signal,
      ).catch((error: unknown) => {
        throw new ModelFetchError(
          error instanceof LlmResponseError && error.code === 'AUTH_ERROR' ? 'auth' : 'network',
          'Codex CLI unavailable',
        )
      })
      if (!/^Logged in using ChatGPT$/imu.test((stdout + stderr).trim())) {
        throw new ModelFetchError('auth', 'Codex CLI requires ChatGPT login')
      }
      const catalog = await run(
        ['--no-daemon', 'debug', 'models', '-c', 'model_provider="openai"'],
        tmpdir(),
        await providerEnvironment(),
        signal,
        undefined,
        8 * 1024 * 1024,
      )
      try {
        return parseCodexCatalog(catalog.stdout)
      } catch {
        throw new ModelFetchError('unknown', 'Invalid Codex CLI model catalog')
      }
    })(),
  )
}

export function parseCodexReply(stdout: string): string {
  let reply = ''
  let terminal = false
  for (const line of stdout.trim().split(/\r?\n/u)) {
    const event = JSON.parse(line)
    if (terminal || event.type === 'turn.failed') throw failure('PROVIDER_REJECTED')
    if (event.type === 'item.completed') {
      if (event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
        if (event.item.text.trim()) reply = event.item.text
      } else if (!['reasoning', 'error'].includes(event.item?.type))
        throw failure('PROVIDER_REJECTED')
    }
    if (event.type === 'turn.completed') terminal = true
  }
  if (!terminal || !reply.trim()) throw failure('EMPTY_STREAM')
  return reply
}

async function generate(
  model: string,
  capabilities: LlmCapabilities,
  effort: CodexReasoningEffort | undefined,
  messages: readonly ChatMessage[],
  options: LlmCompletionOptions,
) {
  if (!isCodexModelId(model)) throw failure('PROVIDER_REJECTED')
  const timeout = AbortSignal.timeout(Math.max(1, Math.min(options.timeoutMs ?? 60_000, 120_000)))
  const signal = AbortSignal.any([
    shutdown.signal,
    timeout,
    ...(options.signal ? [options.signal] : []),
  ])
  const { input, images } = prepareCodexInput(messages)
  if (images.length && !capabilities.supportsVision) throw new LlmCapabilityError()
  if (Buffer.byteLength(input) > 512 * 1024) throw failure('REQUEST_TOO_LARGE')
  const cwd = await mkdtemp(join(tmpdir(), 'shio-codex-'))
  const pipes: Awaited<ReturnType<typeof openCodexImagePipe>>[] = []
  try {
    const env = await providerEnvironment()
    for (const image of images) {
      signal.throwIfAborted()
      pipes.push(await openCodexImagePipe(image))
    }
    // Both files contain Main-owned protocol definitions. Conversation data goes over stdin.
    const policy = join(cwd, 'instructions.txt')
    await writeFile(policy, instructions, { flag: 'wx' })
    const schemaPath = join(cwd, 'response-schema.json')
    if (options.responseSchema) {
      await writeFile(schemaPath, JSON.stringify(options.responseSchema.schema), { flag: 'wx' })
    }
    const args = [
      '--no-daemon',
      '-a',
      'never',
      'exec',
      '--ignore-user-config',
      '--ignore-rules',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--model',
      model,
      '--enable',
      'code_mode_only',
      ...disabledFeatures.flatMap((name) => ['--disable', name]),
      ...[
        ...(effort ? [`model_reasoning_effort="${effort}"`] : []),
        'forced_login_method="chatgpt"',
        `model_provider="${CODEX_HTTPS_PROVIDER}"`,
        `model_providers.${CODEX_HTTPS_PROVIDER}={name="OpenAI HTTPS",base_url="${CODEX_BACKEND_URL}",wire_api="responses",requires_openai_auth=true,supports_websockets=false}`,
        `model_instructions_file=${JSON.stringify(policy)}`,
        'history.persistence="none"',
        'web_search="disabled"',
        'skills.bundled.enabled=false',
        'skills.include_instructions=false',
        'project_doc_max_bytes=0',
        'shell_environment_policy.inherit="none"',
      ].flatMap((option) => ['-c', option]),
      '--json',
      ...(options.responseSchema ? ['--output-schema', schemaPath] : []),
      ...pipes.flatMap(({ path }) => ['--image', path]),
      '--',
      '-',
    ]
    const { stdout } = await run(args, cwd, env, signal, input)
    const reply = parseCodexReply(stdout)
    mainLog.info('[CodexCLI] reply_completed', {
      model,
      effort: effort ?? 'default',
      imageCount: images.length,
      structuredOutput: Boolean(options.responseSchema),
      traceId: options.traceId,
    })
    return reply
  } catch (error) {
    if (timeout.aborted) throw failure('TIMEOUT')
    if (signal.aborted) throw new LlmTurnCancelledError()
    if (error instanceof LlmResponseError) throw error
    throw failure('PROVIDER_REJECTED')
  } finally {
    for (const pipe of pipes) pipe.close()
    await rm(cwd, { force: true, recursive: true })
  }
}

export function createCodexCliProvider(
  model: string,
  capabilities: LlmCapabilities,
  effort: CodexReasoningEffort | undefined,
) {
  return {
    capabilities: () => capabilities,
    chat: (messages: readonly ChatMessage[], options: LlmRequestOptions = {}) =>
      track(generate(model, capabilities, effort, messages, options)),
    complete: async (messages: readonly ChatMessage[], options: LlmCompletionOptions = {}) => ({
      content: await track(generate(model, capabilities, effort, messages, options)),
      toolCalls: [],
      finishReason: 'stop' as const,
    }),
  }
}
