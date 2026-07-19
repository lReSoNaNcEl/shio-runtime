import { ActionButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2'
import Add from '@react-spectrum/s2/icons/Add'

import { useTranslation } from '../../localization/useTranslation'

interface NewConversationButtonProps {
  isDisabled: boolean
  onPress(): void
}

export function NewConversationButton({ isDisabled, onPress }: NewConversationButtonProps) {
  const { t } = useTranslation()
  const label = t('chat.newConversation.action')

  return (
    <TooltipTrigger delay={200}>
      <ActionButton aria-label={label} isDisabled={isDisabled} onPress={onPress}>
        <Add />
      </ActionButton>
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  )
}
