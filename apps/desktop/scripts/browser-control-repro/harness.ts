import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import BrowserToolPolicy from '../../resources/desktop-control/browser-policy.mjs'
import {
  resolveAgentBrowserCommand,
  resolveChromeExecutable,
} from '../../src/main/desktop-control/AgentBrowserResources'

interface McpTextBlock {
  type: 'text'
  text: string
}

interface BrowserBridge {
  root: Context
  call(name: string, args: Record<string, unknown>): Promise<string>
  callExpectingFailure(name: string, args: Record<string, unknown>): Promise<string>
  shutdown(): Promise<void>
}

const execFileAsync = promisify(execFile)

function agentBrowserEnvironment(options: {
  executablePath: string
  profileDirectory: string
  socketDirectory: string
  namespace: string
}): NodeJS.ProcessEnv {
  return {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    AGENT_BROWSER_PROFILE: options.profileDirectory,
    AGENT_BROWSER_SOCKET_DIR: options.socketDirectory,
    AGENT_BROWSER_EXECUTABLE_PATH: options.executablePath,
    AGENT_BROWSER_NAMESPACE: options.namespace,
    AGENT_BROWSER_SESSION: options.namespace,
    AGENT_BROWSER_CONTENT_BOUNDARIES: '1',
    AGENT_BROWSER_MAX_OUTPUT: '20000',
    AGENT_BROWSER_IDLE_TIMEOUT_MS: '60000',
  }
}

async function prewarmAgentBrowser(
  command: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  namespace: string,
): Promise<void> {
  await new Promise<void>((resolveReady, reject) => {
    const child = spawn(
      command,
      ['--json', '--session', namespace, '--idle-timeout', '60s', 'get', 'url'],
      {
        cwd,
        env: environment,
        stdio: 'ignore',
        windowsHide: true,
      },
    )
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('agent-browser daemon prewarm timed out'))
    }, 15_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolveReady()
      else reject(new Error(`agent-browser daemon prewarm failed with exit code ${code}`))
    })
  })
}

async function stopAgentBrowser(
  command: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await execFileAsync(command, ['--idle-timeout', '1s', 'close', '--all'], {
    cwd,
    env: environment,
    timeout: 3_000,
    windowsHide: true,
  }).catch(() => undefined)
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_250))
}

async function processesUsingPath(path: string): Promise<unknown[]> {
  assert(process.env.SystemRoot, 'SystemRoot is required for the Windows process check')
  const powershell = join(
    process.env.SystemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const script =
    "$needle = $env:SHIO_PROCESS_NEEDLE; @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like ('*' + $needle + '*') } | Select-Object ProcessId,Name,CommandLine) | ConvertTo-Json -Compress"
  const { stdout } = await execFileAsync(
    powershell,
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        SHIO_PROCESS_NEEDLE: path,
      },
      timeout: 5_000,
      windowsHide: true,
    },
  )
  const trimmed = stdout.trim()
  if (!trimmed) return []
  const parsed = JSON.parse(trimmed) as unknown
  return Array.isArray(parsed) ? parsed : [parsed]
}

function contentText(content: unknown): string {
  assert(Array.isArray(content))
  return content
    .filter((block): block is McpTextBlock =>
      Boolean(
        block &&
          typeof block === 'object' &&
          (block as { type?: unknown }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string',
      ),
    )
    .map((block) => block.text)
    .join('\n')
}

async function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (request.url === '/long') {
      response.end(`<!doctype html><title>Long output</title><p>${'x'.repeat(25_000)}</p>`)
      return
    }
    if (request.url === '/second') {
      response.end('<!doctype html><title>Second tab</title><h1>Second tab verified</h1>')
      return
    }
    response.end(`<!doctype html>
      <title>Shio browser control test</title>
      <main>
        <h1>Browser Control Test</h1>
        <label for="message">Message</label>
        <input id="message" aria-label="Message" />
        <button id="apply" type="button">Apply message</button>
        <p id="result">Waiting for input</p>
      </main>
      <script>
        document.querySelector('#apply').addEventListener('click', () => {
          document.querySelector('#result').textContent = document.querySelector('#message').value
        })
      </script>`)
  })
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveReady)
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()))
  })
}

async function createBrowserBridge(options: {
  command: string
  cwd: string
  executablePath: string
  profileDirectory: string
  socketDirectory: string
  namespace: string
  toolCallTimeoutMs?: number
}): Promise<BrowserBridge> {
  const environment = agentBrowserEnvironment(options)
  try {
    await prewarmAgentBrowser(options.command, options.cwd, environment, options.namespace)
  } catch (error) {
    await stopAgentBrowser(options.command, options.cwd, environment)
    throw error
  }
  const root = new Context()
  try {
    await root
      .plugin(SystemPrompt, {
        persona: 'Browser-control repro',
        includeRuntimeContext: false,
      })
      .await()
    await root.plugin(ToolRuntime, { mode: 'native' }).await()
    await root
      .plugin(BrowserToolPolicy, {
        serverName: options.namespace,
        maxOutputChars: 20_000,
      })
      .await()
    await root
      .plugin(McpClient, {
        serverName: options.namespace,
        transport: 'stdio',
        command: options.command,
        args: ['mcp', '--tools', 'core'],
        cwd: options.cwd,
        env: environment,
        toolCallTimeoutMs: options.toolCallTimeoutMs ?? 60_000,
        failOnStartupError: true,
        reconnect: { enabled: false },
      })
      .await()
  } catch (error) {
    await root.fiber.dispose()
    await stopAgentBrowser(options.command, options.cwd, environment)
    throw error
  }

  let callNumber = 0
  const execute = async (name: string, args: Record<string, unknown>) =>
    root.tools.execute({
      callId: CallId(`${options.namespace}-${++callNumber}`),
      name: `mcp__${options.namespace}__${name}`,
      arguments: args,
      signal: new AbortController().signal,
    })

  return {
    root,
    call: async (name, args) => {
      const result = await execute(name, args)
      assert.equal(result.isError, false, JSON.stringify(result.content))
      return contentText(result.content)
    },
    callExpectingFailure: async (name, args) => {
      const result = await execute(name, args)
      assert.equal(result.isError, true)
      return result.content
        .filter((block): block is McpTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
    },
    shutdown: async () => {
      await root.fiber.dispose()
      await stopAgentBrowser(options.command, options.cwd, environment)
    },
  }
}

async function expectMcpStartupFailure(
  command: string,
  args: string[],
  cwd: string,
  namespace: string,
): Promise<void> {
  const root = new Context()
  try {
    await root
      .plugin(SystemPrompt, { persona: 'Failure repro', includeRuntimeContext: false })
      .await()
    await root.plugin(ToolRuntime, { mode: 'native' }).await()
    await assert.rejects(
      root
        .plugin(McpClient, {
          serverName: namespace,
          transport: 'stdio',
          command,
          args,
          cwd,
          env: {},
          toolCallTimeoutMs: 1_000,
          failOnStartupError: true,
          reconnect: { enabled: false },
        })
        .await(),
    )
  } finally {
    await root.fiber.dispose()
  }
}

async function removeTemporaryRoot(path: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 79) throw error
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
  }
}

async function main(): Promise<void> {
  const desktopRoot = process.cwd()
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'shio-browser-control-repro-'))
  const browserCommand = resolveAgentBrowserCommand(resolve(desktopRoot, 'node_modules'))
  const executablePath = resolveChromeExecutable()
  assert(executablePath, 'Chrome must be discoverable for the browser-control repro')
  const malformedServer = join(temporaryRoot, 'malformed-mcp.mjs')
  await writeFile(malformedServer, "process.stdout.write('not-json\\n')", 'utf8')
  const testServer = await startTestServer()
  let bridge: BrowserBridge | null = null
  let browserOpened = false

  try {
    await expectMcpStartupFailure(
      join(temporaryRoot, 'missing-mcp-server.exe'),
      [],
      temporaryRoot,
      'missing-browser',
    )
    await expectMcpStartupFailure(
      process.execPath,
      [malformedServer],
      temporaryRoot,
      'malformed-browser',
    )

    await assert.rejects(
      createBrowserBridge({
        command: browserCommand,
        cwd: temporaryRoot,
        executablePath: join(temporaryRoot, 'missing-chrome.exe'),
        profileDirectory: join(temporaryRoot, 'missing-browser-profile'),
        socketDirectory: join(temporaryRoot, 'missing-browser-runtime'),
        namespace: 'browser-unavailable',
        toolCallTimeoutMs: 5_000,
      }),
      /browser|prewarm|executable|chrome|launch|exit code/i,
    )
    assert.deepEqual(await processesUsingPath(temporaryRoot), [])

    bridge = await createBrowserBridge({
      command: browserCommand,
      cwd: temporaryRoot,
      executablePath,
      profileDirectory: join(temporaryRoot, 'browser-profile'),
      socketDirectory: join(temporaryRoot, 'browser-runtime'),
      namespace: 'shio-browser-repro',
    })
    const schemas = bridge.root.tools.schemas()
    const names = new Set(schemas.map((schema) => schema.name))
    assert(names.has('mcp__shio-browser-repro__agent_browser_open'))
    assert(names.has('mcp__shio-browser-repro__agent_browser_snapshot'))
    assert(names.has('mcp__shio-browser-repro__agent_browser_tab_new'))
    assert(![...names].some((name) => /chat|upgrade|plugin|install|debug/i.test(name)))

    const profiles = await bridge.call('agent_browser_tools_profiles', { timeoutMs: 10_000 })
    assert.match(profiles, /core/)
    assert.match(profiles, /tabs/)
    const policyError = await bridge.callExpectingFailure('agent_browser_get_url', {
      extraArgs: ['--profile', join(temporaryRoot, 'escaped-profile')],
    })
    assert.match(policyError, /owned by Shio Main/)

    await bridge.call('agent_browser_open', { url: `${testServer.baseUrl}/long` })
    const boundedOutput = await bridge.call('agent_browser_get_text', { selector: 'body' })
    assert.match(boundedOutput, /AGENT_BROWSER_PAGE_CONTENT/)
    assert.match(boundedOutput, /output truncated/)
    assert(boundedOutput.length <= 20_000)

    const openResult = await bridge.call('agent_browser_open', {
      url: testServer.baseUrl,
      timeoutMs: 60_000,
    })
    browserOpened = true
    const currentUrl = await bridge.call('agent_browser_get_url', {})
    const currentTitle = await bridge.call('agent_browser_get_title', {})
    assert.match(openResult, /Shio browser control test|opened|success/i)
    assert.match(currentUrl, /127\.0\.0\.1/)
    assert.match(currentTitle, /Shio browser control test/)
    const snapshot = await bridge.call('agent_browser_snapshot', { interactive: true })
    assert.match(snapshot, /AGENT_BROWSER_PAGE_CONTENT/)
    assert.match(snapshot, /END_AGENT_BROWSER_PAGE_CONTENT/)
    const inputRef = snapshot.match(/textbox "Message".*\[ref=(e\d+)\]/)?.[1]
    const buttonRef = snapshot.match(/button "Apply message".*\[ref=(e\d+)\]/)?.[1]
    assert(inputRef, `Message textbox ref missing from snapshot: ${snapshot}`)
    assert(buttonRef, `Apply button ref missing from snapshot: ${snapshot}`)

    await bridge.call('agent_browser_fill', {
      selector: `@${inputRef}`,
      text: 'Shio browser control verified',
    })
    await bridge.call('agent_browser_click', { selector: `@${buttonRef}` })
    const resultText = await bridge.call('agent_browser_get_text', { selector: '#result' })
    assert.match(resultText, /Shio browser control verified/)

    const secondTab = await bridge.call('agent_browser_tab_new', {
      url: `${testServer.baseUrl}/second`,
    })
    assert.match(secondTab, /\/second/)
    const tabs = await bridge.call('agent_browser_tab_list', {})
    assert.match(tabs, /t1/)
    assert.match(tabs, /t2/)
    await bridge.call('agent_browser_tab_switch', { tab: 't1' })
    const firstTitle = await bridge.call('agent_browser_get_title', {})
    assert.match(firstTitle, /Shio browser control test/)
    await bridge.call('agent_browser_tab_switch', { tab: 't2' })
    const secondText = await bridge.call('agent_browser_get_text', { selector: 'h1' })
    assert.match(secondText, /Second tab verified/)
    await bridge.call('agent_browser_close', {})
    browserOpened = false
    await bridge.shutdown()
    bridge = null
    assert.deepEqual(await processesUsingPath(temporaryRoot), [])

    console.log('Browser Control DSH -> MCP -> agent-browser -> Chrome repro passed')
  } finally {
    if (browserOpened && bridge) {
      await bridge.call('agent_browser_close', {}).catch(() => undefined)
    }
    await bridge?.shutdown()
    await closeServer(testServer.server)
    await removeTemporaryRoot(temporaryRoot)
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
