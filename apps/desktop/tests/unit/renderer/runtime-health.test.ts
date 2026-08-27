import { describe, expect, it } from 'vitest'

import { aggregateHealth, pluginHealthSeverity } from '../../../src/renderer/runtime/runtimeHealth'
import type { RuntimePluginHealth } from '../../../src/shared/plugins'

describe('Runtime Health projection', () => {
  it('treats setup state as operational and ignores disabled Plugin errors', () => {
    const needsSetup = {
      enabled: true,
      lifecycle: 'active',
      health: { state: 'needs-setup', checkedAt: 1 },
    } as RuntimePluginHealth
    expect(pluginHealthSeverity(needsSetup)).toBe('healthy')
    expect(
      aggregateHealth([
        { enabled: false, severity: 'error' },
        { enabled: true, severity: 'healthy' },
      ]),
    ).toBe('healthy')
  })
})
