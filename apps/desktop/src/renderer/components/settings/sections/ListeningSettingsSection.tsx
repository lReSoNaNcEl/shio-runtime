import {
  Content,
  ContextualHelp,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Heading,
  NumberField,
  SegmentedControl,
  SegmentedControlItem,
  Slider,
  Text,
} from '@react-spectrum/s2'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }
import type * as React from 'react'

import { useTranslation } from '../../../localization/useTranslation'
import { parseAttentionMode } from '../../../speech/continuous-listening/tuning'
import type { ListeningSettingsActions, ListeningSettingsState } from '../state/settingsContracts'

const fullWidth = style({ width: 'full' })

export function ListeningSettingsSection({
  state,
  actions,
}: {
  state: ListeningSettingsState
  actions: ListeningSettingsActions
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="settings-grid streaming-settings">
      <div className="streaming-field-heading">
        <Heading level={3}>{t('streaming.mode.label')}</Heading>
        <ContextualHelp variant="info" aria-label={t('settings.listening.help')}>
          <Heading>{t('settings.listening.help')}</Heading>
          <Content>
            <div className="attention-mode-help">
              <p>{t('settings.listening.silent.help')}</p>
              <p>{t('settings.listening.passive.help')}</p>
              <p>{t('settings.listening.active.help')}</p>
              <p>{t('settings.listening.streamer.help')}</p>
            </div>
          </Content>
        </ContextualHelp>
      </div>
      <SegmentedControl
        aria-label={t('streaming.mode.label')}
        selectedKey={state.mode}
        onSelectionChange={(key) => void actions.setMode(parseAttentionMode(String(key)))}
        isJustified
        styles={fullWidth}
        UNSAFE_className="settings-attention-modes"
      >
        <SegmentedControlItem id="silent">Silent</SegmentedControlItem>
        <SegmentedControlItem id="passive">Passive</SegmentedControlItem>
        <SegmentedControlItem id="active">Active</SegmentedControlItem>
        <SegmentedControlItem id="streamer">Streamer</SegmentedControlItem>
      </SegmentedControl>
      <Text>
        {state.mode === 'active'
          ? t('settings.listening.active.summary')
          : state.mode === 'streamer'
            ? t('settings.listening.streamer.summary')
            : state.mode === 'passive'
              ? t('settings.listening.passive.summary')
              : t('settings.listening.silent.summary')}
      </Text>
      <div className="streaming-slider">
        <Slider
          label={t('settings.listening.spontaneity')}
          value={state.curiosityChancePercent}
          minValue={0}
          maxValue={20}
          step={1}
          onChange={actions.setCuriosityChancePercent}
          isDisabled={!state.curiosityEnabled}
        />
        <span className="streaming-slider-value">{state.curiosityChancePercent}%</span>
        <div className="streaming-slider-ends">
          <Text>{t('settings.listening.rare')}</Text>
          <Text>{t('settings.listening.often')}</Text>
        </div>
      </div>
      <Disclosure isQuiet>
        <DisclosureTitle>{t('settings.listening.advanced')}</DisclosureTitle>
        <DisclosurePanel>
          <div className="streaming-advanced-fields">
            <NumberField
              label={t('settings.listening.replyCooldown')}
              value={state.replyCooldownMs / 1000}
              minValue={0}
              maxValue={120}
              step={0.5}
              onChange={(value) => actions.setReplyCooldownMs(value * 1000)}
            />
            <Text slot="description">{t('settings.listening.replyCooldown.description')}</Text>
            <NumberField
              label={t('settings.listening.followUpWindow')}
              value={state.followUpWindowMs / 1000}
              minValue={0}
              maxValue={120}
              step={0.5}
              onChange={(value) => actions.setFollowUpWindowMs(value * 1000)}
            />
            <Text slot="description">{t('settings.listening.followUpWindow.description')}</Text>
          </div>
        </DisclosurePanel>
      </Disclosure>
    </div>
  )
}
