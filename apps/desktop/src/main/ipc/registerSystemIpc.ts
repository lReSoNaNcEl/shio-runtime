import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, ipcMain } from 'electron'

import { mainLog } from '../logging/safeLogger'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'
import { rendererFailureReportSchema, transitionRecordingSchema } from './payloadSchemas'

export function registerSystemIpc(authorization: IpcAuthorization): void {
  ipcMain.handle(
    'system:report-renderer-failure',
    authorization.handlePayload(
      'system:report-renderer-failure',
      IPC_ONE_PAYLOAD,
      (_event, input: unknown) => {
        // Messages and stacks stay in the renderer because they can contain user data or secrets.
        const report = rendererFailureReportSchema.parse(input)
        mainLog.error('[Renderer] React Error Boundary contained a render failure', report)
        return { ok: true }
      },
    ),
  )
  ipcMain.handle(
    'system:restart-application',
    authorization.handle('system:restart-application', (event) => {
      if (process.env.NODE_ENV === 'development') {
        mainLog.info('[RendererRecovery] Development renderer reload requested')
        event.sender.reloadIgnoringCache()
        return { ok: true }
      }
      mainLog.info('[RendererRecovery] Full application restart requested')
      app.relaunch()
      setTimeout(() => app.quit(), 100)
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
