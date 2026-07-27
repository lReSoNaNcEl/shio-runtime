import { useState } from 'react'

import type { ProjectAwarenessStatus } from '../../../../shared/project-awareness'
import type { ProjectSettingsState } from './settingsContracts'
import { defaultSettingsForm } from './settingsDefaults'

export function useProjectSettings() {
  const [projectEnabled, setProjectEnabled] = useState(defaultSettingsForm.projectEnabled)
  const [projectRepository, setProjectRepository] = useState('')
  const [projectBranch, setProjectBranch] = useState(defaultSettingsForm.projectBranch)
  const [projectStatus, setProjectStatus] = useState<ProjectAwarenessStatus | null>(null)
  const [projectApplyState, setProjectApplyState] =
    useState<ProjectSettingsState['applyState']>('idle')
  const [projectApplyError, setProjectApplyError] = useState('')
  const [projectCredentialInput, setProjectCredentialInput] = useState('')
  const [projectCredentialSaveState, setProjectCredentialSaveState] =
    useState<ProjectSettingsState['credentialSaveState']>('idle')
  const [projectActionBusy, setProjectActionBusy] = useState(false)
  const [projectForgetConfirmation, setProjectForgetConfirmation] = useState(false)

  return {
    projectActionBusy,
    projectApplyError,
    projectApplyState,
    projectBranch,
    projectCredentialInput,
    projectCredentialSaveState,
    projectEnabled,
    projectForgetConfirmation,
    projectRepository,
    projectStatus,
    setProjectActionBusy,
    setProjectApplyError,
    setProjectApplyState,
    setProjectBranch,
    setProjectCredentialInput,
    setProjectCredentialSaveState,
    setProjectEnabled,
    setProjectForgetConfirmation,
    setProjectRepository,
    setProjectStatus,
  }
}
