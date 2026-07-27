import { ActionButton, StatusLight, Text, TextField } from '@react-spectrum/s2'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }

import {
  isValidProjectBranch,
  isValidProjectRepository,
} from '../../../../shared/project-awareness'
import { useTranslation } from '../../../localization/useTranslation'
import { connectionStatusKey, credentialStatusKey } from '../projectStatusPresentation'
import { type ProjectSettingsActions, type ProjectSettingsState } from '../state/settingsContracts'

const fullWidth = style({ width: 'full' })

export function ProjectSettingsSection({
  state,
  actions,
}: {
  state: ProjectSettingsState
  actions: ProjectSettingsActions
}) {
  const { intlLocale, t } = useTranslation()
  const credentialReady = Boolean(state.status?.credential.configured)
  const targetValid =
    isValidProjectRepository(state.repository) && isValidProjectBranch(state.branch)

  return (
    <div className="settings-grid project-setup-flow">
      <section className="project-stage" aria-labelledby="project-credential-title">
        <h3 id="project-credential-title">{t('settings.project.credential.title')}</h3>
        <p>{t('settings.project.credential.description')}</p>
        {state.status && (
          <StatusLight
            variant={
              state.status.credential.configured
                ? 'positive'
                : state.status.credential.lastError
                  ? 'negative'
                  : 'neutral'
            }
          >
            {t(credentialStatusKey(state.status.credential))}
          </StatusLight>
        )}
        <TextField
          label={
            credentialReady
              ? t('settings.project.credential.replace')
              : t('settings.project.credential.token')
          }
          value={state.credentialInput}
          onChange={actions.setCredentialInput}
          type="password"
          autoComplete="off"
          isDisabled={state.runtimeBusy}
          styles={fullWidth}
        />
        <div className="project-credential-actions">
          <ActionButton onPress={() => void actions.openTokenSettings()}>
            {t('settings.project.credential.create')}
          </ActionButton>
          <ActionButton
            isDisabled={
              state.runtimeBusy ||
              !state.status?.credential.secureStorageAvailable ||
              state.credentialInput.trim().length < 20
            }
            onPress={() => void actions.saveCredential()}
          >
            {credentialReady
              ? t('settings.project.credential.replace')
              : t('settings.project.credential.save')}
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
      </section>

      <section
        className="project-stage"
        aria-labelledby="project-target-title"
        aria-disabled={!credentialReady}
      >
        <h3 id="project-target-title">{t('settings.project.target.title')}</h3>
        {!credentialReady && <p>{t('settings.project.target.credentialRequired')}</p>}
        <TextField
          label={t('settings.project.repository')}
          value={state.repository}
          onChange={actions.setRepository}
          placeholder="owner/repository"
          isDisabled={!credentialReady || state.runtimeBusy}
          isInvalid={credentialReady && !isValidProjectRepository(state.repository)}
          errorMessage={t('main.error.project.repositoryFormat')}
          styles={fullWidth}
        />
        <TextField
          label={t('settings.project.branch')}
          value={state.branch}
          onChange={actions.setBranch}
          placeholder="main"
          isDisabled={!credentialReady || state.runtimeBusy}
          isInvalid={credentialReady && !isValidProjectBranch(state.branch)}
          errorMessage={t('main.error.project.branchInvalid')}
          styles={fullWidth}
        />
        <ActionButton
          isDisabled={!credentialReady || !targetValid || state.runtimeBusy}
          onPress={() => void actions.connect()}
        >
          {t('settings.project.connectProject')}
        </ActionButton>
      </section>

      <section
        className="project-stage"
        aria-labelledby="project-runtime-title"
        aria-disabled={!state.connected}
      >
        <h3 id="project-runtime-title">{t('settings.project.controls.title')}</h3>
        {!state.connected && <p>{t('settings.project.controls.connectRequired')}</p>}
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
            {t(connectionStatusKey[state.status.state])}
          </StatusLight>
        )}
        {state.status?.remoteHead && (
          <Text UNSAFE_className="settings-hint">
            {t('settings.project.commit', { sha: state.status.remoteHead.slice(0, 12) })}
          </Text>
        )}
        {state.status?.lastSyncAt && (
          <Text UNSAFE_className="settings-hint">
            {t('settings.project.lastSync', {
              time: new Date(state.status.lastSyncAt).toLocaleString(intlLocale),
            })}
          </Text>
        )}
        <div className="project-awareness-actions">
          <ActionButton
            isDisabled={!state.connected || state.runtimeBusy}
            onPress={() => void actions.sync()}
          >
            {t('settings.project.sync')}
          </ActionButton>
          <ActionButton
            isDisabled={!state.connected || state.runtimeBusy}
            onPress={() => void actions.rebuild()}
          >
            {t('settings.project.rebuild')}
          </ActionButton>
          <ActionButton
            isDisabled={!state.connected || state.runtimeBusy}
            onPress={() => void actions.disconnect()}
          >
            {t('common.disconnect')}
          </ActionButton>
        </div>
        {state.applyError && (
          <div className="project-awareness-error" role="alert">
            {state.applyError}
          </div>
        )}
      </section>
    </div>
  )
}
