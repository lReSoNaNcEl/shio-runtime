import * as dotenv from 'dotenv'
import { app, BrowserWindow } from 'electron'

import { buildApplicationDependencies } from './app/buildApplicationDependencies'
import { initializeApplication } from './app/initializeApplication'
import { shutdownApplication } from './app/shutdownApplication'
import { initializeSafeLogging } from './logging/safeLogger'
import { observeMainPromise } from './reliability/observePromise'

initializeSafeLogging(app.getPath('logs'), process.env.NODE_ENV === 'development')
dotenv.config()

const dependencies = buildApplicationDependencies()

observeMainPromise(
  app.whenReady().then(async () => {
    await initializeApplication(dependencies)
    app.on('activate', () => {
      if (dependencies.isQuitting()) return
      if (BrowserWindow.getAllWindows().length === 0) {
        observeMainPromise(dependencies.createWindow(), 'recreate main window')
      }
    })
  }),
  'initialize application',
  () => app.exit(1),
)

app.on('before-quit', () => {
  dependencies.prepareForQuit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !dependencies.isQuitting()) {
    shutdownApplication(dependencies)
  }
})
