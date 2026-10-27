import { describe, expect, it } from 'vitest'

import { ActionPermissionGuard } from '../../../src/main/action'
import { actionConfirmationRequestSchema } from '../../../src/shared/actions'

describe('Action Permission Guard', () => {
  it('requires destructive confirmation even in Full Control', async () => {
    let confirmations = 0
    const guard = new ActionPermissionGuard({
      authorityMode: () => 'full',
      requestConfirmation: async () => {
        confirmations += 1
        return 'confirm'
      },
    })
    const confirmation = actionConfirmationRequestSchema.parse({
      schemaVersion: 1,
      actionId: 'action-1-00000000-0000-4000-8000-000000000000',
      tool: 'desktop.workflow',
      goal: 'Delete the exact temporary file',
      shellCommand: 'Remove-Item note.txt',
      requestedCapabilities: ['shell'],
      risk: 'destructive',
    })
    await expect(guard.authorize('desktop-workflow', confirmation)).resolves.toBe('confirmed')
    expect(confirmations).toBe(1)
    await expect(
      guard.authorize('desktop-workflow', { ...confirmation, risk: 'normal' }),
    ).resolves.toBe('full')
    expect(confirmations).toBe(1)
  })
})
