// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-spectrum/s2/style', () => ({ style: () => '' }))
const store = vi.hoisted(() => ({
  state: {
    speechCapabilities: { service: 'available' },
    continuousListening: { desired: false, transport: 'off' },
    llmReadiness: { reason: 'ready' },
    llmHealth: { state: 'ok' },
    status: 'idle',
    messages: [],
    microphoneGate: { status: 'closed' },
    overlayAnimationHudEnabled: true,
    overlayMotionProfileId: 'presence_warm',
  },
  listeners: new Set<() => void>(),
  attachCanvas: vi.fn(async () => undefined),
  subscribeOverlayUpdates: vi.fn(),
  dispose: vi.fn(),
}))
vi.mock('../../src/renderer/Controller', () => ({
  controller: {
    getState: () => store.state,
    subscribe: (listener: () => void) => {
      store.listeners.add(listener)
      return () => store.listeners.delete(listener)
    },
    attachCanvas: store.attachCanvas,
    subscribeOverlayUpdates: store.subscribeOverlayUpdates,
    dispose: store.dispose,
  },
}))

import { App } from '../../src/renderer/components/App'
import { localizedWrapper, stubWindowProperty } from '../support/rendering'

let restoreApi: () => void = () => undefined
const originalUrl = window.location.href
const originalTheme = document.documentElement.dataset.theme
const originalColorScheme = document.documentElement.style.colorScheme
afterEach(() => {
  cleanup()
  restoreApi()
  window.history.replaceState({}, '', originalUrl)
  document.documentElement.classList.remove('overlay-window')
  document.body.classList.remove('overlay-window')
  if (originalTheme === undefined) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = originalTheme
  document.documentElement.style.colorScheme = originalColorScheme
  expect(store.listeners.size).toBe(0)
})

describe('Overlay motion HUD', () => {
  it.each(['light', 'dark'] as const)(
    'renders applied motion and follows HUD visibility in the %s theme',
    async (theme) => {
      store.state = {
        ...store.state,
        overlayAnimationHudEnabled: true,
        overlayMotionProfileId: 'presence_warm',
      }
      window.history.replaceState({}, '', '/?overlay=1')
      const unsubscribe = vi.fn()
      restoreApi = stubWindowProperty('overlayApi', {
        config: { get: async () => ({ uiTheme: theme }), onUpdated: () => unsubscribe },
      })
      const view = render(<App />, { wrapper: localizedWrapper('en', theme) })
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe(theme))
      expect(screen.getByText('presence_warm')).toBeInTheDocument()
      const update = (patch: Partial<typeof store.state>) =>
        act(() => {
          store.state = { ...store.state, ...patch }
          for (const listener of store.listeners) listener()
        })
      update({ overlayMotionProfileId: 'greet_wave_soft' })
      expect(screen.queryByText('presence_warm')).not.toBeInTheDocument()
      expect(screen.getByText('greet_wave_soft')).toBeInTheDocument()
      update({ overlayMotionProfileId: '' })
      expect(screen.queryByText('greet_wave_soft')).not.toBeInTheDocument()
      update({ overlayMotionProfileId: 'presence_warm', overlayAnimationHudEnabled: false })
      expect(screen.queryByText('presence_warm')).not.toBeInTheDocument()
      expect(store.attachCanvas).toHaveBeenCalledOnce()
      expect(store.subscribeOverlayUpdates).toHaveBeenCalledOnce()
      view.unmount()
      expect(unsubscribe).toHaveBeenCalledOnce()
      expect(store.dispose).toHaveBeenCalledOnce()
    },
  )
})
