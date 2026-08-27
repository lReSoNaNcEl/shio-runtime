import { describe, it } from 'vitest'

import { runDeterministicContinuousBrowserControl } from '../support/browser/BrowserControlScenarios'

describe('Continuous Browser Control', () => {
  it('controls a dynamic canvas across reactive cycles and explicit termination modes', async () => {
    await runDeterministicContinuousBrowserControl()
  }, 120_000)
})
