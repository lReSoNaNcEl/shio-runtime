import {
  Button,
  ButtonGroup,
  Content,
  Heading,
  InlineAlert,
  NumberField,
  Picker,
  PickerItem,
  ProgressBar,
  ProgressCircle,
  StatusLight,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextField,
} from '@react-spectrum/s2'
import { useState } from 'react'

import {
  type AliveSnapshot,
  type GoalStatus,
  type ScheduledTaskKind,
  type ScheduledTaskStatus,
} from '../../../shared/alive'
import { useTranslation } from '../../localization/useTranslation'

type TasksTab = 'goals' | 'schedule' | 'history'

function goalStatusTone(status: GoalStatus): 'positive' | 'notice' | 'negative' {
  if (status === 'active' || status === 'completed') return 'positive'
  if (status === 'paused') return 'notice'
  return 'negative'
}

function taskStatusTone(status: ScheduledTaskStatus): 'positive' | 'notice' {
  return status === 'scheduled' || status === 'completed' ? 'positive' : 'notice'
}

export function TasksView({
  snapshot,
  onOpenAutonomySettings,
}: {
  snapshot: AliveSnapshot | null
  onOpenAutonomySettings: () => void
}) {
  const { intlLocale, t } = useTranslation()
  const [activeTab, setActiveTab] = useState<TasksTab>('goals')
  const [goalTitle, setGoalTitle] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskKind, setTaskKind] = useState<ScheduledTaskKind>('reminder')
  const [minutes, setMinutes] = useState(15)
  const [scheduleMode, setScheduleMode] = useState<'one-shot' | 'interval'>('one-shot')
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : String(operationError))
    } finally {
      setBusy(false)
    }
  }

  if (!snapshot) {
    return (
      <div className="tasks-loading page-container">
        <ProgressCircle isIndeterminate aria-label={t('common.loading')} />
      </div>
    )
  }

  const activeGoals = snapshot.goals.filter(
    (goal) => goal.status === 'active' || goal.status === 'paused',
  )
  const archivedGoals = snapshot.goals.filter(
    (goal) => goal.status === 'completed' || goal.status === 'cancelled',
  )
  const scheduledTasks = snapshot.tasks.filter((task) => task.status !== 'completed')
  const completedTasks = snapshot.tasks.filter((task) => task.status === 'completed')
  const autonomyState =
    snapshot.settings.mode === 'off'
      ? 'off'
      : snapshot.settings.globallySuspended
        ? 'paused'
        : 'active'
  const formatTime = (value: number): string =>
    new Intl.DateTimeFormat(intlLocale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))

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
            {t(`settings.autonomy.status.${autonomyState}`)}
          </StatusLight>
          <Text>{t('tasks.autonomy.summary')}</Text>
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
          <article className="tasks-panel">
            <div className="tasks-panel-heading">
              <div className="tasks-heading-copy">
                <Heading level={2}>{t('tasks.goals.title')}</Heading>
                <Text>{t('tasks.goals.description')}</Text>
              </div>
              <Text>{t('tasks.goals.count', { count: activeGoals.length })}</Text>
            </div>
            <div className="tasks-create-row">
              <TextField
                label={t('tasks.goals.new')}
                placeholder={t('tasks.goals.placeholder')}
                value={goalTitle}
                isDisabled={busy}
                onChange={setGoalTitle}
              />
              <Button
                variant="primary"
                isDisabled={busy || !goalTitle.trim()}
                onPress={() =>
                  void run(async () => {
                    await window.api.alive.createGoal({ title: goalTitle.trim() })
                    setGoalTitle('')
                  })
                }
              >
                {t('tasks.add')}
              </Button>
            </div>

            {activeGoals.length === 0 ? (
              <div className="tasks-empty-state">
                <Heading level={3}>{t('tasks.goals.emptyTitle')}</Heading>
                <Text>{t('tasks.goals.empty')}</Text>
              </div>
            ) : (
              <div className="tasks-list">
                {activeGoals.map((goal) => (
                  <article className="tasks-item tasks-goal-card" key={goal.id}>
                    <div className="tasks-item-main">
                      <div className="tasks-item-heading">
                        <Text UNSAFE_className="tasks-item-title">{goal.title}</Text>
                        <StatusLight variant={goalStatusTone(goal.status)} size="S">
                          {t(`tasks.goal.status.${goal.status}`)}
                        </StatusLight>
                      </div>
                      {goal.description && <Text>{goal.description}</Text>}
                      <ProgressBar
                        label={t('tasks.goals.progress')}
                        value={Math.round(goal.progress * 100)}
                        minValue={0}
                        maxValue={100}
                      />
                      <Text UNSAFE_className="tasks-item-meta">
                        {t('tasks.goals.progressManaged')}
                      </Text>
                    </div>
                    <ButtonGroup>
                      {goal.status === 'active' && (
                        <Button
                          variant="secondary"
                          isDisabled={busy}
                          onPress={() =>
                            void run(() =>
                              window.api.alive.updateGoal({ id: goal.id, status: 'paused' }),
                            )
                          }
                        >
                          {t('tasks.pause')}
                        </Button>
                      )}
                      {goal.status === 'paused' && (
                        <Button
                          variant="secondary"
                          isDisabled={busy}
                          onPress={() =>
                            void run(() =>
                              window.api.alive.updateGoal({ id: goal.id, status: 'active' }),
                            )
                          }
                        >
                          {t('tasks.resume')}
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        isDisabled={busy}
                        onPress={() =>
                          void run(() =>
                            window.api.alive.updateGoal({ id: goal.id, status: 'completed' }),
                          )
                        }
                      >
                        {t('tasks.complete')}
                      </Button>
                    </ButtonGroup>
                  </article>
                ))}
              </div>
            )}
          </article>
        </TabPanel>

        <TabPanel id="schedule">
          <article className="tasks-panel">
            <div className="tasks-heading-copy">
              <Heading level={2}>{t('tasks.schedule.title')}</Heading>
              <Text>{t('tasks.schedule.description')}</Text>
            </div>
            <div className="tasks-create-grid">
              <TextField
                label={t('tasks.schedule.new')}
                placeholder={t('tasks.schedule.placeholder')}
                value={taskTitle}
                isDisabled={busy}
                onChange={setTaskTitle}
              />
              <NumberField
                label={t('tasks.schedule.minutes')}
                value={minutes}
                minValue={1}
                maxValue={43_200}
                isDisabled={busy}
                onChange={setMinutes}
              />
              <Picker
                label={t('tasks.schedule.kind')}
                selectedKey={taskKind}
                isDisabled={busy}
                onSelectionChange={(key) => setTaskKind(String(key) as ScheduledTaskKind)}
              >
                <PickerItem id="reminder">{t('tasks.kind.reminder')}</PickerItem>
                <PickerItem id="check_in">{t('tasks.kind.checkIn')}</PickerItem>
              </Picker>
              <Picker
                label={t('tasks.schedule.recurrence')}
                selectedKey={scheduleMode}
                isDisabled={busy}
                onSelectionChange={(key) => setScheduleMode(String(key) as 'one-shot' | 'interval')}
              >
                <PickerItem id="one-shot">{t('tasks.schedule.oneShot')}</PickerItem>
                <PickerItem id="interval">{t('tasks.schedule.interval')}</PickerItem>
              </Picker>
              {scheduleMode === 'interval' && (
                <NumberField
                  label={t('tasks.schedule.intervalMinutes')}
                  value={intervalMinutes}
                  minValue={1}
                  maxValue={525_600}
                  isDisabled={busy}
                  onChange={setIntervalMinutes}
                />
              )}
              <Button
                variant="primary"
                isDisabled={busy || !taskTitle.trim()}
                onPress={() =>
                  void run(async () => {
                    await window.api.alive.createTask({
                      title: taskTitle.trim(),
                      kind: taskKind,
                      dueAt: Date.now() + minutes * 60_000,
                      intervalMs:
                        scheduleMode === 'interval' ? intervalMinutes * 60_000 : undefined,
                    })
                    setTaskTitle('')
                  })
                }
              >
                {t('tasks.schedule.create')}
              </Button>
            </div>

            {scheduledTasks.length === 0 ? (
              <div className="tasks-empty-state">
                <Heading level={3}>{t('tasks.schedule.emptyTitle')}</Heading>
                <Text>{t('tasks.schedule.empty')}</Text>
              </div>
            ) : (
              <div className="tasks-list">
                {scheduledTasks.map((task) => (
                  <article className="tasks-item" key={task.id}>
                    <div className="tasks-item-main">
                      <div className="tasks-item-heading">
                        <Text UNSAFE_className="tasks-item-title">{task.title}</Text>
                        <StatusLight variant={taskStatusTone(task.status)} size="S">
                          {t(`tasks.task.status.${task.status}`)}
                        </StatusLight>
                      </div>
                      <Text UNSAFE_className="tasks-item-meta">{formatTime(task.nextRunAt)}</Text>
                    </div>
                    <ButtonGroup>
                      {task.status === 'waiting_confirmation' && (
                        <Button
                          variant="accent"
                          isDisabled={busy || snapshot.settings.globallySuspended}
                          onPress={() => void run(() => window.api.alive.approveTask(task.id))}
                        >
                          {t('tasks.approve')}
                        </Button>
                      )}
                      {task.status === 'scheduled' && (
                        <Button
                          variant="secondary"
                          isDisabled={busy}
                          onPress={() =>
                            void run(() => window.api.alive.setTaskStatus(task.id, 'paused'))
                          }
                        >
                          {t('tasks.pause')}
                        </Button>
                      )}
                      {task.status === 'paused' && (
                        <Button
                          variant="secondary"
                          isDisabled={busy}
                          onPress={() =>
                            void run(() => window.api.alive.setTaskStatus(task.id, 'scheduled'))
                          }
                        >
                          {t('tasks.resume')}
                        </Button>
                      )}
                    </ButtonGroup>
                  </article>
                ))}
              </div>
            )}
          </article>
        </TabPanel>

        <TabPanel id="history">
          <article className="tasks-panel">
            <div className="tasks-heading-copy">
              <Heading level={2}>{t('tasks.history.title')}</Heading>
              <Text>{t('tasks.history.description')}</Text>
            </div>
            {archivedGoals.length === 0 && completedTasks.length === 0 ? (
              <div className="tasks-empty-state">
                <Heading level={3}>{t('tasks.history.emptyTitle')}</Heading>
                <Text>{t('tasks.history.empty')}</Text>
              </div>
            ) : (
              <div className="tasks-history-groups">
                {archivedGoals.length > 0 && (
                  <section className="tasks-history-group">
                    <Heading level={3}>{t('tasks.tabs.goals')}</Heading>
                    <div className="tasks-list">
                      {archivedGoals.map((goal) => (
                        <article className="tasks-item" key={goal.id}>
                          <div className="tasks-item-main">
                            <Text UNSAFE_className="tasks-item-title">{goal.title}</Text>
                            <StatusLight variant={goalStatusTone(goal.status)} size="S">
                              {t(`tasks.goal.status.${goal.status}`)}
                            </StatusLight>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
                {completedTasks.length > 0 && (
                  <section className="tasks-history-group">
                    <Heading level={3}>{t('tasks.tabs.schedule')}</Heading>
                    <div className="tasks-list">
                      {completedTasks.map((task) => (
                        <article className="tasks-item" key={task.id}>
                          <div className="tasks-item-main">
                            <Text UNSAFE_className="tasks-item-title">{task.title}</Text>
                            <Text UNSAFE_className="tasks-item-meta">
                              {formatTime(task.updatedAt)}
                            </Text>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </article>
        </TabPanel>
      </Tabs>
    </section>
  )
}
