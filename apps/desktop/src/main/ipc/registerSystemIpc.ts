import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ipcMain } from 'electron'

import { mainLog } from '../logging/safeLogger'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'
import { transitionRecordingSchema } from './payloadSchemas'

export function registerSystemIpc(authorization: IpcAuthorization): void {
  ipcMain.handle(
    'system:report-renderer-failure',
    authorization.handle('system:report-renderer-failure', () => {
      // Do not accept renderer error text here: it can contain user data or secrets.
      mainLog.error('[Renderer] React Error Boundary contained a render failure')
      return { ok: true }
    }),
  )
  ipcMain.handle(
    'debug:write-transition-recording',
    authorization.handlePayload(
      'debug:write-transition-recording',
      IPC_ONE_PAYLOAD,
      (_event, input: unknown) => {
        const payload = transitionRecordingSchema.parse(input)
        const dir = join(process.cwd(), 'runtime-debug', 'transitions')
        mkdirSync(dir, { recursive: true })
        const safeName = `transition-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        const filePath = join(dir, safeName)
        writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
        return { ok: true, filePath }
      },
    ),
  )
}
