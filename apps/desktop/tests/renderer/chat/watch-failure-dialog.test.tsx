// @vitest-environment jsdom

import { Provider } from '@react-spectrum/s2'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { WatchFailureDialog } from '../../../src/renderer/components/chat/WatchFailureDialog'
import { LocalizationContext } from '../../../src/renderer/localization/LocalizationProvider'
import type { WatchFailure } from '../../../src/renderer/runtime/WatchTogetherCapture'
import { translate } from '../../../src/shared/localization'

const originalApi = Object.getOwnPropertyDescriptor(window, 'api')
afterEach(() => {
  cleanup()
  if (originalApi) Object.defineProperty(window, 'api', originalApi)
  else Reflect.deleteProperty(window, 'api')
})

function Host({ initial, choose }: { initial: WatchFailure; choose: () => void }) {
  const [failure, setFailure] = useState<WatchFailure | undefined>(initial)
  return <WatchFailureDialog failure={failure} onChange={setFailure} onChooseSource={choose} />
}

function show(initial: WatchFailure, locale: 'ru' | 'en', theme: 'dark' | 'light') {
  const resolveSharingBlock = vi.fn()
  const choose = vi.fn()
  const intlLocale = locale === 'ru' ? 'ru-RU' : 'en-US'
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { alive: { resolveSharingBlock } },
  })
  render(
    <Provider colorScheme={theme} locale={intlLocale}>
      <LocalizationContext.Provider
        value={{ locale, intlLocale, t: (key, params) => translate(locale, key, params) }}
      >
        <Host initial={initial} choose={choose} />
      </LocalizationContext.Provider>
    </Provider>,
  )
  return { resolveSharingBlock, choose }
}

it.each([
  ['ru', 'dark'],
  ['en', 'light'],
] as const)(
  'dismisses the privacy explanation without changing the profile in %s / %s',
  async (locale, theme) => {
    const { resolveSharingBlock, choose } = show('watch.blocked.private', locale, theme)
    fireEvent.click(await screen.findByRole('button', { name: translate(locale, 'common.close') }))
    expect(resolveSharingBlock).not.toHaveBeenCalled()
    expect(choose).not.toHaveBeenCalled()
  },
)

it('waits for each confirmation and opens the source picker only after success', async () => {
  const { resolveSharingBlock, choose } = show('watch.blocked.suspended', 'ru', 'light')
  resolveSharingBlock
    .mockRejectedValueOnce(new Error())
    .mockResolvedValueOnce('private')
    .mockResolvedValueOnce(null)
  const resume = await screen.findByRole('button', {
    name: translate('ru', 'watch.resolveBlock.suspended'),
  })
  fireEvent.click(resume)
  await screen.findByRole('alert')
  expect(choose).not.toHaveBeenCalled()
  fireEvent.click(resume)
  const allow = await screen.findByRole('button', {
    name: translate('ru', 'watch.resolveBlock.private'),
  })
  expect(choose).not.toHaveBeenCalled()
  fireEvent.click(allow)
  await waitFor(() => expect(choose).toHaveBeenCalledOnce())
  expect(resolveSharingBlock.mock.calls).toEqual([['suspended'], ['suspended'], ['private']])
})
