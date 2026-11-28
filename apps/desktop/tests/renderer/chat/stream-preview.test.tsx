// @vitest-environment jsdom

import { Provider } from '@react-spectrum/s2'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { StreamSourcePreview } from '../../../src/renderer/components/chat/StreamSourcePreview'
import { LocalizationContext } from '../../../src/renderer/localization/LocalizationProvider'
import { toIntlLocale, translate, type UiLocale } from '../../../src/shared/localization'
import type { ScreenContextSource } from '../../../src/shared/screen-context'
import { createDeferred } from '../../support/Deferred'

const source: ScreenContextSource = {
  id: 'window:1',
  name: 'Tab A',
  kind: 'window',
  previewDataUrl: 'data:image/png;base64,AAAA',
}
beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mount(locale: UiLocale, theme: 'light' | 'dark') {
  const list = vi.fn<Window['api']['screenContext']['listSources']>()
  vi.stubGlobal('api', { screenContext: { listSources: list } })
  render(
    <Provider colorScheme={theme} locale={locale}>
      <LocalizationContext.Provider
        value={{
          locale,
          intlLocale: toIntlLocale(locale),
          t: (key, params) => translate(locale, key, params),
        }}
      >
        <StreamSourcePreview />
      </LocalizationContext.Provider>
    </Provider>,
  )
  return list
}

it.each([
  ['ru', 'light'],
  ['en', 'dark'],
] as const)(
  'previews the selected window on demand in %s / %s and clears a vanished source',
  async (locale, theme) => {
    const list = mount(locale, theme)
    expect(list).not.toHaveBeenCalled()
    list.mockResolvedValueOnce({ ok: true, value: [source] })
    list.mockResolvedValueOnce({ ok: true, value: [source] })
    fireEvent.click(
      screen.getByRole('button', { name: translate(locale, 'streaming.preview.open') }),
    )
    fireEvent.click(await screen.findByRole('button', { name: /Tab A/u }))
    expect(
      await screen.findByRole('img', {
        name: translate(locale, 'streaming.preview.frame', { name: 'Tab A' }),
      }),
    ).toBeVisible()
    list.mockResolvedValueOnce({
      ok: true,
      value: [{ ...source, name: 'Tab B', previewDataUrl: 'data:image/png;base64,BBBB' }],
    })
    fireEvent.click(
      screen.getByRole('button', { name: translate(locale, 'streaming.preview.refresh') }),
    )
    expect(
      await screen.findByRole('img', {
        name: translate(locale, 'streaming.preview.frame', { name: 'Tab B' }),
      }),
    ).toHaveAttribute('src', 'data:image/png;base64,BBBB')
    list.mockResolvedValueOnce({ ok: true, value: [{ ...source, id: 'window:other' }] })
    fireEvent.click(
      screen.getByRole('button', { name: translate(locale, 'streaming.preview.refresh') }),
    )
    expect(
      await screen.findByText(translate(locale, 'screenContext.error.sourceNotFound')),
    ).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
    expect(list).toHaveBeenCalledTimes(4)
  },
)

it('ignores a late source list after closing the preview', async () => {
  const list = mount('en', 'dark')
  const late = createDeferred<Awaited<ReturnType<typeof list>>>()
  list.mockReturnValueOnce(late.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Preview a window or screen' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await act(async () => late.resolve({ ok: true, value: [source] }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('button', { name: 'Preview a window or screen' })).toBeVisible()
})
