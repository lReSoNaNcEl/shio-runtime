import {
  Button,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Heading,
  NumberField,
  Picker,
  PickerItem,
  SegmentedControl,
  SegmentedControlItem,
  Slider,
  StatusLight,
  Switch,
  Text,
} from '@react-spectrum/s2'
import DeviceDesktop from '@react-spectrum/s2/icons/DeviceDesktop'
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen'
import UserAvatar from '@react-spectrum/s2/icons/UserAvatar'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }
import { useId, useState } from 'react'

import { useTranslation } from '../../../localization/useTranslation'
import { observeRendererPromise } from '../../../reliability/observePromise'
import { type AvatarSettingsActions, type AvatarSettingsState } from '../state/settingsContracts'
import { overlayViewModes } from '../state/settingsDefaults'
import { parseOverlayViewMode } from '../state/settingsParsers'

const fullWidth = style({ width: 'full' })
const percentageFormat = { style: 'unit', unit: 'percent', unitDisplay: 'narrow' } as const

export function AvatarSettingsSection({
  state,
  actions,
}: {
  state: AvatarSettingsState
  actions: AvatarSettingsActions
}) {
  const { t } = useTranslation()
  const id = useId()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  async function updateFlashMotion(enabled: boolean) {
    setPending(true)
    setError(false)
    try {
      await actions.setFlashMotionEnabled(enabled)
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="avatar-settings">
      <section className="avatar-settings-card" aria-labelledby={`${id}-model`}>
        <div className="avatar-settings-header">
          <div className="avatar-settings-identity">
            <UserAvatar />
            <div className="avatar-settings-copy">
              <Heading level={3} id={`${id}-model`}>
                {t('settings.avatar.model')}
              </Heading>
              <Text UNSAFE_className="avatar-settings-help">
                {state.vrmName || t('settings.avatar.notSelected')}
              </Text>
            </div>
          </div>
          <Button
            variant="secondary"
            isDisabled={pending}
            onPress={() => observeRendererPromise(actions.pickVrm(), 'select avatar model')}
          >
            <FolderOpen />
            <Text>
              {t(state.vrmName ? 'settings.avatar.changeModel' : 'settings.avatar.chooseFile')}
            </Text>
          </Button>
        </div>
        <div className="avatar-settings-header">
          <div className="avatar-settings-copy">
            <Heading level={4} id={`${id}-flashmotion`}>
              {t('settings.avatar.flashMotion')}
            </Heading>
            <Text id={`${id}-flashmotion-detail`} UNSAFE_className="avatar-settings-help">
              {t('settings.avatar.flashMotionDetail')}
            </Text>
          </div>
          <Switch
            aria-labelledby={`${id}-flashmotion`}
            aria-describedby={`${id}-flashmotion-detail`}
            isSelected={state.flashMotionEnabled}
            isDisabled={pending}
            onChange={(enabled) =>
              observeRendererPromise(updateFlashMotion(enabled), 'configure FlashMotion')
            }
          />
        </div>
        {error && (
          <StatusLight variant="negative">{t('settings.avatar.flashMotionSaveFailed')}</StatusLight>
        )}
      </section>

      <section className="avatar-settings-card" aria-labelledby={`${id}-overlay`}>
        <div className="avatar-settings-header">
          <div className="avatar-settings-identity">
            <DeviceDesktop />
            <div className="avatar-settings-copy">
              <Heading level={3} id={`${id}-overlay`}>
                {t('settings.avatar.overlaySection')}
              </Heading>
              <Text UNSAFE_className="avatar-settings-help">
                {t('settings.avatar.overlaySettingsHint')}
              </Text>
            </div>
          </div>
          <Switch
            isEmphasized
            isSelected={state.overlayVisible}
            onChange={(visible) =>
              observeRendererPromise(actions.toggleOverlay(visible), 'toggle Overlay from Settings')
            }
          >
            {t('settings.avatar.overlayEnabled')}
          </Switch>
        </div>

        <section className="avatar-settings-group" aria-labelledby={`${id}-display`}>
          <Heading level={4} id={`${id}-display`}>
            {t('settings.avatar.displaySection')}
          </Heading>
          <div className="avatar-settings-fields">
            <div className="avatar-settings-field">
              <Text id={`${id}-framing`} UNSAFE_className="avatar-settings-label">
                {t('settings.avatar.cameraSection')}
              </Text>
              <SegmentedControl
                aria-labelledby={`${id}-framing`}
                selectedKey={state.overlayViewMode}
                onSelectionChange={(key) =>
                  actions.setOverlayViewMode(parseOverlayViewMode(String(key)))
                }
                isJustified
                styles={fullWidth}
              >
                {overlayViewModes.map((mode) => (
                  <SegmentedControlItem id={mode} key={mode}>
                    {t(`settings.avatar.cameraMode.${mode}`)}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>
            <Picker
              label={t('settings.avatar.position')}
              selectedKey={state.overlayCorner}
              onSelectionChange={(key) => actions.setOverlayCorner(String(key))}
              styles={fullWidth}
            >
              <PickerItem id="top-left">{t('settings.avatar.topLeft')}</PickerItem>
              <PickerItem id="top-right">{t('settings.avatar.topRight')}</PickerItem>
              <PickerItem id="bottom-left">{t('settings.avatar.bottomLeft')}</PickerItem>
              <PickerItem id="bottom-right">{t('settings.avatar.bottomRight')}</PickerItem>
            </Picker>
            <Slider
              label={t('settings.avatar.scale')}
              value={state.overlayScalePercent}
              minValue={50}
              maxValue={200}
              step={5}
              formatOptions={percentageFormat}
              onChange={actions.setOverlayScalePercent}
              styles={fullWidth}
            />
            <Slider
              label={t('settings.avatar.opacity')}
              value={state.overlayOpacityPercent}
              minValue={0}
              maxValue={100}
              step={1}
              formatOptions={percentageFormat}
              onChange={actions.setOverlayOpacityPercent}
              styles={fullWidth}
            />
          </div>
        </section>

        <section className="avatar-settings-group" aria-labelledby={`${id}-interaction`}>
          <Heading level={4} id={`${id}-interaction`}>
            {t('settings.avatar.interactionSection')}
          </Heading>
          <div className="avatar-settings-fields">
            <Switch
              isSelected={state.overlayClickThrough}
              onChange={actions.setOverlayClickThrough}
              description={t('settings.avatar.clickThroughDescription')}
              styles={fullWidth}
            >
              {t('settings.avatar.clickThrough')}
            </Switch>
            <Switch
              isSelected={state.overlayTransparentBackground}
              onChange={actions.setOverlayTransparentBackground}
              description={t('settings.avatar.transparentDescription')}
              styles={fullWidth}
            >
              {t('settings.avatar.transparent')}
            </Switch>
          </div>
        </section>

        <Disclosure isQuiet UNSAFE_className="avatar-settings-advanced">
          <DisclosureTitle level={4}>{t('settings.avatar.advancedWindow')}</DisclosureTitle>
          <DisclosurePanel>
            <div className="avatar-settings-group avatar-settings-window">
              <Text UNSAFE_className="avatar-settings-help">
                {t('settings.avatar.windowDescription')}
              </Text>
              <div className="avatar-settings-dimensions">
                <NumberField
                  label={t('settings.avatar.width')}
                  value={state.overlayWidth}
                  minValue={250}
                  maxValue={2000}
                  step={10}
                  onChange={actions.setOverlayWidth}
                  hideStepper
                  styles={fullWidth}
                />
                <NumberField
                  label={t('settings.avatar.height')}
                  value={state.overlayHeight}
                  minValue={250}
                  maxValue={2000}
                  step={10}
                  onChange={actions.setOverlayHeight}
                  hideStepper
                  styles={fullWidth}
                />
                <NumberField
                  label={t('settings.avatar.margin')}
                  value={state.overlayMargin}
                  minValue={0}
                  maxValue={500}
                  step={10}
                  onChange={actions.setOverlayMargin}
                  hideStepper
                  styles={fullWidth}
                />
              </div>
            </div>
          </DisclosurePanel>
        </Disclosure>

        <div className="avatar-settings-footer">
          <Button variant="secondary" fillStyle="outline" onPress={actions.resetOverlaySettings}>
            {t('settings.avatar.reset')}
          </Button>
        </div>
      </section>
    </div>
  )
}
