import { useState } from 'react'

import type {
  ComputerUseVisionRoleConfig,
  LlmProviderId,
  LlmProviderPublicSettings,
  LlmRoleCandidate,
  ModelInfo,
  ProviderProfile,
} from '../../../../shared/llm'
import type { ModelsState } from './settingsContracts'
import { defaultComputerUseVisionRole } from './settingsDefaults'

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
  const [computerUseVisionRole, setComputerUseVisionRole] = useState<ComputerUseVisionRoleConfig>(
    defaultComputerUseVisionRole,
  )
  const [characterFallbacks, setCharacterFallbacks] = useState<LlmRoleCandidate[]>([])
  const [speculativeDirectReply, setSpeculativeDirectReply] = useState(false)

  return {
    activeProvider,
    characterFallbacks,
    computerUseVisionRole,
    editingKey,
    keyInput,
    modelOptions,
    modelsState,
    providers,
    providerSettings,
    setActiveProvider,
    setCharacterFallbacks,
    setComputerUseVisionRole,
    setEditingKey,
    setKeyInput,
    setModelOptions,
    setModelsState,
    setProviders,
    setProviderSettings,
    setSpeculativeDirectReply,
    speculativeDirectReply,
  }
}
