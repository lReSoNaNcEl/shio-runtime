import { ComboBox, ComboBoxItem, Switch, Text } from '@react-spectrum/s2'
import ImageIcon from '@react-spectrum/s2/icons/Image'
import LightbulbIcon from '@react-spectrum/s2/icons/Lightbulb'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }
import { useEffect, useState } from 'react'

import { type ModelInfo } from '../../../shared/llm'
import { useTranslation } from '../../localization/useTranslation'

const fullWidth = style({ width: 'full' })

export interface ModelComboBoxProps {
  label: string
  models: ModelInfo[]
  selectedId: string
  isDisabled?: boolean
  isLoading?: boolean
  placeholder?: string
  showCapabilities?: boolean
  onSelect: (id: string) => void
}

export function ModelComboBox({
  label,
  models,
  selectedId,
  isDisabled,
  isLoading,
  showCapabilities = false,
  onSelect,
}: ModelComboBoxProps) {
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
          } else setSearchText(selectedId)
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
          className={`model-capability-status ${selectedModel.capabilities.supportsVision ? 'model-capability-status-positive' : 'model-capability-status-neutral'}`}
        >
          <span aria-hidden="true">{selectedModel.capabilities.supportsVision ? '●' : '○'}</span>
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
