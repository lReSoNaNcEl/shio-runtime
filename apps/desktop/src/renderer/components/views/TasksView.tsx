import {
  Badge,
  Button,
  ButtonGroup,
  Content,
  Heading,
  InlineAlert,
  NumberField,
  Picker,
  PickerItem,
  ProgressCircle,
  Switch,
  Text,
  TextField,
} from '@react-spectrum/s2'
import { useState } from 'react'

import {
  type AliveSnapshot,
  type AutonomyMode,
  type ScheduledTaskKind,
} from '../../../shared/alive'
import { LLM_PROVIDER_IDS, type LlmProviderId } from '../../../shared/llm'
import { useTranslation } from '../../localization/useTranslation'

export function TasksView({ snapshot }: { snapshot: AliveSnapshot | null }) {
  const { t } = useTranslation()
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

  const updateSettings = (patch: Partial<AliveSnapshot['settings']>): Promise<unknown> =>
    window.api.alive.updateSettings({ ...snapshot.settings, ...patch })

  return (
    <section className="tasks-view page-container" aria-label={t('app.nav.tasks')}>
      {error && (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('common.error')}</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      )}

      <article className="tasks-panel tasks-autonomy-panel">
        <div className="tasks-panel-heading">
          <div>
            <Heading level={2}>{t('tasks.autonomy.title')}</Heading>
            <Text>{t('tasks.autonomy.description')}</Text>
          </div>
          <Badge variant={snapshot.health.operational ? 'positive' : 'negative'}>
            {snapshot.health.operational ? t('common.ready') : t('common.error')}
          </Badge>
        </div>
        <div className="tasks-controls">
          <Picker
            label={t('tasks.autonomy.mode')}
            selectedKey={snapshot.settings.mode}
            isDisabled={busy}
            onSelectionChange={(key) =>
              void run(() => updateSettings({ mode: String(key) as AutonomyMode }))
            }
          >
            <PickerItem id="off">{t('tasks.mode.off')}</PickerItem>
            <PickerItem id="suggest">{t('tasks.mode.suggest')}</PickerItem>
            <PickerItem id="confirm">{t('tasks.mode.confirm')}</PickerItem>
            <PickerItem id="full">{t('tasks.mode.full')}</PickerItem>
          </Picker>
          <Switch
            isSelected={snapshot.settings.globallySuspended}
            isDisabled={busy}
            onChange={(globallySuspended) => void run(() => updateSettings({ globallySuspended }))}
          >
            {t('tasks.autonomy.suspend')}
          </Switch>
          <Switch
            isSelected={snapshot.settings.privacyMode}
            isDisabled={busy}
            onChange={(privacyMode) => void run(() => updateSettings({ privacyMode }))}
          >
            {t('tasks.autonomy.privacy')}
          </Switch>
          <Switch
            isSelected={snapshot.settings.fastBrain.enabled}
            isDisabled={busy || snapshot.settings.privacyMode}
            onChange={(enabled) =>
              void run(() =>
                updateSettings({ fastBrain: { ...snapshot.settings.fastBrain, enabled } }),
              )
            }
          >
            {t('tasks.fastBrain')}
          </Switch>
          <Switch
            isSelected={snapshot.settings.quietHours.enabled}
            isDisabled={busy}
            onChange={(enabled) =>
              void run(() =>
                updateSettings({
                  quietHours: { ...snapshot.settings.quietHours, enabled },
                }),
              )
            }
          >
            {t('tasks.autonomy.quietHours')}
          </Switch>
          <NumberField
            label={t('tasks.autonomy.quietStart')}
            value={snapshot.settings.quietHours.startHour}
            minValue={0}
            maxValue={23}
            isDisabled={busy || !snapshot.settings.quietHours.enabled}
            onChange={(startHour) =>
              void run(() =>
                updateSettings({
                  quietHours: { ...snapshot.settings.quietHours, startHour },
                }),
              )
            }
          />
          <Picker
            label={t('tasks.fastBrain.provider')}
            selectedKey={snapshot.settings.fastBrain.providerId ?? 'active'}
            isDisabled={busy || !snapshot.settings.fastBrain.enabled}
            onSelectionChange={(key) =>
              void run(() =>
                updateSettings({
                  fastBrain: {
                    ...snapshot.settings.fastBrain,
                    providerId:
                      String(key) === 'active' ? undefined : (String(key) as LlmProviderId),
                  },
                }),
              )
            }
          >
            <PickerItem id="active">{t('tasks.fastBrain.activeProvider')}</PickerItem>
            {LLM_PROVIDER_IDS.map((providerId) => (
              <PickerItem id={providerId} key={providerId}>
                {providerId}
              </PickerItem>
            ))}
          </Picker>
          <TextField
            label={t('tasks.fastBrain.model')}
            placeholder={t('tasks.fastBrain.modelPlaceholder')}
            value={snapshot.settings.fastBrain.model ?? ''}
            isDisabled={busy || !snapshot.settings.fastBrain.enabled}
            onChange={(model) =>
              void run(() =>
                updateSettings({
                  fastBrain: {
                    ...snapshot.settings.fastBrain,
                    model: model.trim() || undefined,
                  },
                }),
              )
            }
          />
          <NumberField
            label={t('tasks.autonomy.quietEnd')}
            value={snapshot.settings.quietHours.endHour}
            minValue={0}
            maxValue={23}
            isDisabled={busy || !snapshot.settings.quietHours.enabled}
            onChange={(endHour) =>
              void run(() =>
                updateSettings({
                  quietHours: { ...snapshot.settings.quietHours, endHour },
                }),
              )
            }
          />
          <NumberField
            label={t('tasks.autonomy.cooldownMinutes')}
            value={Math.round(snapshot.settings.cooldownMs / 60_000)}
            minValue={1}
            maxValue={1_440}
            isDisabled={busy}
            onChange={(cooldownMinutes) =>
              void run(() => updateSettings({ cooldownMs: cooldownMinutes * 60_000 }))
            }
          />
          <NumberField
            label={t('tasks.autonomy.dailyCap')}
            value={snapshot.settings.maxDailyInitiatives}
            minValue={0}
            maxValue={100}
            isDisabled={busy}
            onChange={(maxDailyInitiatives) =>
              void run(() => updateSettings({ maxDailyInitiatives }))
            }
          />
          <NumberField
            label={t('tasks.fastBrain.timeout')}
            value={snapshot.settings.fastBrain.timeoutMs}
            minValue={250}
            maxValue={5_000}
            step={250}
            isDisabled={busy || !snapshot.settings.fastBrain.enabled}
            onChange={(timeoutMs) =>
              void run(() =>
                updateSettings({
                  fastBrain: { ...snapshot.settings.fastBrain, timeoutMs },
                }),
              )
            }
          />
          <NumberField
            label={t('tasks.fastBrain.tokens')}
            value={snapshot.settings.fastBrain.maxTokens}
            minValue={16}
            maxValue={256}
            step={16}
            isDisabled={busy || !snapshot.settings.fastBrain.enabled}
            onChange={(maxTokens) =>
              void run(() =>
                updateSettings({
                  fastBrain: { ...snapshot.settings.fastBrain, maxTokens },
                }),
              )
            }
          />
        </div>
        <Text>
          {t('tasks.autonomy.limits', {
            count: snapshot.settings.maxDailyInitiatives,
            minutes: Math.round(snapshot.settings.cooldownMs / 60_000),
          })}
        </Text>
      </article>

      <div className="tasks-columns">
        <article className="tasks-panel">
          <Heading level={2}>{t('tasks.goals.title')}</Heading>
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
          <div className="tasks-list">
            {snapshot.goals.length === 0 ? (
              <Text>{t('tasks.goals.empty')}</Text>
            ) : (
              snapshot.goals.map((goal) => (
                <div className="tasks-item" key={goal.id}>
                  <div>
                    <Text UNSAFE_className="tasks-item-title">{goal.title}</Text>
                    <Text>{t(`tasks.goal.status.${goal.status}`)}</Text>
                    <NumberField
                      label={t('tasks.goals.progress')}
                      value={Math.round(goal.progress * 100)}
                      minValue={0}
                      maxValue={100}
                      isDisabled={
                        busy || goal.status === 'completed' || goal.status === 'cancelled'
                      }
                      onChange={(progress) =>
                        void run(() =>
                          window.api.alive.updateGoal({ id: goal.id, progress: progress / 100 }),
                        )
                      }
                    />
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
                    {goal.status !== 'completed' && goal.status !== 'cancelled' && (
                      <Button
                        variant="primary"
                        isDisabled={busy}
                        onPress={() =>
                          void run(() =>
                            window.api.alive.updateGoal({
                              id: goal.id,
                              status: 'completed',
                              progress: 1,
                            }),
                          )
                        }
                      >
                        {t('tasks.complete')}
                      </Button>
                    )}
                  </ButtonGroup>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="tasks-panel">
          <Heading level={2}>{t('tasks.schedule.title')}</Heading>
          <div className="tasks-create-grid">
            <TextField
              label={t('tasks.schedule.new')}
              placeholder={t('tasks.schedule.placeholder')}
              value={taskTitle}
              isDisabled={busy}
              onChange={setTaskTitle}
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
            <NumberField
              label={t('tasks.schedule.minutes')}
              value={minutes}
              minValue={1}
              maxValue={43_200}
              isDisabled={busy}
              onChange={setMinutes}
            />
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
                    intervalMs: scheduleMode === 'interval' ? intervalMinutes * 60_000 : undefined,
                  })
                  setTaskTitle('')
                })
              }
            >
              {t('tasks.schedule.create')}
            </Button>
          </div>
          <div className="tasks-list">
            {snapshot.tasks.length === 0 ? (
              <Text>{t('tasks.schedule.empty')}</Text>
            ) : (
              snapshot.tasks.map((task) => (
                <div className="tasks-item" key={task.id}>
                  <div>
                    <Text UNSAFE_className="tasks-item-title">{task.title}</Text>
                    <Text>
                      {t(`tasks.task.status.${task.status}`)} ·{' '}
                      {new Date(task.nextRunAt).toLocaleString()}
                    </Text>
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
                </div>
              ))
            )}
          </div>
        </article>
      </div>

      <article className="tasks-panel">
        <Heading level={2}>{t('tasks.habits.title')}</Heading>
        <Text>{t('tasks.habits.description')}</Text>
        <div className="tasks-list">
          {snapshot.habitSuggestions.length === 0 ? (
            <Text>{t('tasks.habits.empty')}</Text>
          ) : (
            snapshot.habitSuggestions.map((habit) => (
              <div className="tasks-item" key={habit.id}>
                <div>
                  <Text UNSAFE_className="tasks-item-title">{habit.title}</Text>
                  <Text>{t('tasks.habits.evidence', { count: habit.evidenceCount })}</Text>
                </div>
                {habit.status === 'pending' && (
                  <ButtonGroup>
                    <Button
                      variant="primary"
                      isDisabled={busy}
                      onPress={() =>
                        void run(() => window.api.alive.decideHabit(habit.id, 'approved'))
                      }
                    >
                      {t('tasks.approve')}
                    </Button>
                    <Button
                      variant="secondary"
                      isDisabled={busy}
                      onPress={() =>
                        void run(() => window.api.alive.decideHabit(habit.id, 'rejected'))
                      }
                    >
                      {t('tasks.reject')}
                    </Button>
                  </ButtonGroup>
                )}
              </div>
            ))
          )}
        </div>
      </article>
    </section>
  )
}
