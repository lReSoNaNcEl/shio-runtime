import assert from 'node:assert/strict'

import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'

import { WindowsSystemContextAdapter } from '../../src/main/alive/WindowsSystemContextAdapter'

async function qualifyWindowsWorker(): Promise<void> {
  assert.equal(process.platform, 'win32', 'World Context worker qualification requires Windows')
  const adapter = new WindowsSystemContextAdapter({
    getGlobalIdleSeconds: () => 0,
    pwshPath: resolvePwshPath(undefined, process.env, process.platform),
  })
  try {
    const first = await adapter.observe()
    assert.equal(first.status, 'available', 'persistent PowerShell worker did not start')
    assert.deepEqual(first.sampledProbes, ['foreground-application'])
    assert.equal(first.runningApplications, undefined)
    const second = await adapter.observe({ probes: ['foreground-application'] })
    assert.equal(second.status, 'available', 'persistent PowerShell worker did not accept reuse')
    assert.deepEqual(second.sampledProbes, ['foreground-application'])

    const applications = await adapter.observe({ probes: ['running-applications'] })
    assert.deepEqual(applications.sampledProbes, ['running-applications'])
    assert(Array.isArray(applications.runningApplications))
  } finally {
    adapter.dispose()
  }
  console.log('World Context Windows worker qualification: PASS')
}

void qualifyWindowsWorker().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
