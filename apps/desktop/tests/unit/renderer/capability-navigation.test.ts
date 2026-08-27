import { describe, expect, it } from 'vitest'

import { pluginIdForNavigationTarget } from '../../../src/renderer/components/navigation/capabilityNavigation'
import { PLUGIN_IDS } from '../../../src/shared/plugins'

describe('Capability navigation', () => {
  it('retains exact canonical Plugin ids and rejects unknown ids', () => {
    for (const pluginId of PLUGIN_IDS) {
      expect(pluginIdForNavigationTarget({ kind: 'plugin', id: pluginId })).toBe(pluginId)
    }
    expect(pluginIdForNavigationTarget({ kind: 'plugin', id: 'unknown' })).toBeUndefined()
  })
})
