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
  it('distinguishes connecting, active capture and speech reconnection, with stop available throughout', () => {
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
    }
    const view = render(<WatchSessionBar {...props} phase="connecting" />, {
      wrapper: localizedWrapper('en', theme),
    })
    expect(screen.getByText(t('watch.connecting'))).toBeVisible()
    expect(screen.queryByText(t('watch.live'))).toBeNull()
    expect(screen.queryByRole('button', { name: t('watch.preview') })).toBeNull()
    expect(screen.getByRole('button', { name: t('common.cancel') })).toBeEnabled()
    view.rerender(
      <WatchSessionBar
        {...props}
        phase="live"
        projection={{ ...projection, activity: 'hearing-speech' }}
      />,
    )
    expect(screen.getByText('Test window')).toBeVisible()
    expect(screen.getByText(t('watch.live'))).toBeVisible()
    expect(screen.getByText(t('watch.micHearing'))).toBeVisible()
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
    expect(screen.getByText(t('watch.modelIssue.rateLimited'))).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: t('watch.stop') }))
    expect(onStop).toHaveBeenCalledOnce()
  })
})
