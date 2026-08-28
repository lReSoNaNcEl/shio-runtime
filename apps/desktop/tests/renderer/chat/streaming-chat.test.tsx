// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

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
    quickActions: { starter: [], tools: [] },
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
  it('renders tool shortcuts separately and forwards the full prepared action', () => {
    const onQuickAction = vi.fn()
    const onOpenCapabilities = vi.fn()
    const toolAction = {
      id: 'web-search',
      label: 'Веб-поиск',
      prompt: 'Найди свежие новости с источниками.',
      effect: 'submit' as const,
    }
    const starterAction = {
      id: 'greeting',
      label: 'Поздоровайся',
      prompt: 'Поздоровайся со мной.',
      effect: 'submit' as const,
    }
    const view = render(
      <ChatMessageList
        {...props([])}
        quickActions={{ starter: [starterAction], tools: [toolAction] }}
        onQuickAction={onQuickAction}
        onOpenCapabilities={onOpenCapabilities}
      />,
      { wrapper: Wrapper },
    )

    expect(view.getByRole('group', { name: 'Быстрый старт' })).toHaveClass(
      'chat-starter-action-grid',
    )
    expect(view.getByRole('group', { name: 'Проверить инструменты' })).toHaveClass(
      'chat-tool-action-grid',
    )
    expect(view.getByRole('button', { name: 'Поздоровайся' })).toHaveClass('shio-accent-button')
    fireEvent.click(view.getByRole('button', { name: 'Веб-поиск' }))
    expect(onQuickAction).toHaveBeenCalledWith(toolAction)

    fireEvent.click(view.getByRole('button', { name: 'Все возможности' }))
    expect(onOpenCapabilities).toHaveBeenCalledOnce()
  })

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

  it('preserves history scroll through streaming deltas and resumes from Jump to latest', () => {
    const messages: ChatMsg[] = [
      { id: 'user-1', role: 'user', text: 'Вопрос' },
      { id: 'reply-1', role: 'assistant', text: 'Начало', streaming: true },
    ]
    const view = render(<ChatMessageList {...props(messages)} />, { wrapper: Wrapper })
    const list = view.container.querySelector('#chat-messages') as HTMLDivElement
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 2_000 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 400 })
    list.scrollTop = 700
    fireEvent.scroll(list)

    for (let index = 0; index < 50; index += 1) {
      view.rerender(
        <ChatMessageList
          {...props([
            messages[0],
            {
              id: 'reply-1',
              role: 'assistant',
              text: `Длинный поток ${index}`,
              streaming: true,
            },
          ])}
        />,
      )
      expect(list.scrollTop).toBe(700)
    }

    const jump = view.getByRole('button', { name: '↓ К последнему сообщению' })
    fireEvent.click(jump)
    expect(list.scrollTop).toBe(2_000)

    view.rerender(
      <ChatMessageList
        {...props([
          messages[0],
          { id: 'reply-1', role: 'assistant', text: 'Ещё delta', streaming: true },
        ])}
      />,
    )
    expect(list.scrollTop).toBe(2_000)
  })
})
