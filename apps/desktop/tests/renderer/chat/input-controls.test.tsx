// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-spectrum/s2/style', () => ({ style: () => '' }))

import type { MicrophoneGateState } from '../../../src/renderer/audio/microphoneGateTypes'
import { ChatComposer } from '../../../src/renderer/components/chat/ChatComposer'
import { ScreenContextPicker } from '../../../src/renderer/components/chat/ScreenContextPicker'
import { MicrophoneGateOverlay } from '../../../src/renderer/components/overlays/MicrophoneGateOverlay'
import { translate } from '../../../src/shared/localization'
import { localizedWrapper, stubWindowProperty } from '../../support/rendering'

let restoreApi: () => void = () => undefined
afterEach(() => {
  cleanup()
  restoreApi()
})
const t = (key: Parameters<typeof translate>[1]) => translate('en', key)

describe.each(['light', 'dark'] as const)('chat input controls in %s theme', (theme) => {
  it('exposes recording state and routes stop through the microphone control', () => {
    const props = {
      text: '',
      busy: false,
      gateOpen: false,
      listening: false,
      canInterrupt: false,
      interruptionPending: false,
      onTextChange: vi.fn(),
      onSubmit: vi.fn(),
      onAttachScreen: vi.fn(),
      onToggleMicrophone: vi.fn(),
      onInterrupt: vi.fn(),
    }
    const view = render(<ChatComposer {...props} />, { wrapper: localizedWrapper('en', theme) })
    expect(screen.getByRole('button', { name: t('chat.voiceInput') })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    view.rerender(<ChatComposer {...props} listening />)
    const stop = screen.getByRole('button', { name: t('chat.stopRecording') })
    expect(stop).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(stop)
    expect(props.onToggleMicrophone).toHaveBeenCalledOnce()
    expect(props.onInterrupt).not.toHaveBeenCalled()
  })

  it('selects one microphone and announces validation without enabling Continue', async () => {
    const state: MicrophoneGateState = {
      status: 'selecting',
      intent: { type: 'start-voice-input' },
      reason: 'not-configured',
      devices: [
        { deviceId: 'mic-a', label: 'Studio (USB)' },
        { deviceId: 'mic-b', label: 'Headset' },
      ],
      selectedDeviceId: 'mic-a',
      error: null,
    }
    const props = {
      onDeviceSelect: vi.fn(),
      onRefresh: vi.fn(),
      onContinue: vi.fn(),
      onCancel: vi.fn(),
    }
    const view = render(<MicrophoneGateOverlay state={state} {...props} />, {
      wrapper: localizedWrapper('en', theme),
    })
    const studio = await screen.findByRole('radio', { name: 'Studio' })
    expect(studio).toBeChecked()
    expect(studio).toHaveAccessibleDescription('USB')
    fireEvent.click(screen.getByRole('radio', { name: 'Headset' }))
    expect(props.onDeviceSelect).toHaveBeenCalledWith('mic-b')
    view.rerender(
      <MicrophoneGateOverlay
        state={{ ...state, status: 'validating', selectedDeviceId: 'mic-a' }}
        {...props}
      />,
    )
    expect(studio).toBeDisabled()
    expect(studio).toHaveAccessibleDescription(t('microphone.gate.checkingAccess'))
    expect(screen.getByRole('button', { name: t('common.checkingEllipsis') })).toBeDisabled()
  })

  it('shows named screen sources, enables attachment only after selection, and releases its subscription', async () => {
    const unsubscribe = vi.fn()
    const capture = vi.fn(async () => ({ ok: true, value: { captureId: 'capture-a' } }))
    const onAttach = vi.fn()
    const onDismiss = vi.fn()
    const pixel = 'data:image/png;base64,iVBORw0KGgo='
    restoreApi = stubWindowProperty('api', {
      llm: { getActiveCapabilities: async () => ({ supportsVision: true }) },
      config: { onUpdated: () => unsubscribe },
      screenContext: {
        listSources: async () => ({
          ok: true,
          value: [
            {
              id: 'screen-a',
              name: 'Editor',
              kind: 'window',
              previewDataUrl: pixel,
              appIconDataUrl: pixel,
            },
          ],
        }),
        capture,
      },
    })
    const view = render(
      <ScreenContextPicker
        isOpen
        onDismiss={onDismiss}
        onAttach={onAttach}
        onChangeModel={vi.fn()}
      />,
      { wrapper: localizedWrapper('en', theme) },
    )
    const source = await screen.findByRole('button', { name: /Editor/ })
    const attach = screen.getByRole('button', { name: t('screenContext.picker.attach') })
    expect(attach).toBeDisabled()
    expect(source.querySelectorAll('img')).toHaveLength(2)
    fireEvent.click(source)
    expect(source).toHaveAttribute('aria-pressed', 'true')
    expect(attach).toBeEnabled()
    fireEvent.click(attach)
    await waitFor(() => expect(onAttach).toHaveBeenCalledWith({ captureId: 'capture-a' }))
    expect(capture).toHaveBeenCalledWith({ sourceId: 'screen-a', operationId: expect.any(String) })
    expect(onDismiss).toHaveBeenCalledOnce()
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
