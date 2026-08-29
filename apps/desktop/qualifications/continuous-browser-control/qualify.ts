import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runContinuousBrowserControlQualification } from '../../tests/support/browser/scenarios/qualification'

const outputDirectory = dirname(fileURLToPath(import.meta.url))
const workerPath = resolve(outputDirectory, 'continuous-browser-reactive-worker.cjs')

runContinuousBrowserControlQualification(workerPath).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
