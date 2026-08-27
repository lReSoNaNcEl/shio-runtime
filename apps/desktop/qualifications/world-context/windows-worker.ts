import assert from 'node:assert/strict'

import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'

import { SYSTEM_CONTEXT_PROBES } from '../../src/main/alive/SystemContextAdapter'
import { WindowsSystemContextAdapter } from '../../src/main/alive/WindowsSystemContextAdapter'

async function qualifyWindowsWorker(): Promise<void> {
  assert.equal(process.platform, 'win32', 'World Context worker qualification requires Windows')
  const adapter = new WindowsSystemContextAdapter({
    getGlobalIdleSeconds: () => 0,
    pwshPath: resolvePwshPath(undefined, process.env, process.platform),
  })
  try {
    const first = await adapter.observe({ probes: SYSTEM_CONTEXT_PROBES })
    assert.equal(first.status, 'available', 'persistent PowerShell worker did not start')
    assert.deepEqual(first.sampledProbes, SYSTEM_CONTEXT_PROBES)
    const second = await adapter.observe({ probes: ['foreground-application'] })
    assert.equal(second.status, 'available', 'persistent PowerShell worker did not accept reuse')
    assert.deepEqual(second.sampledProbes, ['foreground-application'])
  } finally {
    adapter.dispose()
  }
  console.log('World Context Windows worker qualification: PASS')
}

void qualifyWindowsWorker().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
