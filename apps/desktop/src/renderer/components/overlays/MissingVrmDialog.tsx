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

export function MissingVrmDialog({
  isOpen,
  onOpenSettings,
  onDismiss,
}: {
  isOpen: boolean
  onOpenSettings: () => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()

  return (
    <DialogContainer onDismiss={onDismiss}>
      {isOpen && (
        <Dialog>
          <Heading>{t('camera.missingAvatar.title')}</Heading>
          <Content>
            <Text>{t('camera.missingAvatar.description')}</Text>
            <Text>{t('camera.missingAvatar.hint')}</Text>
          </Content>
          <Footer>
            <ButtonGroup>
              <Button variant="secondary" onPress={onDismiss}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="accent"
                onPress={onOpenSettings}
                UNSAFE_className="shio-accent-button"
              >
                {t('camera.missingAvatar.openSettings')}
              </Button>
            </ButtonGroup>
          </Footer>
        </Dialog>
      )}
    </DialogContainer>
  )
}
