import { describe, it } from 'vitest'

import { runDeterministicBrowserControl } from '../support/browser/BrowserControlScenarios'

describe('Browser Control', () => {
  it('runs the deterministic browser fixture with semantic and computer-use operations', async () => {
    await runDeterministicBrowserControl()
  }, 120_000)
})
