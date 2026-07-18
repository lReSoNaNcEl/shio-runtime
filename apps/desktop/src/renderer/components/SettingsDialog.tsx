import {
  ActionButton,
  Button,
  ButtonGroup,
  ComboBox,
  ComboBoxItem,
  Content,
  ContextualHelp,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Divider,
  Heading,
  NumberField,
  Picker,
  PickerItem,
  ProgressCircle,
  SegmentedControl,
  SegmentedControlItem,
  Slider,
  StatusLight,
  Switch,
  Text,
  TextField,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import AudioWaveIcon from '@react-spectrum/s2/icons/AudioWave'
import CodeIcon from '@react-spectrum/s2/icons/Code'
import CopyIcon from '@react-spectrum/s2/icons/Copy'
import DataIcon from '@react-spectrum/s2/icons/Data'
import EditIcon from '@react-spectrum/s2/icons/Edit'
import ImageIcon from '@react-spectrum/s2/icons/Image'
import LightbulbIcon from '@react-spectrum/s2/icons/Lightbulb'
import MicrophoneIcon from '@react-spectrum/s2/icons/Microphone'
import SettingsIcon from '@react-spectrum/s2/icons/Settings'
import UserAvatarIcon from '@react-spectrum/s2/icons/UserAvatar'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }
import { useEffect, useRef, useState } from 'react'

import { DEFAULT_SPEECH_URL } from '../../shared/config'
import type {
  BacklogSelectorRoleConfig,
  LlmProviderId,
  ModelInfo,
  ProviderCredentials,
  ProviderProfile,
} from '../../shared/llmProviders'
import type { UiLocale } from '../../shared/localization/locale'
import {
  isValidProjectBranch,
  isValidProjectRepository,
  type ProjectAwarenessStatus,
} from '../../shared/projectAwareness'
import type { ControllerState } from '../Controller'
import { controller } from '../Controller'
import { useTranslation } from '../localization/useTranslation'
import {
  defaultContinuousListeningSettings,
  isCuriosityControlEnabled,
  parseAttentionMode,
  parseTunedNumber,
} from '../speech/continuous-listening/tuning'
import type { AttentionMode } from '../speech/continuous-listening/types'
import { type OverlayViewMode, overlayCameraPresets } from '../three/avatarTuning'

const fullWidth = style({ width: 'full' })

type SettingsSection =
  | 'general'
  | 'project'
  | 'speech'
  | 'listening'
  | 'llm'
  | 'avatar'
  | 'advanced'
const SETTINGS_SECTION_ICONS: Record<SettingsSection, React.JSX.Element> = {
  general: <SettingsIcon />,
  project: <DataIcon />,
  speech: <MicrophoneIcon />,
  listening: <AudioWaveIcon />,
  llm: <DataIcon />,
  avatar: <UserAvatarIcon />,
  advanced: <CodeIcon />,
}
const SETTINGS_SECTIONS: SettingsSection[] = [
  'general',
  'project',
  'speech',
  'listening',
  'llm',
  'avatar',
  'advanced',
]

interface Props {
  isOpen: boolean
  initialSection?: SettingsSection
  continuousListeningMode: AttentionMode
  vrmLoaded: boolean
  faceTrackingEnabled: boolean
  passiveCompanionEnabled: boolean
  onToggleFaceTracking: () => void
  onPassiveCompanionChange: (enabled: boolean) => void
  overlayVisible: boolean
  overlayViewModeProjection: OverlayViewMode
  llmHealth: ControllerState['llmHealth']
  onOverlayVisibleChange: (visible: boolean) => void
  onToggleOverlay: (visible: boolean) => void | Promise<void>
  onClose: () => void
}

const DEFAULT_TEXT = {
  heading: '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438',
  tabsLabel:
    '\u0420\u0430\u0437\u0434\u0435\u043b\u044b \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043a',
  system: '\u0421\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0435',
  character: '\u041f\u0435\u0440\u0441\u043e\u043d\u0430\u0436',
  llm: 'LLM',
  overlay: '\u041e\u0432\u0435\u0440\u043b\u0435\u0439',
  newKeyPlaceholder:
    '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043d\u043e\u0432\u044b\u0439 \u043a\u043b\u044e\u0447...',
  copyKey:
    '\u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043a\u043b\u044e\u0447',
  editKey: '\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043a\u043b\u044e\u0447',
  ttsLanguage: '\u042f\u0437\u044b\u043a TTS',
  russian: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439',
  microphone: '\u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d',
  continuousListening: 'Постоянное прослушивание',
  continuousListeningHint:
    'Фоновая речь проходит через Chunk Builder и безопасный фильтр внимания.',
  attentionMode: 'Режим внимания',
  attentionModesHelp: 'Как работают режимы внимания',
  replyCooldown: 'Пауза между ответами (мс)',
  followUpWindow: 'Окно продолжения диалога (мс)',
  curiosityChance: 'Вероятность редкой реакции',
  vrmModel: 'VRM-\u043c\u043e\u0434\u0435\u043b\u044c',
  chooseFile: '\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0444\u0430\u0439\u043b...',
  modelNotSelected:
    '\u041c\u043e\u0434\u0435\u043b\u044c \u043d\u0435 \u0432\u044b\u0431\u0440\u0430\u043d\u0430',
  gazeTitle: 'Следить взглядом за камерой',
  gazeHint:
    'Глаза Shio следуют за камерой и меняют фокус в зависимости от состояния. При выключении взгляд возвращается в neutral.',
  gazeOn: 'Слежение включено',
  gazeOff: 'Слежение выключено',
  passiveTitle: 'Более активное idle-поведение',
  passiveHint:
    'В простое чаще запускаются короткие движения головы, смена направления глаз и моргания. На разговорные реакции не влияет.',
  passiveOn: 'Режим включен',
  passiveOff: 'Режим выключен',
  overlayTitle:
    '\u041e\u0432\u0435\u0440\u043b\u0435\u0439 \u043d\u0430 \u044d\u043a\u0440\u0430\u043d\u0435',
  overlayEnabled:
    '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c Shio \u043f\u043e\u0432\u0435\u0440\u0445 \u043e\u043a\u043e\u043d',
  overlayEnabledHint:
    '\u041e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442 \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e\u0435 \u043f\u0440\u043e\u0437\u0440\u0430\u0447\u043d\u043e\u0435 \u043e\u043a\u043d\u043e \u0441 \u0430\u0432\u0430\u0442\u0430\u0440\u043e\u043c.',
  overlaySection: '\u041e\u0432\u0435\u0440\u043b\u0435\u0439',
  modelSection: '\u041c\u043e\u0434\u0435\u043b\u044c',
  behaviorSection: '\u041f\u043e\u0432\u0435\u0434\u0435\u043d\u0438\u0435',
  displaySubSection: '\u041e\u0442\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435',
  overlayDisabledNote:
    '\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u0435 \u043e\u0432\u0435\u0440\u043b\u0435\u0439, \u0447\u0442\u043e\u0431\u044b \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b \u043e\u0442\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f.',
  overlayStatusOn:
    '\u041e\u0432\u0435\u0440\u043b\u0435\u0439 \u0432\u043a\u043b\u044e\u0447\u0435\u043d',
  overlayStatusOff:
    '\u041e\u0432\u0435\u0440\u043b\u0435\u0439 \u0432\u044b\u043a\u043b\u044e\u0447\u0435\u043d',
  displaySection: '\u041e\u0442\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435',
  cameraSection: '\u041a\u0430\u043c\u0435\u0440\u0430',
  windowSection: '\u041e\u043a\u043d\u043e',
  interactionSection:
    '\u0412\u0437\u0430\u0438\u043c\u043e\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435',
  overlayEnabledModern:
    '\u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u0430\u0432\u0430\u0442\u0430\u0440 \u043f\u043e\u0432\u0435\u0440\u0445 \u0434\u0440\u0443\u0433\u0438\u0445 \u043e\u043a\u043e\u043d',
  overlayWidth: '\u0428\u0438\u0440\u0438\u043d\u0430',
  overlayHeight: '\u0412\u044b\u0441\u043e\u0442\u0430',
  overlayCorner: '\u041f\u043e\u0437\u0438\u0446\u0438\u044f',
  overlayScale: '\u041c\u0430\u0441\u0448\u0442\u0430\u0431',
  overlayViewMode: 'View mode',
  overlayMargin: '\u041e\u0442\u0441\u0442\u0443\u043f \u043e\u0442 \u043a\u0440\u0430\u044f',
  overlayOpacity: '\u041f\u0440\u043e\u0437\u0440\u0430\u0447\u043d\u043e\u0441\u0442\u044c',
  overlayTransparentBackground:
    '\u041f\u0440\u043e\u0437\u0440\u0430\u0447\u043d\u044b\u0439 \u0444\u043e\u043d',
  overlayTransparentBackgroundHint:
    '\u0424\u043e\u043d \u043e\u043a\u043d\u0430 \u043e\u0432\u0435\u0440\u043b\u0435\u044f \u043e\u0441\u0442\u0430\u0451\u0442\u0441\u044f \u043d\u0435\u0432\u0438\u0434\u0438\u043c\u044b\u043c, \u0432\u0438\u0434\u043d\u0430 \u0442\u043e\u043b\u044c\u043a\u043e Shio.',
  overlayTransparentBackgroundOn:
    '\u0424\u043e\u043d \u043f\u0440\u043e\u0437\u0440\u0430\u0447\u043d\u044b\u0439',
  overlayTransparentBackgroundOff:
    '\u0424\u043e\u043d \u043d\u0435\u043f\u0440\u043e\u0437\u0440\u0430\u0447\u043d\u044b\u0439',
  bottomRight: '\u0421\u043f\u0440\u0430\u0432\u0430 \u0441\u043d\u0438\u0437\u0443',
  bottomLeft: '\u0421\u043b\u0435\u0432\u0430 \u0441\u043d\u0438\u0437\u0443',
  topRight: '\u0421\u043f\u0440\u0430\u0432\u0430 \u0441\u0432\u0435\u0440\u0445\u0443',
  topLeft: '\u0421\u043b\u0435\u0432\u0430 \u0441\u0432\u0435\u0440\u0445\u0443',
  overlayClickThrough: '\u041d\u0435 \u043c\u0435\u0448\u0430\u0442\u044c \u043c\u044b\u0448\u0438',
  overlayClickThroughHint:
    '\u041a\u043b\u0438\u043a\u0438 \u0431\u0443\u0434\u0443\u0442 \u043f\u0440\u043e\u0445\u043e\u0434\u0438\u0442\u044c \u0441\u043a\u0432\u043e\u0437\u044c \u043e\u0432\u0435\u0440\u043b\u0435\u0439 \u043a \u043e\u043a\u043d\u0430\u043c \u043f\u043e\u0434 \u043d\u0438\u043c.',
  overlayClickThroughOn:
    '\u041a\u043b\u0438\u043a\u0438 \u043f\u0440\u043e\u0445\u043e\u0434\u044f\u0442 \u0441\u043a\u0432\u043e\u0437\u044c',
  overlayClickThroughOff:
    '\u041e\u0432\u0435\u0440\u043b\u0435\u0439 \u043f\u0440\u0438\u043d\u0438\u043c\u0430\u0435\u0442 \u043a\u043b\u0438\u043a\u0438',
  resetOverlay:
    '\u0421\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u043e\u0432\u0435\u0440\u043b\u0435\u044f',
  clickThroughDescription:
    '\u041a\u043b\u0438\u043a\u0438 \u043f\u0440\u043e\u0445\u043e\u0434\u044f\u0442 \u0441\u043a\u0432\u043e\u0437\u044c \u043e\u0432\u0435\u0440\u043b\u0435\u0439 \u043a \u043e\u043a\u043d\u0430\u043c \u043f\u043e\u0434 \u043d\u0438\u043c.',
  transparentDescription:
    '\u0424\u043e\u043d \u043e\u043a\u043d\u0430 \u043e\u0432\u0435\u0440\u043b\u0435\u044f \u043e\u0441\u0442\u0430\u0451\u0442\u0441\u044f \u043d\u0435\u0432\u0438\u0434\u0438\u043c\u044b\u043c.',
  windowDescription:
    '\u0420\u0430\u0437\u043c\u0435\u0440 \u043e\u043a\u043d\u0430 \u0438 \u043e\u0442\u0441\u0442\u0443\u043f \u043e\u0442 \u043a\u0440\u0430\u044f \u044d\u043a\u0440\u0430\u043d\u0430.',
  cameraDescription:
    '\u0412\u044b\u0431\u0435\u0440\u0438 \u043a\u0430\u0434\u0440\u0438\u0440\u043e\u0432\u043a\u0443 Shio \u0432 \u043e\u0432\u0435\u0440\u043b\u0435\u0435.',
  clearHistory:
    '\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u0438\u0441\u0442\u043e\u0440\u0438\u044e',
  close: '\u0417\u0430\u043a\u0440\u044b\u0442\u044c',
  save: '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c',
  llmProvider: 'LLM \u041f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440',
  llmApiKey: 'API \u041a\u043b\u044e\u0447',
  llmModel: '\u041c\u043e\u0434\u0435\u043b\u044c',
  loadModels:
    '\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043c\u043e\u0434\u0435\u043b\u0438',
  modelsLoading:
    '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043c\u043e\u0434\u0435\u043b\u0435\u0439...',
  modelsEmpty:
    '\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0445 \u043c\u043e\u0434\u0435\u043b\u0435\u0439.',
  modelsNetworkError:
    '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043c\u043e\u0434\u0435\u043b\u0438.',
  modelsMissingKey:
    '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 API \u043a\u043b\u044e\u0447, \u0447\u0442\u043e\u0431\u044b \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043c\u043e\u0434\u0435\u043b\u0438.',
  modelsAuthError:
    '\u041e\u0448\u0438\u0431\u043a\u0430 \u0430\u0443\u0442\u0435\u043d\u0442\u0438\u0444\u0438\u043a\u0430\u0446\u0438\u0438.',
  backlogSelector: 'Выбор реплики из очереди',
  backlogSelectorEnabled: 'Включить LLM для выбора реплики из очереди',
  backlogSelectorProvider: 'LLM-провайдер для выбора реплики',
  backlogSelectorModel: 'Модель для выбора реплики',
  backlogSelectorHint:
    '\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u0432 \u0440\u0435\u0436\u0438\u043c\u0435 \u043d\u0435\u043f\u0440\u0435\u0440\u044b\u0432\u043d\u043e\u0433\u043e \u043f\u0440\u043e\u0441\u043b\u0443\u0448\u0438\u0432\u0430\u043d\u0438\u044f \u0434\u043b\u044f \u0440\u0435\u0434\u043a\u043e\u0433\u043e \u0432\u044b\u0431\u043e\u0440\u0430 \u043d\u0435\u043e\u0434\u043d\u043e\u0437\u043d\u0430\u0447\u043d\u044b\u0445 \u043d\u0430\u043a\u043e\u043f\u043b\u0435\u043d\u043d\u044b\u0445 \u0440\u0435\u043f\u043b\u0438\u043a. \u041e\u0431\u044b\u0447\u043d\u044b\u0439 \u0447\u0430\u0442 \u044d\u0442\u043e\u0442 \u0444\u0438\u043b\u044c\u0442\u0440 \u043d\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442.',
  streamingOnlyHint:
    '\u041f\u0440\u0438\u043c\u0435\u043d\u044f\u0435\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u0440\u0438 \u0432\u043a\u043b\u044e\u0447\u0451\u043d\u043d\u043e\u043c Streaming Mode.',
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return key
  return key.slice(0, 4) + '*'.repeat(Math.min(key.length - 8, 20)) + key.slice(-4)
}

function LlmHealthStatus({ health }: { health: ControllerState['llmHealth'] }): React.JSX.Element {
  const { t } = useTranslation()
  const status =
    health.state === 'ok'
      ? { variant: 'positive' as const, label: t('common.available') }
      : health.state === 'checking'
        ? { variant: 'informative' as const, label: t('common.checking') }
        : health.state === 'error'
          ? { variant: 'negative' as const, label: t('common.error') }
          : { variant: 'neutral' as const, label: t('common.notConfigured') }

  return (
    <div className="llm-health-status" title={health.detail}>
      <StatusLight role="status" variant={status.variant} size="S">
        {status.label}
      </StatusLight>
      {health.state === 'checking' && (
        <ProgressCircle aria-label={t('settings.llm.healthChecking')} isIndeterminate size="S" />
      )}
    </div>
  )
}

function deduplicateModelsById(models: ModelInfo[]): ModelInfo[] {
  const result: ModelInfo[] = []
  const indexById = new Map<string, number>()
  for (const model of models) {
    const existingIndex = indexById.get(model.id)
    if (existingIndex === undefined) {
      indexById.set(model.id, result.length)
      result.push(model)
    } else if (!result[existingIndex].displayName?.trim() && model.displayName?.trim()) {
      result[existingIndex] = model
    }
  }
  return result
}

interface ModelComboBoxProps {
  label: string
  models: ModelInfo[]
  selectedId: string
  isDisabled?: boolean
  isLoading?: boolean
  placeholder?: string
  showCapabilities?: boolean
  onSelect: (id: string) => void
}

function ModelComboBox({
  label,
  models,
  selectedId,
  isDisabled,
  isLoading,
  showCapabilities = false,
  onSelect,
}: ModelComboBoxProps): React.JSX.Element {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState(selectedId)
  const [isOpen, setIsOpen] = useState(false)
  const [onlyVision, setOnlyVision] = useState(false)
  const normalizedSearch = isOpen ? searchText.trim().toLocaleLowerCase() : ''
  const capabilityFilteredModels =
    showCapabilities && onlyVision
      ? models.filter((model) => model.capabilities.supportsVision)
      : models
  const filteredModels = normalizedSearch
    ? capabilityFilteredModels.filter((model) =>
        `${model.id} ${model.displayName ?? ''}`.toLocaleLowerCase().includes(normalizedSearch),
      )
    : capabilityFilteredModels
  const selectedModel = models.find((model) => model.id === selectedId)

  useEffect(() => {
    if (!isOpen) setSearchText(selectedId)
  }, [isOpen, selectedId])

  const emptyText = onlyVision
    ? t('settings.llm.capabilities.noVisionModels')
    : models.length === 0
      ? t('common.modelsNotFound')
      : t('common.modelsNotFoundForQuery')
  return (
    <div className="model-combobox">
      <ComboBox
        label={label}
        selectedKey={filteredModels.some((model) => model.id === selectedId) ? selectedId : null}
        inputValue={searchText}
        onInputChange={setSearchText}
        onOpenChange={(open) => {
          setIsOpen(open)
          setSearchText(open ? '' : selectedId)
        }}
        onSelectionChange={(key) => {
          const id = String(key ?? '')
          if (models.some((model) => model.id === id)) {
            onSelect(id)
            setSearchText(id)
          } else {
            setSearchText(selectedId)
          }
        }}
        isDisabled={isDisabled}
        loadingState={isLoading ? 'loading' : 'idle'}
        placeholder={t('common.searchModel')}
        styles={fullWidth}
      >
        {filteredModels.length > 0 ? (
          filteredModels.map((model) => {
            const description =
              model.displayName?.trim() && model.displayName !== model.id ? model.displayName : ''
            return (
              <ComboBoxItem
                key={model.id}
                id={model.id}
                textValue={`${model.id} ${model.displayName ?? ''}`}
              >
                <Text slot="label">
                  <span className="model-option-label">
                    <span className="model-option-id">{model.id}</span>
                    {showCapabilities && (
                      <span className="model-capability-badges">
                        {model.capabilities.supportsVision && (
                          <span className="model-capability-badge model-capability-vision">
                            <ImageIcon />
                            {t('settings.llm.capabilities.vision')}
                          </span>
                        )}
                        {model.capabilities.supportsReasoning && (
                          <span className="model-capability-badge">
                            <LightbulbIcon />
                            {t('settings.llm.capabilities.reasoning')}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </Text>
                {description && <Text slot="description">{description}</Text>}
              </ComboBoxItem>
            )
          })
        ) : (
          <ComboBoxItem id="__empty__" textValue={emptyText} isDisabled>
            <Text slot="label">{emptyText}</Text>
          </ComboBoxItem>
        )}
      </ComboBox>
      {showCapabilities && (
        <Switch isSelected={onlyVision} onChange={setOnlyVision}>
          {t('settings.llm.capabilities.onlyVision')}
        </Switch>
      )}
      {showCapabilities && selectedModel && (
        <div
          className={`model-capability-status ${
            selectedModel.capabilities.supportsVision
              ? 'model-capability-status-positive'
              : 'model-capability-status-neutral'
          }`}
        >
          <span aria-hidden="true">
            {selectedModel.capabilities.supportsVision ? '\u25cf' : '\u25cb'}
          </span>
          <span>
            <strong>
              {selectedModel.capabilities.supportsVision
                ? t('settings.llm.capabilities.visionSupported')
                : t('settings.llm.capabilities.visionUnconfirmed')}
            </strong>
            <small>
              {selectedModel.capabilities.supportsVision
                ? t('settings.llm.capabilities.visionSupportedHint')
                : t('settings.llm.capabilities.visionUnconfirmedHint')}
            </small>
          </span>
        </div>
      )}
    </div>
  )
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? ''
const overlayViewModes: OverlayViewMode[] = ['front', 'bust', 'face', 'portrait']
const overlayDefaults = {
  width: 360,
  height: 560,
  margin: 24,
  opacityPercent: 100,
  transparentBackground: true,
  clickThrough: true,
  corner: 'bottom-right',
  scalePercent: 100,
  viewMode: 'front' as OverlayViewMode,
}

function parseOverlayViewMode(mode: string | undefined): OverlayViewMode {
  return mode === 'bust' || mode === 'face' || mode === 'portrait' ? mode : 'front'
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseNumberSetting(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value)
  return clampNumber(Number.isFinite(parsed) ? parsed : fallback, min, max)
}

function projectActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

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
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const settingsSectionLabels: Record<SettingsSection, string> = {
    general: t('settings.section.general'),
    project: t('settings.section.project'),
    speech: t('settings.section.speech'),
    listening: t('settings.section.listening'),
    llm: t('settings.section.llm'),
    avatar: t('settings.section.avatar'),
    advanced: t('settings.section.advanced'),
  }
  const TEXT = {
    ...DEFAULT_TEXT,
    tabsLabel: t('settings.tabsLabel'),
    ttsLanguage: t('settings.speech.ttsLanguage'),
    russian: t('settings.language.ru'),
    microphone: t('settings.speech.microphone'),
    attentionMode: t('streaming.mode.label'),
    attentionModesHelp: t('settings.listening.help'),
    replyCooldown: t('settings.listening.replyCooldown'),
    followUpWindow: t('settings.listening.followUpWindow'),
    curiosityChance: t('settings.listening.spontaneity'),
    vrmModel: t('settings.avatar.model'),
    chooseFile: t('settings.avatar.chooseFile'),
    modelNotSelected: t('settings.avatar.notSelected'),
    passiveTitle: t('settings.avatar.passiveTitle'),
    passiveHint: t('settings.avatar.passiveHint'),
    passiveOn: t('settings.avatar.passiveOn'),
    passiveOff: t('settings.avatar.passiveOff'),
    overlaySection: t('settings.avatar.overlaySection'),
    modelSection: t('settings.avatar.modelSection'),
    behaviorSection: t('settings.avatar.behaviorSection'),
    displaySubSection: t('settings.avatar.displaySection'),
    overlayDisabledNote: t('settings.avatar.overlayDisabled'),
    cameraSection: t('settings.avatar.cameraSection'),
    windowSection: t('settings.avatar.windowSection'),
    interactionSection: t('settings.avatar.interactionSection'),
    overlayEnabledModern: t('settings.avatar.overlayEnabled'),
    overlayEnabledHint: t('settings.avatar.overlayEnabledHint'),
    overlayWidth: t('settings.avatar.width'),
    overlayHeight: t('settings.avatar.height'),
    overlayCorner: t('settings.avatar.position'),
    overlayScale: t('settings.avatar.scale'),
    overlayViewMode: t('settings.avatar.cameraSection'),
    overlayMargin: t('settings.avatar.margin'),
    overlayOpacity: t('settings.avatar.opacity'),
    overlayTransparentBackground: t('settings.avatar.transparent'),
    topLeft: t('settings.avatar.topLeft'),
    topRight: t('settings.avatar.topRight'),
    bottomLeft: t('settings.avatar.bottomLeft'),
    bottomRight: t('settings.avatar.bottomRight'),
    overlayClickThrough: t('settings.avatar.clickThrough'),
    resetOverlay: t('settings.avatar.reset'),
    clickThroughDescription: t('settings.avatar.clickThroughDescription'),
    transparentDescription: t('settings.avatar.transparentDescription'),
    windowDescription: t('settings.avatar.windowDescription'),
    cameraDescription: t('settings.avatar.cameraDescription'),
    clearHistory: t('settings.danger.clear'),
    llmApiKey: t('settings.llm.apiKey'),
    llmModel: t('common.model'),
    newKeyPlaceholder: t('settings.llm.newKey'),
    copyKey: t('settings.llm.copyKey'),
    editKey: t('settings.llm.editKey'),
    loadModels: t('settings.llm.loadModels'),
    modelsLoading: t('settings.llm.modelsLoading'),
    modelsEmpty: t('settings.llm.modelsEmpty'),
    modelsNetworkError: t('settings.llm.modelsNetworkError'),
    modelsMissingKey: t('settings.llm.modelsMissingKey'),
    modelsAuthError: t('settings.llm.modelsAuthError'),
  }
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection)
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)
  const hydrated = useRef(false)
  const saveSequence = useRef(0)
  const saveStatusTimer = useRef<number | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [speechUrl, setSpeechUrl] = useState(DEFAULT_SPEECH_URL)
  const [projectEnabled, setProjectEnabled] = useState(true)
  const [projectRepository, setProjectRepository] = useState('')
  const [projectBranch, setProjectBranch] = useState('main')
  const [projectStatus, setProjectStatus] = useState<ProjectAwarenessStatus | null>(null)
  const [projectApplyState, setProjectApplyState] = useState<
    'idle' | 'applying' | 'applied' | 'error'
  >('idle')
  const [projectApplyError, setProjectApplyError] = useState('')
  const [projectCredentialInput, setProjectCredentialInput] = useState('')
  const [projectActionBusy, setProjectActionBusy] = useState(false)
  const [projectForgetConfirmation, setProjectForgetConfirmation] = useState(false)
  const [lang, setLang] = useState('ru')
  const [uiLocale, setUiLocale] = useState<UiLocale>('ru')
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false)
  const [vrmName, setVrmName] = useState('')
  const [mics, setMics] = useState<Array<{ deviceId: string; label: string }>>([])
  const [micId, setMicId] = useState('default')
  const [replyCooldownMs, setReplyCooldownMs] = useState(
    defaultContinuousListeningSettings.replyCooldownMs,
  )
  const [followUpWindowMs, setFollowUpWindowMs] = useState(
    defaultContinuousListeningSettings.followUpWindowMs,
  )
  const [curiosityChancePercent, setCuriosityChancePercent] = useState(
    defaultContinuousListeningSettings.curiosityChance * 100,
  )
  const [overlayWidth, setOverlayWidth] = useState(overlayDefaults.width)
  const [overlayHeight, setOverlayHeight] = useState(overlayDefaults.height)
  const [overlayMargin, setOverlayMargin] = useState(overlayDefaults.margin)
  const [overlayOpacityPercent, setOverlayOpacityPercent] = useState(overlayDefaults.opacityPercent)
  const [overlayTransparentBackground, setOverlayTransparentBackground] = useState(true)
  const [overlayClickThrough, setOverlayClickThrough] = useState(true)
  const [overlayCorner, setOverlayCorner] = useState(overlayDefaults.corner)
  const [overlayScalePercent, setOverlayScalePercent] = useState(overlayDefaults.scalePercent)
  const [overlayViewMode, setOverlayViewMode] = useState<OverlayViewMode>('front')

  useEffect(() => {
    setOverlayViewMode(overlayViewModeProjection)
  }, [overlayViewModeProjection])
  const [currentTtsVoice, setCurrentTtsVoice] = useState('animevox_makima')

  const [editingKey, setEditingKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [copied, setCopied] = useState(false)
  const copiedResetTimer = useRef<number | null>(null)

  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [activeProvider, setActiveProvider] = useState<LlmProviderId>('groq')
  const [providerCreds, setProviderCreds] = useState<Record<string, ProviderCredentials>>({})
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([])
  const [modelsState, setModelsState] = useState<
    'idle' | 'loading' | 'ready' | 'empty' | 'missing-key' | 'auth-error' | 'network-error'
  >('idle')
  const [backlogRole, setBacklogRole] = useState<BacklogSelectorRoleConfig>({
    enabled: false,
    providerId: '',
    model: '',
    timeoutMs: 2_000,
    minimumConfidence: 0.72,
  })
  const [backlogModels, setBacklogModels] = useState<ModelInfo[]>([])
  const curiosityEnabled = isCuriosityControlEnabled(true, continuousListeningMode)

  useEffect(
    () => () => {
      if (copiedResetTimer.current !== null) window.clearTimeout(copiedResetTimer.current)
      if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (isOpen) return
    if (copiedResetTimer.current !== null) window.clearTimeout(copiedResetTimer.current)
    copiedResetTimer.current = null
    setCopied(false)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    void (async () => {
      const cfg = await window.api.config.get()
      setActiveSection(initialSection)
      // config.get() всегда возвращает нормализованный pythonSpeechUrl (main
      // подставляет DEFAULT_SPEECH_URL при отсутствии), поэтому main-config
      // побеждает без второго fallback на стороне renderer.
      setSpeechUrl(cfg.pythonSpeechUrl)
      setProjectEnabled(cfg.projectAwareness.enabled)
      setProjectRepository(cfg.projectAwareness.repository)
      setProjectBranch(cfg.projectAwareness.branch)
      setProjectStatus(await window.api.projectAwareness.getStatus())
      setProjectApplyState('idle')
      setProjectApplyError('')
      setProjectCredentialInput('')
      setProjectActionBusy(false)
      setProjectForgetConfirmation(false)
      setLang(cfg.ttsLanguage ?? 'ru')
      setUiLocale(cfg.uiLocale)
      setDeveloperModeEnabled(cfg.developerModeEnabled === 'true')
      setCurrentTtsVoice(cfg.ttsVoice ?? 'animevox_makima')
      setReplyCooldownMs(
        parseTunedNumber(cfg.continuousListeningReplyCooldownMs, 15_000, 0, 120_000),
      )
      setFollowUpWindowMs(
        parseTunedNumber(cfg.continuousListeningFollowUpWindowMs, 20_000, 0, 120_000),
      )
      setCuriosityChancePercent(
        parseTunedNumber(cfg.continuousListeningCuriosityChance, 0.03, 0, 1) * 100,
      )
      setEditingKey(false)
      setKeyInput('')
      setActiveProvider(cfg.llm?.activeProvider ?? 'groq')
      setProviderCreds(cfg.llm?.providers ?? {})
      setBacklogRole(
        cfg.llm?.roles?.backlogSelector ?? {
          enabled: false,
          providerId: '',
          model: '',
          timeoutMs: 2_000,
          minimumConfidence: 0.72,
        },
      )
      setVrmName(cfg.vrmPath ? baseName(cfg.vrmPath) : '')
      setOverlayWidth(parseNumberSetting(cfg.overlayWidth, overlayDefaults.width, 250, 2000))
      setOverlayHeight(parseNumberSetting(cfg.overlayHeight, overlayDefaults.height, 250, 2000))
      setOverlayMargin(parseNumberSetting(cfg.overlayMargin, overlayDefaults.margin, 0, 500))
      setOverlayOpacityPercent(Math.round(parseNumberSetting(cfg.overlayOpacity, 1, 0, 1) * 100))
      setOverlayTransparentBackground(cfg.overlayTransparentBackground !== 'false')
      setOverlayClickThrough(cfg.overlayClickThrough !== 'false')
      setOverlayCorner(cfg.overlayCorner ?? 'bottom-right')
      setOverlayScalePercent(Math.round(parseNumberSetting(cfg.overlayScale, 1, 0.5, 2) * 100))
      setOverlayViewMode(parseOverlayViewMode(cfg.overlayViewMode))

      const providerList = await window.api.llm.providers()
      setProviders(providerList)

      const micList = await controller.listMicrophones()
      setMics(micList)
      setMicId(controller.getMicrophoneId() || 'default')
      hydrated.current = true
    })()
  }, [initialSection, isOpen])

  useEffect(() => {
    if (!isOpen || activeSection !== 'project') return
    let active = true
    const refresh = (): void => {
      void window.api.projectAwareness.getStatus().then((status) => {
        if (active) setProjectStatus(status)
      })
    }
    refresh()
    const intervalId = window.setInterval(refresh, 3_000)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [activeSection, isOpen])

  const savedKey = providerCreds[activeProvider]?.apiKey ?? ''
  const selectedModel = providerCreds[activeProvider]?.model ?? ''
  const activeApiKey = editingKey ? keyInput : savedKey

  const updateCred = (id: string, patch: Partial<ProviderCredentials>): void => {
    setProviderCreds((prev) => {
      const base = prev[id] ?? { apiKey: '', model: '' }
      return { ...prev, [id]: { ...base, ...patch } }
    })
  }

  const loadModels = async (providerId: string, apiKey: string): Promise<void> => {
    setModelsState('loading')
    const res = await window.api.llm.fetchModels(providerId, apiKey)
    if (res.ok) {
      const models = deduplicateModelsById(res.models ?? [])
      setModelOptions(models)
      if (models.length === 0) {
        setModelsState('empty')
      } else {
        setModelsState('ready')
        setProviderCreds((prev) => {
          const base = prev[providerId] ?? { apiKey: '', model: '' }
          const model = models.some((m) => m.id === base.model) ? base.model : models[0].id
          return { ...prev, [providerId]: { ...base, model } }
        })
      }
      return
    }
    setModelOptions([])
    if (res.kind === 'auth') {
      setModelsState(apiKey.trim() ? 'auth-error' : 'missing-key')
    } else {
      setModelsState('network-error')
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadModels is re-created every render and intentionally excluded; the debounced fetch must be keyed only on isOpen/activeProvider/activeApiKey/providers to avoid re-firing every render.
  useEffect(() => {
    if (!isOpen) return
    const profile = providers.find((p) => p.id === activeProvider)
    if (profile?.modelsRequireApiKey && !activeApiKey.trim()) {
      setModelOptions([])
      setModelsState('missing-key')
      return
    }
    const timer = setTimeout(() => {
      void loadModels(activeProvider, activeApiKey)
    }, 400)
    return () => clearTimeout(timer)
  }, [isOpen, activeProvider, activeApiKey, providers])

  useEffect(() => {
    if (!isOpen || !backlogRole.enabled || !backlogRole.providerId) {
      setBacklogModels([])
      return
    }
    const apiKey = providerCreds[backlogRole.providerId]?.apiKey ?? ''
    const profile = providers.find((provider) => provider.id === backlogRole.providerId)
    if (profile?.modelsRequireApiKey && !apiKey) {
      setBacklogModels([])
      return
    }
    let current = true
    const timer = setTimeout(() => {
      void window.api.llm.fetchModels(backlogRole.providerId, apiKey).then((result) => {
        if (!current) return
        setBacklogModels(result.ok ? deduplicateModelsById(result.models ?? []) : [])
      })
    }, 400)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [isOpen, backlogRole.enabled, backlogRole.providerId, providerCreds, providers])

  const pickVrm = async (): Promise<void> => {
    const r = await window.api.vrm.pick()
    if (r.ok && r.vrmPath) {
      setVrmName(baseName(r.vrmPath))
      void controller.loadVrmFromPath(r.vrmPath)
    }
  }

  const copyKey = async (): Promise<void> => {
    if (!savedKey) return
    await navigator.clipboard.writeText(savedKey)
    if (copiedResetTimer.current !== null) window.clearTimeout(copiedResetTimer.current)
    setCopied(true)
    copiedResetTimer.current = window.setTimeout(() => {
      copiedResetTimer.current = null
      setCopied(false)
    }, 1500)
  }

  const projectSettingsValid =
    !projectEnabled ||
    (isValidProjectRepository(projectRepository) && isValidProjectBranch(projectBranch))
  const projectTargetApplied =
    projectStatus !== null &&
    projectStatus.enabled === projectEnabled &&
    projectStatus.repository === projectRepository.trim() &&
    projectStatus.branch === projectBranch.trim()
  const projectConnected =
    projectStatus !== null &&
    ['ready', 'syncing', 'indexing', 'stale'].includes(projectStatus.state)
  const projectRuntimeBusy =
    projectActionBusy ||
    projectApplyState === 'applying' ||
    (projectStatus !== null && ['connecting', 'syncing', 'indexing'].includes(projectStatus.state))
  const projectHasIndex = Boolean(projectStatus?.indexedCommit)

  const applyProjectSettings = async (): Promise<void> => {
    setProjectApplyState('applying')
    setProjectApplyError('')
    try {
      const status = await window.api.projectAwareness.configure({
        enabled: projectEnabled,
        provider: 'github',
        repository: projectRepository.trim(),
        branch: projectBranch.trim(),
      })
      setProjectRepository(status.repository)
      setProjectBranch(status.branch)
      setProjectStatus(status)
      setProjectApplyState('applied')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setProjectApplyError(message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
      setProjectStatus(await window.api.projectAwareness.getStatus())
      setProjectApplyState('error')
    }
  }

  const runProjectAction = async (operation: () => Promise<unknown>): Promise<void> => {
    setProjectApplyError('')
    setProjectActionBusy(true)
    try {
      await operation()
    } catch (error) {
      setProjectApplyError(projectActionError(error))
    } finally {
      setProjectStatus(await window.api.projectAwareness.getStatus())
      setProjectActionBusy(false)
    }
  }

  const saveProjectCredential = async (): Promise<void> => {
    await runProjectAction(async () => {
      const status = await window.api.projectAwareness.saveCredential(projectCredentialInput)
      setProjectStatus(status)
      setProjectCredentialInput('')
      setProjectForgetConfirmation(false)
    })
  }

  const forgetProjectCredential = async (): Promise<void> => {
    if (!projectForgetConfirmation) {
      setProjectForgetConfirmation(true)
      return
    }
    await runProjectAction(async () => {
      const status = await window.api.projectAwareness.forgetCredential()
      setProjectStatus(status)
      setProjectCredentialInput('')
      setProjectForgetConfirmation(false)
    })
  }

  const save = async (sequence = ++saveSequence.current): Promise<void> => {
    // Fold a pending key edit into the active provider's credentials, then
    // persist the whole per-provider map so no other provider's token is lost.
    const providers: Record<string, ProviderCredentials> = { ...providerCreds }
    const current = providers[activeProvider] ?? { apiKey: '', model: '' }
    providers[activeProvider] = {
      apiKey: editingKey && keyInput.trim() ? keyInput.trim() : current.apiKey,
      model: current.model,
    }

    const curiosityChance = clampNumber(curiosityChancePercent / 100, 0, 1)
    await window.api.config.save({
      pythonSpeechUrl: speechUrl,
      ttsVoice: currentTtsVoice,
      ttsLanguage: lang,
      uiLocale,
      developerModeEnabled: developerModeEnabled ? 'true' : 'false',
      ttsEngine: 'f5',
      continuousListeningReplyCooldownMs: String(replyCooldownMs),
      continuousListeningFollowUpWindowMs: String(followUpWindowMs),
      continuousListeningCuriosityChance: String(curiosityChance),
      overlayWidth: String(clampNumber(overlayWidth, 250, 2000)),
      overlayHeight: String(clampNumber(overlayHeight, 250, 2000)),
      overlayMargin: String(clampNumber(overlayMargin, 0, 500)),
      overlayOpacity: String(clampNumber(overlayOpacityPercent, 0, 100) / 100),
      overlayTransparentBackground: overlayTransparentBackground ? 'true' : 'false',
      overlayCorner,
      overlayScale: String(clampNumber(overlayScalePercent, 50, 200) / 100),
      overlayViewMode,
      overlayClickThrough: overlayClickThrough ? 'true' : 'false',
      llm: {
        activeProvider,
        providers: providers as Record<LlmProviderId, ProviderCredentials>,
        roles: { backlogSelector: backlogRole },
      },
    })
    await window.api.overlay.applySettings()
    const result = await window.api.overlay.isVisible()
    onOverlayVisibleChange(Boolean(result.visible))
    if (sequence === saveSequence.current) {
      setSaveState('saved')
      if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current)
      saveStatusTimer.current = window.setTimeout(() => setSaveState('idle'), 1800)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the dependency array is an intentional change-trigger list — the debounced auto-save re-runs when any settings field changes (read inside save()); `save` (per-render closure) and `isOpen` (guard) are intentionally excluded so they never trigger a save.
  useEffect(() => {
    if (!hydrated.current || !isOpen) return
    const sequence = ++saveSequence.current
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      void save(sequence).catch(() => {
        if (sequence === saveSequence.current) setSaveState('error')
      })
    }, 650)
    return () => window.clearTimeout(timer)
  }, [
    speechUrl,
    lang,
    uiLocale,
    developerModeEnabled,
    currentTtsVoice,
    replyCooldownMs,
    followUpWindowMs,
    curiosityChancePercent,
    overlayWidth,
    overlayHeight,
    overlayMargin,
    overlayOpacityPercent,
    overlayTransparentBackground,
    overlayClickThrough,
    overlayCorner,
    overlayScalePercent,
    overlayViewMode,
    activeProvider,
    providerCreds,
    backlogRole,
  ])

  const toggleOverlay = async (visible: boolean): Promise<void> => {
    await onToggleOverlay(visible)
    const result = await window.api.overlay.isVisible()
    onOverlayVisibleChange(Boolean(result.visible))
  }

  const resetOverlaySettings = (): void => {
    setOverlayWidth(overlayDefaults.width)
    setOverlayHeight(overlayDefaults.height)
    setOverlayMargin(overlayDefaults.margin)
    setOverlayOpacityPercent(overlayDefaults.opacityPercent)
    setOverlayTransparentBackground(overlayDefaults.transparentBackground)
    setOverlayClickThrough(overlayDefaults.clickThrough)
    setOverlayCorner(overlayDefaults.corner)
    setOverlayScalePercent(overlayDefaults.scalePercent)
    setOverlayViewMode(overlayDefaults.viewMode)
  }

  const selectSection = (section: SettingsSection): void => {
    setActiveSection(section)
  }

  if (!isOpen) return null
  return (
    <section className="settings-view">
      <aside className="settings-nav" aria-label={TEXT.tabsLabel}>
        {SETTINGS_SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            className={activeSection === section ? 'active' : undefined}
            aria-current={activeSection === section ? 'page' : undefined}
            onClick={() => selectSection(section)}
          >
            <span className="settings-nav-icon">{SETTINGS_SECTION_ICONS[section]}</span>
            <span>{settingsSectionLabels[section]}</span>
          </button>
        ))}
      </aside>
      <div className="settings-content">
        <div className="settings-section-heading">
          <Heading>{settingsSectionLabels[activeSection]}</Heading>
          <span className="settings-save-indicator" role="status" aria-live="polite">
            {saveState === 'saving' && (
              <>
                <ProgressCircle aria-label={t('common.saving')} isIndeterminate size="S" />
                <span>{t('common.saving')}</span>
              </>
            )}
            {saveState === 'saved' && (
              <StatusLight variant="positive">{t('common.saved')}</StatusLight>
            )}
            {saveState === 'error' && (
              <StatusLight variant="negative">{t('settings.saveFailed')}</StatusLight>
            )}
          </span>
        </div>
        {activeSection === 'advanced' && (
          <p className="settings-description">{t('settings.advanced.description')}</p>
        )}
        {activeSection === 'project' && (
          <p className="settings-description">{t('settings.project.description')}</p>
        )}
        <Divider />
        <Content key={activeSection}>
          {activeSection === 'general' ? (
            <div className="settings-grid">
              <Picker
                label={t('settings.language')}
                selectedKey={uiLocale}
                onSelectionChange={(key) => setUiLocale(String(key) as UiLocale)}
                styles={fullWidth}
              >
                <PickerItem id="ru">{t('settings.language.ru')}</PickerItem>
                <PickerItem id="en">{t('settings.language.en')}</PickerItem>
              </Picker>
              <div className="settings-switch-with-description">
                <Switch isSelected={developerModeEnabled} onChange={setDeveloperModeEnabled}>
                  {t('settings.developerMode.title')}
                </Switch>
                <span className="settings-hint">{t('settings.developerMode.description')}</span>
              </div>
            </div>
          ) : activeSection === 'project' ? (
            <div className="settings-grid">
              <Switch
                isSelected={projectEnabled}
                onChange={(enabled) => {
                  setProjectEnabled(enabled)
                  setProjectApplyState('idle')
                }}
              >
                {t('settings.project.enable')}
              </Switch>
              <TextField
                label={t('settings.project.repository')}
                value={projectRepository}
                onChange={(value) => {
                  setProjectRepository(value)
                  setProjectApplyState('idle')
                }}
                placeholder="owner/repository"
                isDisabled={!projectEnabled}
                isInvalid={projectEnabled && !isValidProjectRepository(projectRepository)}
                errorMessage={t('main.error.project.repositoryFormat')}
                styles={fullWidth}
              />
              <TextField
                label={t('settings.project.branch')}
                value={projectBranch}
                onChange={(value) => {
                  setProjectBranch(value)
                  setProjectApplyState('idle')
                }}
                placeholder="main"
                isDisabled={!projectEnabled}
                isInvalid={projectEnabled && !isValidProjectBranch(projectBranch)}
                errorMessage={t('main.error.project.branchInvalid')}
                styles={fullWidth}
              />
              <Text UNSAFE_className="settings-hint">{t('settings.project.targetChange')}</Text>
              <div className="settings-row">
                <ActionButton
                  isDisabled={!projectSettingsValid || projectRuntimeBusy}
                  onPress={() => void applyProjectSettings()}
                >
                  {projectApplyState === 'applying'
                    ? t('settings.project.applying')
                    : t('settings.project.apply')}
                </ActionButton>
                {projectStatus && (
                  <StatusLight
                    variant={
                      projectStatus.state === 'ready'
                        ? 'positive'
                        : projectStatus.state === 'error'
                          ? 'negative'
                          : 'neutral'
                    }
                  >
                    {projectStatus.credential.configured
                      ? t('settings.project.credentialSaved', { state: projectStatus.state })
                      : t('settings.project.credentialMissing')}
                  </StatusLight>
                )}
              </div>
              {projectApplyState === 'applied' && (
                <Text UNSAFE_className="settings-hint">{t('settings.project.applied')}</Text>
              )}
              {projectApplyError && (
                <Text UNSAFE_className="project-awareness-error">{projectApplyError}</Text>
              )}
              <div className="project-credential-panel">
                <div className="project-credential-copy">
                  <strong>{t('settings.project.credential.title')}</strong>
                  <span>{t('settings.project.credential.description')}</span>
                </div>
                <TextField
                  label={
                    projectStatus?.credential.configured
                      ? t('settings.project.credential.replace')
                      : t('settings.project.credential.token')
                  }
                  value={projectCredentialInput}
                  onChange={setProjectCredentialInput}
                  type="password"
                  placeholder="github_pat_…"
                  isDisabled={projectRuntimeBusy}
                  styles={fullWidth}
                />
                <div className="project-credential-actions">
                  <ActionButton
                    isDisabled={
                      projectRuntimeBusy || !projectStatus?.credential.secureStorageAvailable
                    }
                    onPress={() => void window.api.projectAwareness.openTokenSettings()}
                  >
                    {t('settings.project.credential.create')}
                  </ActionButton>
                  <ActionButton
                    isDisabled={
                      projectRuntimeBusy ||
                      !projectEnabled ||
                      !projectTargetApplied ||
                      !projectStatus?.credential.secureStorageAvailable ||
                      projectCredentialInput.trim().length < 20
                    }
                    onPress={() => void saveProjectCredential()}
                  >
                    {projectStatus?.credential.configured
                      ? t('settings.project.credential.replaceAndConnect')
                      : t('settings.project.credential.saveAndConnect')}
                  </ActionButton>
                  {projectStatus?.credential.source === 'secure_store' && (
                    <ActionButton
                      isDisabled={projectRuntimeBusy}
                      onPress={() => void forgetProjectCredential()}
                    >
                      {projectForgetConfirmation
                        ? t('settings.project.credential.confirmForget')
                        : t('settings.project.credential.forget')}
                    </ActionButton>
                  )}
                </div>
                {!projectStatus?.credential.secureStorageAvailable && (
                  <Text UNSAFE_className="project-credential-warning">
                    {t('settings.project.credential.unavailable')}
                  </Text>
                )}
                {projectStatus?.credential.lastError && (
                  <Text UNSAFE_className="project-credential-warning">
                    {projectStatus.credential.lastError}
                  </Text>
                )}
              </div>
              <div className="project-runtime-controls">
                <div className="project-credential-copy">
                  <strong>{t('settings.project.controls.title')}</strong>
                  <span>{t('settings.project.controls.description')}</span>
                </div>
                <div className="project-awareness-actions">
                  {projectConnected ? (
                    <ActionButton
                      isDisabled={projectRuntimeBusy || !projectTargetApplied}
                      onPress={() =>
                        void runProjectAction(() => window.api.projectAwareness.disconnect())
                      }
                    >
                      {t('common.disconnect')}
                    </ActionButton>
                  ) : (
                    <ActionButton
                      isDisabled={
                        projectRuntimeBusy ||
                        !projectEnabled ||
                        !projectTargetApplied ||
                        !projectStatus?.credential.configured
                      }
                      onPress={() =>
                        void runProjectAction(() => window.api.projectAwareness.connect())
                      }
                    >
                      {t('common.connect')}
                    </ActionButton>
                  )}
                  <ActionButton
                    isDisabled={!projectConnected || projectRuntimeBusy || !projectTargetApplied}
                    onPress={() => void runProjectAction(() => window.api.projectAwareness.sync())}
                  >
                    {t('settings.project.sync')}
                  </ActionButton>
                  <ActionButton
                    isDisabled={
                      !projectHasIndex ||
                      projectRuntimeBusy ||
                      !projectEnabled ||
                      !projectTargetApplied ||
                      !projectStatus?.credential.configured
                    }
                    onPress={() =>
                      void runProjectAction(() => window.api.projectAwareness.rebuildIndex())
                    }
                  >
                    {t('settings.project.rebuild')}
                  </ActionButton>
                </div>
              </div>
            </div>
          ) : activeSection === 'speech' ? (
            <div className="settings-grid">
              <TextField
                label={t('settings.speech.url')}
                value={speechUrl}
                onChange={setSpeechUrl}
                styles={fullWidth}
              />

              <Picker
                label={TEXT.ttsLanguage}
                selectedKey={lang}
                onSelectionChange={(k) => setLang(String(k))}
                styles={fullWidth}
              >
                <PickerItem id="ru">{TEXT.russian}</PickerItem>
                <PickerItem id="en">{t('settings.language.en')}</PickerItem>
              </Picker>

              <Picker
                label={TEXT.microphone}
                selectedKey={micId}
                onSelectionChange={(k) => {
                  const id = String(k)
                  setMicId(id)
                  controller.setMicrophone(id === 'default' ? '' : id)
                }}
                styles={fullWidth}
              >
                {mics.map((m) => (
                  <PickerItem key={m.deviceId} id={m.deviceId}>
                    {m.label}
                  </PickerItem>
                ))}
              </Picker>
            </div>
          ) : activeSection === 'listening' ? (
            <div className="settings-grid streaming-settings">
              <div className="streaming-field-heading">
                <Heading level={3}>{t('streaming.mode.label')}</Heading>
                <ContextualHelp variant="info" aria-label={TEXT.attentionModesHelp}>
                  <Heading>{TEXT.attentionModesHelp}</Heading>
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
                aria-label={TEXT.attentionMode}
                selectedKey={continuousListeningMode}
                onSelectionChange={(key) => {
                  const mode = parseAttentionMode(String(key))
                  void controller.setContinuousListeningMode(mode)
                }}
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
                {continuousListeningMode === 'active'
                  ? t('settings.listening.active.summary')
                  : continuousListeningMode === 'streamer'
                    ? t('settings.listening.streamer.summary')
                    : continuousListeningMode === 'passive'
                      ? t('settings.listening.passive.summary')
                      : t('settings.listening.silent.summary')}
              </Text>
              <div className="streaming-slider">
                <Slider
                  label={t('settings.listening.spontaneity')}
                  value={curiosityChancePercent}
                  minValue={0}
                  maxValue={20}
                  step={1}
                  onChange={setCuriosityChancePercent}
                  isDisabled={!curiosityEnabled}
                />
                <span className="streaming-slider-value">{curiosityChancePercent}%</span>
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
                      value={replyCooldownMs / 1000}
                      minValue={0}
                      maxValue={120}
                      step={0.5}
                      onChange={(value) => setReplyCooldownMs(value * 1000)}
                    />
                    <Text slot="description">
                      {t('settings.listening.replyCooldown.description')}
                    </Text>
                    <NumberField
                      label={t('settings.listening.followUpWindow')}
                      value={followUpWindowMs / 1000}
                      minValue={0}
                      maxValue={120}
                      step={0.5}
                      onChange={(value) => setFollowUpWindowMs(value * 1000)}
                    />
                    <Text slot="description">
                      {t('settings.listening.followUpWindow.description')}
                    </Text>
                  </div>
                </DisclosurePanel>
              </Disclosure>
              {/* Legacy control removed.
                    <ContextualHelp variant="info" aria-label={TEXT.attentionModesHelp}>
                      <Heading>{TEXT.attentionModesHelp}</Heading>
                      <Content>
                        <div className="attention-mode-help">
                          <p><strong>Silent.</strong> Shio не реагирует на фоновую речь. Ответ возможен через ручную активацию или обычный ввод.</p>
                          <p><strong>Passive — рекомендуется.</strong> Shio отвечает только на прямое обращение «Шио» или «Shio».</p>
                          <p><strong>Active.</strong> Прямые обращения принимаются; возможна редкая реакция на вопросы и продолжение диалога.</p>
                          <p><strong>Streamer.</strong> Shio чаще замечает реплики и иногда комментирует речь без прямого обращения.</p>
                        </div>
                      </Content>
                    </ContextualHelp>
                  }
                  selectedKey={continuousListeningMode}
                  onSelectionChange={(key) => void controller.setContinuousListeningMode(parseAttentionMode(String(key)))}
                  isDisabled
                  styles={fullWidth}
                >
                  <PickerItem id="silent">Silent</PickerItem>
                  <PickerItem id="passive">Passive</PickerItem>
                  <PickerItem id="active">Active</PickerItem>
                  <PickerItem id="streamer">Streamer</PickerItem>
                </Picker>
                <NumberField
                  label={TEXT.replyCooldown}
                  value={replyCooldownMs}
                  minValue={0}
                  maxValue={120000}
                  step={1000}
                  onChange={setReplyCooldownMs}
                  isDisabled
                />
                <NumberField
                  label={TEXT.followUpWindow}
                  value={followUpWindowMs}
                  minValue={0}
                  maxValue={120000}
                  step={1000}
                  onChange={setFollowUpWindowMs}
                  isDisabled
                />
                <Slider
                  label={TEXT.curiosityChance}
                  value={curiosityChancePercent}
                  minValue={0}
                  maxValue={20}
                  step={1}
                  onChange={setCuriosityChancePercent}
                  isDisabled={!curiosityEnabled}
                /> */}
            </div>
          ) : activeSection === 'llm' ? (
            <div className="settings-grid llm-settings-grid">
              <section className="llm-settings-section" aria-labelledby="primary-llm-title">
                <div className="llm-section-heading">
                  <Heading id="primary-llm-title" level={3}>
                    {t('settings.llm.primary')}
                  </Heading>
                  <LlmHealthStatus health={llmHealth} />
                </div>
                <Picker
                  label={t('common.provider')}
                  selectedKey={activeProvider}
                  onSelectionChange={(k) => {
                    setActiveProvider(String(k) as LlmProviderId)
                    setEditingKey(false)
                    setKeyInput('')
                  }}
                  styles={fullWidth}
                >
                  {providers.map((p) => (
                    <PickerItem key={p.id} id={p.id}>
                      {p.displayName}
                    </PickerItem>
                  ))}
                </Picker>

                <div className="settings-field">
                  <span className="settings-label">{TEXT.llmApiKey}</span>
                  <div className="settings-row">
                    {editingKey ? (
                      <TextField
                        aria-label={TEXT.llmApiKey}
                        value={keyInput}
                        onChange={setKeyInput}
                        type="password"
                        placeholder={TEXT.newKeyPlaceholder}
                        UNSAFE_className="grow"
                      />
                    ) : (
                      <TextField
                        aria-label={TEXT.llmApiKey}
                        value={savedKey ? maskKey(savedKey) : ''}
                        isReadOnly
                        placeholder="..."
                        UNSAFE_className="grow"
                      />
                    )}
                    <TooltipTrigger delay={200}>
                      <ActionButton
                        aria-label={TEXT.copyKey}
                        onPress={copyKey}
                        isDisabled={!savedKey}
                      >
                        <CopyIcon />
                      </ActionButton>
                      <Tooltip>{TEXT.copyKey}</Tooltip>
                    </TooltipTrigger>
                    {!editingKey && (
                      <TooltipTrigger delay={200}>
                        <ActionButton aria-label={TEXT.editKey} onPress={() => setEditingKey(true)}>
                          <EditIcon />
                        </ActionButton>
                        <Tooltip>{TEXT.editKey}</Tooltip>
                      </TooltipTrigger>
                    )}
                  </div>
                  {copied && (
                    <Text UNSAFE_className="settings-hint" role="status">
                      {t('settings.llm.copied')}
                    </Text>
                  )}
                </div>

                <div className="settings-field">
                  <span className="settings-label">{TEXT.llmModel}</span>
                  <ModelComboBox
                    label={TEXT.llmModel}
                    models={modelOptions}
                    selectedId={selectedModel}
                    isDisabled={modelsState !== 'ready'}
                    isLoading={modelsState === 'loading'}
                    showCapabilities
                    onSelect={(id) => updateCred(activeProvider, { model: id })}
                  />
                  <span className="settings-hint">
                    {modelsState === 'loading' && (
                      <>
                        <ProgressCircle aria-label={TEXT.modelsLoading} isIndeterminate size="S" />{' '}
                        {TEXT.modelsLoading}
                      </>
                    )}
                    {modelsState === 'empty' && TEXT.modelsEmpty}
                    {modelsState === 'missing-key' && TEXT.modelsMissingKey}
                    {modelsState === 'auth-error' && TEXT.modelsAuthError}
                    {modelsState === 'network-error' && TEXT.modelsNetworkError}
                  </span>
                  {(modelsState === 'network-error' || modelsState === 'auth-error') && (
                    <ActionButton onPress={() => void loadModels(activeProvider, activeApiKey)}>
                      <Text>{TEXT.loadModels}</Text>
                    </ActionButton>
                  )}
                </div>
              </section>
              <Divider />
              <section className="llm-settings-section" aria-labelledby="backlog-selector-title">
                <div className="llm-selector-title-row">
                  <Heading id="backlog-selector-title" level={3}>
                    {t('settings.llm.smart.title')}
                  </Heading>
                  <div className="llm-selector-actions">
                    <Switch
                      aria-label={t('settings.llm.smart.enable')}
                      isSelected={backlogRole.enabled}
                      onChange={(enabled) => setBacklogRole((value) => ({ ...value, enabled }))}
                    />
                    <ContextualHelp
                      variant="info"
                      size="S"
                      aria-label={t('settings.llm.smart.more')}
                    >
                      <Heading>{t('settings.llm.smart.title')}</Heading>
                      <Content>{t('settings.llm.smart.description')}</Content>
                    </ContextualHelp>
                  </div>
                </div>
                <Text UNSAFE_className="settings-hint">{t('settings.llm.smart.hint')}</Text>
                {backlogRole.enabled && (
                  <div className="llm-selector-fields">
                    <Picker
                      label={t('common.provider')}
                      selectedKey={backlogRole.providerId || null}
                      onSelectionChange={(key) =>
                        setBacklogRole((value) => ({
                          ...value,
                          providerId: String(key) as LlmProviderId,
                          model: '',
                        }))
                      }
                      styles={fullWidth}
                    >
                      {providers
                        .filter((provider) => Boolean(providerCreds[provider.id]?.apiKey))
                        .map((provider) => (
                          <PickerItem key={provider.id} id={provider.id}>
                            {provider.displayName}
                          </PickerItem>
                        ))}
                    </Picker>
                    <ModelComboBox
                      label={t('common.model')}
                      models={backlogModels}
                      selectedId={backlogRole.model}
                      isDisabled={!backlogRole.providerId || backlogModels.length === 0}
                      placeholder={t('common.searchModel')}
                      onSelect={(id) => setBacklogRole((value) => ({ ...value, model: id }))}
                    />
                  </div>
                )}
              </section>
            </div>
          ) : activeSection === 'avatar' ? (
            <div className="settings-grid avatar-panel">
              <section className="avatar-section" aria-labelledby="avatar-model-title">
                <h3 id="avatar-model-title" className="overlay-section-title">
                  {TEXT.modelSection}
                </h3>
                <div className="settings-field">
                  <span className="settings-label">{TEXT.vrmModel}</span>
                  <div className="settings-row">
                    <Button variant="secondary" onPress={pickVrm}>
                      {TEXT.chooseFile}
                    </Button>
                    <span className="settings-hint">{vrmName || TEXT.modelNotSelected}</span>
                  </div>
                </div>
              </section>

              <Divider />

              <section className="avatar-section" aria-labelledby="avatar-behavior-title">
                <h3 id="avatar-behavior-title" className="overlay-section-title">
                  {TEXT.behaviorSection}
                </h3>
                <div
                  className={
                    passiveCompanionEnabled ? 'overlay-toggle-card active' : 'overlay-toggle-card'
                  }
                >
                  <div className="overlay-toggle-copy">
                    <span className="overlay-toggle-title">{TEXT.passiveTitle}</span>
                    <span className="overlay-toggle-hint">{TEXT.passiveHint}</span>
                  </div>
                  <div className="overlay-toggle-control">
                    <span className="overlay-toggle-status">
                      {passiveCompanionEnabled ? TEXT.passiveOn : TEXT.passiveOff}
                    </span>
                    <Switch
                      size="L"
                      isEmphasized
                      isSelected={passiveCompanionEnabled}
                      onChange={onPassiveCompanionChange}
                    />
                  </div>
                </div>
              </section>

              <Divider />

              <section
                className="overlay-section overlay-display-section"
                aria-labelledby="avatar-overlay-title"
              >
                <h3 id="avatar-overlay-title" className="overlay-section-title">
                  {TEXT.overlaySection}
                </h3>
                <Switch
                  size="L"
                  isEmphasized
                  isSelected={overlayVisible}
                  onChange={(visible) => void toggleOverlay(visible)}
                >
                  {TEXT.overlayEnabledModern}
                </Switch>
                <span className="settings-hint">{TEXT.overlayEnabledHint}</span>
                {!overlayVisible && (
                  <span className="settings-hint overlay-disabled-note">
                    {TEXT.overlayDisabledNote}
                  </span>
                )}
              </section>

              <div className={!overlayVisible ? 'overlay-disabled-content' : undefined}>
                <section className="overlay-section" aria-labelledby="overlay-camera-title">
                  <div>
                    <h3 id="overlay-camera-title" className="overlay-section-title">
                      {TEXT.cameraSection}
                    </h3>
                    <span className="settings-hint">{TEXT.cameraDescription}</span>
                  </div>
                  <SegmentedControl
                    aria-label={TEXT.overlayViewMode}
                    selectedKey={overlayViewMode}
                    onSelectionChange={(k) => setOverlayViewMode(parseOverlayViewMode(String(k)))}
                    isDisabled={!overlayVisible}
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
                    {TEXT.displaySubSection}
                  </h3>
                  <div className="overlay-slider-grid">
                    <Slider
                      label={TEXT.overlayOpacity}
                      value={overlayOpacityPercent}
                      minValue={0}
                      maxValue={100}
                      step={1}
                      onChange={setOverlayOpacityPercent}
                      isDisabled={!overlayVisible}
                    />
                    <span className="overlay-slider-value">{overlayOpacityPercent}%</span>
                  </div>
                  <div className="overlay-slider-grid">
                    <Slider
                      label={TEXT.overlayScale}
                      value={overlayScalePercent}
                      minValue={50}
                      maxValue={200}
                      step={5}
                      onChange={setOverlayScalePercent}
                      isDisabled={!overlayVisible}
                    />
                    <span className="overlay-slider-value">{overlayScalePercent}%</span>
                  </div>
                  <SegmentedControl
                    aria-label={TEXT.overlayCorner}
                    selectedKey={overlayCorner}
                    onSelectionChange={(k) => setOverlayCorner(String(k))}
                    isDisabled={!overlayVisible}
                    isJustified
                    styles={fullWidth}
                  >
                    <SegmentedControlItem id="top-left">{TEXT.topLeft}</SegmentedControlItem>
                    <SegmentedControlItem id="top-right">{TEXT.topRight}</SegmentedControlItem>
                    <SegmentedControlItem id="bottom-left">{TEXT.bottomLeft}</SegmentedControlItem>
                    <SegmentedControlItem id="bottom-right">
                      {TEXT.bottomRight}
                    </SegmentedControlItem>
                  </SegmentedControl>
                </section>

                <section className="overlay-section" aria-labelledby="overlay-window-title">
                  <div>
                    <h3 id="overlay-window-title" className="overlay-section-title">
                      {TEXT.windowSection}
                    </h3>
                    <span className="settings-hint">{TEXT.windowDescription}</span>
                  </div>
                  <div className="overlay-number-grid">
                    <NumberField
                      label={TEXT.overlayWidth}
                      value={overlayWidth}
                      minValue={250}
                      maxValue={2000}
                      step={10}
                      onChange={setOverlayWidth}
                      isDisabled={!overlayVisible}
                      hideStepper
                    />
                    <NumberField
                      label={TEXT.overlayHeight}
                      value={overlayHeight}
                      minValue={250}
                      maxValue={2000}
                      step={10}
                      onChange={setOverlayHeight}
                      isDisabled={!overlayVisible}
                      hideStepper
                    />
                    <NumberField
                      label={TEXT.overlayMargin}
                      value={overlayMargin}
                      minValue={0}
                      maxValue={500}
                      step={10}
                      onChange={setOverlayMargin}
                      isDisabled={!overlayVisible}
                      hideStepper
                    />
                  </div>
                </section>

                <section className="overlay-section" aria-labelledby="overlay-interaction-title">
                  <h3 id="overlay-interaction-title" className="overlay-section-title">
                    {TEXT.interactionSection}
                  </h3>
                  <div className="overlay-switch-list">
                    <Switch
                      isSelected={overlayClickThrough}
                      onChange={setOverlayClickThrough}
                      isDisabled={!overlayVisible}
                    >
                      {TEXT.overlayClickThrough}
                    </Switch>
                    <span className="settings-hint">{TEXT.clickThroughDescription}</span>
                  </div>
                  <div className="overlay-switch-list">
                    <Switch
                      isSelected={overlayTransparentBackground}
                      onChange={setOverlayTransparentBackground}
                      isDisabled={!overlayVisible}
                    >
                      {TEXT.overlayTransparentBackground}
                    </Switch>
                    <span className="settings-hint">{TEXT.transparentDescription}</span>
                  </div>
                </section>
              </div>

              <div className="settings-row overlay-actions-row">
                <Button variant="secondary" onPress={resetOverlaySettings}>
                  {TEXT.resetOverlay}
                </Button>
              </div>
            </div>
          ) : null}
        </Content>
        {activeSection === 'advanced' && (
          <section className="danger-zone">
            <h3>{t('settings.danger.title')}</h3>
            <p>{t('settings.danger.description')}</p>
            <Button variant="negative" onPress={() => setConfirmClearHistory(true)}>
              {TEXT.clearHistory}
            </Button>
          </section>
        )}
      </div>
      {confirmClearHistory && (
        <div
          className="danger-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-history-title"
        >
          <div>
            <h2 id="clear-history-title">{t('settings.danger.confirmTitle')}</h2>
            <p>{t('settings.danger.confirmDescription')}</p>
            <ButtonGroup>
              <Button variant="secondary" autoFocus onPress={() => setConfirmClearHistory(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="negative"
                onPress={() => {
                  void controller.clearHistory()
                  setConfirmClearHistory(false)
                }}
              >
                {t('settings.danger.clear')}
              </Button>
            </ButtonGroup>
          </div>
        </div>
      )}
    </section>
  )
}
