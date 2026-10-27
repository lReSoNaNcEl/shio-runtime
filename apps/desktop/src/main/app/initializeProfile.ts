import { mkdirSync } from 'node:fs'
import { isAbsolute } from 'node:path'

import { app } from 'electron'

// Must run before persistence modules capture app.getPath('userData').
const userDataRoot = process.env.SHIO_DESKTOP_USER_DATA_ROOT?.trim()
if (userDataRoot) {
  if (!isAbsolute(userDataRoot)) throw new Error('SHIO_DESKTOP_USER_DATA_ROOT must be absolute')
  mkdirSync(userDataRoot, { recursive: true })
  app.setPath('userData', userDataRoot)
  app.setAppLogsPath()
}
