import { ActionButton, StatusLight, Switch, Text, TextField } from '@react-spectrum/s2'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }

import {
  isValidProjectBranch,
  isValidProjectRepository,
} from '../../../../shared/project-awareness'
import { useTranslation } from '../../../localization/useTranslation'
import { type ProjectSettingsActions, type ProjectSettingsState } from '../state/settingsContracts'

const fullWidth = style({ width: 'full' })

export function ProjectSettingsSection({
  state,
  actions,
}: {
  state: ProjectSettingsState
  actions: ProjectSettingsActions
}) {
  const { t } = useTranslation()
  return (
    <div className="settings-grid">
      <Switch
        isSelected={state.enabled}
        onChange={(enabled) => {
          actions.setEnabled(enabled)
          actions.setApplyState('idle')
        }}
      >
        {t('settings.project.enable')}
      </Switch>
      <TextField
        label={t('settings.project.repository')}
        value={state.repository}
        onChange={(value) => {
          actions.setRepository(value)
          actions.setApplyState('idle')
        }}
        placeholder="owner/repository"
        isDisabled={!state.enabled}
        isInvalid={state.enabled && !isValidProjectRepository(state.repository)}
        errorMessage={t('main.error.project.repositoryFormat')}
        styles={fullWidth}
      />
      <TextField
        label={t('settings.project.branch')}
        value={state.branch}
        onChange={(value) => {
          actions.setBranch(value)
          actions.setApplyState('idle')
        }}
        placeholder="main"
        isDisabled={!state.enabled}
        isInvalid={state.enabled && !isValidProjectBranch(state.branch)}
        errorMessage={t('main.error.project.branchInvalid')}
        styles={fullWidth}
      />
      <Text UNSAFE_className="settings-hint">{t('settings.project.targetChange')}</Text>
      <div className="settings-row">
        <ActionButton
          isDisabled={!state.settingsValid || state.runtimeBusy}
          onPress={() => void actions.apply()}
        >
          {state.applyState === 'applying'
            ? t('settings.project.applying')
            : t('settings.project.apply')}
        </ActionButton>
        {state.status && (
          <StatusLight
            variant={
              state.status.state === 'ready'
                ? 'positive'
                : state.status.state === 'error'
                  ? 'negative'
                  : 'neutral'
            }
          >
            {state.status.credential.configured
              ? t('settings.project.credentialSaved', { state: state.status.state })
              : t('settings.project.credentialMissing')}
          </StatusLight>
        )}
      </div>
      {state.applyState === 'applied' && (
        <Text UNSAFE_className="settings-hint">{t('settings.project.applied')}</Text>
      )}
      {state.applyError && (
        <Text UNSAFE_className="project-awareness-error">{state.applyError}</Text>
      )}
      <div className="project-credential-panel">
        <div className="project-credential-copy">
          <strong>{t('settings.project.credential.title')}</strong>
          <span>{t('settings.project.credential.description')}</span>
        </div>
        <TextField
          label={
            state.status?.credential.configured
              ? t('settings.project.credential.replace')
              : t('settings.project.credential.token')
          }
          value={state.credentialInput}
          onChange={actions.setCredentialInput}
          type="password"
          placeholder="github_pat_…"
          isDisabled={state.runtimeBusy}
          styles={fullWidth}
        />
        <div className="project-credential-actions">
          <ActionButton
            isDisabled={state.runtimeBusy || !state.status?.credential.secureStorageAvailable}
            onPress={() => void actions.openTokenSettings()}
          >
            {t('settings.project.credential.create')}
          </ActionButton>
          <ActionButton
            isDisabled={
              state.runtimeBusy ||
              !state.enabled ||
              !state.targetApplied ||
              !state.status?.credential.secureStorageAvailable ||
              state.credentialInput.trim().length < 20
            }
            onPress={() => void actions.saveCredential()}
          >
            {state.status?.credential.configured
              ? t('settings.project.credential.replaceAndConnect')
              : t('settings.project.credential.saveAndConnect')}
          </ActionButton>
          {state.status?.credential.source === 'secure_store' && (
            <ActionButton
              isDisabled={state.runtimeBusy}
              onPress={() => void actions.forgetCredential()}
            >
              {state.forgetConfirmation
                ? t('settings.project.credential.confirmForget')
                : t('settings.project.credential.forget')}
            </ActionButton>
          )}
        </div>
        {!state.status?.credential.secureStorageAvailable && (
          <Text UNSAFE_className="project-credential-warning">
            {t('settings.project.credential.unavailable')}
          </Text>
        )}
        {state.status?.credential.lastError && (
          <Text UNSAFE_className="project-credential-warning">
            {state.status.credential.lastError}
          </Text>
        )}
      </div>
      <div className="project-runtime-controls">
        <div className="project-credential-copy">
          <strong>{t('settings.project.controls.title')}</strong>
          <span>{t('settings.project.controls.description')}</span>
        </div>
        <div className="project-awareness-actions">
          {state.connected ? (
            <ActionButton
              isDisabled={state.runtimeBusy || !state.targetApplied}
              onPress={() => void actions.disconnect()}
            >
              {t('common.disconnect')}
            </ActionButton>
          ) : (
            <ActionButton
              isDisabled={
                state.runtimeBusy ||
                !state.enabled ||
                !state.targetApplied ||
                !state.status?.credential.configured
              }
              onPress={() => void actions.connect()}
            >
              {t('common.connect')}
            </ActionButton>
          )}
          <ActionButton
            isDisabled={!state.connected || state.runtimeBusy || !state.targetApplied}
            onPress={() => void actions.sync()}
          >
            {t('settings.project.sync')}
          </ActionButton>
          <ActionButton
            isDisabled={
              !state.hasIndex ||
              state.runtimeBusy ||
              !state.enabled ||
              !state.targetApplied ||
              !state.status?.credential.configured
            }
            onPress={() => void actions.rebuild()}
          >
            {t('settings.project.rebuild')}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
