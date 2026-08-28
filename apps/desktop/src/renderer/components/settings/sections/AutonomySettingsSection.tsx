import {
  Button,
  Content,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Heading,
  InlineAlert,
  NumberField,
  Picker,
  PickerItem,
  ProgressCircle,
  StatusLight,
  Switch,
  Text,
  TextField,
} from '@react-spectrum/s2'
import { useEffect, useState } from 'react'

import { type AliveSnapshot, type AutonomyMode } from '../../../../shared/alive'
import { LLM_PROVIDER_IDS, type LlmProviderId } from '../../../../shared/llm'
import { useTranslation } from '../../../localization/useTranslation'

interface AutonomyLimitsDraft {
  quietStartHour: number
  quietEndHour: number
  cooldownMinutes: number
  maxDailyInitiatives: number
}

function limitsDraft(settings: AliveSnapshot['settings']): AutonomyLimitsDraft {
  return {
    quietStartHour: settings.quietHours.startHour,
    quietEndHour: settings.quietHours.endHour,
    cooldownMinutes: Math.round(settings.cooldownMs / 60_000),
    maxDailyInitiatives: settings.maxDailyInitiatives,
  }
}

export function AutonomySettingsSection({ snapshot }: { snapshot: AliveSnapshot | null }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelDraft, setModelDraft] = useState(snapshot?.settings.fastBrain.model ?? '')
  const [limits, setLimits] = useState<AutonomyLimitsDraft | null>(() =>
    snapshot ? limitsDraft(snapshot.settings) : null,
  )
  const snapshotQuietStartHour = snapshot?.settings.quietHours.startHour
  const snapshotQuietEndHour = snapshot?.settings.quietHours.endHour
  const snapshotCooldownMs = snapshot?.settings.cooldownMs
  const snapshotMaxDailyInitiatives = snapshot?.settings.maxDailyInitiatives

  useEffect(() => {
    setModelDraft(snapshot?.settings.fastBrain.model ?? '')
  }, [snapshot?.settings.fastBrain.model])

  useEffect(() => {
    if (
      snapshotQuietStartHour === undefined ||
      snapshotQuietEndHour === undefined ||
      snapshotCooldownMs === undefined ||
      snapshotMaxDailyInitiatives === undefined
    ) {
      setLimits(null)
      return
    }
    setLimits({
      quietStartHour: snapshotQuietStartHour,
      quietEndHour: snapshotQuietEndHour,
      cooldownMinutes: Math.round(snapshotCooldownMs / 60_000),
      maxDailyInitiatives: snapshotMaxDailyInitiatives,
    })
  }, [
    snapshotCooldownMs,
    snapshotMaxDailyInitiatives,
    snapshotQuietEndHour,
    snapshotQuietStartHour,
  ])

  if (!snapshot || !limits) {
    return (
      <div className="autonomy-settings-loading">
        <ProgressCircle isIndeterminate aria-label={t('common.loading')} />
      </div>
    )
  }

  const updateSettings = async (
    patch: Partial<AliveSnapshot['settings']>,
  ): Promise<AliveSnapshot> => {
    const updated = await window.api.alive.updateSettings({ ...snapshot.settings, ...patch })
    setLimits(limitsDraft(updated.settings))
    return updated
  }

  const run = async (operation: () => Promise<unknown>, rollback?: () => void): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (operationError) {
      rollback?.()
      setError(operationError instanceof Error ? operationError.message : String(operationError))
    } finally {
      setBusy(false)
    }
  }

  const updateLimits = (
    next: AutonomyLimitsDraft,
    patch: Partial<AliveSnapshot['settings']>,
  ): void => {
    setLimits(next)
    void run(
      () => updateSettings(patch),
      () => setLimits(limitsDraft(snapshot.settings)),
    )
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
            {t('tasks.autonomy.title')}
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
            label={t('tasks.autonomy.mode')}
            selectedKey={snapshot.settings.mode}
            isDisabled={busy}
            onSelectionChange={(key) =>
              void run(() => updateSettings({ mode: String(key) as AutonomyMode }))
            }
          >
            <PickerItem id="off">{t('tasks.mode.off')}</PickerItem>
            <PickerItem id="suggest">{t('tasks.mode.suggest')}</PickerItem>
            <PickerItem id="confirm">{t('tasks.mode.confirm')}</PickerItem>
            <PickerItem id="full">{t('tasks.mode.full')}</PickerItem>
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

      <section className="autonomy-settings-panel" aria-labelledby="autonomy-limits-title">
        <div className="autonomy-settings-copy">
          <Heading id="autonomy-limits-title" level={3}>
            {t('settings.autonomy.limitsTitle')}
          </Heading>
          <Text UNSAFE_className="settings-hint">
            {t('tasks.autonomy.limits', {
              count: snapshot.settings.maxDailyInitiatives,
              minutes: Math.round(snapshot.settings.cooldownMs / 60_000),
            })}
          </Text>
        </div>
        <div className="autonomy-setting-row">
          <Switch
            isSelected={snapshot.settings.quietHours.enabled}
            isDisabled={busy}
            onChange={(enabled) =>
              void run(() =>
                updateSettings({
                  quietHours: { ...snapshot.settings.quietHours, enabled },
                }),
              )
            }
          >
            {t('tasks.autonomy.quietHours')}
          </Switch>
          <Text UNSAFE_className="settings-hint">
            {t('settings.autonomy.quietHoursDescription')}
          </Text>
        </div>
        {snapshot.settings.quietHours.enabled && (
          <div className="autonomy-settings-grid">
            <NumberField
              label={t('tasks.autonomy.quietStart')}
              value={limits.quietStartHour}
              minValue={0}
              maxValue={23}
              isDisabled={busy}
              onChange={(quietStartHour) =>
                updateLimits(
                  { ...limits, quietStartHour },
                  {
                    quietHours: {
                      ...snapshot.settings.quietHours,
                      startHour: quietStartHour,
                    },
                  },
                )
              }
            />
            <NumberField
              label={t('tasks.autonomy.quietEnd')}
              value={limits.quietEndHour}
              minValue={0}
              maxValue={23}
              isDisabled={busy}
              onChange={(quietEndHour) =>
                updateLimits(
                  { ...limits, quietEndHour },
                  {
                    quietHours: {
                      ...snapshot.settings.quietHours,
                      endHour: quietEndHour,
                    },
                  },
                )
              }
            />
          </div>
        )}
        <div className="autonomy-settings-grid">
          <NumberField
            label={t('tasks.autonomy.cooldownMinutes')}
            value={limits.cooldownMinutes}
            minValue={1}
            maxValue={1_440}
            isDisabled={busy}
            onChange={(cooldownMinutes) =>
              updateLimits({ ...limits, cooldownMinutes }, { cooldownMs: cooldownMinutes * 60_000 })
            }
          />
          <NumberField
            label={t('tasks.autonomy.dailyCap')}
            value={limits.maxDailyInitiatives}
            minValue={0}
            maxValue={100}
            isDisabled={busy}
            onChange={(maxDailyInitiatives) =>
              updateLimits({ ...limits, maxDailyInitiatives }, { maxDailyInitiatives })
            }
          />
        </div>
      </section>

      <Disclosure isQuiet UNSAFE_className="autonomy-advanced">
        <DisclosureTitle level={3}>{t('settings.autonomy.advanced')}</DisclosureTitle>
        <DisclosurePanel>
          <div className="autonomy-settings-panel">
            <div className="autonomy-setting-row">
              <Switch
                isSelected={snapshot.settings.fastBrain.enabled}
                isDisabled={busy || snapshot.settings.privacyMode}
                onChange={(enabled) =>
                  void run(() =>
                    updateSettings({
                      fastBrain: { ...snapshot.settings.fastBrain, enabled },
                    }),
                  )
                }
              >
                {t('tasks.fastBrain')}
              </Switch>
              <Text UNSAFE_className="settings-hint">
                {t('settings.autonomy.fastBrainDescription')}
              </Text>
              <Text UNSAFE_className="settings-hint">
                {t('settings.autonomy.fastBrainDifference')}
              </Text>
            </div>
            {snapshot.settings.fastBrain.enabled && !snapshot.settings.privacyMode && (
              <div className="autonomy-settings-grid">
                <Picker
                  label={t('tasks.fastBrain.provider')}
                  selectedKey={snapshot.settings.fastBrain.providerId ?? 'active'}
                  isDisabled={busy}
                  onSelectionChange={(key) =>
                    void run(() =>
                      updateSettings({
                        fastBrain: {
                          ...snapshot.settings.fastBrain,
                          providerId:
                            String(key) === 'active' ? undefined : (String(key) as LlmProviderId),
                        },
                      }),
                    )
                  }
                >
                  <PickerItem id="active">{t('tasks.fastBrain.activeProvider')}</PickerItem>
                  {LLM_PROVIDER_IDS.map((providerId) => (
                    <PickerItem id={providerId} key={providerId}>
                      {providerId}
                    </PickerItem>
                  ))}
                </Picker>
                <TextField
                  label={t('tasks.fastBrain.model')}
                  placeholder={t('tasks.fastBrain.modelPlaceholder')}
                  value={modelDraft}
                  isDisabled={busy}
                  onChange={setModelDraft}
                  onBlur={() =>
                    void run(() =>
                      updateSettings({
                        fastBrain: {
                          ...snapshot.settings.fastBrain,
                          model: modelDraft.trim() || undefined,
                        },
                      }),
                    )
                  }
                />
                <NumberField
                  label={t('tasks.fastBrain.timeout')}
                  value={snapshot.settings.fastBrain.timeoutMs}
                  minValue={250}
                  maxValue={5_000}
                  step={250}
                  isDisabled={busy}
                  onChange={(timeoutMs) =>
                    void run(() =>
                      updateSettings({
                        fastBrain: { ...snapshot.settings.fastBrain, timeoutMs },
                      }),
                    )
                  }
                />
                <NumberField
                  label={t('tasks.fastBrain.tokens')}
                  value={snapshot.settings.fastBrain.maxTokens}
                  minValue={16}
                  maxValue={256}
                  step={16}
                  isDisabled={busy}
                  onChange={(maxTokens) =>
                    void run(() =>
                      updateSettings({
                        fastBrain: { ...snapshot.settings.fastBrain, maxTokens },
                      }),
                    )
                  }
                />
              </div>
            )}
          </div>
        </DisclosurePanel>
      </Disclosure>
    </div>
  )
}
