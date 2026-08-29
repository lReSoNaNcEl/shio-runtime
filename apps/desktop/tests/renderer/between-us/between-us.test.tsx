// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BetweenUsOverview } from '../../../src/renderer/components/views/between-us/BetweenUsOverview'
import { IntentionsPanel } from '../../../src/renderer/components/views/between-us/IntentionsPanel'
import { LocalizationContext } from '../../../src/renderer/localization/LocalizationProvider'
import type { AliveSnapshot, PersistentGoal, ScheduledTask } from '../../../src/shared/alive'
import { translate } from '../../../src/shared/localization'

const now = new Date('2026-08-29T12:00:00+03:00').getTime()

Element.prototype.getAnimations = () => []

function goal(id: string, status: PersistentGoal['status'] = 'active'): PersistentGoal {
  return {
    id,
    title: id === 'goal-1' ? 'Подготовить новый релиз' : 'Проверить документацию',
    description: 'Сделать результат надёжным',
    nextStep: 'Проверить packaged build',
    lastNote: '',
    owner: 'shared',
    status,
    progress: 4 / 7,
    measurable: true,
    createdAt: now - 1000,
    updatedAt: now,
  }
}

function task(id: string, status: ScheduledTask['status'] = 'scheduled'): ScheduledTask {
  return {
    id,
    title: id === 'task-1' ? 'Проверить сборку' : 'Вернуться к плану',
    kind: 'reminder',
    dueAt: now + 60_000,
    status,
    nextRunAt: now + 60_000,
    createdAt: now - 1000,
    updatedAt: status === 'completed' ? now - 86_400_000 : now,
  }
}

function snapshot(
  input: {
    goals?: readonly PersistentGoal[]
    tasks?: readonly ScheduledTask[]
    mode?: AliveSnapshot['settings']['mode']
    suspended?: boolean
  } = {},
): AliveSnapshot {
  return {
    settings: {
      mode: input.mode ?? 'full',
      globallySuspended: input.suspended ?? false,
      privacyMode: false,
      quietHours: { enabled: false, startHour: 22, endHour: 8 },
      cooldownMs: 900_000,
      maxDailyInitiatives: 6,
      fastBrain: { enabled: false, timeoutMs: 1250, maxTokens: 64 },
    },
    goals: input.goals ?? [],
    tasks: input.tasks ?? [],
    goalExecutions: [],
    goalWatches: [],
    habitSuggestions: [],
    audit: [],
  } as unknown as AliveSnapshot
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

function renderOverview(value: AliveSnapshot) {
  return render(
    <BetweenUsOverview
      snapshot={value}
      onOpenAutonomySettings={() => undefined}
      onOpenChat={() => undefined}
    />,
    { wrapper: Wrapper },
  )
}

const originalApi = Object.getOwnPropertyDescriptor(window, 'api')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalApi) Object.defineProperty(window, 'api', originalApi)
  else Reflect.deleteProperty(window, 'api')
})

describe('Between Us renderer', () => {
  it('presents the conversation-first empty state without zero counters', () => {
    const view = renderOverview(snapshot())

    expect(view.getByText('Shio может проявлять инициативу')).toBeInTheDocument()
    expect(view.getByText('Пока между нами нет активных намерений.')).toBeInTheDocument()
    expect(view.getByText(/Лучше всего просто рассказать Shio/u)).toBeInTheDocument()
    expect(view.getByRole('button', { name: 'Обсудить с Shio' })).toBeInTheDocument()
    expect(view.getByRole('button', { name: '+ Добавить вручную' })).toBeInTheDocument()
    expect(view.queryByText(/0 намер/u)).not.toBeInTheDocument()
  })

  it('renders one and multiple goals while keeping busy state local to one card', () => {
    const one = snapshot({ goals: [goal('goal-1')] })
    const view = renderOverview(one)
    expect(view.getByText('Подготовить новый релиз')).toBeInTheDocument()
    expect(view.getByText('1 намерения')).toBeInTheDocument()

    view.rerender(
      <Wrapper>
        <IntentionsPanel
          snapshot={snapshot({ goals: [goal('goal-1'), goal('goal-2')] })}
          operation={{ kind: 'goal-update', id: 'goal-1' }}
          run={async () => true}
          onOpenChat={() => undefined}
          onAddManually={() => undefined}
        />
      </Wrapper>,
    )
    expect(view.getByText('Проверить документацию')).toBeInTheDocument()
    const menus = view.getAllByRole('button', { name: 'Другие действия' })
    expect(menus[0]).toBeDisabled()
    expect(menus[1]).not.toBeDisabled()
  })

  it('shows reminders, grouped unified history, and both autonomy stop states', () => {
    const value = snapshot({
      goals: [goal('goal-1', 'completed')],
      tasks: [task('task-1'), task('task-2', 'completed')],
    })
    const view = renderOverview(value)

    fireEvent.click(view.getByRole('tab', { name: 'Вернуться позже' }))
    expect(view.getByText('Проверить сборку')).toBeInTheDocument()
    expect(view.getByRole('button', { name: 'Попросить Shio в чате' })).toBeInTheDocument()

    fireEvent.click(view.getByRole('tab', { name: 'История' }))
    expect(view.getByText('Сегодня')).toBeInTheDocument()
    expect(view.getByText('Вчера')).toBeInTheDocument()
    expect(view.getByText('Подготовить новый релиз')).toBeInTheDocument()
    expect(view.getByText('Вернуться к плану')).toBeInTheDocument()

    view.rerender(
      <BetweenUsOverview
        snapshot={snapshot({ mode: 'off' })}
        onOpenAutonomySettings={() => undefined}
        onOpenChat={() => undefined}
      />,
    )
    expect(view.getByText('Инициатива Shio выключена')).toBeInTheDocument()
    view.rerender(
      <BetweenUsOverview
        snapshot={snapshot({ suspended: true })}
        onOpenAutonomySettings={() => undefined}
        onOpenChat={() => undefined}
      />,
    )
    expect(view.getByText('Инициатива Shio на паузе')).toBeInTheDocument()
  })

  it('opens both manual dialogs and surfaces a bounded operation error', async () => {
    const createGoal = vi.fn().mockRejectedValue(new Error('SAVE_FAILED'))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        alive: {
          createGoal,
          createTask: vi.fn().mockResolvedValue(undefined),
        },
      },
    })
    const view = renderOverview(snapshot())
    fireEvent.click(view.getByRole('button', { name: '+ Добавить вручную' }))
    expect(
      await view.findByRole('dialog', { name: 'Добавить намерение вручную' }),
    ).toBeInTheDocument()
    fireEvent.change(view.getByRole('textbox', { name: 'О чём договоримся' }), {
      target: { value: 'Новая договорённость' },
    })
    fireEvent.click(view.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(view.getByText('SAVE_FAILED')).toBeInTheDocument())

    fireEvent.click(view.getByRole('button', { name: 'Отмена' }))
    fireEvent.click(view.getByRole('tab', { name: 'Вернуться позже' }))
    fireEvent.click(view.getByRole('button', { name: '+ Добавить вручную' }))
    expect(
      await view.findByRole('dialog', { name: 'Добавить напоминание вручную' }),
    ).toBeInTheDocument()
  })

  it('keeps primary conversation actions available at a narrow viewport', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    window.dispatchEvent(new Event('resize'))
    const view = renderOverview(snapshot())

    expect(view.container.querySelector('.tasks-view')).toBeInTheDocument()
    expect(view.getByRole('button', { name: 'Обсудить с Shio' })).toBeVisible()
    expect(view.getByRole('button', { name: '+ Добавить вручную' })).toBeVisible()
  })
})
