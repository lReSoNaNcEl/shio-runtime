import * as dotenv from 'dotenv'
import { app, BrowserWindow } from 'electron'

import { buildApplicationDependencies } from './app/buildApplicationDependencies'
import { initializeApplication } from './app/initializeApplication'
import { shutdownApplication } from './app/shutdownApplication'
import { initializeSafeLogging } from './logging/safeLogger'

initializeSafeLogging(app.getPath('logs'), process.env.NODE_ENV === 'development')
dotenv.config()

const dependencies = buildApplicationDependencies()

app.whenReady().then(async () => {
  await initializeApplication(dependencies)
  app.on('activate', () => {
    if (dependencies.isQuitting()) return
    if (BrowserWindow.getAllWindows().length === 0) void dependencies.createWindow()
  })
})

app.on('before-quit', () => {
  dependencies.prepareForQuit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !dependencies.isQuitting()) {
    shutdownApplication(dependencies)
  }
})
