import {
  ActionButton,
  Button,
  ButtonGroup,
  Heading,
  Menu,
  MenuItem,
  MenuTrigger,
  StatusLight,
  Text,
} from '@react-spectrum/s2'
import Chat from '@react-spectrum/s2/icons/Chat'
import More from '@react-spectrum/s2/icons/More'

import { type AliveSnapshot, type ScheduledTaskStatus } from '../../../../shared/alive'
import { useTranslation } from '../../../localization/useTranslation'
import { type BetweenUsOperation, type RunBetweenUsOperation } from './operations'

function taskStatusTone(status: ScheduledTaskStatus): 'positive' | 'notice' {
  return status === 'scheduled' || status === 'completed' ? 'positive' : 'notice'
}

export function RemindersPanel({
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
  const { intlLocale, t } = useTranslation()
  const tasks = snapshot.tasks.filter((task) => task.status !== 'completed')
  const formatTime = (value: number): string =>
    new Intl.DateTimeFormat(intlLocale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))

  return (
    <article className="tasks-panel">
      <div className="tasks-panel-heading">
        <div className="tasks-heading-copy">
          <Heading level={2}>{t('tasks.schedule.title')}</Heading>
          <Text>{t('tasks.schedule.description')}</Text>
        </div>
        {tasks.length > 0 && (
          <ButtonGroup>
            <Button variant="primary" onPress={onOpenChat}>
              <Chat aria-hidden />
              <Text>{t('tasks.schedule.openChat')}</Text>
            </Button>
            <Button variant="secondary" onPress={onAddManually}>
              {t('tasks.schedule.manual')}
            </Button>
          </ButtonGroup>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="tasks-empty-state">
          <Heading level={3}>{t('tasks.schedule.emptyTitle')}</Heading>
          <Text>{t('tasks.schedule.empty')}</Text>
          <ButtonGroup UNSAFE_className="tasks-empty-actions">
            <Button variant="primary" onPress={onOpenChat}>
              <Chat aria-hidden />
              <Text>{t('tasks.schedule.openChat')}</Text>
            </Button>
            <Button variant="secondary" onPress={onAddManually}>
              {t('tasks.schedule.manual')}
            </Button>
          </ButtonGroup>
        </div>
      ) : (
        <div className="tasks-list">
          {tasks.map((task) => {
            const busy = operation?.kind === 'task-update' && operation.id === task.id
            const setStatus = (status: ScheduledTaskStatus): Promise<boolean> =>
              run({ kind: 'task-update', id: task.id }, () =>
                window.api.alive.setTaskStatus(task.id, status),
              )
            return (
              <article className="tasks-item" key={task.id}>
                <div className="tasks-item-main">
                  <Text UNSAFE_className="tasks-item-title">{task.title}</Text>
                  <Text UNSAFE_className="tasks-item-meta">{formatTime(task.nextRunAt)}</Text>
                </div>
                <div className="tasks-item-actions">
                  <StatusLight variant={taskStatusTone(task.status)} size="S">
                    {t(`tasks.task.status.${task.status}`)}
                  </StatusLight>
                  {task.status === 'waiting_confirmation' && (
                    <Button
                      variant="primary"
                      isPending={busy}
                      isDisabled={snapshot.settings.globallySuspended}
                      onPress={() =>
                        void run({ kind: 'task-update', id: task.id }, () =>
                          window.api.alive.approveTask(task.id),
                        )
                      }
                    >
                      {t('tasks.approve')}
                    </Button>
                  )}
                  <MenuTrigger>
                    <ActionButton aria-label={t('tasks.moreActions')} isDisabled={busy}>
                      <More />
                    </ActionButton>
                    <Menu
                      aria-label={t('tasks.moreActions')}
                      onAction={(key) => void setStatus(String(key) as ScheduledTaskStatus)}
                    >
                      {task.status === 'paused' ? (
                        <MenuItem id="scheduled">{t('tasks.resume')}</MenuItem>
                      ) : (
                        <MenuItem id="paused">{t('tasks.pause')}</MenuItem>
                      )}
                    </Menu>
                  </MenuTrigger>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </article>
  )
}
