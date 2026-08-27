// @vitest-environment jsdom

import { render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import type { ChatMsg } from '../../../src/renderer/Controller'
import { ChatMessageList } from '../../../src/renderer/components/chat/ChatMessageList'
import { LocalizationContext } from '../../../src/renderer/localization/LocalizationProvider'
import { translate } from '../../../src/shared/localization'

const listening = {
  desired: false,
  transport: 'off' as const,
  activity: 'idle' as const,
  microphoneCaptured: false,
}

function props(messages: ChatMsg[]) {
  return {
    messages,
    status: 'thinking' as const,
    quickActions: [],
    onQuickAction: () => undefined,
    continuousListening: listening,
  }
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <LocalizationContext.Provider
      value={{
        locale: 'ru',
        intlLocale: 'ru-RU',
        t: (key, params) => translate('ru', key, params),
      }}
    >
      {children}
    </LocalizationContext.Provider>
  )
}

describe('streaming assistant chat bubble', () => {
  it('appears on first text, updates one bubble, and settles on completion', () => {
    const view = render(
      <ChatMessageList {...props([{ id: 'user-1', role: 'user', text: 'Вопрос' }])} />,
      { wrapper: Wrapper },
    )
    expect(view.container.querySelector('.message-assistant')).toBeNull()

    view.rerender(
      <ChatMessageList
        {...props([{ id: 'reply-1', role: 'assistant', text: 'Первый', streaming: true }])}
      />,
    )
    let bubble = view.container.querySelector('.message-assistant')
    expect(bubble).toHaveAttribute('aria-busy', 'true')
    expect(bubble).toHaveTextContent('Первый')

    view.rerender(
      <ChatMessageList
        {...props([{ id: 'reply-1', role: 'assistant', text: 'Первый второй', streaming: true }])}
      />,
    )
    expect(view.container.querySelectorAll('.message-assistant')).toHaveLength(1)
    expect(view.container.querySelector('.message-assistant')).toHaveTextContent('Первый второй')

    view.rerender(
      <ChatMessageList
        {...props([
          { id: 'reply-1', role: 'assistant', text: 'Точный финальный текст.', streaming: false },
        ])}
      />,
    )
    bubble = view.container.querySelector('.message-assistant')
    expect(bubble).not.toHaveAttribute('aria-busy')
    expect(bubble).toHaveTextContent('Точный финальный текст.')
  })

  it('keeps interrupted partial text visible and terminal', () => {
    const view = render(
      <ChatMessageList
        {...props([
          {
            id: 'reply-1',
            role: 'assistant',
            text: 'Сохранённый partial',
            streaming: false,
            interrupted: true,
          },
        ])}
      />,
      { wrapper: Wrapper },
    )
    const bubble = view.container.querySelector('.message-assistant')
    expect(bubble).toHaveTextContent('Сохранённый partial')
    expect(bubble).not.toHaveAttribute('aria-busy')
    expect(bubble?.querySelector('.msg-interrupted')).not.toBeNull()
  })
})
