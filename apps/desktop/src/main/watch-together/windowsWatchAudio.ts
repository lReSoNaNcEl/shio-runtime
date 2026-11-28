import { execFile } from 'node:child_process'
import { release } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export async function windowsWatchAudio(
  sourceId: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (process.platform !== 'win32') return
  if (sourceId.startsWith('screen:')) return 'loopback'
  const handle = /^window:(\d{1,18}):0$/u.exec(sourceId)?.[1]
  const root = process.env.SystemRoot
  if (!handle || !root || Number(release().split('.')[2]) < 20348) return

  // The handle comes from the current native enumeration. The renderer supplies no PID.
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ShioWatchWindow {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
}
'@
[uint32]$owner = 0
[void][ShioWatchWindow]::GetWindowThreadProcessId([IntPtr]::new([long]${handle}), [ref]$owner)
[Console]::WriteLine($owner)
`
  try {
    const { stdout } = await run(
      join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      {
        env: { SystemRoot: root, WINDIR: root, TEMP: process.env.TEMP, TMP: process.env.TMP },
        windowsHide: true,
        maxBuffer: 4096,
        timeout: 3500,
        signal,
      },
    )
    const pid = Number(stdout.trim())
    if (Number.isInteger(pid) && pid > 0 && pid <= 0xffffffff && pid !== process.pid)
      return `applicationLoopback:${pid}`
  } catch {
    // Keep the selected video available when application audio is unavailable.
  }
}
