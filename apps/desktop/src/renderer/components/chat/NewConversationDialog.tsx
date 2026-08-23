import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Footer,
  Heading,
  Text,
} from '@react-spectrum/s2'

import { useTranslation } from '../../localization/useTranslation'

interface NewConversationDialogProps {
  isOpen: boolean
  isPending: boolean
  error: string | null
  onConfirm(): void
  onDismiss(): void
}

export function NewConversationDialog({
  isOpen,
  isPending,
  error,
  onConfirm,
  onDismiss,
}: NewConversationDialogProps) {
  const { t } = useTranslation()

  return (
    <DialogContainer
      onDismiss={() => {
        if (!isPending) onDismiss()
      }}
    >
      {isOpen && (
        <Dialog>
          <Heading>{t('chat.newConversation.title')}</Heading>
          <Content>
            <Text>{t('chat.newConversation.description')}</Text>
            {error && (
              <span role="alert">
                <Text>{error}</Text>
              </span>
            )}
          </Content>
          <Footer>
            <ButtonGroup>
              <Button variant="secondary" isDisabled={isPending} onPress={onDismiss}>
                {t('common.cancel')}
              </Button>
              <Button variant="negative" isPending={isPending} onPress={onConfirm}>
                {t('chat.newConversation.confirm')}
              </Button>
            </ButtonGroup>
          </Footer>
        </Dialog>
      )}
    </DialogContainer>
  )
}
