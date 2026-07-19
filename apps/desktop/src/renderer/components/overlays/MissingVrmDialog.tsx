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
          <Heading>{t('camera.missingVrm.title')}</Heading>
          <Content>
            <p>{t('camera.missingVrm.description')}</p>
            <p>{t('camera.missingVrm.hint')}</p>
          </Content>
          <Footer>
            <ButtonGroup>
              <Button variant="secondary" onPress={onDismiss}>
                {t('common.cancel')}
              </Button>
              <Button variant="accent" onPress={onOpenSettings}>
                {t('camera.missingVrm.openSettings')}
              </Button>
            </ButtonGroup>
          </Footer>
        </Dialog>
      )}
    </DialogContainer>
  )
}
