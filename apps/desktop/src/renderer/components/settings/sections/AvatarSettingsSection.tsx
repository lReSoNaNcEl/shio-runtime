import {
  Button,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Divider,
  Heading,
  NumberField,
  SegmentedControl,
  SegmentedControlItem,
  Slider,
  Switch,
  Text,
} from '@react-spectrum/s2'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }

import { overlayCameraPresets } from '../../../avatar/tuning/cameraTuning'
import { useTranslation } from '../../../localization/useTranslation'
import { observeRendererPromise } from '../../../reliability/observePromise'
import { type AvatarSettingsActions, type AvatarSettingsState } from '../state/settingsContracts'
import { overlayViewModes } from '../state/settingsDefaults'
import { parseOverlayViewMode } from '../state/settingsParsers'

const fullWidth = style({ width: 'full' })

export function AvatarSettingsSection({
  state,
  actions,
}: {
  state: AvatarSettingsState
  actions: AvatarSettingsActions
}) {
  const { t } = useTranslation()
  return (
    <div className="settings-grid avatar-panel">
      <section className="avatar-section" aria-labelledby="avatar-model-title">
        <Heading level={3} id="avatar-model-title" UNSAFE_className="overlay-section-title">
          {t('settings.avatar.modelSection')}
        </Heading>
        <div className="settings-field">
          <Text UNSAFE_className="settings-label">{t('settings.avatar.model')}</Text>
          <div className="settings-row">
            <Button
              variant="secondary"
              onPress={() => observeRendererPromise(actions.pickVrm(), 'select VRM asset')}
            >
              {t('settings.avatar.chooseFile')}
            </Button>
            <Text UNSAFE_className="settings-hint">
              {state.vrmName || t('settings.avatar.notSelected')}
            </Text>
          </div>
        </div>
      </section>
      <Divider />
      <section
        className="overlay-section overlay-display-section"
        aria-labelledby="avatar-overlay-title"
      >
        <Heading level={3} id="avatar-overlay-title" UNSAFE_className="overlay-section-title">
          {t('settings.avatar.overlaySection')}
        </Heading>
        <Switch
          size="L"
          isEmphasized
          isSelected={state.overlayVisible}
          onChange={(visible) =>
            observeRendererPromise(actions.toggleOverlay(visible), 'toggle Overlay from Settings')
          }
        >
          {t('settings.avatar.overlayEnabled')}
        </Switch>
        <Text UNSAFE_className="settings-hint">{t('settings.avatar.overlayEnabledHint')}</Text>
        {!state.overlayVisible && (
          <Text UNSAFE_className="settings-hint overlay-disabled-note">
            {t('settings.avatar.overlayDisabled')}
          </Text>
        )}
      </section>
      <div className={!state.overlayVisible ? 'overlay-disabled-content' : undefined}>
        <section className="overlay-section" aria-labelledby="overlay-camera-title">
          <div>
            <Heading level={3} id="overlay-camera-title" UNSAFE_className="overlay-section-title">
              {t('settings.avatar.cameraSection')}
            </Heading>
            <Text UNSAFE_className="settings-hint">{t('settings.avatar.cameraDescription')}</Text>
          </div>
          <SegmentedControl
            aria-label={t('settings.avatar.cameraSection')}
            selectedKey={state.overlayViewMode}
            onSelectionChange={(key) =>
              actions.setOverlayViewMode(parseOverlayViewMode(String(key)))
            }
            isDisabled={!state.overlayVisible}
            isJustified
            styles={fullWidth}
          >
            {overlayViewModes.map((mode) => (
              <SegmentedControlItem key={mode} id={mode}>
                {overlayCameraPresets[mode].label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </section>
        <section className="overlay-section" aria-labelledby="overlay-display-sub-title">
          <Heading
            level={3}
            id="overlay-display-sub-title"
            UNSAFE_className="overlay-section-title"
          >
            {t('settings.avatar.displaySection')}
          </Heading>
          <div className="overlay-slider-grid">
            <Slider
              label={t('settings.avatar.opacity')}
              value={state.overlayOpacityPercent}
              minValue={0}
              maxValue={100}
              step={1}
              onChange={actions.setOverlayOpacityPercent}
              isDisabled={!state.overlayVisible}
            />
            <Text UNSAFE_className="overlay-slider-value">{state.overlayOpacityPercent}%</Text>
          </div>
          <div className="overlay-slider-grid">
            <Slider
              label={t('settings.avatar.scale')}
              value={state.overlayScalePercent}
              minValue={50}
              maxValue={200}
              step={5}
              onChange={actions.setOverlayScalePercent}
              isDisabled={!state.overlayVisible}
            />
            <Text UNSAFE_className="overlay-slider-value">{state.overlayScalePercent}%</Text>
          </div>
          <SegmentedControl
            aria-label={t('settings.avatar.position')}
            selectedKey={state.overlayCorner}
            onSelectionChange={(key) => actions.setOverlayCorner(String(key))}
            isDisabled={!state.overlayVisible}
            isJustified
            styles={fullWidth}
          >
            <SegmentedControlItem id="top-left">
              {t('settings.avatar.topLeft')}
            </SegmentedControlItem>
            <SegmentedControlItem id="top-right">
              {t('settings.avatar.topRight')}
            </SegmentedControlItem>
            <SegmentedControlItem id="bottom-left">
              {t('settings.avatar.bottomLeft')}
            </SegmentedControlItem>
            <SegmentedControlItem id="bottom-right">
              {t('settings.avatar.bottomRight')}
            </SegmentedControlItem>
          </SegmentedControl>
        </section>
        <Disclosure isQuiet UNSAFE_className="overlay-section overlay-advanced">
          <DisclosureTitle level={3}>{t('settings.avatar.advancedWindow')}</DisclosureTitle>
          <DisclosurePanel>
            <Text UNSAFE_className="settings-hint">{t('settings.avatar.windowDescription')}</Text>
            <div className="overlay-number-grid">
              <NumberField
                label={t('settings.avatar.width')}
                value={state.overlayWidth}
                minValue={250}
                maxValue={2000}
                step={10}
                onChange={actions.setOverlayWidth}
                isDisabled={!state.overlayVisible}
                hideStepper
              />
              <NumberField
                label={t('settings.avatar.height')}
                value={state.overlayHeight}
                minValue={250}
                maxValue={2000}
                step={10}
                onChange={actions.setOverlayHeight}
                isDisabled={!state.overlayVisible}
                hideStepper
              />
              <NumberField
                label={t('settings.avatar.margin')}
                value={state.overlayMargin}
                minValue={0}
                maxValue={500}
                step={10}
                onChange={actions.setOverlayMargin}
                isDisabled={!state.overlayVisible}
                hideStepper
              />
            </div>
          </DisclosurePanel>
        </Disclosure>
        <section className="overlay-section" aria-labelledby="overlay-interaction-title">
          <Heading
            level={3}
            id="overlay-interaction-title"
            UNSAFE_className="overlay-section-title"
          >
            {t('settings.avatar.interactionSection')}
          </Heading>
          <div className="overlay-switch-list">
            <Switch
              isSelected={state.overlayClickThrough}
              onChange={actions.setOverlayClickThrough}
              isDisabled={!state.overlayVisible}
            >
              {t('settings.avatar.clickThrough')}
            </Switch>
            <Text UNSAFE_className="settings-hint">
              {t('settings.avatar.clickThroughDescription')}
            </Text>
          </div>
          <div className="overlay-switch-list">
            <Switch
              isSelected={state.overlayTransparentBackground}
              onChange={actions.setOverlayTransparentBackground}
              isDisabled={!state.overlayVisible}
            >
              {t('settings.avatar.transparent')}
            </Switch>
            <Text UNSAFE_className="settings-hint">
              {t('settings.avatar.transparentDescription')}
            </Text>
          </div>
        </section>
      </div>
      <div className="settings-row overlay-actions-row">
        <Button variant="secondary" onPress={actions.resetOverlaySettings}>
          {t('settings.avatar.reset')}
        </Button>
      </div>
    </div>
  )
}
