import { runBrowserControlQualification } from '../../tests/support/browser/scenarios/qualification'

runBrowserControlQualification().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
