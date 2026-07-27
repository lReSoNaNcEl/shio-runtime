import {
  Button,
  Divider,
  NumberField,
  SegmentedControl,
  SegmentedControlItem,
  Slider,
  Switch,
} from '@react-spectrum/s2'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }

import { overlayCameraPresets } from '../../../avatar/tuning/cameraTuning'
import { useTranslation } from '../../../localization/useTranslation'
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
        <h3 id="avatar-model-title" className="overlay-section-title">
          {t('settings.avatar.modelSection')}
        </h3>
        <div className="settings-field">
          <span className="settings-label">{t('settings.avatar.model')}</span>
          <div className="settings-row">
            <Button variant="secondary" onPress={() => void actions.pickVrm()}>
              {t('settings.avatar.chooseFile')}
            </Button>
            <span className="settings-hint">
              {state.vrmName || t('settings.avatar.notSelected')}
            </span>
          </div>
        </div>
      </section>
      <Divider />
      <section
        className="overlay-section overlay-display-section"
        aria-labelledby="avatar-overlay-title"
      >
        <h3 id="avatar-overlay-title" className="overlay-section-title">
          {t('settings.avatar.overlaySection')}
        </h3>
        <Switch
          size="L"
          isEmphasized
          isSelected={state.overlayVisible}
          onChange={(visible) => void actions.toggleOverlay(visible)}
        >
          {t('settings.avatar.overlayEnabled')}
        </Switch>
        <span className="settings-hint">{t('settings.avatar.overlayEnabledHint')}</span>
        {!state.overlayVisible && (
          <span className="settings-hint overlay-disabled-note">
            {t('settings.avatar.overlayDisabled')}
          </span>
        )}
      </section>
      <div className={!state.overlayVisible ? 'overlay-disabled-content' : undefined}>
        <section className="overlay-section" aria-labelledby="overlay-camera-title">
          <div>
            <h3 id="overlay-camera-title" className="overlay-section-title">
              {t('settings.avatar.cameraSection')}
            </h3>
            <span className="settings-hint">{t('settings.avatar.cameraDescription')}</span>
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
          <h3 id="overlay-display-sub-title" className="overlay-section-title">
            {t('settings.avatar.displaySection')}
          </h3>
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
            <span className="overlay-slider-value">{state.overlayOpacityPercent}%</span>
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
            <span className="overlay-slider-value">{state.overlayScalePercent}%</span>
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
        <details className="overlay-section overlay-advanced">
          <summary>{t('settings.avatar.advancedWindow')}</summary>
          <div>
            <h3 id="overlay-window-title" className="overlay-section-title">
              {t('settings.avatar.windowSection')}
            </h3>
            <span className="settings-hint">{t('settings.avatar.windowDescription')}</span>
          </div>
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
        </details>
        <section className="overlay-section" aria-labelledby="overlay-interaction-title">
          <h3 id="overlay-interaction-title" className="overlay-section-title">
            {t('settings.avatar.interactionSection')}
          </h3>
          <div className="overlay-switch-list">
            <Switch
              isSelected={state.overlayClickThrough}
              onChange={actions.setOverlayClickThrough}
              isDisabled={!state.overlayVisible}
            >
              {t('settings.avatar.clickThrough')}
            </Switch>
            <span className="settings-hint">{t('settings.avatar.clickThroughDescription')}</span>
          </div>
          <div className="overlay-switch-list">
            <Switch
              isSelected={state.overlayTransparentBackground}
              onChange={actions.setOverlayTransparentBackground}
              isDisabled={!state.overlayVisible}
            >
              {t('settings.avatar.transparent')}
            </Switch>
            <span className="settings-hint">{t('settings.avatar.transparentDescription')}</span>
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
