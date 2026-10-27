// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TasksView } from '../../src/renderer/components/views/TasksView'
import type { AliveSnapshot, PersistentGoal } from '../../src/shared/alive'
import { translate } from '../../src/shared/localization'
import { localizedWrapper } from '../support/rendering'

const t = (key: Parameters<typeof translate>[1]) => translate('en', key)
afterEach(cleanup)

describe.each(['light', 'dark'] as const)('Tasks in %s theme', (theme) => {
  it('opens manual creation in a dialog and shows progress only for measurable goals', async () => {
    const goal: PersistentGoal = {
      id: 'goal-1',
      title: 'Measurable fixture',
      description: '',
      nextStep: '',
      lastNote: '',
      owner: 'shared',
      status: 'active',
      measurable: true,
      progress: 0.4,
      createdAt: 1,
      updatedAt: 1,
    }
    const snapshot = {
      settings: { mode: 'off', globallySuspended: false },
      goals: [goal, { ...goal, id: 'goal-2', title: 'Qualitative fixture', measurable: false }],
      goalExecutions: [],
      tasks: [],
    } as unknown as AliveSnapshot
    render(
      <TasksView snapshot={snapshot} onOpenAutonomySettings={vi.fn()} onOpenChat={vi.fn()} />,
      { wrapper: localizedWrapper('en', theme) },
    )
    const progress = screen.getAllByRole('progressbar', { name: t('tasks.goals.progress') })
    expect(progress).toHaveLength(1)
    expect(progress[0]).toHaveAttribute('aria-valuenow', '40')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('tasks.goals.manual') }))
    const dialog = await screen.findByRole('dialog', { name: t('tasks.goals.manual') })
    expect(within(dialog).getByRole('textbox', { name: t('tasks.goals.new') })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: t('common.cancel') }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
