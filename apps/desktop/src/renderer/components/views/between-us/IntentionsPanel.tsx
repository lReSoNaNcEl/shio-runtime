import { Badge, Button, ButtonGroup, Heading, Text } from '@react-spectrum/s2'
import Chat from '@react-spectrum/s2/icons/Chat'

import { type AliveSnapshot } from '../../../../shared/alive'
import { useTranslation } from '../../../localization/useTranslation'
import { GoalCard } from './GoalCard'
import { type BetweenUsOperation, type RunBetweenUsOperation } from './operations'

export function IntentionsPanel({
  snapshot,
  operation,
  run,
  onOpenChat,
  onAddManually,
}: {
  snapshot: AliveSnapshot
  operation: BetweenUsOperation | null
  run: RunBetweenUsOperation
  onOpenChat: () => void
  onAddManually: () => void
}) {
  const { t } = useTranslation()
  const goals = snapshot.goals.filter(
    (goal) => goal.status !== 'completed' && goal.status !== 'cancelled',
  )

  return (
    <article className="tasks-panel">
      <div className="tasks-panel-heading">
        <div className="tasks-heading-copy">
          <Heading level={2}>{t('tasks.goals.title')}</Heading>
          <Text>{t('tasks.goals.description')}</Text>
        </div>
        {goals.length > 0 && (
          <Badge size="S" variant="gray">
            {t('tasks.goals.count', { count: goals.length })}
          </Badge>
        )}
      </div>

      {goals.length === 0 ? (
        <div className="tasks-empty-state">
          <Heading level={3}>{t('tasks.goals.chatFirstTitle')}</Heading>
          <Text>{t('tasks.goals.chatFirst')}</Text>
          <div className="tasks-empty-actions">
            <Button variant="primary" onPress={onOpenChat}>
              <Chat aria-hidden />
              <Text>{t('tasks.goals.openChat')}</Text>
            </Button>
            <Button variant="secondary" onPress={onAddManually}>
              {t('tasks.goals.manual')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ButtonGroup UNSAFE_className="tasks-goal-entry-actions">
            <Button variant="secondary" onPress={onOpenChat}>
              <Chat aria-hidden />
              <Text>{t('tasks.goals.openChat')}</Text>
            </Button>
            <Button variant="secondary" onPress={onAddManually}>
              {t('tasks.goals.manual')}
            </Button>
          </ButtonGroup>
          <div className="tasks-list">
            {goals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                execution={snapshot.goalExecutions.find((item) => item.goalId === goal.id)}
                globallySuspended={snapshot.settings.globallySuspended}
                operation={operation}
                run={run}
              />
            ))}
          </div>
        </>
      )}
    </article>
  )
}
