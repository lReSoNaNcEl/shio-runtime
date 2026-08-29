import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  Picker,
  PickerItem,
  TextField,
} from '@react-spectrum/s2'
import { useState } from 'react'

import { type GoalOwner } from '../../../../shared/alive'
import { useTranslation } from '../../../localization/useTranslation'
import { type BetweenUsOperation, type RunBetweenUsOperation } from './operations'

export function ManualGoalDialog({
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
  const [description, setDescription] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [owner, setOwner] = useState<GoalOwner>('shared')
  const busy = operation?.kind === 'create-goal'

  const submit = async (): Promise<void> => {
    const created = await run({ kind: 'create-goal' }, () =>
      window.api.alive.createGoal({
        title: title.trim(),
        description: description.trim() || undefined,
        nextStep: nextStep.trim() || undefined,
        owner,
      }),
    )
    if (!created) return
    setTitle('')
    setDescription('')
    setNextStep('')
    setOwner('shared')
    onDismiss()
  }

  return (
    <DialogContainer onDismiss={() => !busy && onDismiss()}>
      {isOpen && (
        <Dialog size="M" aria-label={t('tasks.goals.manualTitle')}>
          <Heading>{t('tasks.goals.manualTitle')}</Heading>
          <Content>
            <div className="tasks-goal-create-grid">
              <TextField
                label={t('tasks.goals.new')}
                placeholder={t('tasks.goals.placeholder')}
                value={title}
                isDisabled={busy}
                onChange={setTitle}
              />
              <TextField
                label={t('tasks.goals.why')}
                placeholder={t('tasks.goals.whyPlaceholder')}
                value={description}
                isDisabled={busy}
                onChange={setDescription}
              />
              <TextField
                label={t('tasks.goals.nextStep')}
                placeholder={t('tasks.goals.nextStepPlaceholder')}
                value={nextStep}
                isDisabled={busy}
                onChange={setNextStep}
              />
              <Picker
                label={t('tasks.goals.owner')}
                selectedKey={owner}
                isDisabled={busy}
                onSelectionChange={(key) => setOwner(String(key) as GoalOwner)}
              >
                <PickerItem id="shared">{t('tasks.goal.owner.shared')}</PickerItem>
                <PickerItem id="user">{t('tasks.goal.owner.user')}</PickerItem>
                <PickerItem id="shio">{t('tasks.goal.owner.shio')}</PickerItem>
              </Picker>
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
              {t('tasks.add')}
            </Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogContainer>
  )
}
