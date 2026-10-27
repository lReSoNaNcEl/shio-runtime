import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { IpcAuthorization } from '../../src/main/ipc/IpcAuthorization'

describe('IPC caller and argument contract', () => {
  function assertSenderBoundaries(): void {
    const authorization = new IpcAuthorization({ main: () => 11, overlay: () => 22 })
    assert.throws(
      () => authorization.assert({ sender: { id: 22 } } as never, 'llm:save-credential'),
      /not authorized/,
      'Overlay reached privileged credential IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 999 } } as never, 'config:get'),
      /not authorized/,
      'Unknown sender reached Main IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 22 } } as never, 'plugins:enable'),
      /not authorized/,
      'Overlay reached Plugin Runtime IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 22 } } as never, 'project-awareness:get-config'),
      /not authorized/,
      'Overlay reached Project Awareness configuration IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 999 } } as never, 'plugins:list'),
      /not authorized/,
      'Unknown sender reached Plugin Runtime IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 22 } } as never, 'capabilities:snapshot'),
      /not authorized/,
      'Overlay reached capability catalog IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 22 } } as never, 'system:open-external-link'),
      /not authorized/,
      'Overlay reached external navigation IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 22 } } as never, 'desktop-control:start-runtime'),
      /not authorized/,
      'Overlay reached Desktop Control IPC',
    )
    for (const channel of ['actions:request-authority-mode', 'actions:emergency-stop'] as const) {
      assert.throws(
        () => authorization.assert({ sender: { id: 22 } } as never, channel),
        /not authorized/,
        `Overlay reached Action Runtime IPC: ${channel}`,
      )
    }
    assert.equal(authorization.assert({ sender: { id: 11 } } as never, 'plugins:list'), 'main')
    assert.equal(
      authorization.assert({ sender: { id: 11 } } as never, 'capabilities:snapshot'),
      'main',
    )
    assert.equal(
      authorization.assert({ sender: { id: 22 } } as never, 'avatar-state:get'),
      'overlay',
    )
    const noPayloadHandler = authorization.handle('config:get', () => ({ ok: true }))
    assert.throws(() => noPayloadHandler({ sender: { id: 11 } } as never, { injected: true }))
  }

  it(
    'rejects unknown senders, privileged Overlay calls and extra arguments',
    assertSenderBoundaries,
  )
})
