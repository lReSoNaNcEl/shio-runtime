import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { AGENT_BROWSER_VERSION } from '../../shared/desktop-control'

export interface AgentBrowserRuntimeResources {
  command: string
  executablePath?: string
  namespace: string
  profileDirectory: string
  socketDirectory: string
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
