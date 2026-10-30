import {
  ActionButton,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Picker,
  PickerItem,
  Text,
} from '@react-spectrum/s2'
import { useState } from 'react'

import { controller } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'

type Side = 'left' | 'right'
type Anchor = 'hips' | 'chest' | 'neck' | 'head'
const ANCHORS: readonly Anchor[] = ['hips', 'chest', 'neck', 'head']

/** Debug Preview authoring: copies the current arm pose as a rig-relative keypose
 * JSON fragment to the clipboard. Nothing is written to files from the renderer. */
export function KeyposeAuthoringPanel() {
  const { t } = useTranslation()
  const [side, setSide] = useState<Side>('right')
  const [anchor, setAnchor] = useState<Anchor>('chest')
  const [status, setStatus] = useState<'idle' | 'copied' | 'unavailable' | 'failed'>('idle')

  const copy = async () => {
    const keypose = controller.captureAvatarKeypose(side, anchor)
    if (!keypose) {
      setStatus('unavailable')
      return
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(keypose))
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }

  return (
    <Disclosure isQuiet>
      <DisclosureTitle level={4}>{t('avatarPreview.keypose.title')}</DisclosureTitle>
      <DisclosurePanel>
        <Text>{t('avatarPreview.keypose.description')}</Text>
        <div className="preview-actions">
          <Picker
            label={t('avatarPreview.keypose.hand')}
            selectedKey={side}
            onSelectionChange={(key) => setSide(key === 'left' ? 'left' : 'right')}
          >
            <PickerItem id="left">{t('avatarPreview.keypose.hand.left')}</PickerItem>
            <PickerItem id="right">{t('avatarPreview.keypose.hand.right')}</PickerItem>
          </Picker>
          <Picker
            label={t('avatarPreview.keypose.anchor')}
            selectedKey={anchor}
            onSelectionChange={(key) =>
              setAnchor(ANCHORS.find((entry) => entry === key) ?? 'chest')
            }
          >
            <PickerItem id="hips">{t('avatarPreview.keypose.anchor.hips')}</PickerItem>
            <PickerItem id="chest">{t('avatarPreview.keypose.anchor.chest')}</PickerItem>
            <PickerItem id="neck">{t('avatarPreview.keypose.anchor.neck')}</PickerItem>
            <PickerItem id="head">{t('avatarPreview.keypose.anchor.head')}</PickerItem>
          </Picker>
        </div>
        <ActionButton onPress={() => observeRendererPromise(copy(), 'copy avatar keypose')}>
          <Text>{t('avatarPreview.keypose.copy')}</Text>
        </ActionButton>
        {status !== 'idle' && (
          <span className="settings-hint" role="status">
            {t(`avatarPreview.keypose.status.${status}`)}
          </span>
        )}
      </DisclosurePanel>
    </Disclosure>
  )
}
