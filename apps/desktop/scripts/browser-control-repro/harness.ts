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
import { AdapterBackedGameReflexPolicy } from '../../src/main/browser-game/GameReflexPolicy'
import { GameSessionController } from '../../src/main/browser-game/GameSessionController'
import { LocalVisualTargetReflexAdapter } from '../../src/main/browser-game/LocalVisualTargetReflexAdapter'
import {
  AgentBrowserAdapter,
  BrowserAutomationError,
} from '../../src/main/desktop-control/AgentBrowserAdapter'
import {
  AGENT_BROWSER_SESSION_IDLE_TIMEOUT_ARGUMENT,
  AGENT_BROWSER_SESSION_IDLE_TIMEOUT_MS,
  resolveAgentBrowserCommand,
  resolveChromeExecutable,
} from '../../src/main/desktop-control/AgentBrowserResources'
import { DesktopControlPlugin } from '../../src/main/desktop-control/DesktopControlPlugin'
import { DshHarnessAdapter } from '../../src/main/desktop-control/DshHarnessAdapter'
import { BROWSER_OBSERVATION_MAX_INTERACTIVE_ELEMENTS } from '../../src/shared/desktop-control'

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
const BROWSER_GAME_QUALIFICATION_MS = process.argv.includes('--browser-game-qualification')
  ? 5 * 60 * 1_000
  : 0

class RecordingLocalVisualTargetReflexAdapter extends LocalVisualTargetReflexAdapter {
  readonly intents: Array<{
    type: string
    x?: number
    y?: number
    frameWidth: number
    frameHeight: number
  }> = []

  override async decide(
    ...args: Parameters<LocalVisualTargetReflexAdapter['decide']>
  ): ReturnType<LocalVisualTargetReflexAdapter['decide']> {
    const intent = await super.decide(...args)
    if (intent.type !== 'none') {
      this.intents.push({ ...intent, frameWidth: args[0].width, frameHeight: args[0].height })
    }
    return intent
  }
}

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
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(AGENT_BROWSER_SESSION_IDLE_TIMEOUT_MS),
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
      [
        '--json',
        '--session',
        namespace,
        '--idle-timeout',
        AGENT_BROWSER_SESSION_IDLE_TIMEOUT_ARGUMENT,
        'get',
        'url',
      ],
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

function diagnosticError(error: unknown): { name: string; code?: string } {
  if (!(error instanceof Error)) return { name: typeof error }
  const code = (error as Error & { code?: unknown }).code
  return {
    name: error.name,
    ...(typeof code === 'string' ? { code } : {}),
  }
}

async function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (request.url === '/long') {
      response.end(`<!doctype html><title>Long output</title><p>${'x'.repeat(25_000)}</p>`)
      return
    }
    if (request.url === '/many') {
      response.end(
        `<!doctype html><title>Many controls</title>${Array.from(
          { length: BROWSER_OBSERVATION_MAX_INTERACTIVE_ELEMENTS + 5 },
          (_, index) => `<button>Control ${index + 1}</button>`,
        ).join('')}`,
      )
      return
    }
    if (request.url === '/second') {
      response.end('<!doctype html><title>Second tab</title><h1>Second tab verified</h1>')
      return
    }
    if (request.url === '/captcha') {
      response.end(
        '<!doctype html><title>CAPTCHA fixture</title><div class="g-recaptcha" style="width:320px;height:100px"></div>',
      )
      return
    }
    if (request.url === '/anti-bot') {
      response.end(
        '<!doctype html><title>Anti-bot fixture</title><div class="cf-turnstile" style="width:320px;height:100px"></div>',
      )
      return
    }
    if (request.url === '/authentication') {
      response.end(
        '<!doctype html><title>Authentication fixture</title><label>Password <input type="password" /></label>',
      )
      return
    }
    if (request.url === '/redirect') {
      const address = server.address()
      assert(address && typeof address === 'object')
      response.writeHead(302, { location: `http://localhost:${address.port}/details` })
      response.end()
      return
    }
    if (request.url === '/details') {
      response.end(
        '<!doctype html><title>Details</title><h1>More details</h1><p>Fresh details observation</p>',
      )
      return
    }
    if (request.url === '/catalog') {
      response.end(`<!doctype html><title>Catalog</title><h1>Catalog</h1>
        <button type="button" onclick="location.href='/next'">Next page</button>`)
      return
    }
    if (request.url === '/next') {
      response.end('<!doctype html><title>Next page</title><h1>Next page</h1>')
      return
    }
    if (request.url === '/ambiguous') {
      response.end(`<!doctype html><title>Ambiguous</title><h1>Choose</h1>
        <button type="button">Continue</button><button type="button">Continue</button>`)
      return
    }
    if (request.url === '/noop') {
      response.end(
        '<!doctype html><title>No change</title><h1>No change</h1><button type="button">Do nothing</button>',
      )
      return
    }
    if (request.url === '/iframe-game') {
      response.end(
        '<!doctype html><title>Embedded game</title><canvas aria-label="Embedded fixture game" width="640" height="360"></canvas>',
      )
      return
    }
    if (request.url === '/iframe-wrapper') {
      response.end(`<!doctype html><title>Game portal wrapper</title>
        <iframe id="game-element" name="gameFrame" title="Game" allow="autoplay; fullscreen; gamepad; keyboard-map *" src="/iframe-game" style="width:640px;height:360px;border:0"></iframe>`)
      return
    }
    if (request.url === '/advertisement-wrapper') {
      response.end(`<!doctype html><title>Advertisement wrapper</title>
        <iframe title="Advertisement" src="/iframe-game" style="width:640px;height:360px;border:0"></iframe>`)
      return
    }
    response.end(`<!doctype html>
      <title>Shio browser control test</title>
      <main>
        <h1>Browser Control Test</h1>
        <p>Controlled semantic browser fixture</p>
        <canvas id="fixture-game" aria-label="Fixture game" tabindex="0" width="320" height="180"></canvas>
        <p id="game-score">Score: 0</p>
        <p id="game-state">Round ready</p>
        <p id="game-cycles">Completed cycles: 0</p>
        <p id="game-key-position">Keyboard position: 0</p>
        <a href="/details">More details</a>
        <button type="button" onclick="location.href='/catalog'">Open catalog</button>
        <label for="message">Message</label>
        <input id="message" aria-label="Message" />
        <label for="search">Search</label>
        <input id="search" role="combobox" aria-label="Search" aria-expanded="false" />
        <label for="category">Category</label>
        <select id="category" aria-label="Category"><option value="films">Films</option><option value="series">Series</option></select>
        <button id="apply" type="button">Apply message</button>
        <p id="result">Waiting for input</p>
      </main>
      <script>
        const fixtureCanvas = document.querySelector('#fixture-game')
        const fixtureContext = fixtureCanvas.getContext('2d')
        const gameScore = document.querySelector('#game-score')
        const gameState = document.querySelector('#game-state')
        const gameCycles = document.querySelector('#game-cycles')
        const gameKeyPosition = document.querySelector('#game-key-position')
        let fixtureScore = 0
        let fixtureCompletedCycles = 0
        let fixtureHolding = false
        let fixtureGameOver = false
        let fixtureKeyPosition = 0
        let fixtureFrame = 0
        const fixtureTarget = () => ({ x: 160 + fixtureScore * 30, y: 90, radius: 24 })
        const setGameState = (value) => {
          gameState.textContent = value
          fixtureCanvas.setAttribute('aria-label', 'Fixture game · ' + value)
        }
        const renderFixture = () => {
          fixtureContext.fillStyle = '#101827'
          fixtureContext.fillRect(0, 0, fixtureCanvas.width, fixtureCanvas.height)
          const target = fixtureTarget()
          fixtureContext.fillStyle = fixtureGameOver ? '#64748b' : '#ff2fa8'
          fixtureContext.beginPath()
          fixtureContext.arc(target.x, target.y, target.radius, 0, Math.PI * 2)
          fixtureContext.fill()
          fixtureContext.fillStyle = '#38bdf8'
          fixtureContext.fillRect(0, 174, fixtureFrame % fixtureCanvas.width, 6)
          gameScore.textContent = 'Score: ' + fixtureScore
          gameCycles.textContent = 'Completed cycles: ' + fixtureCompletedCycles
          gameKeyPosition.textContent = 'Keyboard position: ' + fixtureKeyPosition
        }
        const canvasPoint = (event) => {
          const bounds = fixtureCanvas.getBoundingClientRect()
          return {
            x: (event.clientX - bounds.left) * (fixtureCanvas.width / bounds.width),
            y: (event.clientY - bounds.top) * (fixtureCanvas.height / bounds.height),
          }
        }
        fixtureCanvas.addEventListener('pointerdown', (event) => {
          fixtureCanvas.focus()
          if (fixtureGameOver) {
            fixtureCompletedCycles += 1
            fixtureScore = 0
            fixtureGameOver = false
            setGameState('Retried')
            renderFixture()
            return
          }
          const point = canvasPoint(event)
          const target = fixtureTarget()
          if (Math.hypot(point.x - target.x, point.y - target.y) > target.radius) {
            setGameState('Miss')
            return
          }
          fixtureHolding = true
          setGameState('Holding')
        })
        fixtureCanvas.addEventListener('pointerup', () => {
          if (!fixtureHolding) return
          fixtureHolding = false
          fixtureScore += 1
          fixtureGameOver = fixtureScore >= 3
          setGameState(fixtureGameOver ? 'Game over' : 'Released')
          renderFixture()
        })
        fixtureCanvas.addEventListener('keydown', (event) => {
          if (event.key !== 'ArrowRight') return
          fixtureKeyPosition += 1
          setGameState('Keyboard moving')
          renderFixture()
        })
        fixtureCanvas.addEventListener('keyup', (event) => {
          if (event.key === 'ArrowRight') setGameState('Key released')
        })
        const animateFixture = () => {
          fixtureFrame += 2
          renderFixture()
          requestAnimationFrame(animateFixture)
        }
        animateFixture()
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

async function waitForObservedGameState(
  adapter: AgentBrowserAdapter,
  expected: RegExp,
): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const observation = await adapter.observe()
    if (expected.test(observation.content)) return observation.content
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  assert.fail(`Game fixture did not reach ${expected}`)
}

async function waitForGameInput(controller: GameSessionController): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const status = controller.status()
    if (status.telemetry.inputEvents >= 2) return
    if (status.state === 'error') {
      assert.fail(`Game controller failed before input: ${status.lastErrorCode ?? 'unknown'}`)
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  const status = controller.status()
  assert.fail(
    `Game controller did not dispatch its first intent (${status.state}:${status.lastErrorCode ?? 'none'})`,
  )
}

async function waitForAutonomousFixtureCycle(adapter: AgentBrowserAdapter): Promise<void> {
  assert.match(await waitForObservedGameState(adapter, /Game over/u), /Score: 3/u)
  assert.match(await waitForObservedGameState(adapter, /Retried/u), /Score: 0/u)
  assert.match(await waitForObservedGameState(adapter, /Score: 1/u), /Released/u)
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

    const adapterNamespace = 'shio-browser-adapter-repro'
    const adapterProfile = join(temporaryRoot, 'adapter-browser-profile')
    const adapterSocket = join(temporaryRoot, 'adapter-browser-runtime')
    const personalChromeProfile = process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')
      : ''
    assert.notEqual(
      resolve(adapterProfile).toLocaleLowerCase(),
      resolve(personalChromeProfile || temporaryRoot, 'personal-profile').toLocaleLowerCase(),
    )
    const adapterEnvironment = agentBrowserEnvironment({
      executablePath,
      profileDirectory: adapterProfile,
      socketDirectory: adapterSocket,
      namespace: adapterNamespace,
    })
    const adapter = new AgentBrowserAdapter({
      resources: () => ({
        command: browserCommand,
        executablePath,
        namespace: adapterNamespace,
        profileDirectory: adapterProfile,
        socketDirectory: adapterSocket,
      }),
    })
    try {
      const opened = await adapter.open(testServer.baseUrl)
      assert.equal(opened.evidence.operation, 'open')
      assert.equal(opened.evidence.after?.url, `${testServer.baseUrl}/`)
      assert.equal(opened.observation?.title, 'Shio browser control test')
      assert.match(opened.observation?.content ?? '', /Controlled semantic browser fixture/)
      const sessionId = adapter.sessionSnapshot()?.sessionId
      assert(sessionId)
      const realtime = adapter.getRealtimeControlProvider()
      const realtimeSession = realtime.session()
      assert(realtimeSession)
      const captureSamples: unknown[] = []
      const captureFrame = realtime.captureFrame.bind(realtime)
      realtime.captureFrame = async (...args) => {
        try {
          const frame = await captureFrame(...args)
          if (captureSamples.length < 2) {
            captureSamples.push({
              width: frame.width,
              height: frame.height,
              viewport: frame.viewport,
            })
          }
          return frame
        } catch (error) {
          console.error('Browser game fixture capture failed', diagnosticError(error))
          throw error
        }
      }
      const dispatchInput = realtime.dispatchInput.bind(realtime)
      realtime.dispatchInput = async (...args) => {
        try {
          await dispatchInput(...args)
        } catch (error) {
          console.error('Browser game fixture input failed', diagnosticError(error))
          throw error
        }
      }
      const gameEnvironment = await realtime.inspectGameEnvironment(new AbortController().signal)
      const gameSurfaces = gameEnvironment.surfaces
      assert.equal(gameEnvironment.blocker, undefined)
      assert.equal(gameSurfaces.length, 1)
      assert.equal(gameSurfaces[0]?.kind, 'canvas')
      assert.equal(gameSurfaces[0]?.label, 'Fixture game')
      await adapter.open(`${testServer.baseUrl}/iframe-wrapper`)
      const iframeEnvironment = await realtime.inspectGameEnvironment(new AbortController().signal)
      assert.equal(iframeEnvironment.surfaces.length, 1)
      assert.equal(iframeEnvironment.surfaces[0]?.kind, 'game-root')
      assert.equal(iframeEnvironment.surfaces[0]?.label, 'Game')
      assert.match(iframeEnvironment.surfaces[0]?.id ?? '', /^game-surface-0-frame-[0-9a-f]{12}$/u)
      await adapter.open(`${testServer.baseUrl}/advertisement-wrapper`)
      const advertisementEnvironment = await realtime.inspectGameEnvironment(
        new AbortController().signal,
      )
      assert.equal(advertisementEnvironment.surfaces.length, 0)
      await adapter.open(testServer.baseUrl)
      const fixtureReflex = new RecordingLocalVisualTargetReflexAdapter()
      const gameController = new GameSessionController({
        realtime: () => realtime,
        reflex: new AdapterBackedGameReflexPolicy(fixtureReflex),
      })
      const gamePreparation = await gameController.prepareStart(
        {
          goal: 'Tap the visible fixture target once',
          surfaceId: gameSurfaces[0]?.id,
          allowedInputs: ['pointer'],
          ...(BROWSER_GAME_QUALIFICATION_MS > 0
            ? { maxDurationMs: 6 * 60 * 1_000, maxInputEvents: 20_000 }
            : {}),
        },
        new AbortController().signal,
      )
      const startedGame = await gameController.start(
        gamePreparation.preparationId,
        'action-10000-11111111-1111-4111-8111-111111111111',
        new AbortController().signal,
      )
      assert.equal(startedGame.state, 'running')
      const qualificationStartedAt = Date.now()
      let completedCycles = 0
      let gameRunError: unknown
      try {
        await waitForGameInput(gameController)
        assert.deepEqual(
          fixtureReflex.intents.slice(0, 2).map((intent) => intent.type),
          ['pointer-down', 'pointer-up'],
        )
        if (BROWSER_GAME_QUALIFICATION_MS === 0) {
          const firstScore = await waitForObservedGameState(adapter, /Score: 1/u)
          assert.match(firstScore, /Released/u)
          await waitForAutonomousFixtureCycle(adapter)
          completedCycles += 1
        } else {
          let nextProgressAt = 30_000
          while (Date.now() - qualificationStartedAt < BROWSER_GAME_QUALIFICATION_MS) {
            await new Promise((resolveWait) => setTimeout(resolveWait, 250))
            const status = gameController.status()
            assert.equal(
              status.state,
              'running',
              `Browser game qualification stopped early: ${status.lastErrorCode ?? status.state}`,
            )
            const elapsedMs = Date.now() - qualificationStartedAt
            if (elapsedMs >= nextProgressAt) {
              console.log('Browser game qualification progress', {
                elapsedMs,
                capturedFrames: status.telemetry.capturedFrames,
                inputEvents: status.telemetry.inputEvents,
                captureFps: status.telemetry.captureFps,
                decisionLatencyMsP50: status.telemetry.decisionLatencyMsP50,
              })
              nextProgressAt += 30_000
            }
          }
        }
      } catch (error) {
        console.error('Browser game fixture controller status', gameController.status())
        console.error('Browser game fixture reflex intents', fixtureReflex.intents)
        console.error('Browser game fixture capture samples', captureSamples)
        console.error('Browser game fixture surface', gameSurfaces[0])
        gameRunError = error
      }
      const stoppedGame = await gameController.stop()
      if (gameRunError) throw gameRunError
      assert.equal(stoppedGame.state, 'stopped')
      assert((stoppedGame.telemetry.capturedFrames ?? 0) >= 1)
      assert(stoppedGame.telemetry.inputEvents >= 10)
      if (BROWSER_GAME_QUALIFICATION_MS > 0) {
        const completedCyclesMatch = (await adapter.observe()).content.match(
          /Completed cycles: (\d+)/u,
        )
        assert(completedCyclesMatch, 'Fixture did not expose its completed-cycle counter')
        completedCycles = Number(completedCyclesMatch[1])
        assert(stoppedGame.telemetry.sessionDurationMs >= BROWSER_GAME_QUALIFICATION_MS)
        assert(completedCycles >= 2)
        console.log('Browser game five-minute qualification passed', {
          completedCycles,
          telemetry: stoppedGame.telemetry,
        })
      }

      const surface = gameSurfaces[0]
      assert(surface)
      if (BROWSER_GAME_QUALIFICATION_MS > 0) {
        await adapter.open(testServer.baseUrl)
        await realtime.dispatchInput(
          {
            sessionId: realtimeSession.sessionId,
            tabId: realtimeSession.tabId,
            events: [
              {
                type: 'pointer-down',
                x: surface.bounds.x + 0.5 * surface.bounds.width,
                y: surface.bounds.y + 0.5 * surface.bounds.height,
                button: 'left',
              },
              {
                type: 'pointer-up',
                x: surface.bounds.x + 0.5 * surface.bounds.width,
                y: surface.bounds.y + 0.5 * surface.bounds.height,
                button: 'left',
              },
            ],
          },
          new AbortController().signal,
        )
        assert.match(await waitForObservedGameState(adapter, /Score: 1/u), /Released/u)
      }
      const fixturePoint = (score: number): { x: number; y: number } => ({
        x: surface.bounds.x + ((160 + score * 30) / 320) * surface.bounds.width,
        y: surface.bounds.y + 0.5 * surface.bounds.height,
      })
      await realtime.dispatchInput(
        {
          sessionId: realtimeSession.sessionId,
          tabId: realtimeSession.tabId,
          events: [
            {
              type: 'pointer-down',
              x: surface.bounds.x + 4,
              y: surface.bounds.y + 4,
              button: 'left',
            },
            {
              type: 'pointer-up',
              x: surface.bounds.x + 4,
              y: surface.bounds.y + 4,
              button: 'left',
            },
          ],
        },
        new AbortController().signal,
      )
      assert.match(await waitForObservedGameState(adapter, /Miss/u), /Score: 1/u)

      await realtime.dispatchInput(
        {
          sessionId: realtimeSession.sessionId,
          tabId: realtimeSession.tabId,
          events: [{ type: 'key-down', key: 'ArrowRight', code: 'ArrowRight' }],
        },
        new AbortController().signal,
      )
      assert.match(await waitForObservedGameState(adapter, /Keyboard moving/u), /position: 1/u)
      await realtime.dispatchInput(
        {
          sessionId: realtimeSession.sessionId,
          tabId: realtimeSession.tabId,
          events: [{ type: 'key-up', key: 'ArrowRight', code: 'ArrowRight' }],
        },
        new AbortController().signal,
      )
      await waitForObservedGameState(adapter, /Key released/u)

      const secondTarget = fixturePoint(1)
      await realtime.dispatchInput(
        {
          sessionId: realtimeSession.sessionId,
          tabId: realtimeSession.tabId,
          events: [{ type: 'pointer-down', ...secondTarget, button: 'left' }],
        },
        new AbortController().signal,
      )
      await waitForObservedGameState(adapter, /Holding/u)
      await realtime.dispatchInput(
        {
          sessionId: realtimeSession.sessionId,
          tabId: realtimeSession.tabId,
          events: [{ type: 'pointer-up', ...secondTarget, button: 'left' }],
        },
        new AbortController().signal,
      )
      assert.match(await waitForObservedGameState(adapter, /Score: 2/u), /Released/u)

      const thirdTarget = fixturePoint(2)
      await realtime.dispatchInput(
        {
          sessionId: realtimeSession.sessionId,
          tabId: realtimeSession.tabId,
          events: [
            { type: 'pointer-down', ...thirdTarget, button: 'left' },
            { type: 'pointer-up', ...thirdTarget, button: 'left' },
          ],
        },
        new AbortController().signal,
      )
      assert.match(await waitForObservedGameState(adapter, /Game over/u), /Score: 3/u)

      await realtime.dispatchInput(
        {
          sessionId: realtimeSession.sessionId,
          tabId: realtimeSession.tabId,
          events: [
            {
              type: 'pointer-down',
              x: surface.bounds.x + 8,
              y: surface.bounds.y + 8,
              button: 'left',
            },
            {
              type: 'pointer-up',
              x: surface.bounds.x + 8,
              y: surface.bounds.y + 8,
              button: 'left',
            },
          ],
        },
        new AbortController().signal,
      )
      assert.match(await waitForObservedGameState(adapter, /Retried/u), /Score: 0/u)
      await realtime.dispatchInput(
        {
          sessionId: realtimeSession.sessionId,
          tabId: realtimeSession.tabId,
          events: [{ type: 'pointer-move', x: 1, y: 1 }],
        },
        new AbortController().signal,
      )
      await realtime.releaseInputs()
      for (const [path, blocker] of [
        ['/captcha', 'captcha'],
        ['/anti-bot', 'anti-bot'],
        ['/authentication', 'authentication'],
      ] as const) {
        await adapter.open(`${testServer.baseUrl}${path}`)
        assert.equal(
          (await realtime.inspectGameEnvironment(new AbortController().signal)).blocker,
          blocker,
        )
      }
      await adapter.open(testServer.baseUrl)
      const postGameObservation = await adapter.observe()
      const details = postGameObservation.interactiveElements.find(
        (element) => element.role === 'link' && element.name === 'More details',
      )
      assert(details)
      const detailsResult = await adapter.click({
        kind: 'semantic-ref',
        observationId: postGameObservation.observationId,
        ref: details.ref,
      })
      assert.equal(detailsResult.evidence.operation, 'click')
      assert.match(detailsResult.evidence.after?.url ?? '', /\/details$/)
      assert.match(detailsResult.observation?.content ?? '', /Fresh details observation/)
      assert.notEqual(detailsResult.observation?.observationId, opened.observation.observationId)
      await assert.rejects(
        adapter.click({
          kind: 'semantic-ref',
          observationId: opened.observation.observationId,
          ref: details.ref,
        }),
        (error: unknown) =>
          error instanceof BrowserAutomationError && error.code === 'TARGET_STALE',
      )
      const backed = await adapter.back()
      assert.equal(backed.evidence.operation, 'back')
      assert.notEqual(backed.evidence.before?.url, backed.evidence.after?.url)
      assert.equal(backed.observation?.title, 'Shio browser control test')
      const forwarded = await adapter.forward()
      assert.equal(forwarded.evidence.operation, 'forward')
      assert.notEqual(forwarded.evidence.before?.url, forwarded.evidence.after?.url)
      assert.equal(forwarded.observation?.title, 'Details')

      const formPage = await adapter.open(testServer.baseUrl)
      const messageField = formPage.observation?.interactiveElements.find(
        (element) => element.role === 'textbox' && element.name === 'Message',
      )
      assert(messageField)
      const filled = await adapter.fill(
        {
          kind: 'semantic-ref',
          observationId: formPage.observation.observationId,
          ref: messageField.ref,
        },
        'Typed by deterministic Browser Control',
      )
      assert.equal(filled.evidence.operation, 'fill')
      assert(filled.evidence.after)
      const searchField = filled.observation?.interactiveElements.find(
        (element) => element.role === 'combobox' && element.name === 'Search',
      )
      assert(searchField)
      const searchFilled = await adapter.fill(
        {
          kind: 'semantic-ref',
          observationId: filled.observation.observationId,
          ref: searchField.ref,
        },
        'Editable combobox input',
      )
      assert.equal(searchFilled.evidence.operation, 'fill')
      assert(searchFilled.evidence.after)
      const categoryField = searchFilled.observation?.interactiveElements.find(
        (element) => element.role === 'combobox' && element.name === 'Category',
      )
      assert(categoryField)
      const selected = await adapter.select(
        {
          kind: 'semantic-ref',
          observationId: searchFilled.observation.observationId,
          ref: categoryField.ref,
        },
        ['series'],
      )
      assert.equal(selected.evidence.operation, 'select')
      assert(selected.evidence.after)
      const applyMessage = selected.observation?.interactiveElements.find(
        (element) => element.role === 'button' && element.name === 'Apply message',
      )
      assert(applyMessage)
      const applied = await adapter.click({
        kind: 'semantic-ref',
        observationId: selected.observation.observationId,
        ref: applyMessage.ref,
      })
      assert.match(applied.observation?.content ?? '', /Typed by deterministic Browser Control/)
      const scrolled = await adapter.scroll('down', 300)
      assert.equal(scrolled.evidence.operation, 'scroll')
      assert(scrolled.evidence.after)

      const catalogPage = await adapter.open(testServer.baseUrl)
      assert.equal(adapter.sessionSnapshot()?.sessionId, sessionId)
      const catalog = catalogPage.observation?.interactiveElements.find(
        (element) => element.role === 'button' && element.name === 'Open catalog',
      )
      assert(catalog)
      const catalogResult = await adapter.click({
        kind: 'semantic-ref',
        observationId: catalogPage.observation.observationId,
        ref: catalog.ref,
      })
      assert.equal(catalogResult.evidence.operation, 'click')
      assert.equal(catalogResult.observation?.title, 'Catalog')
      const next = catalogResult.observation?.interactiveElements.find(
        (element) => element.role === 'button' && element.name === 'Next page',
      )
      assert(next)
      const nextResult = await adapter.click({
        kind: 'semantic-ref',
        observationId: catalogResult.observation.observationId,
        ref: next.ref,
      })
      assert.equal(nextResult.observation?.title, 'Next page')
      assert.equal(adapter.sessionSnapshot()?.sessionId, sessionId)

      await adapter.open(`${testServer.baseUrl}/ambiguous`)
      const ambiguous = adapter.observationSnapshot()
      assert(ambiguous)
      await assert.rejects(
        adapter.click({
          kind: 'accessible-name',
          observationId: ambiguous.observationId,
          role: 'button',
          name: 'Continue',
        }),
        (error: unknown) =>
          error instanceof BrowserAutomationError && error.code === 'TARGET_AMBIGUOUS',
      )
      await assert.rejects(
        adapter.click({
          kind: 'accessible-name',
          observationId: ambiguous.observationId,
          role: 'button',
          name: 'Missing target',
        }),
        (error: unknown) =>
          error instanceof BrowserAutomationError && error.code === 'TARGET_NOT_FOUND',
      )

      const noChange = await adapter.open(`${testServer.baseUrl}/noop`)
      const noChangeButton = noChange.observation?.interactiveElements.find(
        (element) => element.name === 'Do nothing',
      )
      assert(noChangeButton)
      const unverified = await adapter.click({
        kind: 'semantic-ref',
        observationId: noChange.observation.observationId,
        ref: noChangeButton.ref,
      })
      assert.equal(unverified.evidence.before?.url, unverified.evidence.after?.url)
      assert.equal(unverified.evidence.before?.content, unverified.evidence.after?.content)

      const boundedControls = await adapter.open(`${testServer.baseUrl}/many`)
      assert.equal(
        boundedControls.observation?.interactiveElements.length,
        BROWSER_OBSERVATION_MAX_INTERACTIVE_ELEMENTS,
      )
      assert.equal(boundedControls.observation?.truncated, true)

      await adapter.open(testServer.baseUrl)
      await execFileAsync(
        browserCommand,
        [
          '--json',
          '--session',
          adapterNamespace,
          '--idle-timeout',
          AGENT_BROWSER_SESSION_IDLE_TIMEOUT_ARGUMENT,
          'tab',
          'new',
          `${testServer.baseUrl}/second`,
        ],
        { cwd: adapterSocket, env: adapterEnvironment, timeout: 15_000, windowsHide: true },
      )
      const adapterTabs = await adapter.listTabs()
      const firstTab = adapterTabs.find((tab) => tab.url === `${testServer.baseUrl}/`)
      const secondAdapterTab = adapterTabs.find((tab) => tab.url?.endsWith('/second'))
      assert(firstTab, `Root tab missing from ${JSON.stringify(adapterTabs)}`)
      assert(secondAdapterTab, `Second tab missing from ${JSON.stringify(adapterTabs)}`)
      const inspectedTabs = await adapter.inspectTabs()
      assert.equal(inspectedTabs.evidence.operation, 'tabs')
      assert.equal(inspectedTabs.evidence.tabs?.length, adapterTabs.length)
      const switched = await adapter.switchTab(firstTab.tabId)
      assert.equal(switched.evidence.afterSession?.activeTabId, firstTab.tabId)
      assert.equal(switched.observation?.title, 'Shio browser control test')

      const redirected = await adapter.open(`${testServer.baseUrl}/redirect`)
      assert.equal(redirected.evidence.operation, 'open')
      assert.match(redirected.evidence.after?.url ?? '', /^http:\/\/localhost:/u)
      assert.equal(redirected.observation?.title, 'Details')
    } finally {
      await adapter.close()
    }
    await assert.rejects(
      adapter.observe(),
      (error: unknown) =>
        error instanceof BrowserAutomationError && error.code === 'SESSION_CLOSED',
    )
    assert.deepEqual(await processesUsingPath(temporaryRoot), [])

    const pluginBrowserResources = {
      command: browserCommand,
      executablePath,
      namespace: 'shio-browser-no-dsh-repro',
      profileDirectory: join(temporaryRoot, 'no-dsh-browser-profile'),
      socketDirectory: join(temporaryRoot, 'no-dsh-browser-runtime'),
    }
    const plugin = new DesktopControlPlugin({
      adapter: new DshHarnessAdapter({
        resources: () => ({
          command: process.execPath,
          runtimeScript: resolve(desktopRoot, 'resources', 'desktop-control', 'dsh-runtime.mjs'),
          profileDirectory: resolve(desktopRoot, 'resources', 'desktop-control'),
          workspaceDirectory: join(temporaryRoot, 'no-dsh-workspace'),
          sessionDirectory: join(temporaryRoot, 'no-dsh-sessions'),
          homeDirectory: join(temporaryRoot, 'no-dsh-home'),
          browser: pluginBrowserResources,
        }),
        model: () => ({
          provider: 'mistral',
          providerDisplayName: 'Mistral',
          model: '',
          baseURL: 'https://api.mistral.ai/v1',
          apiKey: '',
          credentialConfigured: false,
        }),
      }),
      browser: new AgentBrowserAdapter({ resources: () => pluginBrowserResources }),
      authorityMode: () => 'confirm',
    })
    await plugin.initialize({ pluginId: 'desktop-control' })
    await plugin.start()
    try {
      const statusWithoutDsh = await plugin.getStatus()
      assert.equal(statusWithoutDsh.browserControl, 'ready')
      assert.equal(statusWithoutDsh.automationEngine, 'needs-setup')
      assert.equal((await plugin.getHealth()).state, 'degraded')
      const deterministicWithoutDsh = await plugin.executeWorkflow(
        {
          type: 'desktop.workflow',
          goal: 'Open the exact controlled fixture',
          browserOperation: { operation: 'open', url: testServer.baseUrl },
          requestedCapabilities: ['browser'],
          risk: 'normal',
        },
        new AbortController().signal,
      )
      assert.equal(deterministicWithoutDsh.evidence.kind, 'browser')
      assert.equal(deterministicWithoutDsh.evidence.operation, 'open')
      assert.equal(deterministicWithoutDsh.evidence.riskClass, 'navigation')
      const effectiveSafeNavigation = plugin.validateWorkflowRequest({
        type: 'desktop.workflow',
        goal: 'Open safe page',
        browserOperation: { operation: 'open', url: testServer.baseUrl },
        requestedCapabilities: ['browser'],
        risk: 'destructive',
      })
      assert.equal(effectiveSafeNavigation.browserRiskClass, 'navigation')
      assert.equal(effectiveSafeNavigation.risk, 'normal')
      const browserContext = plugin.getBrowserContextProvider()
      assert(browserContext.currentObservation())
      assert.match(
        (await browserContext.observe({ userText: 'Что здесь?', traceId: 'page' }))?.content ?? '',
        /Controlled semantic browser fixture/,
      )
      const directFieldObservation = browserContext.currentObservation()
      const directField = directFieldObservation?.interactiveElements.find(
        (element) => element.role === 'textbox' && element.name === 'Message',
      )
      assert(directFieldObservation)
      assert(directField)
      const deterministicFillWithoutDsh = await plugin.executeWorkflow(
        {
          type: 'desktop.workflow',
          goal: 'Fill known field without planner',
          browserOperation: {
            operation: 'fill',
            target: {
              kind: 'semantic-ref',
              observationId: directFieldObservation.observationId,
              ref: directField.ref,
            },
            value: 'Direct plugin fill without DSH',
          },
          requestedCapabilities: ['browser'],
          risk: 'normal',
        },
        new AbortController().signal,
      )
      assert.equal(deterministicFillWithoutDsh.evidence.riskClass, 'input')
      const afterDirectFill = browserContext.currentObservation()
      const directApply = afterDirectFill?.interactiveElements.find(
        (element) => element.role === 'button' && element.name === 'Apply message',
      )
      assert(afterDirectFill)
      assert(directApply)
      await plugin.executeWorkflow(
        {
          type: 'desktop.workflow',
          goal: 'Click known button without planner',
          browserOperation: {
            operation: 'click',
            target: {
              kind: 'semantic-ref',
              observationId: afterDirectFill.observationId,
              ref: directApply.ref,
            },
          },
          requestedCapabilities: ['browser'],
          risk: 'normal',
        },
        new AbortController().signal,
      )
      assert.match(
        browserContext.currentObservation()?.content ?? '',
        /Direct plugin fill without DSH/,
      )
      const applyObservation = browserContext.currentObservation()
      assert(applyObservation)
      const applyTarget = applyObservation.interactiveElements.find(
        (element) => element.name === 'Apply message',
      )
      assert(applyTarget)
      const effectiveSubmission = plugin.validateWorkflowRequest({
        type: 'desktop.workflow',
        goal: 'Apply message',
        browserOperation: {
          operation: 'click',
          target: {
            kind: 'semantic-ref',
            observationId: applyObservation.observationId,
            ref: applyTarget.ref,
          },
        },
        requestedCapabilities: ['browser'],
        risk: 'normal',
      })
      assert.equal(effectiveSubmission.browserRiskClass, 'submission')
      assert.equal(effectiveSubmission.risk, 'destructive')
      const plannerLifecycle = new DshHarnessAdapter({
        resources: () => ({
          command: process.execPath,
          runtimeScript: resolve(desktopRoot, 'resources', 'desktop-control', 'dsh-runtime.mjs'),
          profileDirectory: resolve(desktopRoot, 'resources', 'desktop-control'),
          workspaceDirectory: join(temporaryRoot, 'planner-workspace'),
          sessionDirectory: join(temporaryRoot, 'planner-sessions'),
          homeDirectory: join(temporaryRoot, 'planner-home'),
          browser: pluginBrowserResources,
        }),
        model: () => ({
          provider: 'mistral',
          providerDisplayName: 'Mistral',
          model: 'planner-model',
          baseURL: 'https://planner.invalid/v1',
          apiKey: 'test-only',
          credentialConfigured: true,
        }),
        createHarness: async () => ({
          start: async () => undefined,
          run: async () => ({ finalResponse: '', notifications: [] }),
          close: async () => undefined,
        }),
      })
      await plannerLifecycle.start('browser')
      await plannerLifecycle.close()
      assert.match(
        (await browserContext.observe({ userText: 'Что здесь?', traceId: 'after-planner' }))
          ?.content ?? '',
        /Controlled semantic browser fixture/,
      )
      await assert.rejects(
        plugin.executeWorkflow(
          {
            type: 'desktop.workflow',
            goal: 'Compare several pages and choose the best option',
            requestedCapabilities: ['browser'],
            risk: 'normal',
          },
          new AbortController().signal,
        ),
        (error: unknown) =>
          Boolean(
            error &&
              typeof error === 'object' &&
              (error as { code?: unknown }).code === 'DSH_MODEL_NOT_CONFIGURED',
          ),
      )
      assert.equal(AGENT_BROWSER_SESSION_IDLE_TIMEOUT_ARGUMENT, '1800s')
      assert.equal(AGENT_BROWSER_SESSION_IDLE_TIMEOUT_MS, 30 * 60 * 1_000)
    } finally {
      await plugin.stop()
    }
    assert.deepEqual(await processesUsingPath(temporaryRoot), [])

    console.log('Browser observation, continuity and deterministic interaction repro passed')
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
