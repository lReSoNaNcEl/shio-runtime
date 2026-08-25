import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { SystemContextAdapter, SystemContextObservation } from './SystemContextAdapter'

const execFileAsync = promisify(execFile)
const OBSERVATION_TIMEOUT_MS = 4_000
const MAX_RUNNING_APPLICATIONS = 20

const WINDOWS_CONTEXT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ShioForegroundWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$handle = [ShioForegroundWindow]::GetForegroundWindow()
$foreground = $null
if ($handle -ne [IntPtr]::Zero) {
  [uint32]$processId = 0
  [void][ShioForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
  if ($processId -gt 0) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
      $foreground = [ordered]@{
        processName = [string]$process.ProcessName
        displayName = [string]$process.MainModule.FileVersionInfo.FileDescription
        windowTitle = [string]$process.MainWindowTitle
      }
    }
  }
}
$applications = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } |
  Sort-Object ProcessName -Unique | Select-Object -First 20 | ForEach-Object {
    [ordered]@{
      processName = [string]$_.ProcessName
      displayName = [string]$_.MainModule.FileVersionInfo.FileDescription
    }
  })
$os = Get-CimInstance Win32_OperatingSystem
$processor = Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average
$memoryLoad = if ($os.TotalVisibleMemorySize -gt 0) {
  [math]::Round((1 - ($os.FreePhysicalMemory / $os.TotalVisibleMemorySize)) * 100, 1)
} else { $null }
[ordered]@{
  foregroundApplication = $foreground
  runningApplications = $applications
  system = [ordered]@{
    cpuLoad = if ($null -ne $processor.Average) { [math]::Round($processor.Average, 1) } else { $null }
    memoryLoad = $memoryLoad
  }
} | ConvertTo-Json -Depth 5 -Compress
`

interface WindowsObservationPayload {
  foregroundApplication?: {
    processName?: unknown
    displayName?: unknown
    windowTitle?: unknown
  } | null
  runningApplications?: readonly {
    processName?: unknown
    displayName?: unknown
  }[]
  system?: { cpuLoad?: unknown; memoryLoad?: unknown }
}

export interface WindowsSystemContextAdapterOptions {
  getGlobalIdleSeconds(): number
  pwshPath: string
}

export class WindowsSystemContextAdapter implements SystemContextAdapter {
  constructor(private readonly options: WindowsSystemContextAdapterOptions) {}

  async observe(): Promise<SystemContextObservation> {
    const capturedAt = Date.now()
    const globalUserIdleMs = Math.max(0, Math.round(this.options.getGlobalIdleSeconds() * 1_000))
    try {
      const { stdout } = await execFileAsync(
        this.options.pwshPath,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_CONTEXT_SCRIPT],
        {
          timeout: OBSERVATION_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: 256 * 1_024,
          env: credentialMinimalEnvironment(),
        },
      )
      const payload = JSON.parse(stdout) as WindowsObservationPayload
      return {
        capturedAt,
        globalUserIdleMs,
        foregroundApplication: foreground(payload.foregroundApplication),
        runningApplications: Object.freeze(
          (payload.runningApplications ?? [])
            .flatMap((application) => {
              const processName = boundedString(application.processName, 120)
              if (!processName) return []
              const displayName = boundedString(application.displayName, 160)
              return [{ processName, ...(displayName ? { displayName } : {}) }]
            })
            .slice(0, MAX_RUNNING_APPLICATIONS),
        ),
        system: {
          cpuLoad: boundedLoad(payload.system?.cpuLoad),
          memoryLoad: boundedLoad(payload.system?.memoryLoad),
        },
        status: 'available',
      }
    } catch {
      return { capturedAt, globalUserIdleMs, status: 'degraded' }
    }
  }
}

function foreground(
  value: WindowsObservationPayload['foregroundApplication'],
): SystemContextObservation['foregroundApplication'] {
  const processName = boundedString(value?.processName, 120)
  if (!processName) return undefined
  const displayName = boundedString(value?.displayName, 160)
  const windowTitle = boundedString(value?.windowTitle, 300)
  return {
    processName,
    ...(displayName ? { displayName } : {}),
    ...(windowTitle ? { windowTitle } : {}),
  }
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : undefined
}

function boundedLoad(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : undefined
}

function credentialMinimalEnvironment(): NodeJS.ProcessEnv {
  const keys = ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'PSModulePath'] as const
  return Object.fromEntries(
    keys.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
  )
}
