import { Badge, Heading, StatusLight, Text } from '@react-spectrum/s2'

import { type AliveSnapshot, type GoalStatus } from '../../../../shared/alive'
import { useTranslation } from '../../../localization/useTranslation'

function goalStatusTone(status: GoalStatus): 'positive' | 'notice' | 'negative' {
  if (status === 'active' || status === 'completed') return 'positive'
  if (status === 'cancelled') return 'negative'
  return 'notice'
}

export function BetweenUsHistory({ snapshot }: { snapshot: AliveSnapshot }) {
  const { intlLocale, t } = useTranslation()
  const goals = snapshot.goals.filter(
    (goal) => goal.status === 'completed' || goal.status === 'cancelled',
  )
  const tasks = snapshot.tasks.filter((task) => task.status === 'completed')
  const entries = [
    ...goals.map((goal) => ({ type: 'goal' as const, at: goal.updatedAt, goal })),
    ...tasks.map((task) => ({ type: 'task' as const, at: task.updatedAt, task })),
  ].sort((left, right) => right.at - left.at)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfYesterday = startOfToday.getTime() - 86_400_000
  const dateFormatter = new Intl.DateTimeFormat(intlLocale, { dateStyle: 'long' })
  const groups = entries.reduce<
    Array<{ key: string; label: string; entries: (typeof entries)[number][] }>
  >((result, entry) => {
    const date = new Date(entry.at)
    date.setHours(0, 0, 0, 0)
    const day = date.getTime()
    const key = String(day)
    const label =
      day === startOfToday.getTime()
        ? t('tasks.history.today')
        : day === startOfYesterday
          ? t('tasks.history.yesterday')
          : dateFormatter.format(date)
    const current = result.at(-1)
    if (current?.key === key) current.entries.push(entry)
    else result.push({ key, label, entries: [entry] })
    return result
  }, [])

  return (
    <article className="tasks-panel">
      <div className="tasks-heading-copy">
        <Heading level={2}>{t('tasks.history.title')}</Heading>
        <Text>{t('tasks.history.description')}</Text>
      </div>
      {entries.length === 0 ? (
        <div className="tasks-empty-state">
          <Heading level={3}>{t('tasks.history.emptyTitle')}</Heading>
          <Text>{t('tasks.history.empty')}</Text>
        </div>
      ) : (
        <div className="tasks-history-groups">
          {groups.map((group) => (
            <section className="tasks-history-group" key={group.key}>
              <Heading level={3}>{group.label}</Heading>
              <div className="tasks-list">
                {group.entries.map((entry) => (
                  <article
                    className="tasks-item"
                    key={`${entry.type}-${entry.type === 'goal' ? entry.goal.id : entry.task.id}`}
                  >
                    <Text UNSAFE_className="tasks-item-title">
                      {entry.type === 'goal' ? entry.goal.title : entry.task.title}
                    </Text>
                    {entry.type === 'goal' ? (
                      <div className="tasks-goal-badges">
                        <Badge size="S" variant="gray">
                          {t(`tasks.goal.owner.${entry.goal.owner}`)}
                        </Badge>
                        <StatusLight variant={goalStatusTone(entry.goal.status)} size="S">
                          {t(`tasks.goal.status.${entry.goal.status}`)}
                        </StatusLight>
                      </div>
                    ) : (
                      <StatusLight variant="positive" size="S">
                        {t(`tasks.task.status.${entry.task.status}`)}
                      </StatusLight>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </article>
  )
}
