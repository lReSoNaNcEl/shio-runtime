import {
  Button,
  Content,
  Heading,
  InlineAlert,
  StatusLight,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
} from '@react-spectrum/s2'
import { useState } from 'react'

import { type AliveSnapshot } from '../../../../shared/alive'
import { useTranslation } from '../../../localization/useTranslation'
import { BetweenUsHistory } from './BetweenUsHistory'
import { IntentionsPanel } from './IntentionsPanel'
import { ManualGoalDialog } from './ManualGoalDialog'
import { ManualReminderDialog } from './ManualReminderDialog'
import { type BetweenUsOperation, type RunBetweenUsOperation } from './operations'
import { RemindersPanel } from './RemindersPanel'

type BetweenUsTab = 'goals' | 'schedule' | 'history'

export function BetweenUsOverview({
  snapshot,
  onOpenAutonomySettings,
  onOpenChat,
}: {
  snapshot: AliveSnapshot
  onOpenAutonomySettings: () => void
  onOpenChat: () => void
}) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<BetweenUsTab>('goals')
  const [manualGoalOpen, setManualGoalOpen] = useState(false)
  const [manualReminderOpen, setManualReminderOpen] = useState(false)
  const [operation, setOperation] = useState<BetweenUsOperation | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run: RunBetweenUsOperation = async (nextOperation, work) => {
    setOperation(nextOperation)
    setError(null)
    try {
      await work()
      return true
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : String(operationError))
      return false
    } finally {
      setOperation(null)
    }
  }

  const autonomyState =
    snapshot.settings.mode === 'off'
      ? 'off'
      : snapshot.settings.globallySuspended
        ? 'paused'
        : 'active'
  const activeGoals = snapshot.goals.filter(
    (goal) => goal.status !== 'completed' && goal.status !== 'cancelled',
  ).length
  const activeReminders = snapshot.tasks.filter((task) => task.status !== 'completed').length
  const completed =
    snapshot.goals.filter((goal) => goal.status === 'completed').length +
    snapshot.tasks.filter((task) => task.status === 'completed').length
  const summaryCounts = [
    activeGoals > 0 ? t('tasks.summary.intentions', { count: activeGoals }) : null,
    activeReminders > 0 ? t('tasks.summary.reminders', { count: activeReminders }) : null,
    completed > 0 ? t('tasks.summary.completed', { count: completed }) : null,
  ].filter((value): value is string => Boolean(value))

  return (
    <section className="tasks-view page-container" aria-label={t('app.nav.tasks')}>
      {error && (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('common.error')}</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      )}

      <article className="tasks-autonomy-summary">
        <div className="tasks-summary-copy">
          <StatusLight variant={autonomyState === 'active' ? 'positive' : 'notice'}>
            {t(`tasks.autonomy.status.${autonomyState}`)}
          </StatusLight>
          {summaryCounts.length > 0 && <Text>{summaryCounts.join(' · ')}</Text>}
        </div>
        <Button variant="secondary" onPress={onOpenAutonomySettings}>
          {t('tasks.autonomy.configure')}
        </Button>
      </article>

      <Tabs
        aria-label={t('app.nav.tasks')}
        selectedKey={activeTab}
        onSelectionChange={(key) => {
          if (key === 'schedule' || key === 'history') setActiveTab(key)
          else setActiveTab('goals')
        }}
      >
        <TabList UNSAFE_className="tasks-tabs">
          <Tab id="goals">{t('tasks.tabs.goals')}</Tab>
          <Tab id="schedule">{t('tasks.tabs.schedule')}</Tab>
          <Tab id="history">{t('tasks.tabs.history')}</Tab>
        </TabList>
        <TabPanel id="goals">
          <IntentionsPanel
            snapshot={snapshot}
            operation={operation}
            run={run}
            onOpenChat={onOpenChat}
            onAddManually={() => setManualGoalOpen(true)}
          />
        </TabPanel>
        <TabPanel id="schedule">
          <RemindersPanel
            snapshot={snapshot}
            operation={operation}
            run={run}
            onOpenChat={onOpenChat}
            onAddManually={() => setManualReminderOpen(true)}
          />
        </TabPanel>
        <TabPanel id="history">
          <BetweenUsHistory snapshot={snapshot} />
        </TabPanel>
      </Tabs>

      <ManualGoalDialog
        isOpen={manualGoalOpen}
        operation={operation}
        run={run}
        onDismiss={() => setManualGoalOpen(false)}
      />
      <ManualReminderDialog
        isOpen={manualReminderOpen}
        operation={operation}
        run={run}
        onDismiss={() => setManualReminderOpen(false)}
      />
    </section>
  )
}
