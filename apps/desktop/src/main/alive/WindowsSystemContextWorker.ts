import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

import type { SystemContextProbe } from './SystemContextAdapter'

const WORKER_REQUEST_TIMEOUT_MS = 4_000
const MAX_WORKER_LINE_BYTES = 256 * 1_024

const WINDOWS_CONTEXT_WORKER_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ShioForegroundWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

function Get-ShioDisplayName($process) {
  try { return [string]$process.MainModule.FileVersionInfo.FileDescription }
  catch { return '' }
}

function Get-ShioForegroundApplication {
  $handle = [ShioForegroundWindow]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) { return $null }
  [uint32]$processId = 0
  [void][ShioForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
  if ($processId -le 0) { return $null }
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  return [ordered]@{
    processName = [string]$process.ProcessName
    displayName = Get-ShioDisplayName $process
    windowTitle = [string]$process.MainWindowTitle
  }
}

function Get-ShioRunningApplications {
  return @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object ProcessName -Unique | Select-Object -First 20 | ForEach-Object {
      [ordered]@{
        processName = [string]$_.ProcessName
        displayName = Get-ShioDisplayName $_
      }
    })
}

function Get-ShioSystemLoad {
  $os = Get-CimInstance Win32_OperatingSystem
  $processor = Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average
  $memoryLoad = if ($os.TotalVisibleMemorySize -gt 0) {
    [math]::Round((1 - ($os.FreePhysicalMemory / $os.TotalVisibleMemorySize)) * 100, 1)
  } else { $null }
  return [ordered]@{
    cpuLoad = if ($null -ne $processor.Average) { [math]::Round($processor.Average, 1) } else { $null }
    memoryLoad = $memoryLoad
  }
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
  $response = $null
  try {
    if ($line.Length -gt 4096) { throw 'REQUEST_TOO_LARGE' }
    $request = $line | ConvertFrom-Json
    if ($null -eq $request.id) { throw 'INVALID_REQUEST_ID' }
    $sources = @($request.probes)
    foreach ($source in $sources) {
      if ($source -notin @('foreground-application', 'running-applications', 'system-load')) {
        throw 'INVALID_PROBE'
      }
    }
    $payload = [ordered]@{}
    if ($sources -contains 'foreground-application') {
      $payload.foregroundApplication = Get-ShioForegroundApplication
    }
    if ($sources -contains 'running-applications') {
      $payload.runningApplications = @(Get-ShioRunningApplications)
    }
    if ($sources -contains 'system-load') {
      $payload.system = Get-ShioSystemLoad
    }
    $response = [ordered]@{ id = [int]$request.id; ok = $true; payload = $payload }
  } catch {
    $response = [ordered]@{ id = [int]$request.id; ok = $false; code = [string]$_.Exception.Message }
  }
  [Console]::Out.WriteLine(($response | ConvertTo-Json -Depth 6 -Compress))
  [Console]::Out.Flush()
}
`

export interface WindowsSystemContextWorkerClient {
  request(probes: readonly SystemContextProbe[]): Promise<unknown>
  dispose(): void
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export class WindowsSystemContextWorker implements WindowsSystemContextWorkerClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly pending = new Map<number, PendingRequest>()
  private decoder = new StringDecoder('utf8')
  private stdoutBuffer = ''
  private nextRequestId = 1
  private disposed = false

  constructor(private readonly pwshPath: string) {}

  request(probes: readonly SystemContextProbe[]): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('SYSTEM_CONTEXT_WORKER_DISPOSED'))
    const child = this.ensureChild()
    const id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('SYSTEM_CONTEXT_WORKER_TIMEOUT'))
        this.failChild(child, new Error('SYSTEM_CONTEXT_WORKER_TIMEOUT'))
      }, WORKER_REQUEST_TIMEOUT_MS)
      timer.unref()
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, probes })}\n`, 'utf8', (error) => {
        if (!error) return
        this.rejectRequest(id, new Error('SYSTEM_CONTEXT_WORKER_WRITE_FAILED'))
        this.failChild(child, error)
      })
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const child = this.child
    this.child = null
    this.rejectAll(new Error('SYSTEM_CONTEXT_WORKER_DISPOSED'))
    if (child) {
      child.stdin.end()
      if (!child.killed) child.kill()
    }
    this.resetDecoder()
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    const child = spawn(
      this.pwshPath,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_CONTEXT_WORKER_SCRIPT],
      {
        windowsHide: true,
        stdio: 'pipe',
        env: credentialMinimalEnvironment(),
      },
    )
    this.child = child
    child.stdout.on('data', (chunk: Buffer) => this.handleStdout(child, chunk))
    child.stderr.on('data', () => undefined)
    child.stdin.on('error', (error) => this.failChild(child, error))
    child.once('error', (error) => this.failChild(child, error))
    child.once('exit', () => this.failChild(child, new Error('SYSTEM_CONTEXT_WORKER_EXITED')))
    return child
  }

  private handleStdout(child: ChildProcessWithoutNullStreams, chunk: Buffer): void {
    if (this.child !== child) return
    this.stdoutBuffer += this.decoder.write(chunk)
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > MAX_WORKER_LINE_BYTES) {
      this.failChild(child, new Error('SYSTEM_CONTEXT_WORKER_RESPONSE_TOO_LARGE'))
      return
    }
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/u, '')
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line) this.handleLine(child, line)
      if (this.child !== child) return
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  private handleLine(child: ChildProcessWithoutNullStreams, line: string): void {
    try {
      const response = JSON.parse(line) as {
        id?: unknown
        ok?: unknown
        payload?: unknown
        code?: unknown
      }
      if (!Number.isInteger(response.id)) throw new Error('SYSTEM_CONTEXT_WORKER_INVALID_ID')
      const id = Number(response.id)
      const pending = this.pending.get(id)
      if (!pending) throw new Error('SYSTEM_CONTEXT_WORKER_UNKNOWN_ID')
      this.pending.delete(id)
      clearTimeout(pending.timer)
      if (response.ok !== true) {
        const code = typeof response.code === 'string' ? response.code.slice(0, 120) : 'FAILED'
        pending.reject(new Error(`SYSTEM_CONTEXT_WORKER_${code}`))
        return
      }
      pending.resolve(response.payload)
    } catch (error) {
      this.failChild(
        child,
        error instanceof Error ? error : new Error('SYSTEM_CONTEXT_WORKER_INVALID_RESPONSE'),
      )
    }
  }

  private rejectRequest(id: number, error: Error): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    pending.reject(error)
  }

  private failChild(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return
    this.child = null
    if (!child.killed) child.kill()
    this.rejectAll(error)
    this.resetDecoder()
  }

  private rejectAll(error: Error): void {
    for (const [id] of this.pending) this.rejectRequest(id, error)
  }

  private resetDecoder(): void {
    this.decoder = new StringDecoder('utf8')
    this.stdoutBuffer = ''
  }
}

function credentialMinimalEnvironment(): NodeJS.ProcessEnv {
  const keys = ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'PSModulePath'] as const
  return Object.fromEntries(
    keys.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
  )
}
