import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { AGENT_BROWSER_VERSION } from '../../shared/desktop-control'

export const AGENT_BROWSER_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1_000
export const AGENT_BROWSER_SESSION_IDLE_TIMEOUT_ARGUMENT = '1800s'

export interface AgentBrowserRuntimeResources {
  command: string
  executablePath?: string
  namespace: string
  profileDirectory: string
  socketDirectory: string
}

const SAFE_BROWSER_OS_VARIABLES = [
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

export function buildAgentBrowserChildEnvironment(
  hostEnvironment: NodeJS.ProcessEnv,
  browser: AgentBrowserRuntimeResources,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    AGENT_BROWSER_PROFILE: browser.profileDirectory,
    AGENT_BROWSER_SOCKET_DIR: browser.socketDirectory,
    AGENT_BROWSER_NAMESPACE: browser.namespace,
    AGENT_BROWSER_SESSION: browser.namespace,
    AGENT_BROWSER_CONTENT_BOUNDARIES: '1',
    AGENT_BROWSER_MAX_OUTPUT: '20000',
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(AGENT_BROWSER_SESSION_IDLE_TIMEOUT_MS),
    AGENT_BROWSER_HEADED: '1',
    AGENT_BROWSER_STREAM_QUALITY: '65',
    AGENT_BROWSER_STREAM_MAX_WIDTH: '768',
    AGENT_BROWSER_STREAM_MAX_HEIGHT: '768',
  }
  for (const name of SAFE_BROWSER_OS_VARIABLES) {
    const value = hostEnvironment[name]
    if (value) environment[name] = value
  }
  if (browser.executablePath) {
    environment.AGENT_BROWSER_EXECUTABLE_PATH = browser.executablePath
  }
  return environment
}

export function resolveAgentBrowserCommand(
  modulesDirectory: string,
  platform = process.platform,
  architecture = process.arch,
): string {
  const platformArchitecture =
    platform === 'win32' && architecture === 'arm64' ? 'x64' : architecture
  const extension = platform === 'win32' ? '.exe' : ''
  return join(
    modulesDirectory,
    'agent-browser',
    'bin',
    `agent-browser-${platform}-${platformArchitecture}${extension}`,
  )
}

export function resolveChromeExecutable(
  environment: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
): string | undefined {
  const candidates = [
    environment.LOCALAPPDATA
      ? join(environment.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : undefined,
    environment.PROGRAMFILES
      ? join(environment.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : undefined,
    environment['PROGRAMFILES(X86)']
      ? join(environment['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
      : undefined,
  ]
  return candidates.find((candidate): candidate is string =>
    Boolean(candidate && fileExists(candidate)),
  )
}

export function agentBrowserDiagnosticVersion(): typeof AGENT_BROWSER_VERSION {
  return AGENT_BROWSER_VERSION
}
