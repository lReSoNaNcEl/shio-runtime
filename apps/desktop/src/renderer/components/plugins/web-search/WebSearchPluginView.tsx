import { ActionButton, Heading, Text } from '@react-spectrum/s2'
import ChevronLeftIcon from '@react-spectrum/s2/icons/ChevronLeft'
import DiscoverIcon from '@react-spectrum/s2/icons/Discover'

import { type PluginStatus } from '../../../../shared/plugins'
import { useTranslation } from '../../../localization/useTranslation'
import { PluginSummary, PluginToggle } from '../PluginSummary'

export function WebSearchPluginView({
  plugin,
  onBack,
  onPluginChange,
}: {
  plugin: PluginStatus
  onBack: () => void
  onPluginChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <section className="plugin-detail page-container">
      <ActionButton isQuiet onPress={onBack} UNSAFE_className="plugin-back-button">
        <ChevronLeftIcon />
        <Text>{t('plugins.backToCatalog')}</Text>
      </ActionButton>
      <div className="plugin-detail-heading">
        <span className="plugin-icon" aria-hidden="true">
          <DiscoverIcon />
        </span>
        <div>
          <Heading level={2}>{t('plugins.webSearch.name')}</Heading>
          <Text>{t('plugins.webSearch.description')}</Text>
        </div>
        <PluginToggle plugin={plugin} onChange={onPluginChange} />
      </div>

      <section className="plugin-detail-section">
        <Heading level={3}>{t('plugins.desktopControl.stateTitle')}</Heading>
        <PluginSummary plugin={plugin} />
      </section>

      <section className="plugin-detail-section">
        <Heading level={3}>{t('plugins.webSearch.providerTitle')}</Heading>
        <Text>{t('plugins.webSearch.providerDescription')}</Text>
        <dl className="plugin-status-list">
          <div>
            <dt>{t('plugins.webSearch.providerTitle')}</dt>
            <dd>{t('plugins.webSearch.providerName')}</dd>
          </div>
          <div>
            <dt>{t('plugins.webSearch.authentication')}</dt>
            <dd>{t('plugins.webSearch.noApiKey')}</dd>
          </div>
        </dl>
      </section>
    </section>
  )
}
