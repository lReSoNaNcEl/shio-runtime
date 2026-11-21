import {
  Button,
  Content,
  Heading,
  InlineAlert,
  Picker,
  PickerItem,
  ProgressCircle,
  StatusLight,
  Switch,
  Text,
} from '@react-spectrum/s2'
import { useState } from 'react'

import { type AliveSnapshot, type AutonomyMode } from '../../../../shared/alive'
import { useTranslation } from '../../../localization/useTranslation'

export function AutonomySettingsSection({ snapshot }: { snapshot: AliveSnapshot | null }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!snapshot) {
    return (
      <div className="autonomy-settings-loading">
        <ProgressCircle isIndeterminate aria-label={t('common.loading')} />
      </div>
    )
  }

  const updateSettings = (patch: Partial<AliveSnapshot['settings']>) =>
    window.api.alive.updateSettings({ ...snapshot.settings, ...patch })

  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : String(operationError))
    } finally {
      setBusy(false)
    }
  }

  const autonomyState =
    snapshot.settings.mode === 'off'
      ? 'off'
      : snapshot.settings.globallySuspended
        ? 'paused'
        : 'active'

  const toggleAutonomy = (): void => {
    if (snapshot.settings.mode === 'off') {
      void run(() => updateSettings({ mode: 'suggest', globallySuspended: false }))
      return
    }
    void run(() => updateSettings({ globallySuspended: !snapshot.settings.globallySuspended }))
  }

  return (
    <div className="autonomy-settings-stack">
      {error && (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('common.error')}</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      )}

      <section className="autonomy-master-card" aria-labelledby="autonomy-master-title">
        <div className="autonomy-settings-copy">
          <Heading id="autonomy-master-title" level={3}>
            {t('autonomy.title')}
          </Heading>
          <Text UNSAFE_className="settings-hint">{t('settings.autonomy.masterDescription')}</Text>
        </div>
        <div className="autonomy-master-action">
          <StatusLight variant={autonomyState === 'active' ? 'positive' : 'notice'}>
            {t(`settings.autonomy.status.${autonomyState}`)}
          </StatusLight>
          <Button variant="secondary" isDisabled={busy} onPress={toggleAutonomy}>
            {t(autonomyState === 'active' ? 'settings.autonomy.pause' : 'settings.autonomy.resume')}
          </Button>
        </div>
      </section>

      <section className="autonomy-settings-panel" aria-labelledby="autonomy-policy-title">
        <div className="autonomy-settings-copy">
          <Heading id="autonomy-policy-title" level={3}>
            {t('settings.autonomy.policyTitle')}
          </Heading>
          <Text UNSAFE_className="settings-hint">{t('settings.autonomy.policyDescription')}</Text>
        </div>
        <div className="autonomy-settings-fields">
          <Picker
            label={t('autonomy.mode')}
            selectedKey={snapshot.settings.mode}
            isDisabled={busy}
            onSelectionChange={(key) =>
              void run(() => updateSettings({ mode: String(key) as AutonomyMode }))
            }
          >
            <PickerItem id="off">{t('autonomy.mode.off')}</PickerItem>
            <PickerItem id="suggest">{t('autonomy.mode.suggest')}</PickerItem>
            <PickerItem id="confirm">{t('autonomy.mode.confirm')}</PickerItem>
            <PickerItem id="full">{t('autonomy.mode.full')}</PickerItem>
          </Picker>
          <div className="autonomy-setting-row">
            <Switch
              isSelected={!snapshot.settings.privacyMode}
              isDisabled={busy}
              onChange={(allowComputerContext) =>
                void run(() => updateSettings({ privacyMode: !allowComputerContext }))
              }
            >
              {t('settings.autonomy.computerContext')}
            </Switch>
            <Text UNSAFE_className="settings-hint">
              {t('settings.autonomy.computerContextDescription')}
            </Text>
          </div>
        </div>
      </section>
    </div>
  )
}
