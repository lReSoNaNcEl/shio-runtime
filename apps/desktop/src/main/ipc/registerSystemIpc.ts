import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ipcMain } from 'electron'

export function registerSystemIpc(): void {
  ipcMain.handle('debug:write-transition-recording', (_event, payload: unknown) => {
    const dir = join(process.cwd(), 'runtime-debug', 'transitions')
    mkdirSync(dir, { recursive: true })
    const safeName = `transition-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    const filePath = join(dir, safeName)
    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
    return { ok: true, filePath }
  })
}
