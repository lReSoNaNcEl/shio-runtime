// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-spectrum/s2/style', () => ({ style: () => '' }))

import { WatchSessionBar } from '../../../src/renderer/components/controls/ListeningControl'
import type { ContinuousListeningProjection } from '../../../src/renderer/speech/continuous-listening/types'
import { translate } from '../../../src/shared/localization'
import { localizedWrapper } from '../../support/rendering'

afterEach(cleanup)

describe.each(['light', 'dark'] as const)('live share in %s theme', (theme) => {
  it('distinguishes connecting, live capture and speech reconnection, with stop available throughout', async () => {
    const t = (key: Parameters<typeof translate>[1]) => translate('en', key)
    const onStop = vi.fn()
    const projection: ContinuousListeningProjection = {
      desired: true,
      transport: 'ready',
      microphoneCaptured: true,
      activity: 'idle',
    }
    const props = {
      sourceName: 'Test window',
      mountPreview: vi.fn(),
      onStop,
      projection,
      playbackGaps: 0,
      readPlaybackLevel: () => 0.1,
      readMicrophoneLevel: () => 0.5,
      microphone: 'on' as const,
      onMicrophoneChange: vi.fn(),
    }
    const view = render(<WatchSessionBar {...props} phase="connecting" />, {
      wrapper: localizedWrapper('en', theme),
    })
    expect(screen.getByText(t('watch.connecting'))).toBeVisible()
    expect(screen.queryByText(t('watch.live'))).toBeNull()
    expect(screen.queryByRole('button', { name: t('watch.preview') })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByRole('button', { name: t('common.cancel') })).toBeEnabled()
    view.rerender(
      <WatchSessionBar
        {...props}
        phase="live"
        playbackAudio="application"
        projection={{ ...projection, activity: 'hearing-speech' }}
      />,
    )
    expect(screen.getByText('Test window')).toBeVisible()
    expect(screen.getByText(t('watch.live'))).toBeVisible()
    expect(screen.getByText(t('watch.micHearing'))).toBeVisible()
    const microphoneMeter = screen.getByRole('meter', { name: t('watch.audioLevel.microphone') })
    const playbackMeter = screen.getByRole('meter', { name: t('watch.audioLevel.playback') })
    expect(microphoneMeter).toHaveAttribute('aria-valuenow', '89')
    expect(playbackMeter).toHaveAttribute('aria-valuenow', '63')
    view.rerender(<WatchSessionBar {...props} phase="live" voiceFeedback="classifying" />)
    expect(screen.getByText(t('watch.voiceFeedback.classifying'))).toBeVisible()
    view.rerender(<WatchSessionBar {...props} phase="live" voiceFeedback="aside" />)
    expect(screen.getByText(t('watch.voiceFeedback.aside'))).toBeVisible()
    expect(screen.getByRole('button', { name: t('watch.preview') })).toBeEnabled()
    view.rerender(
      <WatchSessionBar
        {...props}
        phase="live"
        projection={{ ...projection, transport: 'reconnecting' }}
        modelIssue="rateLimited"
      />,
    )
    expect(screen.getByText(t('watch.micReconnecting'))).toBeVisible()
    expect(screen.queryByRole('meter', { name: t('watch.audioLevel.microphone') })).toBeNull()
    expect(screen.queryByText(t('watch.modelIssue.rateLimited'))).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: translate('en', 'watch.warningCount', { count: 1 }) }),
    )
    expect(await screen.findByText(t('watch.modelIssue.rateLimited'))).toBeVisible()
    view.rerender(
      <WatchSessionBar {...props} phase="live" microphone="off" playbackAudio="application" />,
    )
    expect(screen.getByText(t('watch.audio.application'))).toBeVisible()
    expect(screen.queryByRole('meter', { name: t('watch.audioLevel.microphone') })).toBeNull()
    expect(screen.getByText(t('watch.micOff'))).toBeVisible()
    expect(screen.getByRole('meter', { name: t('watch.audioLevel.playback') })).toHaveAttribute(
      'aria-valuenow',
      '63',
    )
    const microphone = screen.getByRole('switch', { name: t('watch.microphoneControl') })
    expect(microphone).not.toBeChecked()
    fireEvent.click(microphone)
    expect(props.onMicrophoneChange).toHaveBeenLastCalledWith(true)
    view.rerender(<WatchSessionBar {...props} phase="live" microphone="starting" />)
    expect(screen.getByText(t('watch.audio.unavailable'))).toBeVisible()
    expect(screen.queryByRole('meter', { name: t('watch.audioLevel.playback') })).toBeNull()
    expect(microphone).toBeChecked()
    expect(screen.getByText(t('watch.micStarting'))).toBeVisible()
    fireEvent.click(microphone)
    expect(props.onMicrophoneChange).toHaveBeenLastCalledWith(false)
    view.rerender(<WatchSessionBar {...props} phase="live" microphone="stopping" />)
    expect(microphone).toBeDisabled()
    view.rerender(<WatchSessionBar {...props} phase="live" microphone="failed" />)
    expect(microphone).toBeEnabled()
    expect(microphone).not.toBeChecked()
    expect(screen.getByText(t('watch.micUnavailable'))).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: t('watch.stop') }))
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('groups audio gaps and leaves preview available when the microphone is off', async () => {
    const mountPreview = vi.fn()
    const props = {
      phase: 'live' as const,
      sourceName: 'Общее окно',
      mountPreview,
      onStop: vi.fn(),
      onMicrophoneChange: vi.fn(),
      microphone: 'on' as const,
      readMicrophoneLevel: () => 0,
      readPlaybackLevel: () => 0,
      projection: {
        desired: true,
        transport: 'ready',
        microphoneCaptured: true,
        activity: 'idle',
        audioGapCount: 3,
      } satisfies ContinuousListeningProjection,
      playbackGaps: 2,
      playbackAudio: 'application' as const,
    }
    const view = render(<WatchSessionBar {...props} />, {
      wrapper: localizedWrapper('ru', theme),
    })
    const playbackWarning = translate('ru', 'watch.playbackGaps', { count: 2 })
    const microphoneWarning = translate('ru', 'watch.microphoneGaps', { count: 3 })
    expect(screen.queryByText(playbackWarning)).toBeNull()
    expect(screen.queryByText(microphoneWarning)).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: translate('ru', 'watch.warningCount', { count: 2 }) }),
    )
    expect(await screen.findByText(playbackWarning)).toBeVisible()
    expect(screen.getByText(microphoneWarning)).toBeVisible()

    view.rerender(<WatchSessionBar {...props} playbackGaps={0} microphone="off" />)
    expect(screen.queryByText(microphoneWarning)).toBeNull()
    expect(
      screen.getByRole('switch', { name: translate('ru', 'watch.microphoneControl') }),
    ).not.toBeChecked()
    expect(screen.queryByRole('button', { name: /Предупреждения/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: translate('ru', 'watch.preview') }))
    const video = await screen.findByLabelText(translate('ru', 'watch.liveFrame'))
    expect(mountPreview).toHaveBeenCalledWith(video)
  })
})
