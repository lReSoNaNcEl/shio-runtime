import { Badge, Image, Text, ToggleButton } from '@react-spectrum/s2'
import AppIcon from '@react-spectrum/s2/icons/App'
import DeviceDesktop from '@react-spectrum/s2/icons/DeviceDesktop'

import { type ScreenContextSource } from '../../../shared/screen-context'
import { useTranslation } from '../../localization/useTranslation'

export function ScreenSourceGrid({
  sources,
  selectedId,
  onSelect,
}: {
  sources: ScreenContextSource[]
  selectedId: string | null
  onSelect: (source: ScreenContextSource | null) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="screen-context-source-grid">
      {sources.map((source) => {
        const selected = source.id === selectedId
        const FallbackIcon = source.kind === 'window' ? AppIcon : DeviceDesktop
        return (
          <ToggleButton
            key={source.id}
            isSelected={selected}
            UNSAFE_className="screen-context-source"
            onChange={(isSelected) => onSelect(isSelected ? source : null)}
          >
            {source.previewDataUrl ? (
              <Image
                slot={null}
                UNSAFE_className="screen-context-source-thumbnail"
                src={source.previewDataUrl}
                alt=""
              />
            ) : (
              <span
                className="screen-context-source-thumbnail screen-context-source-placeholder"
                aria-hidden="true"
              >
                {source.appIconDataUrl ? (
                  <Image
                    slot={null}
                    UNSAFE_className="screen-context-source-fallback-icon"
                    src={source.appIconDataUrl}
                    alt=""
                  />
                ) : (
                  <FallbackIcon />
                )}
              </span>
            )}
            <span className="screen-context-source-info">
              <span className="screen-context-source-identity" title={source.name}>
                {source.previewDataUrl && source.appIconDataUrl && (
                  <Image
                    slot={null}
                    UNSAFE_className="screen-context-source-app-icon"
                    src={source.appIconDataUrl}
                    alt=""
                  />
                )}
                <Text UNSAFE_className="screen-context-source-name">{source.name}</Text>
              </span>
              <Badge size="S" variant={source.kind === 'screen' ? 'informative' : 'gray'}>
                {source.kind === 'screen'
                  ? t('screenContext.source.screen')
                  : t('screenContext.source.window')}
              </Badge>
            </span>
          </ToggleButton>
        )
      })}
    </div>
  )
}
