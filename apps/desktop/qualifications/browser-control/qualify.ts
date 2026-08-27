import { runBrowserControlQualification } from '../../tests/support/browser/BrowserControlScenarios'

runBrowserControlQualification().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
