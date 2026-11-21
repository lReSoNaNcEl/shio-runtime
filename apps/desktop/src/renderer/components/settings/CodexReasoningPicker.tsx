import { Picker, PickerItem } from '@react-spectrum/s2'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }

import { type CodexReasoningEffort, type ModelReasoningOptions } from '../../../shared/llm'
import { useTranslation } from '../../localization/useTranslation'

const fullWidth = style({ width: 'full' })

export function CodexReasoningPicker({
  options,
  value,
  onChange,
}: {
  options?: ModelReasoningOptions
  value?: CodexReasoningEffort
  onChange: (value: CodexReasoningEffort | undefined) => void
}) {
  const { t } = useTranslation()
  if (!options?.levels.length) return null
  const defaultLabel = t('settings.llm.reasoningDefault')
  return (
    <Picker
      label={t('settings.llm.reasoningEffort')}
      styles={fullWidth}
      selectedKey={value && options.levels.includes(value) ? value : 'default'}
      onSelectionChange={(key) => {
        if (key === 'default') onChange(undefined)
        else {
          const level = options.levels.find((entry) => entry === key)
          if (level) onChange(level)
        }
      }}
    >
      <PickerItem id="default">
        {options.defaultLevel ? `${defaultLabel} (${options.defaultLevel})` : defaultLabel}
      </PickerItem>
      {options.levels.map((level) => (
        <PickerItem id={level} key={level}>
          {level}
        </PickerItem>
      ))}
    </Picker>
  )
}
