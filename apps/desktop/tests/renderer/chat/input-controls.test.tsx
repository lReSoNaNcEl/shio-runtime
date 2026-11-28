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
import { createDeferred } from '../../support/Deferred'
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

    view.rerender(<ChatComposer {...props} sharing text="What is on screen?" />)
    expect(screen.getByPlaceholderText(t('chat.sharePlaceholder'))).toBeVisible()
    expect(screen.queryByRole('button', { name: t('screenContext.attach.action') })).toBeNull()
    expect(screen.queryByRole('button', { name: t('chat.voiceInput') })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: t('chat.send') }))
    expect(props.onSubmit).toHaveBeenCalledOnce()
    view.rerender(<ChatComposer {...props} sharing canInterrupt />)
    fireEvent.click(screen.getByRole('button', { name: t('chat.stopResponse') }))
    expect(props.onInterrupt).toHaveBeenCalledOnce()
    view.rerender(<ChatComposer {...props} sharing listening />)
    expect(screen.getByRole('button', { name: t('chat.stopRecording') })).toBeEnabled()
    view.rerender(<ChatComposer {...props} />)
    expect(screen.getByRole('button', { name: t('screenContext.attach.action') })).toBeEnabled()
    expect(screen.getByRole('button', { name: t('chat.voiceInput') })).toBeEnabled()
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

  it('refreshes the empty source list after a window becomes available', async () => {
    const listSources = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'NO_SOURCES' } })
      .mockResolvedValueOnce({
        ok: true,
        value: [{ id: 'window:1:0', name: 'Editor', kind: 'window' }],
      })
    restoreApi = stubWindowProperty('api', {
      llm: { getActiveCapabilities: async () => ({ supportsVision: true }) },
      watchTogether: { prepareModel: async () => true },
      config: { onUpdated: () => () => undefined },
      screenContext: { listSources },
    })
    render(
      <ScreenContextPicker isOpen onDismiss={vi.fn()} onChangeModel={vi.fn()} onWatch={vi.fn()} />,
      { wrapper: localizedWrapper('en', theme) },
    )
    expect(await screen.findByText(t('screenContext.picker.noSources'))).toBeVisible()
    expect(screen.getByRole('button', { name: t('watch.start') })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: t('screenContext.picker.refresh') }))
    expect(await screen.findByRole('button', { name: /Editor/ })).toBeVisible()
    expect(screen.queryByText(t('screenContext.picker.noSources'))).toBeNull()
  })

  it('selects a source first and keeps an optional reference scoped to the chosen share', async () => {
    restoreApi = stubWindowProperty('api', {
      llm: { getActiveCapabilities: async () => ({ supportsVision: true }) },
      watchTogether: { prepareModel: async () => true },
      config: { onUpdated: () => () => undefined },
      screenContext: {
        checkSource: async () => ({ ok: true, value: true }),
        listSources: async () => ({
          ok: true,
          value: [
            {
              id: 'window:1:0',
              name: 'Editor',
              kind: 'window',
              previewDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            },
          ],
        }),
      },
    })
    const onWatch = vi.fn()
    render(
      <ScreenContextPicker
        isOpen
        referenceAvailable
        onWatch={onWatch}
        onDismiss={vi.fn()}
        onChangeModel={vi.fn()}
      />,
      { wrapper: localizedWrapper('en', theme) },
    )
    const source = await screen.findByRole('button', { name: /Editor/ })
    const start = screen.getByRole('button', { name: t('watch.start') })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(start).toBeDisabled()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(source)
    expect(start).toBeDisabled()
    await waitFor(() => expect(start).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: t('watch.reference.group') }))
    const field = screen.getByRole('textbox', { name: t('watch.reference.label') })
    fireEvent.change(field, { target: { value: 'http://example.com/' } })
    expect(start).toBeDisabled()
    const url = 'https://example.com/ref?q=1#notes'
    fireEvent.change(field, { target: { value: url } })
    const disclosure = screen.getByRole('button', { name: /Reference link · example.com/ })
    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(start).toBeEnabled()
    fireEvent.click(start)
    await waitFor(() => expect(onWatch).toHaveBeenCalledWith('window:1:0', 'Editor', url))
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
        checkSource: async () => ({ ok: true, value: true }),
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
    await waitFor(() => expect(attach).toBeEnabled())
    fireEvent.click(attach)
    await waitFor(() => expect(onAttach).toHaveBeenCalledWith({ captureId: 'capture-a' }))
    expect(capture).toHaveBeenCalledWith({ sourceId: 'screen-a', operationId: expect.any(String) })
    expect(onDismiss).toHaveBeenCalledOnce()
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('offers a window without a thumbnail and keeps the picker open when that window closes', async () => {
    const check = createDeferred<{ ok: false; error: { code: 'SOURCE_NOT_FOUND' } }>()
    const checkSource = vi.fn(() => check.promise)
    const icon = 'data:image/png;base64,iVBORw0KGgo='
    restoreApi = stubWindowProperty('api', {
      llm: { getActiveCapabilities: async () => ({ supportsVision: true }) },
      watchTogether: { prepareModel: async () => true },
      config: { onUpdated: () => () => undefined },
      screenContext: {
        checkSource,
        listSources: async () => ({
          ok: true,
          value: [{ id: 'window:1:0', name: 'Editor', kind: 'window', appIconDataUrl: icon }],
        }),
      },
    })
    const onWatch = vi.fn()
    render(
      <ScreenContextPicker isOpen onWatch={onWatch} onDismiss={vi.fn()} onChangeModel={vi.fn()} />,
      { wrapper: localizedWrapper('en', theme) },
    )
    const source = await screen.findByRole('button', { name: /Editor/ })
    expect(source.querySelector('img')).toHaveAttribute('src', icon)
    fireEvent.click(source)
    expect(checkSource).toHaveBeenCalledWith('window:1:0')
    expect(screen.getByText(t('screenContext.picker.checkingSource'))).toBeVisible()
    expect(screen.getByRole('button', { name: t('watch.start') })).toBeDisabled()
    check.resolve({ ok: false, error: { code: 'SOURCE_NOT_FOUND' } })
    expect(await screen.findByText(t('screenContext.error.sourceNotFound'))).toBeVisible()
    expect(screen.queryByRole('button', { name: /Editor/ })).toBeNull()
    expect(screen.getByRole('button', { name: t('screenContext.picker.refresh') })).toBeEnabled()
    expect(onWatch).not.toHaveBeenCalled()
  })
})
