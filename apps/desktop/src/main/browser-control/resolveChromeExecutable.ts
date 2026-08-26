import { existsSync } from 'node:fs'
import { join } from 'node:path'

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
