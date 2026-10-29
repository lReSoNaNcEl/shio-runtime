import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, BrowserWindow } from 'electron'

import { initializeSafeLogging, mainLog } from '../../src/main/logging/safeLogger'

// The parent installs a file-only, fail-closed exception observer before loading
// this fixture. No default Electron exception dialog can interrupt the desktop.
const root = process.env.SHIO_EPIPE_ROOT
if (!root) throw new Error('Missing owned fixture directory')
const pipeErrors: string[] = []
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => pipeErrors.push(error.code ?? 'UNKNOWN'))
}
mkdirSync(join(root, 'logs'), { recursive: true })
app.disableHardwareAcceleration()
app.setPath('userData', join(root, 'profile'))
initializeSafeLogging(join(root, 'logs'), false)

void app.whenReady().then(() => {
  writeFileSync(join(root, 'ready.json'), JSON.stringify({ ready: true }))
  const timer = setInterval(() => {
    if (!existsSync(join(root, 'closed-pipes.signal'))) return
    clearInterval(timer)
    process.stdout.write('intentional closed stdout\n')
    process.stderr.write('intentional closed stderr\n')
    console.log('guarded console after closed stdout')
    console.error('guarded console after closed stderr')
    mainLog.info('EPIPE_FIXTURE_FILE_LOG_ALIVE')
    setTimeout(() => {
      writeFileSync(
        join(root, 'result.json'),
        JSON.stringify({
          completed: true,
          pipeErrors,
          browserWindows: BrowserWindow.getAllWindows().length,
        }),
      )
      app.quit()
    }, 300)
  }, 25)
})
