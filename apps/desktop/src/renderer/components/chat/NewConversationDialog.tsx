import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Footer,
  Heading,
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
            <p>{t('chat.newConversation.description')}</p>
            {error && <p role="alert">{error}</p>}
          </Content>
          <Footer>
            <ButtonGroup>
              <Button variant="secondary" isDisabled={isPending} onPress={onDismiss}>
                {t('common.cancel')}
              </Button>
              <Button variant="accent" isPending={isPending} onPress={onConfirm}>
                {t('chat.newConversation.confirm')}
              </Button>
            </ButtonGroup>
          </Footer>
        </Dialog>
      )}
    </DialogContainer>
  )
}
