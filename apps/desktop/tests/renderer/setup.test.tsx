// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SetupCenter } from '../../src/renderer/components/setup/SetupCenter'
import type { ControllerState } from '../../src/renderer/controller/contracts'
import { translate } from '../../src/shared/localization'
import { localizedWrapper, stubWindowProperty } from '../support/rendering'

vi.mock('@react-spectrum/s2/style', () => ({ style: () => '' }))
vi.mock('../../src/renderer/Controller', () => ({ controller: {} }))

const t = (key: Parameters<typeof translate>[1]) => translate('en', key)
let restoreApi: () => void = () => undefined
let restoreMedia: () => void = () => undefined
afterEach(() => {
  cleanup()
  restoreApi()
  restoreMedia()
})

describe.each(['light', 'dark'] as const)('Setup Center in %s theme', (theme) => {
  it('uses saved credentials, tests and releases the microphone, and exposes Plugin and Overlay actions', async () => {
    const stop = vi.fn()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }))
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, enumerateDevices: vi.fn(async () => []) },
    })
    restoreMedia = () => {
      if (original) Object.defineProperty(navigator, 'mediaDevices', original)
      else Reflect.deleteProperty(navigator, 'mediaDevices')
    }
    restoreApi = stubWindowProperty('api', {
      llm: {
        providers: vi.fn(async () => []),
        fetchModels: vi.fn(async () => ({ ok: true, models: [] })),
      },
      config: {
        get: vi.fn(async () => ({
          micDeviceId: '',
          llm: {
            activeProvider: 'groq',
            providers: { groq: { model: 'test-model', credential: { configured: true } } },
          },
        })),
      },
    })
    const onOpenPlugins = vi.fn()
    const onToggleOverlay = vi.fn(async () => undefined)
    const state = {
      llmReadiness: { providerId: 'groq', reason: 'ready' },
      vrmConfigured: true,
      overlayState: 'on',
    } as ControllerState
    render(
      <SetupCenter
        state={state}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        onOpenPlugins={onOpenPlugins}
        onToggleOverlay={onToggleOverlay}
      />,
      { wrapper: localizedWrapper('en', theme) },
    )
    expect(await screen.findByText(t('setup.ai.credentialSaved'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('setup.microphone.test') }))
    await screen.findByText(t('setup.microphone.testReady'))
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(stop).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: t('setup.plugins.open') }))
    expect(onOpenPlugins).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: t('setup.overlay.disable') }))
    await waitFor(() => expect(onToggleOverlay).toHaveBeenCalledWith(false))
    fireEvent.click(screen.getByRole('button', { name: t('setup.ai.replaceCredential') }))
    expect(screen.queryByText(t('setup.ai.credentialSaved'))).not.toBeInTheDocument()
  })
})
