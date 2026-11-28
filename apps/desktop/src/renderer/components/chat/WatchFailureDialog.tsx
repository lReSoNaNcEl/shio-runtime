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
import { useState } from 'react'

import { WATCH_BLOCK_REASONS } from '../../../shared/watchTogether'
import { useTranslation } from '../../localization/useTranslation'
import { type WatchFailure } from '../../runtime/WatchTogetherCapture'

export function WatchFailureDialog({
  failure,
  onChange,
  onChooseSource,
}: {
  failure?: WatchFailure
  onChange: (failure?: WatchFailure) => void
  onChooseSource: () => void
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const reason = WATCH_BLOCK_REASONS.find((value) => failure === `watch.blocked.${value}`)
  const dismiss = () => {
    if (pending) return
    setSaveFailed(false)
    onChange()
  }
  const confirm = async () => {
    if (!reason || pending) return
    setPending(true)
    setSaveFailed(false)
    try {
      const next = await window.api.alive.resolveSharingBlock(reason)
      onChange(next ? `watch.blocked.${next}` : undefined)
      if (!next) onChooseSource()
    } catch {
      setSaveFailed(true)
    } finally {
      setPending(false)
    }
  }
  return (
    <DialogContainer onDismiss={dismiss}>
      {failure && (
        <Dialog>
          <Heading>{t('watch.unavailableTitle')}</Heading>
          <Content>
            <Text>{t(failure)}</Text>
            {saveFailed && <div role="alert">{t('settings.saveFailed')}</div>}
          </Content>
          <Footer>
            <ButtonGroup>
              <Button variant="secondary" autoFocus isDisabled={pending} onPress={dismiss}>
                {t('common.close')}
              </Button>
              {reason && (
                <Button variant="primary" isPending={pending} onPress={() => void confirm()}>
                  {t(`watch.resolveBlock.${reason}`)}
                </Button>
              )}
            </ButtonGroup>
          </Footer>
        </Dialog>
      )}
    </DialogContainer>
  )
}
