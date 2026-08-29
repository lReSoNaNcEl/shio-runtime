import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  NumberField,
  Picker,
  PickerItem,
  TextField,
} from '@react-spectrum/s2'
import { useState } from 'react'

import { type ScheduledTaskKind } from '../../../../shared/alive'
import { useTranslation } from '../../../localization/useTranslation'
import { type BetweenUsOperation, type RunBetweenUsOperation } from './operations'

export function ManualReminderDialog({
  isOpen,
  operation,
  run,
  onDismiss,
}: {
  isOpen: boolean
  operation: BetweenUsOperation | null
  run: RunBetweenUsOperation
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<ScheduledTaskKind>('reminder')
  const [minutes, setMinutes] = useState(15)
  const [scheduleMode, setScheduleMode] = useState<'one-shot' | 'interval'>('one-shot')
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const busy = operation?.kind === 'create-task'

  const submit = async (): Promise<void> => {
    const created = await run({ kind: 'create-task' }, () =>
      window.api.alive.createTask({
        title: title.trim(),
        kind,
        dueAt: Date.now() + minutes * 60_000,
        intervalMs: scheduleMode === 'interval' ? intervalMinutes * 60_000 : undefined,
      }),
    )
    if (!created) return
    setTitle('')
    setKind('reminder')
    setMinutes(15)
    setScheduleMode('one-shot')
    setIntervalMinutes(60)
    onDismiss()
  }

  return (
    <DialogContainer onDismiss={() => !busy && onDismiss()}>
      {isOpen && (
        <Dialog size="M" aria-label={t('tasks.schedule.manualTitle')}>
          <Heading>{t('tasks.schedule.manualTitle')}</Heading>
          <Content>
            <div className="tasks-create-grid">
              <TextField
                label={t('tasks.schedule.new')}
                placeholder={t('tasks.schedule.placeholder')}
                value={title}
                isDisabled={busy}
                onChange={setTitle}
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
                selectedKey={kind}
                isDisabled={busy}
                onSelectionChange={(key) => setKind(String(key) as ScheduledTaskKind)}
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
            </div>
          </Content>
          <ButtonGroup slot="buttonGroup">
            <Button variant="secondary" isDisabled={busy} onPress={onDismiss}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              isPending={busy}
              isDisabled={!title.trim()}
              onPress={() => void submit()}
            >
              {t('tasks.schedule.create')}
            </Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogContainer>
  )
}
