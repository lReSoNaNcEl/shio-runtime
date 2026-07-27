import { useState } from 'react'

import type {
  BacklogSelectorRoleConfig,
  LlmProviderId,
  LlmProviderPublicSettings,
  ModelInfo,
  ProviderProfile,
} from '../../../../shared/llm'
import type { ModelsState } from './settingsContracts'
import { defaultBacklogSelectorRole } from './settingsDefaults'

export function useAiSettings() {
  const [editingKey, setEditingKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [activeProvider, setActiveProvider] = useState<LlmProviderId>('groq')
  const [providerSettings, setProviderSettings] = useState<
    Record<LlmProviderId, LlmProviderPublicSettings>
  >({} as Record<LlmProviderId, LlmProviderPublicSettings>)
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([])
  const [modelsState, setModelsState] = useState<ModelsState>('idle')
  const [backlogRole, setBacklogRole] = useState<BacklogSelectorRoleConfig>(
    defaultBacklogSelectorRole,
  )
  const [backlogModels, setBacklogModels] = useState<ModelInfo[]>([])

  return {
    activeProvider,
    backlogModels,
    backlogRole,
    editingKey,
    keyInput,
    modelOptions,
    modelsState,
    providers,
    providerSettings,
    setActiveProvider,
    setBacklogModels,
    setBacklogRole,
    setEditingKey,
    setKeyInput,
    setModelOptions,
    setModelsState,
    setProviders,
    setProviderSettings,
  }
}
