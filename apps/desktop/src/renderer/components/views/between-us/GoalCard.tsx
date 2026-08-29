import {
  ActionButton,
  Badge,
  Menu,
  MenuItem,
  MenuTrigger,
  ProgressBar,
  StatusLight,
  Text,
} from '@react-spectrum/s2'
import More from '@react-spectrum/s2/icons/More'

import {
  type GoalExecutionState,
  type GoalStatus,
  type PersistentGoal,
} from '../../../../shared/alive'
import { useTranslation } from '../../../localization/useTranslation'
import { type BetweenUsOperation, type RunBetweenUsOperation } from './operations'

function goalStatusTone(status: GoalStatus): 'positive' | 'notice' | 'negative' {
  if (status === 'active' || status === 'completed') return 'positive'
  if (status === 'cancelled') return 'negative'
  return 'notice'
}

export function GoalCard({
  goal,
  execution,
  globallySuspended,
  operation,
  run,
}: {
  goal: PersistentGoal
  execution?: GoalExecutionState
  globallySuspended: boolean
  operation: BetweenUsOperation | null
  run: RunBetweenUsOperation
}) {
  const { t } = useTranslation()
  const busy = operation?.kind === 'goal-update' && operation.id === goal.id
  const completedSteps = execution?.completedSteps.length ?? 0
  const plannedSteps = execution?.plannedSteps.length ?? 0
  const executionPercent = plannedSteps > 0 ? Math.round((completedSteps / plannedSteps) * 100) : 0
  const update = (status: GoalStatus): Promise<boolean> =>
    run({ kind: 'goal-update', id: goal.id }, () =>
      window.api.alive.updateGoal({ id: goal.id, status }),
    )

  return (
    <article className="tasks-item tasks-goal-card">
      <div className="tasks-item-main">
        <div className="tasks-item-heading">
          <Text UNSAFE_className="tasks-item-title">{goal.title}</Text>
          <div className="tasks-goal-badges">
            <Badge size="S" variant="gray">
              {t(`tasks.goal.owner.${goal.owner}`)}
            </Badge>
            <StatusLight variant={goalStatusTone(goal.status)} size="S">
              {t(`tasks.goal.status.${goal.status}`)}
            </StatusLight>
          </div>
        </div>
        {goal.description && (
          <div className="tasks-goal-context">
            <Text UNSAFE_className="tasks-context-label">{t('tasks.goals.why')}</Text>
            <Text>{goal.description}</Text>
          </div>
        )}
        {goal.nextStep && (
          <div className="tasks-goal-context">
            <Text UNSAFE_className="tasks-context-label">{t('tasks.goals.nextStep')}</Text>
            <Text>{goal.nextStep}</Text>
          </div>
        )}
        {goal.lastNote && (
          <div className="tasks-goal-context">
            <Text UNSAFE_className="tasks-context-label">{t('tasks.goals.lastNote')}</Text>
            <Text>{goal.lastNote}</Text>
          </div>
        )}
        {execution && (
          <div className="tasks-goal-execution">
            <StatusLight
              variant={
                execution.phase === 'completed'
                  ? 'positive'
                  : execution.phase === 'failed'
                    ? 'negative'
                    : execution.phase === 'paused'
                      ? 'notice'
                      : 'informative'
              }
              size="S"
            >
              {t(`tasks.execution.phase.${execution.phase}`)}
            </StatusLight>
            {execution.currentStep && (
              <div className="tasks-goal-context">
                <Text UNSAFE_className="tasks-context-label">
                  {t('tasks.execution.currentStep')}
                </Text>
                <Text>{execution.currentStep}</Text>
              </div>
            )}
            {plannedSteps > 0 && (
              <ProgressBar
                label={t('tasks.execution.steps', {
                  completed: completedSteps,
                  total: plannedSteps,
                })}
                value={executionPercent}
                minValue={0}
                maxValue={100}
              />
            )}
          </div>
        )}
        {!execution && goal.measurable && (
          <ProgressBar
            label={t('tasks.goals.progress')}
            value={Math.round(goal.progress * 100)}
            minValue={0}
            maxValue={100}
          />
        )}
      </div>
      <div className="tasks-goal-actions">
        <MenuTrigger>
          <ActionButton aria-label={t('tasks.moreActions')} isDisabled={busy}>
            <More />
          </ActionButton>
          <Menu
            aria-label={t('tasks.moreActions')}
            onAction={(key) => void update(String(key) as GoalStatus)}
          >
            {goal.status === 'paused' ? (
              <MenuItem id="active" isDisabled={globallySuspended}>
                {t('tasks.resume')}
              </MenuItem>
            ) : (
              <MenuItem id="paused">{t('tasks.pause')}</MenuItem>
            )}
            <MenuItem id="cancelled">{t('tasks.stop')}</MenuItem>
            <MenuItem id="completed">{t('tasks.complete')}</MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
    </article>
  )
}
