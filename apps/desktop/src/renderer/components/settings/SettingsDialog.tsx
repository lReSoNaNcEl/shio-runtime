import { Content, Divider, Heading, ProgressCircle, StatusLight } from '@react-spectrum/s2'

import { useTranslation } from '../../localization/useTranslation'
import { SettingsNavigation } from './SettingsNavigation'
import { AdvancedSettingsSection } from './sections/AdvancedSettingsSection'
import { AvatarSettingsSection } from './sections/AvatarSettingsSection'
import { GeneralSettingsSection } from './sections/GeneralSettingsSection'
import { ListeningSettingsSection } from './sections/ListeningSettingsSection'
import { LlmSettingsSection } from './sections/LlmSettingsSection'
import { ProjectSettingsSection } from './sections/ProjectSettingsSection'
import { SpeechSettingsSection } from './sections/SpeechSettingsSection'
import { type SettingsDialogProps, type SettingsSection } from './state/settingsContracts'
import { useSettingsDialogState } from './state/useSettingsDialogState'

export function SettingsDialog({
  isOpen,
  initialSection = 'general',
  continuousListeningMode,
  passiveCompanionEnabled,
  onPassiveCompanionChange,
  overlayVisible,
  overlayViewModeProjection,
  llmHealth,
  onOverlayVisibleChange,
  onToggleOverlay,
}: SettingsDialogProps) {
  const { t } = useTranslation()
  const viewModel = useSettingsDialogState({
    isOpen,
    initialSection,
    continuousListeningMode,
    passiveCompanionEnabled,
    onPassiveCompanionChange,
    overlayVisible,
    overlayViewModeProjection,
    llmHealth,
    onOverlayVisibleChange,
    onToggleOverlay,
  })
  const labels: Record<SettingsSection, string> = {
    general: t('settings.section.general'),
    project: t('settings.section.project'),
    speech: t('settings.section.speech'),
    listening: t('settings.section.listening'),
    llm: t('settings.section.llm'),
    avatar: t('settings.section.avatar'),
    advanced: t('settings.section.advanced'),
  }

  if (!isOpen) return null

  const section =
    viewModel.activeSection === 'general' ? (
      <GeneralSettingsSection {...viewModel.general} />
    ) : viewModel.activeSection === 'project' ? (
      <ProjectSettingsSection {...viewModel.project} />
    ) : viewModel.activeSection === 'speech' ? (
      <SpeechSettingsSection {...viewModel.speech} />
    ) : viewModel.activeSection === 'listening' ? (
      <ListeningSettingsSection {...viewModel.listening} />
    ) : viewModel.activeSection === 'llm' ? (
      <LlmSettingsSection {...viewModel.llm} />
    ) : viewModel.activeSection === 'avatar' ? (
      <AvatarSettingsSection {...viewModel.avatar} />
    ) : (
      <AdvancedSettingsSection {...viewModel.advanced} />
    )

  return (
    <section className="settings-view">
      <SettingsNavigation
        activeSection={viewModel.activeSection}
        labels={labels}
        onSelect={viewModel.setActiveSection}
        ariaLabel={t('settings.tabsLabel')}
      />
      <div className="settings-content">
        <div className="settings-section-heading">
          <Heading>{labels[viewModel.activeSection]}</Heading>
          <span className="settings-save-indicator" role="status" aria-live="polite">
            {viewModel.saveState === 'saving' && (
              <>
                <ProgressCircle aria-label={t('common.saving')} isIndeterminate size="S" />
                <span>{t('common.saving')}</span>
              </>
            )}
            {viewModel.saveState === 'saved' && (
              <StatusLight variant="positive">{t('common.saved')}</StatusLight>
            )}
            {viewModel.saveState === 'error' && (
              <StatusLight variant="negative">{t('settings.saveFailed')}</StatusLight>
            )}
          </span>
        </div>
        {viewModel.activeSection === 'advanced' && (
          <p className="settings-description">{t('settings.advanced.description')}</p>
        )}
        {viewModel.activeSection === 'project' && (
          <p className="settings-description">{t('settings.project.description')}</p>
        )}
        <Divider />
        <Content key={viewModel.activeSection}>{section}</Content>
      </div>
    </section>
  )
}
